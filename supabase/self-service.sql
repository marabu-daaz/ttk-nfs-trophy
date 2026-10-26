-- ============================================================================
-- NFS Trophy – Selbst-Abmeldung per Link (Projekt A)
-- ============================================================================
-- VORAUSSETZUNG: hardening.sql (nfs_as_list) und audit-log.sql wurden ausgeführt.
-- Komplett ausführen. Kann gefahrlos mehrfach laufen.
--
-- Ablauf:
--   • Jede Nennung bekommt einen zufälligen, nicht erratbaren Schlüssel (cancel_token).
--   • Die Bestätigungsmail enthält den Link  https://nfs-trophy.com/abmelden?t=<token>
--   • Die Abmeldeseite zeigt die Nennung (registration_by_token, öffentlich).
--   • Abmelden selbst läuft über die Edge Function (cancel_registration, nur Server),
--     damit Spieler und Turnierleitung immer eine Mail bekommen.
-- ============================================================================

-- 1) Schlüssel + Zeitpunkt des letzten „Link erneut senden“
alter table public.registrations
    add column if not exists cancel_token uuid not null default gen_random_uuid();
create unique index if not exists registrations_cancel_token_uniq
    on public.registrations (cancel_token);

alter table public.registrations
    add column if not exists link_sent_at timestamptz;

-- Hinweis: public_registrations listet ihre Spalten explizit auf –
-- cancel_token ist dort NICHT enthalten und bleibt geheim.


-- 2) Nennung zu einem Link anzeigen (öffentlich, verrät keine E-Mail/Telefon)
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
        'abmeldbar',  (t.date_iso is null or now() < (t.date_iso::text)::timestamptz)
    )
    from public.registrations r
    join public.tournaments t on t.id = r.tournament_id
    where r.cancel_token = p_token;
$$;

revoke all on function public.registration_by_token(uuid) from public;
grant execute on function public.registration_by_token(uuid) to anon, authenticated, service_role;


-- 3) Abmelden (ganz oder einzelne Bewerbe) – nur für den Server (Edge Function)
create or replace function public.cancel_registration(p_token uuid, p_bewerbe text[] default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    r        public.registrations%rowtype;
    t_begin  timestamptz;
    list     jsonb;
    wl       jsonb;
    keep     jsonb;
    removed  jsonb;
    freed    jsonb;
begin
    select * into r from public.registrations where cancel_token = p_token for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'not_found');
    end if;

    select (date_iso::text)::timestamptz into t_begin from public.tournaments where id = r.tournament_id;
    if t_begin is not null and now() >= t_begin then
        return json_build_object('ok', false, 'reason', 'too_late');
    end if;

    list := public.nfs_as_list(to_jsonb(r.bewerbe_list));
    if jsonb_array_length(list) = 0 and r.bewerb is not null then
        list := jsonb_build_array(r.bewerb);
    end if;
    wl := public.nfs_as_list(to_jsonb(r.waitlist_bewerbe));

    if p_bewerbe is null then
        removed := list;
        keep := '[]'::jsonb;
    else
        select coalesce(jsonb_agg(x), '[]'::jsonb) into removed
          from jsonb_array_elements_text(list) x where x = any(p_bewerbe);
        select coalesce(jsonb_agg(x), '[]'::jsonb) into keep
          from jsonb_array_elements_text(list) x where not (x = any(p_bewerbe));
    end if;

    if jsonb_array_length(removed) = 0 then
        return json_build_object('ok', false, 'reason', 'nothing_to_remove');
    end if;

    -- Bewerbe, in denen ein Startplatz frei wird (nicht auf Warteliste gewesen)
    select coalesce(jsonb_agg(x), '[]'::jsonb) into freed
      from jsonb_array_elements_text(removed) x where not (wl ? x);

    -- Fürs Änderungsprotokoll: als „Selbst-Abmeldung“ kennzeichnen
    perform set_config('nfs.actor', 'Selbst-Abmeldung', true);

    if jsonb_array_length(keep) = 0 then
        delete from public.registrations where id = r.id;
    else
        select coalesce(jsonb_agg(x), '[]'::jsonb) into wl
          from jsonb_array_elements_text(wl) x where keep ? x;
        update public.registrations r2
           set bewerbe_list     = p.bewerbe_list,
               waitlist_bewerbe = p.waitlist_bewerbe,
               bewerb           = p.bewerb,
               waitlist         = p.waitlist
          from jsonb_populate_record(null::public.registrations, jsonb_build_object(
                   'bewerbe_list', keep,
                   'waitlist_bewerbe', wl,
                   'bewerb', keep ->> 0,
                   'waitlist', jsonb_array_length(wl) > 0 and jsonb_array_length(wl) = jsonb_array_length(keep)
               )) p
         where r2.id = r.id;
    end if;

    return json_build_object(
        'ok', true,
        'deleted', jsonb_array_length(keep) = 0,
        'removed', removed,
        'remaining', keep,
        'freed', freed,
        'tournament_id', r.tournament_id,
        'vorname', r.vorname,
        'nachname', r.nachname,
        'email', r.email
    );
end;
$$;

revoke all on function public.cancel_registration(uuid, text[]) from public, anon, authenticated;
grant execute on function public.cancel_registration(uuid, text[]) to service_role;
