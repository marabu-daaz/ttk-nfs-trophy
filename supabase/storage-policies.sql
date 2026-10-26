-- ============================================================================
-- NFS Trophy – Datei-Speicher (Storage) absichern (Projekt A)
-- ============================================================================
-- VORAUSSETZUNG: supabase/admins.sql wurde ausgeführt (Funktion public.is_admin()).
-- Komplett ausführen. Kann gefahrlos mehrfach laufen.
--
-- Vorher:
--   • sponsoren: JEDER (auch ohne Login) durfte Dateien hochladen, ändern, LÖSCHEN
--   • fotos/pdfs: jeder eingeloggte Benutzer durfte schreiben
--   • fotos: nur Eingeloggte durften die Liste lesen → Galerie auf der Website leer
-- Nachher:
--   • Lesen: öffentlich (die Website zeigt PDFs, Fotos und Sponsoren-Logos)
--   • Hochladen/Ändern/Löschen: nur Admins aus public.admins
-- ============================================================================

-- Alte Policies entfernen
drop policy if exists "Admin Upload Access 1m4ctr_0" on storage.objects;
drop policy if exists "Admin Upload Access 1m4ctr_1" on storage.objects;
drop policy if exists "Admin Upload Access 1m4ctr_2" on storage.objects;
drop policy if exists "Admin Upload Access 1m4ctr_3" on storage.objects;
drop policy if exists "Admin Upload Access 21n7l_0" on storage.objects;
drop policy if exists "Admin Upload Access 21n7l_1" on storage.objects;
drop policy if exists "Admin Upload Access 21n7l_2" on storage.objects;
drop policy if exists "Admin Upload Access 21n7l_3" on storage.objects;
drop policy if exists "Sponsoren: public delete" on storage.objects;
drop policy if exists "Sponsoren: public insert" on storage.objects;
drop policy if exists "Sponsoren: public read" on storage.objects;
drop policy if exists "Sponsoren: public update" on storage.objects;
drop policy if exists "pdfs_read_public" on storage.objects;

-- Neue Policies (idempotent)
drop policy if exists "nfs_public_read" on storage.objects;
drop policy if exists "nfs_admin_insert" on storage.objects;
drop policy if exists "nfs_admin_update" on storage.objects;
drop policy if exists "nfs_admin_delete" on storage.objects;

-- Lesen (inkl. Auflisten der Fotos für die Galerie): für alle
create policy "nfs_public_read" on storage.objects
    for select to anon, authenticated
    using (bucket_id in ('fotos', 'pdfs', 'sponsoren'));

-- Schreiben: nur Admins
create policy "nfs_admin_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id in ('fotos', 'pdfs', 'sponsoren') and public.is_admin());

create policy "nfs_admin_update" on storage.objects
    for update to authenticated
    using (bucket_id in ('fotos', 'pdfs', 'sponsoren') and public.is_admin())
    with check (bucket_id in ('fotos', 'pdfs', 'sponsoren') and public.is_admin());

create policy "nfs_admin_delete" on storage.objects
    for delete to authenticated
    using (bucket_id in ('fotos', 'pdfs', 'sponsoren') and public.is_admin());

-- Kontrolle
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
