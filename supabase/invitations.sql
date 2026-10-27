-- ============================================================================
-- NFS Trophy – Einladungen zu neuen Turnieren (Projekt A)
-- ============================================================================
-- VORAUSSETZUNG: players.sql. Komplett ausführen. Kann gefahrlos mehrfach laufen.
--
--   • Jeder Spieler bekommt einen geheimen Schlüssel (invite_token) für
--     – das vorausgefüllte Nennformular  (nfs-trophy.com/?p=<token>)
--     – das Abbestellen von Einladungen  (nfs-trophy.com/abbestellen?t=<token>)
--   • no_invites: Spieler bekommt keine Einladungen (im Admin oder per Link)
--   • invited_tournament / invited_at: wer wurde für welches Turnier schon
--     eingeladen → nach dem Tageslimit von Resend einfach fortsetzen
-- ============================================================================

alter table public.players add column if not exists invite_token uuid not null default gen_random_uuid();
alter table public.players add column if not exists no_invites boolean not null default false;
alter table public.players add column if not exists no_invites_at timestamptz;
alter table public.players add column if not exists invited_tournament text;
alter table public.players add column if not exists invited_at timestamptz;
create unique index if not exists players_invite_token_uniq on public.players (invite_token);


-- 1) Daten fürs vorausgefüllte Nennformular (öffentlich, nur mit Schlüssel; ohne RC)
create or replace function public.player_prefill(p_token uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
    select json_build_object(
        'vorname',  p.vorname,
        'nachname', p.nachname,
        'email',    p.email,
        'telefon',  p.telefon,
        'verein',   p.verein
    )
    from public.players p
    where p.invite_token = p_token;
$$;

revoke all on function public.player_prefill(uuid) from public;
grant execute on function public.player_prefill(uuid) to anon, authenticated, service_role;


-- 2) Einladungen abbestellen (öffentlich, nur mit Schlüssel)
create or replace function public.player_unsubscribe(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v text;
begin
    update public.players
       set no_invites = true,
           no_invites_at = coalesce(no_invites_at, now())
     where invite_token = p_token
    returning vorname into v;
    return json_build_object('ok', v is not null, 'vorname', v);
end;
$$;

revoke all on function public.player_unsubscribe(uuid) from public;
grant execute on function public.player_unsubscribe(uuid) to anon, authenticated, service_role;


-- Prüfen: Wie viele könnten eingeladen werden?
select count(*) filter (where email like '%@%' and not no_invites) as einladbar,
       count(*) filter (where no_invites) as ausgenommen,
       count(*) as spieler
from public.players;
