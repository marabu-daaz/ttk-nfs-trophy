-- ============================================================================
-- NFS Trophy – Spielerdatenbank (Projekt A)
-- ============================================================================
-- VORAUSSETZUNG: admins.sql (is_admin) und hardening.sql (nfs_as_list).
-- Komplett ausführen. Kann gefahrlos mehrfach laufen.
--
--   • players         – jede Person einmal (Name, Verein, RC, Kontakt)
--   • player_entries  – Teilnahmen: ein Eintrag pro Person und Turnier
--   • Jede Website-Nennung wird automatisch einer Person zugeordnet
--     (gleicher Name → gleiche Person, sonst neue Person).
--   • Alte Excel-Listen kommen einmalig über nfs_import_entry() dazu
--     (Skript tools/import_players.py erzeugt die SQL-Datei).
--   • Mögliche Doppelte prüft man im Admin unter „Spieler“.
--   • Nur Admins können lesen und ändern.
-- ============================================================================


-- 1) Namen vergleichbar machen: klein, ohne Akzente, nur Buchstaben
create or replace function public.nfs_name_key(p_vorname text, p_nachname text)
returns text
language sql
immutable
as $$
    select trim(regexp_replace(
        translate(
            replace(lower(coalesce(p_vorname, '') || ' ' || coalesce(p_nachname, '')), 'ß', 'ss'),
            'äöüáàâãåéèêëíìîïóòôõúùûýÿčćçšžřňďťľĺńłśźżőűăşţđ',
            'aouaaaaaeeeeiiiioooouuuyycccszrndtllnlszzouastd'
        ),
        '[^a-z]+', ' ', 'g'
    ));
$$;

create or replace function public.nfs_rc_int(p text)
returns integer
language sql
immutable
as $$
    select case when d ~ '^\d{1,5}$' then d::int end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;


-- 2) Tabellen
create table if not exists public.players (
    id          bigint generated always as identity primary key,
    vorname     text not null,
    nachname    text not null,
    name_key    text not null default '',
    verein      text,
    email       text,
    telefon     text,
    rc          integer,
    notiz       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists players_name_key_idx on public.players (name_key);
create index if not exists players_email_idx on public.players (lower(email));

create table if not exists public.player_entries (
    id               bigint generated always as identity primary key,
    player_id        bigint not null references public.players (id) on delete cascade,
    tournament_id    text not null,
    registration_id  text unique,              -- null bei importierten Einträgen
    bewerbe          text[] not null default '{}',   -- mit Startplatz
    warteliste       text[] not null default '{}',
    verein           text,
    rc               integer,
    source           text not null default 'website',  -- 'website' | 'import'
    created_at       timestamptz not null default now(),
    unique (player_id, tournament_id)
);
create index if not exists player_entries_tournament_idx on public.player_entries (tournament_id);

-- Weitere Schreibweisen einer Person (entstehen beim Zusammenführen, z.B. „Sammy“ → „Samuel“)
create table if not exists public.player_aliases (
    name_key   text primary key,
    player_id  bigint not null references public.players (id) on delete cascade
);

-- Paare, die als „verschiedene Personen“ bestätigt wurden (kleinere ID zuerst)
create table if not exists public.player_distinct (
    a bigint not null references public.players (id) on delete cascade,
    b bigint not null references public.players (id) on delete cascade,
    primary key (a, b),
    check (a < b)
);

-- name_key immer aktuell halten
create or replace function public.nfs_players_touch()
returns trigger
language plpgsql
as $$
begin
    new.name_key := public.nfs_name_key(new.vorname, new.nachname);
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists nfs_players_touch on public.players;
create trigger nfs_players_touch before insert or update on public.players
    for each row execute function public.nfs_players_touch();


-- 3) Zugriff: nur Admins
alter table public.players enable row level security;
alter table public.player_entries enable row level security;
alter table public.player_distinct enable row level security;
alter table public.player_aliases enable row level security;

drop policy if exists "Admin Full Access" on public.player_aliases;
create policy "Admin Full Access" on public.player_aliases
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin Full Access" on public.players;
create policy "Admin Full Access" on public.players
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin Full Access" on public.player_entries;
create policy "Admin Full Access" on public.player_entries
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin Full Access" on public.player_distinct;
create policy "Admin Full Access" on public.player_distinct
    for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- 4) Person zu Name finden oder anlegen
