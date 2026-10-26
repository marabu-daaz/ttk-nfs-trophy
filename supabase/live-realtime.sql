-- ============================================================================
-- NFS Trophy – Echtzeit für den Live-Ticker (Projekt B = TTOP / cl-tt-system)
-- ============================================================================
-- Im SQL-Editor von PROJEKT B ausführen (nicht Projekt A!), sobald TTOP läuft.
-- Ohne diese Freigabe funktioniert der Live-Ticker trotzdem (lädt alle 20 s nach).
--
-- Warum nur "settings"?
-- sync.py löscht jede Minute ALLE Zeilen von players/matches/settings und schreibt
-- sie neu. Realtime auf players/matches würde pro Sync hunderte Nachrichten an
-- jeden Zuschauer schicken (Kontingent!). Der Live-Ticker hört deshalb nur auf
-- den neuen "last_sync"-Eintrag in settings: eine Nachricht pro Sync.
-- ============================================================================

-- 0) Prüfen: Welche Tabellen sind schon für Realtime freigegeben?
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime';

-- 1) Nur settings freigeben (Fehler "already member" ist harmlos)
alter publication supabase_realtime add table public.settings;

-- Falls players/matches früher schon freigegeben wurden – wieder entfernen:
-- alter publication supabase_realtime drop table public.players;
-- alter publication supabase_realtime drop table public.matches;

-- Hinweis: Realtime liefert nur Zeilen, die anonyme Besucher lesen dürfen.
-- Der Live-Ticker liest settings bereits anonym – das passt also.
