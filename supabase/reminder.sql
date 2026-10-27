-- ============================================================================
-- NFS Trophy – Erinnerungsmail vor dem Turnier (Projekt A)
-- ============================================================================
-- Komplett ausführen. Kann gefahrlos mehrfach laufen.
--
-- Die Edge Function (Aktion „send_reminder“) merkt sich hier, wer schon eine
-- Erinnerung bekommen hat. So kann man nach dem Tageslimit von Resend am
-- nächsten Tag einfach fortsetzen, ohne jemanden doppelt anzuschreiben.
-- ============================================================================

alter table public.registrations
    add column if not exists reminder_sent_at timestamptz;

-- Hinweis: public_registrations listet ihre Spalten explizit auf –
-- reminder_sent_at ist dort NICHT enthalten (nicht öffentlich).

-- Prüfen:
select count(*) as nennungen, count(reminder_sent_at) as schon_erinnert
from public.registrations;
