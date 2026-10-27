-- ============================================================================
-- NFS Trophy – Erweiterungen für den neuen Admin-Bereich (Projekt A)
-- ============================================================================
-- Im Supabase SQL-Editor ausführen. Kann gefahrlos mehrfach laufen.
-- ============================================================================

-- 1) Anwesenheit beim Check-in am Turniertag
alter table public.registrations
    add column if not exists checked_in boolean not null default false;

-- Hinweis: Die öffentliche View public_registrations listet ihre Spalten
-- explizit auf – checked_in ist dort bewusst NICHT enthalten.


-- 2) Anmeldeschluss auch serverseitig durchsetzen
--    VORAUSSETZUNG: supabase/admins.sql (Funktion is_admin()).
--    Der Anmeldeschluss wird im Turnier-Setup gesetzt (turnier_info.registrationDeadline).
--    Die Website prüft ihn bereits – dieser Trigger verhindert zusätzlich, dass jemand
--    nach Ablauf direkt über die Datenbank-Schnittstelle nennt. Admins sind ausgenommen.
create or replace function public.nfs_check_deadline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    info     jsonb;
    deadline timestamptz;
begin
    -- Admins (Liste in public.admins) dürfen auch nach dem Anmeldeschluss nennen
    if public.is_admin() then
        return new;
    end if;

    select to_jsonb(t.turnier_info) into info
      from public.tournaments t
     where t.id = new.tournament_id;

    -- turnier_info wird als JSON-Text gespeichert → ggf. auspacken
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

    if deadline is not null and now() > deadline then
        raise exception 'Der Anmeldeschluss für dieses Turnier ist vorbei.';
    end if;

    return new;
end;
$$;

-- Trigger laufen alphabetisch: nfs_check_deadline vor nfs_compute_waitlist
drop trigger if exists nfs_check_deadline on public.registrations;
create trigger nfs_check_deadline
    before insert on public.registrations
    for each row execute function public.nfs_check_deadline();
