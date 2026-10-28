-- ============================================================================
-- NFS Trophy – Nennung selbst verwalten: Angaben ändern, Bewerbe dazunehmen (Projekt A)
-- ============================================================================
-- VORAUSSETZUNG: self-service.sql, setup-save.sql, players.sql (nfs_rc_int).
-- Im SQL-Editor komplett ausführen. Kann gefahrlos mehrfach laufen.
-- Funktioniert auch mit der aktuell veröffentlichten Website (nur Ergänzungen).
--
-- Ablauf wie beim Abmelden:
--   • registration_by_token (öffentlich) liefert jetzt auch die eigenen Angaben und
--     die Bewerbe, die man noch dazunehmen kann (mit freien Plätzen).
--     Nur wer den geheimen Link aus der Bestätigungsmail hat, sieht diese Daten.
--   • update_registration_self (nur Server/Edge Function) speichert Änderungen –
--     die Edge Function schickt danach Bestätigung an Spieler und Turnierleitung.
--   • Name ist nicht änderbar (hängt an Spielerdatenbank und Ergebnissen).
-- ============================================================================


-- 1) Hilfsfunktionen

-- Anmeldung offen? (Schalter im Admin UND Anmeldeschluss nicht vorbei)
create or replace function public.nfs_reg_open(p_tournament_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    t_open   boolean;
    info     jsonb;
    deadline timestamptz;
begin
    select t.is_open, to_jsonb(t.turnier_info) into t_open, info
      from public.tournaments t where t.id::text = p_tournament_id;
    if not coalesce(t_open, false) then return false; end if;

    if jsonb_typeof(info) = 'string' then
        begin
            info := (info #>> '{}')::jsonb;
        exception when others then
            info := '{}'::jsonb;
        end;
    end if;
    begin
        deadline := nullif(info ->> 'registrationDeadline', '')::timestamptz;
    exception when others then
        deadline := null;
    end;
    return deadline is null or now() <= deadline;
end;
$$;

-- Vergebene Startplätze (ohne Warteliste) in einem Bewerb – gleiche Zählung wie der Wartelisten-Trigger
create or replace function public.nfs_active_count(p_tournament_id text, p_bewerb text)
returns int
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::int
      from public.registrations r
     where r.tournament_id::text = p_tournament_id
       and (
            public.nfs_as_list(to_jsonb(r.bewerbe_list)) ? p_bewerb
            or (jsonb_array_length(public.nfs_as_list(to_jsonb(r.bewerbe_list))) = 0 and r.bewerb = p_bewerb)
       )
       and not (
            case
                when jsonb_array_length(public.nfs_as_list(to_jsonb(r.waitlist_bewerbe))) > 0
                    then public.nfs_as_list(to_jsonb(r.waitlist_bewerbe)) ? p_bewerb
                else coalesce(r.waitlist, false)
            end
       );
$$;

revoke all on function public.nfs_reg_open(text) from public, anon, authenticated;
revoke all on function public.nfs_active_count(text, text) from public, anon, authenticated;


-- 2) Nennung zu einem Link anzeigen – jetzt mit eigenen Angaben und Bewerbs-Angebot
create or replace function public.registration_by_token(p_token uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
    select json_build_object(
        'vorname',    r.vorname,
        'nachname',   r.nachname,
        'bewerbe',    case
                          when jsonb_array_length(public.nfs_as_list(to_jsonb(r.bewerbe_list))) = 0 and r.bewerb is not null
                              then jsonb_build_array(r.bewerb)
                          else public.nfs_as_list(to_jsonb(r.bewerbe_list))
                      end,
        'warteliste', public.nfs_as_list(to_jsonb(r.waitlist_bewerbe)),
        'turnier',    t.name,
        'datum',      t.date_text,
        'beginn',     t.date_iso,
        'abmeldbar',  (t.date_iso is null or now() < (t.date_iso::text)::timestamptz),
        -- eigene Angaben (nur über den geheimen Link sichtbar)
        'email',      r.email,
        'telefon',    r.telefon,
        'verein',     r.verein,
        'rc',         r.rc,
        'notiz',      r.notiz,
        'quittung',   coalesce(r.needs_receipt, false),
        'anmeldung_offen', public.nfs_reg_open(t.id::text),
        -- alle Bewerbe des Turniers mit freien Plätzen (zum Dazunehmen)
        'angebot',    (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'name',   b ->> 'name',
                       'time',   b ->> 'time',
                       'min_rc', nullif(b ->> 'min_rc', '')::int,
                       'max_rc', nullif(b ->> 'max_rc', '')::int,
                       'frei',   greatest(coalesce(nullif(b ->> 'capacity', '')::int, 20)
                                          - public.nfs_active_count(t.id::text, b ->> 'name'), 0)
                   ) order by o), '[]'::jsonb)
              from jsonb_array_elements(public.nfs_as_list(to_jsonb(t.bewerbe))) with ordinality x(b, o)
        )
    )
    from public.registrations r
    join public.tournaments t on t.id = r.tournament_id
    where r.cancel_token = p_token;