--    Gleicher Name (oder bekannte andere Schreibweise) → gleiche Person. Gibt es den Namen mehrfach,
--    gewinnt die Person mit passender E-Mail, sonst die zuletzt aktive.
create or replace function public.nfs_find_or_create_player(
    p_vorname text, p_nachname text, p_email text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    k   text := public.nfs_name_key(p_vorname, p_nachname);
    pid bigint;
begin
    if k = '' then
        return null;
    end if;

    select p.id into pid
      from public.players p
      left join public.player_entries e on e.player_id = p.id
     where p.name_key = k
        or p.id in (select a.player_id from public.player_aliases a where a.name_key = k)
     group by p.id, p.email
     order by (lower(coalesce(p.email, '')) = lower(coalesce(nullif(trim(p_email), ''), '-'))) desc,
              max(e.created_at) desc nulls last, p.id
     limit 1;

    if pid is null then
        insert into public.players (vorname, nachname)
        values (trim(p_vorname), trim(p_nachname))
        returning id into pid;
    end if;
    return pid;
end;
$$;


-- 5) Website-Nennung → Teilnahme
--    p_rematch: Name wurde geändert → Person neu suchen. Sonst bleibt die
--    Nennung bei ihrer Person (auch nach einem Zusammenführen).
drop function if exists public.nfs_link_registration(public.registrations);
create or replace function public.nfs_link_registration(r public.registrations, p_rematch boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    pid      bigint;
    old_pid  bigint;
    list     text[];
    wl       text[];
    t_date   timestamptz;
    newest   boolean;
begin
    select coalesce(array_agg(x), '{}') into list
      from jsonb_array_elements_text(public.nfs_as_list(to_jsonb(r.bewerbe_list))) x;
    if cardinality(list) = 0 and r.bewerb is not null then
        list := array[r.bewerb];
    end if;
    select coalesce(array_agg(x), '{}') into wl
      from jsonb_array_elements_text(public.nfs_as_list(to_jsonb(r.waitlist_bewerbe))) x
     where x = any(list);
    if cardinality(wl) = 0 and r.waitlist is true then
        wl := list;
    end if;

    -- Schon zugeordnet? Dann bei dieser Person bleiben (außer der Name wurde geändert)
    select player_id into old_pid from public.player_entries where registration_id = r.id::text;
    if old_pid is not null and not p_rematch then
        pid := old_pid;
    else
        pid := public.nfs_find_or_create_player(r.vorname, r.nachname, r.email);
    end if;
    if pid is null then
        return;
    end if;

    if old_pid is not null and old_pid <> pid then
        delete from public.player_entries where registration_id = r.id::text;
        delete from public.players p where p.id = old_pid
           and not exists (select 1 from public.player_entries e where e.player_id = p.id);
    end if;

    insert into public.player_entries (player_id, tournament_id, registration_id, bewerbe, warteliste, verein, rc, source, created_at)
    values (pid, r.tournament_id::text, r.id::text,
            array(select x from unnest(list) x where not (x = any(wl))), wl,
            nullif(trim(r.verein), ''), public.nfs_rc_int(r.rc::text), 'website', coalesce(r.created_at, now()))
    on conflict (player_id, tournament_id) do update
       set registration_id = excluded.registration_id,
           bewerbe         = excluded.bewerbe,
           warteliste      = excluded.warteliste,
           verein          = excluded.verein,
           rc              = excluded.rc,
           source          = 'website';

    -- Stammdaten: Kontakt immer ergänzen, Verein/RC nur vom neuesten Turnier
    select (date_iso::text)::timestamptz into t_date from public.tournaments where id::text = r.tournament_id::text;
    select coalesce(t_date >= max((t.date_iso::text)::timestamptz), true) into newest
      from public.player_entries e
      join public.tournaments t on t.id::text = e.tournament_id
     where e.player_id = pid;

    update public.players p
       set email   = coalesce(nullif(trim(r.email), ''), p.email),
           telefon = coalesce(nullif(trim(r.telefon), ''), p.telefon),
           verein  = case when newest then coalesce(nullif(trim(r.verein), ''), p.verein) else coalesce(p.verein, nullif(trim(r.verein), '')) end,
           rc      = case when newest then coalesce(public.nfs_rc_int(r.rc::text), p.rc) else coalesce(p.rc, public.nfs_rc_int(r.rc::text)) end
     where p.id = pid;
end;
$$;

revoke all on function public.nfs_link_registration(public.registrations, boolean) from public, anon, authenticated;
revoke all on function public.nfs_find_or_create_player(text, text, text) from public, anon, authenticated;

create or replace function public.nfs_sync_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    pid     bigint;
    rematch boolean := false;
begin
    if tg_op = 'DELETE' then
        delete from public.player_entries where registration_id = old.id::text
        returning player_id into pid;
        -- Person ohne jede Teilnahme wieder entfernen
        delete from public.players p where p.id = pid
           and not exists (select 1 from public.player_entries e where e.player_id = p.id);
        return old;
    end if;
    if tg_op = 'UPDATE' then
        rematch := public.nfs_name_key(old.vorname, old.nachname) <> public.nfs_name_key(new.vorname, new.nachname);
    end if;
    perform public.nfs_link_registration(new, rematch);
    return new;
exception when others then
    -- Die Spielerdatenbank darf eine Nennung nie verhindern
    raise warning 'nfs_sync_player: %', sqlerrm;
    return coalesce(new, old);
end;
$$;

drop trigger if exists nfs_sync_player on public.registrations;
create trigger nfs_sync_player after insert or update or delete on public.registrations
    for each row execute function public.nfs_sync_player();


-- 6) Bestehende Website-Nennungen einmalig übernehmen
do $$
declare
    r public.registrations;
