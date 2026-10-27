-- ============================================================
--  NFS Trophy – Nach dem Turnier & Sammeladressen
--  Einmalig im Supabase-SQL-Editor ausführen (nach players.sql und invitations.sql).
--  Kann gefahrlos mehrfach ausgeführt werden.
--
--  1) Turnierbericht je Turnier (tournaments.report)
--  2) Nicht erschienen: Teilnahme bleibt sichtbar, zählt aber nicht in der Statistik
--  3) Danke-Mail: merkt sich, wer sie schon bekommen hat
--  4) Admin-Adressen (Christian, Eric) werden nie automatisch bei Spielern eingetragen,
--     auch wenn ein Admin jemanden mit der eigenen Adresse nennt
--  5) Name des angemeldeten Admins für die Anzeige im Admin
-- ============================================================

-- 1) Turnierbericht
alter table public.tournaments add column if not exists report text;

-- 2) Nicht erschienen
alter table public.player_entries add column if not exists no_show boolean not null default false;

create or replace function public.nfs_set_no_shows(p_tournament_id text, p_registration_ids text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    n integer;
begin
    if not public.is_admin() then
        raise exception 'forbidden';
    end if;
    update public.player_entries
       set no_show = (registration_id = any(coalesce(p_registration_ids, '{}')))
     where tournament_id = p_tournament_id
       and registration_id is not null;
    select count(*) into n from public.player_entries
     where tournament_id = p_tournament_id and no_show;
    return n;
end;
$$;
revoke all on function public.nfs_set_no_shows(text, text[]) from public, anon;
grant execute on function public.nfs_set_no_shows(text, text[]) to authenticated;

-- 3) Danke-Mail
alter table public.registrations add column if not exists thanks_sent_at timestamptz;

-- 4) Admin-Adressen nicht automatisch übernehmen
--    Nur Änderungen aus der Nennung heraus (Trigger-Kette, Tiefe > 1) werden abgefangen.
--    Im Admin von Hand eingetragen (z.B. die eigene Adresse beim eigenen Spieler) bleibt erlaubt.
create or replace function public.nfs_keep_admin_email_off()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if pg_trigger_depth() > 1
       and new.email is distinct from old.email
       and exists (select 1 from public.admins a where lower(a.email) = lower(trim(new.email))) then
        new.email := old.email;
    end if;
    return new;
end;
$$;

drop trigger if exists nfs_keep_admin_email_off on public.players;
create trigger nfs_keep_admin_email_off before update on public.players
    for each row execute function public.nfs_keep_admin_email_off();

-- 5) Name des angemeldeten Admins (steht im Admin oben statt „Admin“)
update public.admins set name = 'Christian Ritter' where lower(email) = 'christianritter1310@gmail.com';
update public.admins set name = 'Eric Tang' where name = 'Eric';

create or replace function public.admin_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select name from public.admins
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
revoke all on function public.admin_name() from public, anon;
grant execute on function public.admin_name() to authenticated;

-- Kontrolle: Wer ist Admin? (Erics echte Adresse muss hier stehen – sie bekommt alle Mails in CC)
select email, name from public.admins order by name;

-- Kontrolle: Adressen, die bei mehreren Spielern stehen (im Admin unter Spieler → „Gemeinsame Adressen“ bereinigen)
select lower(trim(email)) as adresse, count(*) as spieler,
       string_agg(vorname || ' ' || nachname, ', ' order by nachname) as namen
  from public.players
 where email like '%@%'
 group by lower(trim(email))
having count(*) > 1
 order by count(*) desc;
