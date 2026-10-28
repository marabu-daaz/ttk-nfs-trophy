-- ============================================================================
-- NFS Trophy – Turnier-Setup sicher speichern (Projekt A)
-- ============================================================================
-- VORAUSSETZUNG: hardening.sql, admins.sql (is_admin) wurden ausgeführt.
-- Im SQL-Editor komplett ausführen. Kann gefahrlos mehrfach laufen.
-- Funktioniert auch mit der aktuell veröffentlichten Website (nur Ergänzungen).
--
-- 1) nfs_save_tournament: Turnier-Setup in EINEM Schritt speichern
--    • schreibt nur die Felder, die im Admin geändert wurden
--    • prüft, ob jemand anderes dieselben Felder inzwischen gespeichert hat
--      (zwei Admins gleichzeitig → keine stillen Überschreibungen)
--    • benennt Bewerbe samt aller Nennungen um – alles oder nichts
--    • blockiert dabei kurz neue Website-Nennungen (gleiche Sperre wie die Warteliste),
--      damit keine Nennung mit dem alten Bewerbsnamen „durchrutscht“
--    • verhindert das Entfernen von Bewerben, in denen noch jemand genannt ist
--
-- 2) Wartelisten-Trigger: Nennungen für Bewerbe, die es (nicht mehr) gibt, ablehnen
--    (z.B. Website war offen, während im Admin umbenannt wurde)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Turnier-Setup speichern
-- ----------------------------------------------------------------------------
create or replace function public.nfs_save_tournament(
    p_id      text,
    p_patch   jsonb,
    p_expect  jsonb default '{}'::jsonb,   -- Werte, die der Admin zuletzt gesehen hat
    p_renames jsonb default '{}'::jsonb    -- { "alter Name": "neuer Name" }
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    allowed   text[] := array['is_open', 'name', 'date_text', 'date_iso', 'subtitle', 'oettv_url',
                              'fee_normal', 'fee_nfs', 'bewerbe', 'turnier_info', 'show_ttop_button',
                              'ttop_url', 'hall_of_fame', 'ausschreibung_path'];
    cur       jsonb;
    k         text;
    sets      text;
    new_names jsonb;
    orphan    text;
    orphan_n  int;
    r         record;
    list      jsonb;
    wl        jsonb;
    new_list  jsonb;
    new_wl    jsonb;
    moved     int := 0;
begin
    if not public.is_admin() then
        raise exception 'Nur für Admins.';
    end if;

    p_patch   := coalesce(p_patch, '{}'::jsonb);
    p_expect  := coalesce(p_expect, '{}'::jsonb);
    p_renames := case when jsonb_typeof(p_renames) = 'object' then p_renames else '{}'::jsonb end;

    -- Gleiche Sperre wie bei neuen Nennungen (nfs_compute_waitlist): Website-Nennungen
    -- warten, bis hier fertig gespeichert ist, und sehen danach schon die neuen Bewerbsnamen.
    perform pg_advisory_xact_lock(hashtext('nfs_reg_' || p_id));

    select to_jsonb(t) into cur from public.tournaments t where t.id::text = p_id for update;
    if cur is null then
        return json_build_object('ok', false, 'reason', 'not_found');
    end if;

    -- Hat jemand anderes diese Felder geändert, seit der Admin sie geprüft hat?
    for k in select jsonb_object_keys(p_expect) loop
        if coalesce(cur -> k, 'null'::jsonb) is distinct from coalesce(p_expect -> k, 'null'::jsonb) then
            return json_build_object('ok', false, 'reason', 'conflict', 'field', k);
        end if;
    end loop;

    -- Bewerb entfernt, in dem noch jemand genannt ist? (Umbenennungen zählen als behalten)
    if p_patch ? 'bewerbe' then
        select coalesce(jsonb_agg(b ->> 'name'), '[]'::jsonb) into new_names
          from jsonb_array_elements(public.nfs_as_list(p_patch -> 'bewerbe')) b;

        select x, count(*) into orphan, orphan_n
          from public.registrations reg,
               lateral jsonb_array_elements_text(
                   case when jsonb_array_length(public.nfs_as_list(to_jsonb(reg.bewerbe_list))) > 0
                            then public.nfs_as_list(to_jsonb(reg.bewerbe_list))
                        when reg.bewerb is not null then jsonb_build_array(reg.bewerb)
                        else '[]'::jsonb
                   end) x
         where reg.tournament_id::text = p_id
           and not new_names ? coalesce(p_renames ->> x, x)
         group by x
         limit 1;

        if orphan is not null then
            raise exception 'Der Bewerb „%“ hat noch % Nennung(en) und kann nicht entfernt werden. Bitte zuerst im Bereich „Bewerbe“ abmelden – oder umbenennen statt löschen.', orphan, orphan_n;
        end if;
    end if;

    -- Nur die geänderten Felder schreiben
    select string_agg(format('%1$I = p.%1$I', key), ', ') into sets
      from jsonb_object_keys(p_patch) key
     where key = any(allowed);

    if sets is not null then
        execute format(
            'update public.tournaments t set %s from jsonb_populate_record(null::public.tournaments, $1) p where t.id::text = $2',
            sets
        ) using p_patch, p_id;
    end if;

    -- Nennungen auf die neuen Bewerbsnamen umstellen (Warteliste wandert mit)
    if p_renames <> '{}'::jsonb then
        for r in
            select reg.id, reg.bewerb, reg.bewerbe_list, reg.waitlist_bewerbe
              from public.registrations reg
             where reg.tournament_id::text = p_id
               for update
        loop
            list := public.nfs_as_list(to_jsonb(r.bewerbe_list));
            if jsonb_array_length(list) = 0 and r.bewerb is not null then
                list := jsonb_build_array(r.bewerb);
            end if;
            wl := public.nfs_as_list(to_jsonb(r.waitlist_bewerbe));

            select coalesce(jsonb_agg(coalesce(p_renames ->> x, x) order by o), '[]'::jsonb) into new_list
              from jsonb_array_elements_text(list) with ordinality a(x, o);
            select coalesce(jsonb_agg(coalesce(p_renames ->> x, x) order by o), '[]'::jsonb) into new_wl
              from jsonb_array_elements_text(wl) with ordinality a(x, o);

            continue when new_list = list and new_wl = wl;

            update public.registrations reg
               set bewerbe_list     = p.bewerbe_list,
                   waitlist_bewerbe = p.waitlist_bewerbe,
                   bewerb           = p.bewerb
              from jsonb_populate_record(null::public.registrations, jsonb_build_object(
                       'bewerbe_list', new_list,
                       'waitlist_bewerbe', new_wl,
                       'bewerb', new_list ->> 0
                   )) p
             where reg.id = r.id;
            moved := moved + 1;
        end loop;
    end if;

    return json_build_object('ok', true, 'moved', moved);
end;
$$;

revoke all on function public.nfs_save_tournament(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.nfs_save_tournament(text, jsonb, jsonb, jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- 2) Wartelisten-Trigger (Stand admins.sql) + Prüfung auf unbekannte Bewerbe
-- ----------------------------------------------------------------------------
create or replace function public.nfs_compute_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    t_bewerbe   jsonb;
    t_open      boolean;
    b           jsonb;
    b_name      text;
    cap         int;
    active_cnt  int;
    selected    jsonb;
    wl          jsonb := '[]'::jsonb;
begin
    if public.is_admin() then
        return new;
    end if;

    perform pg_advisory_xact_lock(hashtext('nfs_reg_' || new.tournament_id::text));

    select public.nfs_as_list(to_jsonb(t.bewerbe)), t.is_open
      into t_bewerbe, t_open
      from public.tournaments t
     where t.id = new.tournament_id;

    if not coalesce(t_open, false) then
        raise exception 'Die Anmeldung für dieses Turnier ist geschlossen.';
    end if;

    selected := public.nfs_as_list(to_jsonb(new.bewerbe_list));
    if jsonb_array_length(selected) = 0 and new.bewerb is not null then
        selected := jsonb_build_array(new.bewerb);
    end if;

    -- Bewerb gibt es nicht (mehr)? Seite war offen, während im Admin umbenannt wurde
    if exists (
        select 1 from jsonb_array_elements_text(selected) s
         where not exists (select 1 from jsonb_array_elements(t_bewerbe) x where x ->> 'name' = s)
    ) then
        raise exception 'Die Bewerbe wurden inzwischen geändert – bitte lade die Seite neu und wähle deine Bewerbe noch einmal.';
    end if;

    for b in select * from jsonb_array_elements(t_bewerbe) loop
        b_name := b->>'name';
        continue when not (selected ? b_name);

        cap := coalesce(nullif(b->>'capacity', '')::int, 20);

        select count(*) into active_cnt
          from public.registrations r
         where r.tournament_id = new.tournament_id
           and (
                public.nfs_as_list(to_jsonb(r.bewerbe_list)) ? b_name
                or (jsonb_array_length(public.nfs_as_list(to_jsonb(r.bewerbe_list))) = 0 and r.bewerb = b_name)
           )
           and not (
                case
                    when jsonb_array_length(public.nfs_as_list(to_jsonb(r.waitlist_bewerbe))) > 0
                        then public.nfs_as_list(to_jsonb(r.waitlist_bewerbe)) ? b_name
                    else coalesce(r.waitlist, false)
                end
           );

        if active_cnt >= cap then
            wl := wl || to_jsonb(b_name);
        end if;
    end loop;

    new := jsonb_populate_record(new, jsonb_build_object(
        'waitlist_bewerbe', wl,
        'waitlist', jsonb_array_length(wl) > 0 and jsonb_array_length(wl) = jsonb_array_length(selected)
    ));

    return new;
end;
$$;
