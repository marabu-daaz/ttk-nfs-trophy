# NFS Trophy – TTK Naturfreunde Stadlau

## Über das Projekt
Die NFS Trophy ist ein RC-Ranglistenturnier des TTK Naturfreunde Stadlau in Wien.  
Diese Webanwendung ermöglicht die Verwaltung von Nennungen, Finanzen, Turnier-Setup und Archiv – mit einem modernen Admin-Dashboard und einer öffentlichen Anmeldeseite.

## Inhalt

Statische Website (Vanilla JS, ES-Module), keine Build-Tools nötig.
Gehostet auf **Netlify**, Daten in **Supabase**.

| Seite | Pfad |
|---|---|
| Öffentliche Seite | `/` (→ `public/index.html`) |
| Admin-Dashboard | `/public/admin.html` |
| Live-Ticker | `/public/live.html` |

## Lokal ansehen

Wegen der ES-Module und absoluten Pfade (`/src/...`) muss ein lokaler Server
im **Projekt-Root** laufen – direktes Öffnen der HTML-Datei funktioniert nicht:

```bash
python -m http.server 8000
# http://localhost:8000/public/index.html
```

---

## Was hat sich geändert? (Version 2.0)

Die Website wurde komplett überarbeitet – von einer einzelnen HTML-Datei zu einer modularen, sicheren und modernen Webanwendung.

### 1. Neue Ordner-Struktur
Die alte index.html (mit allem drin) wurde aufgeteilt:

- config.js                 # Supabase Credentials (Anon-Keys, öffentlich – Schutz über RLS)
- netlify.toml              # Redirect / → public/index.html, Header
- icons/                    # Favicons, PWA-Icons, logo.png
- supabase/
  - hardening.sql         # RLS-Prüfung, Duplikat-Schutz, serverseitige Warteliste
- public/
  - index.html            # Öffentliche Seite
  - admin.html            # Admin-Dashboard
- src/
  - shared/               # Gemeinsame Funktionen
    - supabase.js       # Supabase Client
    - utils.js          # esc(), showToast(), rcNum(), etc.
    - constants.js      # Standard-Werte
  - frontend/
    - app.js            # Frontend Hauptlogik
    - gallery.js        # Lightbox-Logik
  - admin/
    - admin.js          # Admin Hauptlogik
    - finance.js        # Finanz-Tab
    - setup.js          # Turnier-Setup
    - archive.js        # Archiv & Medien
- styles/
  - shared.css            # Gemeinsame Styles
  - style.css             # Frontend Styles
  - admin.css             # Admin Styles (Dark/Light Mode)

### 2. Sicherheitsverbesserungen
- XSS-Schutz: Alle Nutzereingaben werden mit esc() escaped – keine script-Einschleusung mehr
- Fehlerbehandlung: Try/Catch für alle Supabase-Operationen – keine Abstürze mehr
- RLS: Row-Level-Security in Supabase bleibt aktiviert

### 3. Neue Features
- Adminbereich eingerichtet
- Livestreams: Tisch 1 und Tisch 5 – Links im Ergebnisse-Bereich
- TTOP Bewerbe: Admin-Checkbox + URL-Feld – Button erscheint bei Live-Ergebnissen
- Google Maps: Offizieller Google Maps Eintrag der Halle (statt OpenStreetMap)
- Bewerbe nachtragen: Für alte Turniere können Bewerbe nachträglich definiert werden
- Galerie mit Captions: Bilder werden nach Bewerb-Namen sortiert, Captions in Lightbox
- Anmeldestatus dynamisch: GEÖFFNET (grün) / GESCHLOSSEN (rot) mit Hinweistext

### 4. Verbesserte Export-Funktionen
- Excel-Export mit allen Bewerben als Spalten
- PDF-Druckliste mit Wartelisten-Positionen
- Beleg-PDF für einzelne Nennungen

### 6. Buchhaltung
- tournament_id Spalte in expenses und incomes Tabellen hinzugefügt
- Kassenbuch mit Einnahmen und Ausgaben pro Turnier

---

## Technologien
- Frontend: HTML5, CSS3 (Dark/Light Mode), Vanilla JS (ES Modules)
- Backend: Supabase (PostgreSQL, Auth, Storage, RLS)
- Bibliotheken: jsPDF, XLSX, QRCode.js

---

## Alte vs. Neue Struktur (Übersicht)

- Alte Version: Eine index.html mit allem drin
- Neue Version: Modulare Aufteilung in public/, src/, styles/

- Alte Version: Kein Adminbereich
- Neue Version: Separates admin.html mit eigenem CSS und JS

- Alte Version: OpenStreetMap
- Neue Version: Google Maps

- Alte Version: Keine Livestream-Links
- Neue Version: Livestreams für Tisch 1 und 5

- Alte Version: Kein TTOP Button
- Neue Version: TTOP Button (Admin-gesteuert)

- Alte Version: Keine Bildunterschriften
- Neue Version: Captions in Lightbox

---

## Setup für Entwicklung

1. Repository klonen
2. Supabase Credentials in config.js eintragen
3. Lokalen Server starten:
   python -m http.server 8000
4. Admin-Seite: http://localhost:8000/public/admin.html
5. Public-Seite: http://localhost:8000/public/index.html

---

## Deployment

Netlify deployed automatisch bei jedem Push auf `main`. Konfiguration in `netlify.toml`
(Publish-Ordner = Projekt-Root, Rewrite `/` → `/public/index.html`, Security- und Cache-Header).

Wichtig: Die Ordnerstruktur muss erhalten bleiben (src/, styles/, icons/, config.js müssen neben public/ liegen).

## Supabase

`supabase/hardening.sql` enthält Prüf-Abfragen und Härtungen (im SQL-Editor abschnittweise ausführen):
- Öffentliche View `public_registrations` ohne E-Mail/Telefon
- Unique-Index gegen doppelte Nennungen (gleiche Person = E-Mail + Name pro Turnier)
- Trigger, der die Warteliste serverseitig berechnet (keine Überbuchung, keine Manipulation)
- Vorlage für RLS-Policies

---

## Team
- Alexander Si – Entwicklung
- Christian Ritter – Turnierleitung & Entwicklung
- Eric Tang – Turnierleitung


---

## Lizenz
Alle Rechte vorbehalten – TTK Naturfreunde Stadlau

---

## Änderungshistorie

- 06/2026, Version 1.0: Initiale Single-Page-Version
- 10/2026, Version 2.1: Code-Review – Supabase-Fehlerbehandlung im Admin, Bewerbe-Editor verliert keine Daten mehr,
  Saldo-Berechnung, sichere Dateinamen bei Uploads, Logo als Datei statt Base64, Spam-Honeypot,
  RFC-konforme Kalender-Dateien, Live-Ticker pausiert im Hintergrund, Netlify-Header
- 08/2026, Version 2.0: Komplettes Refactoring – Modulare Struktur, XSS-Schutz, neue Features, Fehlerbehandlung, Adminbereich