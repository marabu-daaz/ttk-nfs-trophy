// src/shared/i18n.js
// ==========================================
// i18n – Mehrsprachigkeit (DE/EN)
// ==========================================

export const translations = {
    de: {
        // ---- Navigation ----
        'nav.bewerbe': 'Bewerbe',
        'nav.anmelden': 'Anmelden',
        'nav.nennstand': 'Nennstand',
        'nav.zeitplan': 'Zeitplan',
        'nav.ergebnisse': 'Ergebnisse',
        'nav.archiv': 'Archiv',
        'nav.sponsoren': 'Sponsoren',
        'nav.kontakt': 'Kontakt',

        // ---- Hero ----
        'hero.wien': 'Wien',
        'hero.cta': 'Jetzt nennen',
        'hero.ausschreibung': 'Ausschreibung öffnen',
        'hero.ausschreibungFolgt': 'Ausschreibung folgt',
        'hero.countdown': 'Bis Turnierstart',
        'hero.terminFolgt': 'Termin folgt',
        'hero.tage': 'Tage',
        'hero.std': 'Std',
        'hero.min': 'Min',
        'hero.sek': 'Sek',

        // ---- Bewerbe ----
        'bewerbe.eyebrow': 'Die Bewerbe',
        'bewerbe.start': 'Start',
        'bewerbe.maxPlaetze': 'Max. {n} Plätze',
        'bewerbe.preisgeld': 'Preisgeld',
        'bewerbe.note': 'Nenngeld pro Bewerb {fee} €, für NFS-Mitglieder {nfsFee} €. Barzahlung vor Ort. Die Teilnehmerzahl pro Bewerb ist begrenzt.',

        // ---- Formular ----
        'form.eyebrow': 'Nennung',
        'form.headline': 'Sichere dir<br><em>deinen Startplatz</em>',
        'form.vorname': 'Vorname',
        'form.nachname': 'Nachname',
        'form.email': 'E-Mail',
        'form.telefon': 'Telefon',
        'form.verein': 'Verein',
        'form.rc': 'RC-Punkte',
        'form.bewerbe': 'Bewerbe',
        'form.bewerbeHelp': 'Mehrfachauswahl möglich',
        'form.anmerkung': 'Anmerkung',
        'form.receipt': 'Ich benötige eine Zahlungsbestätigung für das Nenngeld.',
        'form.agb': 'Ich akzeptiere die <a href="#datenschutz" style="text-decoration:underline; color:inherit;">Datenschutzerklärung</a> und die Turnierordnung (ÖTTV). Ich bin mit der Weitergabe meiner Daten an den Verband sowie mit Foto- und Videoaufnahmen und deren Veröffentlichung einverstanden.',
        'form.submit': 'Nennung absenden',
        'form.submitting': 'Sende...',
        'form.feeTitle': 'Nenngeld',
        'form.feePer': 'pro Bewerb',
        'form.feeNfs': 'NFS-Mitglieder',
        'form.closed': 'Für dieses Turnier ist die Anmeldung aktuell geschlossen.',
        'form.emailPhoneHint': 'Die Nennung kann auch per E-Mail oder Telefon erfolgen.',
        'form.capNote': 'Die Bewerbe sind in der Teilnehmerzahl begrenzt. Weitere Nennungen werden auf eine Warteliste gesetzt und rücken bei Absagen nach.',

        // ---- Nennstand ----
        'nennstand.eyebrow': 'Live-Nennstand',
        'nennstand.headline': 'Wer ist<br><em>schon dabei</em>',
        'nennstand.export': 'Als Excel herunterladen',
        'nennstand.empty': 'Noch keine Nennungen',
        'nennstand.waitlist': 'Warteliste ({n})',
        'nennstand.meta': 'Stand {date}, {n} Nennungen gesamt',

        // ---- Zeitplan ----
        'zeitplan.eyebrow': 'Ablauf',
        'zeitplan.headline': 'Der <em>Zeitplan</em>',

        // ---- Ergebnisse ----
        'ergebnisse.eyebrow': 'Aktuelles Turnier',
        'ergebnisse.headline': 'Ausschreibung, Livestreams &<br><em>Live-Ergebnisse</em>',
        'ergebnisse.dokument': 'Dokument',
        'ergebnisse.ausschreibungCard': 'Offizielle Ausschreibung',
        'ergebnisse.ausschreibungFolgt': 'Ausschreibung folgt',
        'ergebnisse.liveK': 'Während des Turniers',
        'ergebnisse.liveCard': 'Live-Ergebnisse',
        'ergebnisse.oettvBtn': 'Zum ÖTTV-Ergebnissystem',
        'ergebnisse.ttopBtn': 'TTOP Bewerbe',
        'ergebnisse.livestreamK': '📺 Livestream',
        'ergebnisse.tisch1': 'Tisch 1',
        'ergebnisse.tisch1Desc': 'Finale & Halbfinale',
        'ergebnisse.tisch5': 'Tisch 5',
        'ergebnisse.tisch5Desc': 'Nebenplatz & Trostbewerbe',
        'ergebnisse.livestreamOpen': '📺 Zum Livestream',

        // ---- Archiv ----
        'archiv.eyebrow': 'Archiv',
        'archiv.headline': 'Die bisherigen<br><em>Auflagen</em>',
        'archiv.text': 'Alle Trophys seit 2018 mit Ausschreibungen, Ergebnissen und Fotos.',
        'archiv.laden': 'Lade Archiv',
        'archiv.keine': 'Noch keine vergangenen Turniere im Archiv',
        'archiv.keineMat': 'Keine Materialien',

        // ---- Rekorde ----
        'rekorde.eyebrow': 'Ewige Bestenliste',
        'rekorde.headline': 'Die Rekord-<br><em>Halter</em>',
        'rekorde.text': 'Die erfolgreichsten Spieler über alle bisherigen Ausgaben der NFS Trophy.',

        // ---- Sponsoren ----
        'sponsoren.eyebrow': 'Unsere Partner',
        'sponsoren.headline': 'Partner & <em>Sponsoren</em>',

        // ---- Kontakt ----
        'kontakt.eyebrow': 'Kontakt',
        'kontakt.headline': 'Schreib uns<br><em>an</em>',
        'kontakt.veranstalter': 'Veranstalter',
        'kontakt.leitung': 'Turnierleitung',
        'kontakt.email': 'E-Mail',
        'kontakt.telefon': 'Telefon und WhatsApp',
        'kontakt.anfahrt': 'Anfahrt',
        'kontakt.route': '📍 Route planen',

        // ---- Footer ----
        'footer.copyright': '© {year} TTK Naturfreunde Stadlau',
        'footer.impressum': 'Impressum',
        'footer.datenschutz': 'Datenschutz',
        'footer.websiteBy': 'Website von Alexander Si',

        // ---- Toasts / Fehler ----
        'toast.fillRequired': 'Bitte Pflichtfelder ausfüllen, mindestens einen Bewerb wählen und AGB akzeptieren.',
        'toast.regClosed': 'Die Anmeldung für dieses Turnier ist derzeit geschlossen.',
        'toast.rateLimited': 'Zu viele Nennungen mit dieser E-Mail-Adresse in kurzer Zeit. Bitte warte 5 Minuten.',
        'toast.sendError': 'Fehler beim Senden. Bitte später erneut versuchen.',
        'toast.rcMin': 'Fehler: Für den Bewerb "{name}" benötigst du mindestens {min} RC-Punkte!',
        'toast.loadError': 'Fehler beim Laden der Daten.',
        'toast.exportOk': 'Excel-Export erfolgreich!',
        'toast.exportError': 'Fehler beim Export.',

        // ---- Success-Message ----
        'success.headline': 'Wir freuen uns auf dich!',
        'success.msg': 'Nennung erfolgreich! Wir bestätigen in Kürze per E-Mail.',
        'success.msgWaitlist': 'Gespeichert! Du stehst für <strong>{events}</strong> auf der Warteliste.',
        'success.addToCal': '📅 In den Kalender eintragen',
        'success.newReg': 'Weitere Person anmelden',
    },

    en: {
        // ---- Navigation ----
        'nav.bewerbe': 'Events',
        'nav.anmelden': 'Register',
        'nav.nennstand': 'Entry list',
        'nav.zeitplan': 'Schedule',
        'nav.ergebnisse': 'Results',
        'nav.archiv': 'Archive',
        'nav.sponsoren': 'Sponsors',
        'nav.kontakt': 'Contact',

        // ---- Hero ----
        'hero.wien': 'Vienna',
        'hero.cta': 'Register now',
        'hero.ausschreibung': 'Open invitation',
        'hero.ausschreibungFolgt': 'Invitation coming soon',
        'hero.countdown': 'Until tournament start',
        'hero.terminFolgt': 'Date TBA',
        'hero.tage': 'Days',
        'hero.std': 'Hrs',
        'hero.min': 'Min',
        'hero.sek': 'Sec',

        // ---- Bewerbe ----
        'bewerbe.eyebrow': 'The events',
        'bewerbe.start': 'Start',
        'bewerbe.maxPlaetze': 'Max. {n} spots',
        'bewerbe.preisgeld': 'Prize money',
        'bewerbe.note': 'Entry fee per event {fee} €, NFS members {nfsFee} €. Payment on site. Number of players per event is limited.',

        // ---- Formular ----
        'form.eyebrow': 'Registration',
        'form.headline': 'Secure<br><em>your spot</em>',
        'form.vorname': 'First name',
        'form.nachname': 'Last name',
        'form.email': 'Email',
        'form.telefon': 'Phone',
        'form.verein': 'Club',
        'form.rc': 'RC points',
        'form.bewerbe': 'Events',
        'form.bewerbeHelp': 'Multiple selections allowed',
        'form.anmerkung': 'Notes',
        'form.receipt': 'I need a payment confirmation for the entry fee.',
        'form.agb': 'I accept the <a href="#datenschutz" style="text-decoration:underline; color:inherit;">privacy policy</a> (German only) and the tournament rules (ÖTTV). I agree to the transfer of my data to the association and to photo/video recordings and their publication.',
        'form.submit': 'Submit registration',
        'form.submitting': 'Sending...',
        'form.feeTitle': 'Entry fee',
        'form.feePer': 'per event',
        'form.feeNfs': 'NFS members',
        'form.closed': 'Registration for this tournament is currently closed.',
        'form.emailPhoneHint': 'You can also register by email or phone.',
        'form.capNote': 'The number of players per event is limited. Further entries will be placed on a waiting list and move up in case of cancellations.',

        // ---- Nennstand ----
        'nennstand.eyebrow': 'Live entry list',
        'nennstand.headline': 'Who is<br><em>already in</em>',
        'nennstand.export': 'Download as Excel',
        'nennstand.empty': 'No entries yet',
        'nennstand.waitlist': 'Waiting list ({n})',
        'nennstand.meta': 'Updated {date}, {n} entries total',

        // ---- Zeitplan ----
        'zeitplan.eyebrow': 'Schedule',
        'zeitplan.headline': 'The <em>schedule</em>',

        // ---- Ergebnisse ----
        'ergebnisse.eyebrow': 'Current tournament',
        'ergebnisse.headline': 'Invitation, livestreams &<br><em>live results</em>',
        'ergebnisse.dokument': 'Document',
        'ergebnisse.ausschreibungCard': 'Official invitation',
        'ergebnisse.ausschreibungFolgt': 'Invitation coming soon',
        'ergebnisse.liveK': 'During the tournament',
        'ergebnisse.liveCard': 'Live results',
        'ergebnisse.oettvBtn': 'To ÖTTV results system',
        'ergebnisse.ttopBtn': 'TTOP events',
        'ergebnisse.livestreamK': '📺 Livestream',
        'ergebnisse.tisch1': 'Table 1',
        'ergebnisse.tisch1Desc': 'Final & semi-finals',
        'ergebnisse.tisch5': 'Table 5',
        'ergebnisse.tisch5Desc': 'Side table & consolation events',
        'ergebnisse.livestreamOpen': '📺 To livestream',

        // ---- Archiv ----
        'archiv.eyebrow': 'Archive',
        'archiv.headline': 'Past<br><em>editions</em>',
        'archiv.text': 'All Trophies since 2018 with invitations, results and photos.',
        'archiv.laden': 'Loading archive',
        'archiv.keine': 'No past tournaments in archive yet',
        'archiv.keineMat': 'No materials',

        // ---- Rekorde ----
        'rekorde.eyebrow': 'All-time leaderboard',
        'rekorde.headline': 'The record<br><em>holders</em>',
        'rekorde.text': 'The most successful players across all editions of the NFS Trophy.',

        // ---- Sponsoren ----
        'sponsoren.eyebrow': 'Our partners',
        'sponsoren.headline': 'Partners & <em>Sponsors</em>',

        // ---- Kontakt ----
        'kontakt.eyebrow': 'Contact',
        'kontakt.headline': 'Get in<br><em>touch</em>',
        'kontakt.veranstalter': 'Organizer',
        'kontakt.leitung': 'Tournament directors',
        'kontakt.email': 'Email',
        'kontakt.telefon': 'Phone & WhatsApp',
        'kontakt.anfahrt': 'Directions',
        'kontakt.route': '📍 Plan route',

        // ---- Footer ----
        'footer.copyright': '© {year} TTK Naturfreunde Stadlau',
        'footer.impressum': 'Legal notice (DE)',
        'footer.datenschutz': 'Privacy (DE)',
        'footer.websiteBy': 'Website by Alexander Si',

        // ---- Toasts / Fehler ----
        'toast.fillRequired': 'Please fill in all required fields, select at least one event and accept the terms.',
        'toast.regClosed': 'Registration for this tournament is currently closed.',
        'toast.rateLimited': 'Too many registrations with this email address in a short time. Please wait 5 minutes.',
        'toast.sendError': 'Error sending. Please try again later.',
        'toast.rcMin': 'Error: For event "{name}" you need at least {min} RC points!',
        'toast.loadError': 'Error loading data.',
        'toast.exportOk': 'Excel export successful!',
        'toast.exportError': 'Error during export.',

        // ---- Success-Message ----
        'success.headline': 'See you there!',
        'success.msg': 'Registration successful! We will confirm shortly by email.',
        'success.msgWaitlist': 'Saved! You are on the waiting list for <strong>{events}</strong>.',
        'success.addToCal': '📅 Add to calendar',
        'success.newReg': 'Register another person',
    }
};

