-- ============================================================================
-- NFS Trophy – Echtzeit für den Live-Ticker (Projekt B = Turnier-Software)
-- ============================================================================
-- Im SQL-Editor von PROJEKT B ausführen (nicht Projekt A!).
-- Danach erscheinen neue Ergebnisse im Live-Ticker sofort statt erst nach ~20 s.
-- Ohne diese Freigabe funktioniert der Live-Ticker trotzdem (automatisches Nachladen).
-- ============================================================================

-- 0) Prüfen: Welche Tabellen sind schon für Realtime freigegeben?
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime';

-- 1) matches und players freigeben (einzeln ausführen; Fehler "already member" ist harmlos)
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.players;

-- Hinweis: Realtime liefert nur Zeilen, die der anonyme Besucher auch lesen darf.
-- Der Live-Ticker liest players/matches/settings bereits anonym – das passt also.
