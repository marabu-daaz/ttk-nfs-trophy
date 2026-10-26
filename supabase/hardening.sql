-- ============================================================================
-- NFS Trophy – Supabase Härtung (Projekt A: Website / Nennungen)
-- ============================================================================
-- Im Supabase-Dashboard unter "SQL Editor" ausführen – ABSCHNITTWEISE,
-- und vorher die Prüf-Abfragen in Schritt 0 laufen lassen.
-- Alles ist so geschrieben, dass es mehrfach ausgeführt werden kann.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. PRÜFEN (nur lesen, ändert nichts)
-- ----------------------------------------------------------------------------

-- 0a) Welche Spalten liefert die öffentliche View? Darf KEIN email/telefon/notiz enthalten!
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'public_registrations';

-- 0b) Welche RLS-Policies gibt es auf registrations? anon darf nur INSERT, kein SELECT/UPDATE/DELETE.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'registrations';

-- 0c) Ist RLS überhaupt aktiv? (rowsecurity muss überall true sein)
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('registrations', 'tournaments', 'ergebnisse', 'expenses', 'incomes');

-- 0d) Gibt es schon doppelte Nennungen (gleiche PERSON im selben Turnier)?
--     Gleiche E-Mail allein ist erlaubt (Turnierleitung/Eltern melden mehrere Personen an).
--     Falls hier Zeilen kommen: vor Schritt 2 im Admin bereinigen, sonst schlägt der Index fehl.
select tournament_id, lower(email) as email,
       lower(trim(vorname)) as vorname, lower(trim(nachname)) as nachname, count(*)
from public.registrations
group by 1, 2, 3, 4
having count(*) > 1;


-- ----------------------------------------------------------------------------
-- 1. ÖFFENTLICHE VIEW nur mit unkritischen Spalten
-- ----------------------------------------------------------------------------
-- Nur ausführen, wenn 0a) sensible Spalten zeigt.
-- Die View läuft mit den Rechten des Besitzers, daher kann anon sie lesen,
-- obwohl anon die Tabelle registrations selbst nicht lesen darf.

-- drop view if exists public.public_registrations;
-- create view public.public_registrations as
-- select id, tournament_id, vorname, nachname, verein, rc,
--        bewerb, bewerbe_list, waitlist, waitlist_bewerbe, created_at
-- from public.registrations;
-- grant select on public.public_registrations to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. DOPPELTE NENNUNGEN verhindern (gleiche Person pro Turnier)
-- ----------------------------------------------------------------------------
-- Eine E-Mail darf mehrere Personen anmelden ("Weitere Person anmelden"),
-- aber dieselbe Person (E-Mail + Vorname + Nachname) nur einmal pro Turnier.
-- Das Frontend zeigt bei Fehlercode 23505 eine passende Meldung an.

create unique index if not exists registrations_tournament_person_uniq
    on public.registrations (tournament_id, lower(email), lower(trim(vorname)), lower(trim(nachname)));


-- ----------------------------------------------------------------------------
-- 3. WARTELISTE SERVERSEITIG berechnen
--    HINWEIS: Nach supabase/admins.sql diesen Abschnitt nicht erneut ausführen –
--    admins.sql (Schritt 4) enthält die aktuelle Version mit is_admin().
-- ----------------------------------------------------------------------------
-- Bisher berechnet nur der Browser, ob ein Bewerb voll ist. Jeder kann aber mit
-- dem öffentlichen Key direkt "waitlist: false" senden, und zwei gleichzeitige
-- Nennungen können einen Bewerb überbuchen.
-- Dieser Trigger überschreibt waitlist/waitlist_bewerbe bei jeder öffentlichen
-- Nennung mit dem echten Wert. Eingeloggte Admins sind ausgenommen.

-- Hilfsfunktion: macht aus jsonb-Array, JSON-String oder NULL immer ein jsonb-Array
create or replace function public.nfs_as_list(v jsonb)
returns jsonb
language plpgsql immutable
as $$
begin
    if v is null then return '[]'::jsonb; end if;
    if jsonb_typeof(v) = 'array' then return v; end if;
    if jsonb_typeof(v) = 'string' then
        begin
            v := (v #>> '{}')::jsonb;
            if jsonb_typeof(v) = 'array' then return v; end if;
        exception when others then
            return '[]'::jsonb;
        end;
    end if;
    return '[]'::jsonb;
end;
$$;

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
    -- Admins dürfen Werte frei setzen (z.B. manuell nachrücken lassen)
    if auth.role() = 'authenticated' then
        return new;
    end if;

    -- Pro Turnier serialisieren → keine Überbuchung bei gleichzeitigen Nennungen
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

    for b in select * from jsonb_array_elements(t_bewerbe) loop
        b_name := b->>'name';
        continue when not (selected ? b_name);

        cap := coalesce(nullif(b->>'capacity', '')::int, 20);

        select count(*) into active_cnt
          from public.registrations r
         where r.tournament_id = new.tournament_id
           -- ist für diesen Bewerb gemeldet
           and (
                public.nfs_as_list(to_jsonb(r.bewerbe_list)) ? b_name
                or (jsonb_array_length(public.nfs_as_list(to_jsonb(r.bewerbe_list))) = 0 and r.bewerb = b_name)
           )
           -- und steht dort NICHT auf der Warteliste
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

    -- jsonb_populate_record funktioniert unabhängig davon, ob die Spalte text[] oder jsonb ist
    new := jsonb_populate_record(new, jsonb_build_object(
        'waitlist_bewerbe', wl,
        'waitlist', jsonb_array_length(wl) > 0 and jsonb_array_length(wl) = jsonb_array_length(selected)
    ));

    return new;
end;
$$;

drop trigger if exists nfs_compute_waitlist on public.registrations;
create trigger nfs_compute_waitlist
    before insert on public.registrations
    for each row execute function public.nfs_compute_waitlist();


-- ----------------------------------------------------------------------------
-- 4. RLS-POLICIES (nur falls 0b/0c Lücken zeigen)
-- ----------------------------------------------------------------------------
-- Ziel: anon darf Nennungen nur ANLEGEN, eingeloggte Admins dürfen alles.
-- Vorher bestehende, zu offene Policies (z.B. "anon select") im Dashboard löschen.

-- alter table public.registrations enable row level security;
--
-- create policy "anon_insert_registrations" on public.registrations
--     for insert to anon
--     with check (true);   -- Prüfung auf is_open übernimmt der Trigger aus Schritt 3
--
-- create policy "admin_all_registrations" on public.registrations
--     for all to authenticated
--     using (true) with check (true);
--
-- Gleiches Muster für expenses / incomes (nur authenticated, KEIN anon-Zugriff)
-- und tournaments / ergebnisse (anon: nur select; authenticated: alles).