// ==========================================
// STATE + FUNKTIONEN
// ==========================================
let currentLang = 'de';

export function getLanguage() { return currentLang; }

export function t(key, params = {}) {
    const dict = translations[currentLang] || translations.de;
    let str = dict[key] ?? translations.de[key] ?? key;
    Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    });
    return str;
}

export function applyTranslations() {
    // Text-Inhalte
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const val = t(key);
        if (/<[a-z]/i.test(val)) el.innerHTML = val;
        else el.textContent = val;
    });

    // Platzhalter (input placeholder)
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });

    // Title-Attribute (Tooltips)
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.getAttribute('data-i18n-title'));
    });

    // HTML-Sprache setzen
    document.documentElement.lang = currentLang;
}

export function setLanguage(lang, { silent = false } = {}) {
    if (lang !== 'de' && lang !== 'en') lang = 'de';
    currentLang = lang;
    localStorage.setItem('nfs_lang', lang);
    applyTranslations();
    if (!silent) {
        window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
    }
}

export function initLanguageSwitcher() {
    const btn = document.getElementById('langToggle');
    if (!btn) return;

    // Sprache aus URL > localStorage > default
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    const saved = localStorage.getItem('nfs_lang');
    const initial = urlLang === 'en' || urlLang === 'de' ? urlLang : (saved || 'de');

    setLanguage(initial, { silent: true });
    updateToggleLabel(btn);

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const next = currentLang === 'de' ? 'en' : 'de';
        setLanguage(next);
        updateToggleLabel(btn);

        // URL-Parameter aktualisieren (damit Sharing-Links funktionieren)
        const url = new URL(window.location);
        if (next === 'de') url.searchParams.delete('lang');
        else url.searchParams.set('lang', next);
        window.history.replaceState({}, '', url);
    });
}

function updateToggleLabel(btn) {
    btn.textContent = currentLang === 'de' ? '🇬🇧 EN' : '🇩🇪 DE';
    btn.title = currentLang === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln';
}