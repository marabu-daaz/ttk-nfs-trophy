-- ============================================================================
-- NFS Trophy – Admins per Liste statt „jeder eingeloggte Benutzer“ (Projekt A)
-- ============================================================================
-- VORHER: Dashboard → Authentication → Sign In / Providers →
--         „Allow new users to sign up“ AUSSCHALTEN.
--         Neue Admins (z.B. Eric) dann unter Authentication → Users → „Add user“
--         anlegen (E-Mail + Passwort, „Auto Confirm User“ an).
--
-- Bisher dürfen ALLE eingeloggten Benutzer alles. Mit dieser Datei dürfen nur
-- noch E-Mail-Adressen aus der Tabelle public.admins Daten sehen und ändern.
--
-- Abschnittsweise ausführen, in dieser Reihenfolge!
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Admin-Liste anlegen und befüllen
-- ----------------------------------------------------------------------------
create table if not exists public.admins (
    email      text primary key,
    name       text,
    created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- keine Policies: die Liste ist über die API weder lesbar noch änderbar

-- >>> E-Mail-Adressen GENAU so eintragen, wie sie unter Authentication → Users stehen <<<
insert into public.admins (email, name) values
    ('christianritter1310@gmail.com', 'Christian'),
    ('ERIC-EMAIL-HIER-EINTRAGEN',     'Eric')
on conflict (email) do nothing;

-- Prüfen: Stehen alle Admins drin und gibt es sie auch als Benutzer?
select a.email, a.name, (u.id is not null) as benutzer_existiert
from public.admins a
left join auth.users u on lower(u.email) = lower(a.email);


-- ----------------------------------------------------------------------------
-- 2. Prüf-Funktion
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.admins
        where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;


-- ----------------------------------------------------------------------------
-- 3. Policies umstellen: „Admin Full Access“ nur noch für Admins aus der Liste
-- ----------------------------------------------------------------------------
-- (Erst ausführen, wenn Schritt 1 deine eigene E-Mail korrekt enthält –
--  sonst sperrst du dich aus. Rückgängig: Policies wieder mit using (true) anlegen.)

drop policy if exists "Admin Full Access" on public.registrations;
create policy "Admin Full Access" on public.registrations
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin Full Access" on public.tournaments;
create policy "Admin Full Access" on public.tournaments
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin Full Access" on public.ergebnisse;
create policy "Admin Full Access" on public.ergebnisse
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin Full Access" on public.expenses;
create policy "Admin Full Access" on public.expenses
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin Full Access" on public.incomes;
create policy "Admin Full Access" on public.incomes
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Protokoll (falls audit-log.sql schon ausgeführt wurde)
do $$
begin
    if to_regclass('public.audit_log') is not null then
        drop policy if exists "audit_read_admin" on public.audit_log;
        create policy "audit_read_admin" on public.audit_log
            for select to authenticated using (public.is_admin());
    end if;
end $$;


-- ----------------------------------------------------------------------------
-- 4. Trigger: Ausnahme nur noch für echte Admins (statt für jeden Eingeloggten)
-- ----------------------------------------------------------------------------
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
    if public.is_admin() then
        return new;
    end if;

    select to_jsonb(t.turnier_info) into info
      from public.tournaments t
     where t.id = new.tournament_id;

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

-- Wartelisten-Trigger aus hardening.sql: Admin-Ausnahme auf is_admin() umstellen
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


-- ----------------------------------------------------------------------------
-- 5. Storage (Fotos, PDFs, Sponsoren-Logos) prüfen
-- ----------------------------------------------------------------------------
-- Zeigt die Policies der Datei-Buckets. Steht bei INSERT/UPDATE/DELETE als
-- Bedingung nur „authenticated“ bzw. true, bitte Ergebnis an Claude schicken –
-- dann stelle ich sie ebenfalls auf is_admin() um.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects';