$$;

revoke all on function public.registration_by_token(uuid) from public;
grant execute on function public.registration_by_token(uuid) to anon, authenticated, service_role;


-- 3) Angaben ändern / Bewerbe dazunehmen – nur für den Server (Edge Function)
--    p_data: { email?, telefon?, verein?, rc?, notiz?, quittung?, add?: ["Bewerb", …] }
create or replace function public.update_registration_self(p_token uuid, p_data jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    tid       text;
    r         public.registrations%rowtype;
    t_bewerbe jsonb;
    t_begin   timestamptz;
    list      jsonb;
    wl        jsonb;
    add_list  jsonb;
    added     jsonb := '[]'::jsonb;
    added_wl  jsonb := '[]'::jsonb;
    b         jsonb;
    nm        text;
    rc_val    int;
    lim       int;
    v_email   text;
    v_telefon text;
    v_verein  text;
    v_rc      text;
    v_notiz   text;
    v_receipt boolean;
    changes   jsonb := '{}'::jsonb;
begin
    p_data := coalesce(p_data, '{}'::jsonb);

    select r0.tournament_id::text into tid from public.registrations r0 where r0.cancel_token = p_token;
    if tid is null then
        return json_build_object('ok', false, 'reason', 'not_found');
    end if;

    -- Gleiche Sperre wie Website-Nennungen und Turnier-Speichern (Plätze zählen, keine Überbuchung)
    perform pg_advisory_xact_lock(hashtext('nfs_reg_' || tid));

    select * into r from public.registrations where cancel_token = p_token for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'not_found');
    end if;

    select public.nfs_as_list(to_jsonb(t.bewerbe)), (t.date_iso::text)::timestamptz
      into t_bewerbe, t_begin
      from public.tournaments t where t.id = r.tournament_id;
    if t_begin is not null and now() >= t_begin then
        return json_build_object('ok', false, 'reason', 'too_late');
    end if;

    -- Angaben (nur was mitgeschickt wurde; leer = leeren, außer E-Mail)
    v_email   := r.email;
    v_telefon := r.telefon;
    v_verein  := r.verein;
    v_rc      := r.rc;
    v_notiz   := r.notiz;
    v_receipt := coalesce(r.needs_receipt, false);

    if p_data ? 'email' then
        v_email := lower(trim(p_data ->> 'email'));
        if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 200 then
            return json_build_object('ok', false, 'reason', 'invalid_email');
        end if;
        -- Groß-/Kleinschreibung der alten Adresse nicht als Änderung werten
        if v_email = lower(coalesce(r.email, '')) then v_email := r.email; end if;
    end if;
    if p_data ? 'telefon' then v_telefon := left(trim(coalesce(p_data ->> 'telefon', '')), 40); end if;
    if p_data ? 'verein'  then v_verein  := left(trim(coalesce(p_data ->> 'verein', '')), 120); end if;
    if p_data ? 'rc'      then v_rc      := left(trim(coalesce(p_data ->> 'rc', '')), 10); end if;
    if p_data ? 'notiz'   then v_notiz   := left(trim(coalesce(p_data ->> 'notiz', '')), 1000); end if;
    if p_data ? 'quittung' and jsonb_typeof(p_data -> 'quittung') = 'boolean' then
        v_receipt := (p_data ->> 'quittung')::boolean;
    end if;

    -- Bewerbe dazunehmen
    list := public.nfs_as_list(to_jsonb(r.bewerbe_list));
    if jsonb_array_length(list) = 0 and r.bewerb is not null then
        list := jsonb_build_array(r.bewerb);
    end if;
    wl := public.nfs_as_list(to_jsonb(r.waitlist_bewerbe));
    add_list := public.nfs_as_list(p_data -> 'add');

    if jsonb_array_length(add_list) > 0 then
        if not public.nfs_reg_open(tid) then
            return json_build_object('ok', false, 'reason', 'closed');
        end if;
        rc_val := coalesce(public.nfs_rc_int(v_rc), 0);

        for nm in select jsonb_array_elements_text(add_list) loop
            continue when list ? nm;
            b := null;
            select x into b from jsonb_array_elements(t_bewerbe) x where x ->> 'name' = nm limit 1;
            if b is null then
                return json_build_object('ok', false, 'reason', 'unknown_bewerb', 'bewerb', nm);
            end if;
            lim := nullif(b ->> 'min_rc', '')::int;
            if coalesce(lim, 0) > 0 and rc_val < lim then
                return json_build_object('ok', false, 'reason', 'rc_low', 'bewerb', nm, 'limit', lim);
            end if;
            lim := nullif(b ->> 'max_rc', '')::int;
            if coalesce(lim, 0) > 0 and rc_val > lim then
                return json_build_object('ok', false, 'reason', 'rc_high', 'bewerb', nm, 'limit', lim);
            end if;

            if public.nfs_active_count(tid, nm) >= coalesce(nullif(b ->> 'capacity', '')::int, 20) then
                wl := wl || to_jsonb(nm);
                added_wl := added_wl || to_jsonb(nm);
            end if;
            list := list || to_jsonb(nm);
            added := added || to_jsonb(nm);
        end loop;
    end if;

    -- Für Mails und Protokoll: was hat sich geändert? (alt → neu)
    if v_email   is distinct from r.email   then changes := changes || jsonb_build_object('E-Mail',      jsonb_build_array(r.email, v_email)); end if;
    if v_telefon is distinct from r.telefon then changes := changes || jsonb_build_object('Telefon',     jsonb_build_array(r.telefon, v_telefon)); end if;
    if v_verein  is distinct from r.verein  then changes := changes || jsonb_build_object('Verein',      jsonb_build_array(r.verein, v_verein)); end if;
    if v_rc      is distinct from r.rc      then changes := changes || jsonb_build_object('RC-Punkte',   jsonb_build_array(r.rc, v_rc)); end if;
    if v_notiz   is distinct from r.notiz   then changes := changes || jsonb_build_object('Anmerkung',   jsonb_build_array(r.notiz, v_notiz)); end if;
    if v_receipt is distinct from coalesce(r.needs_receipt, false) then
        changes := changes || jsonb_build_object('Quittung', jsonb_build_array(
            case when coalesce(r.needs_receipt, false) then 'ja' else 'nein' end,
            case when v_receipt then 'ja' else 'nein' end));
    end if;

    if changes = '{}'::jsonb and jsonb_array_length(added) = 0 then
        return json_build_object('ok', false, 'reason', 'nothing_changed');
    end if;

    perform set_config('nfs.actor', 'Selbst-Änderung', true);
    begin
        update public.registrations r2
           set email            = p.email,
               telefon          = p.telefon,
               verein           = p.verein,
               rc               = p.rc,
               notiz            = p.notiz,
               needs_receipt    = p.needs_receipt,
               bewerbe_list     = p.bewerbe_list,
               waitlist_bewerbe = p.waitlist_bewerbe,
               bewerb           = p.bewerb,
               waitlist         = p.waitlist
          from jsonb_populate_record(null::public.registrations, jsonb_build_object(
                   'email', v_email, 'telefon', v_telefon, 'verein', v_verein, 'rc', v_rc,
                   'notiz', v_notiz, 'needs_receipt', v_receipt,
                   'bewerbe_list', list,
                   'waitlist_bewerbe', wl,
                   'bewerb', list ->> 0,
                   'waitlist', jsonb_array_length(wl) > 0 and jsonb_array_length(wl) = jsonb_array_length(list)
               )) p
         where r2.id = r.id;
    exception when unique_violation then
        -- Gleicher Name + neue E-Mail ist schon genannt
        return json_build_object('ok', false, 'reason', 'duplicate');
    end;

    return json_build_object(
        'ok', true,
        'added', added,
        'added_waitlist', added_wl,
        'changes', changes,
        'bewerbe', list,
        'warteliste', wl,
        'vorname', r.vorname,
        'nachname', r.nachname,
        'email', v_email,
        'old_email', r.email,
        'tournament_id', r.tournament_id
    );
end;
$$;

revoke all on function public.update_registration_self(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_registration_self(uuid, jsonb) to service_role;