begin
    for r in select * from public.registrations order by created_at loop
        perform public.nfs_link_registration(r);
    end loop;
end $$;


-- 7) Import alter Listen (nur im SQL-Editor, nicht über die API)
create or replace function public.nfs_import_entry(
    p_tournament_id text, p_vorname text, p_nachname text,
    p_verein text, p_rc integer, p_email text, p_bewerbe text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    pid bigint := public.nfs_find_or_create_player(p_vorname, p_nachname, p_email);
begin
    if pid is null then
        return;
    end if;
    insert into public.player_entries (player_id, tournament_id, bewerbe, verein, rc, source)
    values (pid, p_tournament_id, coalesce(p_bewerbe, '{}'), nullif(trim(p_verein), ''), p_rc, 'import')
    on conflict (player_id, tournament_id) do update
       set bewerbe = array(select distinct x from unnest(public.player_entries.bewerbe || excluded.bewerbe) x),
           verein  = coalesce(public.player_entries.verein, excluded.verein),
           rc      = coalesce(public.player_entries.rc, excluded.rc);

    -- Stammdaten nur ergänzen, nichts Neueres überschreiben
    update public.players p
       set verein = coalesce(p.verein, nullif(trim(p_verein), '')),
           rc     = coalesce(p.rc, p_rc),
           email  = coalesce(p.email, nullif(trim(p_email), ''))
     where p.id = pid;
end;
$$;

revoke all on function public.nfs_import_entry(text, text, text, text, integer, text, text[]) from public, anon, authenticated;


-- 8) Zwei Einträge derselben Person zusammenführen (aus dem Admin)
create or replace function public.nfs_merge_players(p_keep bigint, p_drop bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    d public.players;
    e public.player_entries;
begin
    if not public.is_admin() then
        raise exception 'Keine Berechtigung';
    end if;
    if p_keep = p_drop then
        return;
    end if;
    select * into d from public.players where id = p_drop;
    if not found then
        return;
    end if;

    for e in select * from public.player_entries where player_id = p_drop loop
        if exists (select 1 from public.player_entries where player_id = p_keep and tournament_id = e.tournament_id) then
            update public.player_entries k
               set bewerbe         = array(select distinct x from unnest(k.bewerbe || e.bewerbe) x),
                   warteliste      = array(select distinct x from unnest(k.warteliste || e.warteliste) x),
                   registration_id = coalesce(k.registration_id, e.registration_id),
                   verein          = coalesce(k.verein, e.verein),
                   rc              = coalesce(k.rc, e.rc)
             where k.player_id = p_keep and k.tournament_id = e.tournament_id;
            delete from public.player_entries where id = e.id;
        else
            update public.player_entries set player_id = p_keep where id = e.id;
        end if;
    end loop;

    update public.players k
       set verein  = coalesce(k.verein, d.verein),
           email   = coalesce(k.email, d.email),
           telefon = coalesce(k.telefon, d.telefon),
           rc      = coalesce(k.rc, d.rc),
           notiz   = nullif(concat_ws(' · ', k.notiz, d.notiz), '')
     where k.id = p_keep;

    -- Schreibweisen merken, damit künftige Nennungen bei der richtigen Person landen
    update public.player_aliases set player_id = p_keep where player_id = p_drop;
    insert into public.player_aliases (name_key, player_id)
    select d.name_key, p_keep
     where d.name_key <> (select name_key from public.players where id = p_keep)
    on conflict (name_key) do update set player_id = excluded.player_id;

    delete from public.players where id = p_drop;
end;
$$;

revoke all on function public.nfs_merge_players(bigint, bigint) from public, anon;
grant execute on function public.nfs_merge_players(bigint, bigint) to authenticated;


-- Prüfen:
select count(*) as spieler,
       (select count(*) from public.player_entries) as teilnahmen
from public.players;
