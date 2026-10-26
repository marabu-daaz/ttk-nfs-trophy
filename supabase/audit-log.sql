-- ============================================================================
-- NFS Trophy – Änderungsprotokoll (Projekt A)
-- ============================================================================
-- Im SQL-Editor ausführen. Kann gefahrlos mehrfach laufen.
--
-- Ein Trigger schreibt jede Änderung an Nennungen, Turnieren, Kassenbuch und
-- Ergebnis-PDFs in die Tabelle audit_log: wer (E-Mail des Admins bzw. „Website“),
-- wann, was – bei Änderungen nur die geänderten Felder (alt → neu).
-- Einträge können über die App weder geändert noch gelöscht werden.
-- ============================================================================

create table if not exists public.audit_log (
    id            bigint generated always as identity primary key,
    created_at    timestamptz not null default now(),
    actor         text,          -- E-Mail des Admins, 'Website' oder 'System'
    table_name    text not null,
    action        text not null, -- INSERT / UPDATE / DELETE
    record_id     text,
    tournament_id text,
    old_data      jsonb,         -- bei UPDATE nur geänderte Felder (+ _name)
    new_data      jsonb
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_record_idx on public.audit_log (table_name, record_id);
create index if not exists audit_log_tournament_idx on public.audit_log (tournament_id, created_at desc);

alter table public.audit_log enable row level security;

-- Nur eingeloggte Admins dürfen lesen. Keine Schreib-Policies: nur der Trigger schreibt.
drop policy if exists "audit_read_admin" on public.audit_log;
create policy "audit_read_admin" on public.audit_log
    for select to authenticated using (true);


create or replace function public.nfs_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    o       jsonb;
    n       jsonb;
    chg_old jsonb := '{}'::jsonb;
    chg_new jsonb := '{}'::jsonb;
    k       text;
    who     text;
    rid     text;
    tid     text;
    label   text;
begin
    who := coalesce(
        auth.jwt() ->> 'email',
        case when auth.role() = 'anon' then 'Website' else 'System' end
    );

    if tg_op in ('UPDATE', 'DELETE') then o := to_jsonb(old); end if;
    if tg_op in ('UPDATE', 'INSERT') then n := to_jsonb(new); end if;

    rid := coalesce(n ->> 'id', o ->> 'id');
    tid := case when tg_table_name = 'tournaments' then rid
                else coalesce(n ->> 'tournament_id', o ->> 'tournament_id') end;

    if tg_op = 'UPDATE' then
        -- nur geänderte Felder speichern
        for k in select jsonb_object_keys(n) loop
            if (o -> k) is distinct from (n -> k) then
                chg_old := chg_old || jsonb_build_object(k, o -> k);
                chg_new := chg_new || jsonb_build_object(k, n -> k);
            end if;
        end loop;
        if chg_new = '{}'::jsonb then
            return new;   -- nichts wirklich geändert
        end if;
        -- Name für die Anzeige immer mitnehmen
        label := case tg_table_name
            when 'registrations' then concat_ws(' ', n ->> 'vorname', n ->> 'nachname')
            when 'tournaments'   then n ->> 'name'
            else coalesce(n ->> 'description', n ->> 'label') end;
        o := chg_old || jsonb_build_object('_name', label);
        n := chg_new;
    end if;

    insert into public.audit_log (actor, table_name, action, record_id, tournament_id, old_data, new_data)
    values (who, tg_table_name, tg_op, rid, tid, o, n);

    return coalesce(new, old);
end;
$$;

-- Trigger auf allen relevanten Tabellen
drop trigger if exists nfs_audit on public.registrations;
create trigger nfs_audit after insert or update or delete on public.registrations
    for each row execute function public.nfs_audit();

drop trigger if exists nfs_audit on public.tournaments;
create trigger nfs_audit after insert or update or delete on public.tournaments
    for each row execute function public.nfs_audit();

drop trigger if exists nfs_audit on public.incomes;
create trigger nfs_audit after insert or update or delete on public.incomes
    for each row execute function public.nfs_audit();

drop trigger if exists nfs_audit on public.expenses;
create trigger nfs_audit after insert or update or delete on public.expenses
    for each row execute function public.nfs_audit();

drop trigger if exists nfs_audit on public.ergebnisse;
create trigger nfs_audit after insert or update or delete on public.ergebnisse
    for each row execute function public.nfs_audit();

-- Optional: Einträge älter als 3 Jahre aufräumen (bei Bedarf manuell ausführen)
-- delete from public.audit_log where created_at < now() - interval '3 years';
