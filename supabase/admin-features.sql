-- ============================================================================
-- NFS Trophy – Erweiterung für den neuen Admin-Bereich (Projekt A)
-- ============================================================================
-- Einmalig im Supabase SQL-Editor ausführen. Kann gefahrlos mehrfach laufen.
-- ============================================================================

-- Anwesenheit beim Check-in am Turniertag
alter table public.registrations
    add column if not exists checked_in boolean not null default false;

-- Hinweis: Die öffentliche View public_registrations listet ihre Spalten
-- explizit auf – checked_in ist dort bewusst NICHT enthalten.
