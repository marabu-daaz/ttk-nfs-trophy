// src/admin/admin.js
// Einstieg des Admin-Bereichs: Login, Navigation, Laden, Neu-Rendern

import { supabase } from '../shared/supabase.js';
import { showToast, throwIfError } from '../shared/utils.js';
import { state, subscribe, notify, reloadAll, totals, allBewerbNames, waitingIn } from './state.js';
import { icon, hydrateIcons, confirmDialog, openMail } from './ui.js';
import * as dashboard from './dashboard.js';
import * as registrations from './registrations.js';
import * as bewerbe from './bewerbe.js';
import * as checkin from './checkin.js';
import { loadBookkeeping, setFinanceTournamentId, setFinanceChangeHandler, initFinanceView, renderFinance } from './finance.js';
import { fillSetup, initSetupEvents, setSetupTournamentId, setSetupTournaments, setSetupSavedHandler } from './setup.js';
import { setArchiveTournamentId, setArchiveTournaments, populateArchivDropdown, initArchiveEvents, initFotoUpload } from './archive.js';

const $ = id => document.getElementById(id);

// ==========================================
// ANSICHTEN
// ==========================================
const VIEWS = {
    uebersicht: { title: 'Übersicht', render: dashboard.render },
    nennungen: { title: 'Nennungen', render: registrations.render },
    bewerbe: { title: 'Bewerbe', render: bewerbe.render },
    checkin: { title: 'Check-in', render: checkin.render },
    kasse: { title: 'Kasse', render: renderKasse },
    setup: { title: 'Turnier-Setup', render: null },
    archiv: { title: 'Archiv & Medien', render: null },
};
let currentView = null;

function route() {
    const name = (location.hash.match(/^#\/(\w+)/) || [])[1];
    const view = VIEWS[name] ? name : 'uebersicht';
    currentView = view;

    Object.keys(VIEWS).forEach(v => $(`view-${v}`).classList.toggle('hidden', v !== view));
    document.querySelectorAll('#mainNav a[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    $('topTitle').textContent = VIEWS[view].title;
    document.title = `${VIEWS[view].title} · NFS Trophy Admin`;
    document.body.classList.remove('nav-open');
    renderCurrent();
    window.scrollTo(0, 0);
}

function renderCurrent() {
    if (!state.tournament) return;
    renderSidebar();
    VIEWS[currentView]?.render?.();
}

function renderSidebar() {
    const t = state.tournament;
    $('sbTournamentName').textContent = t.name || 'Turnier';
    $('sbTournamentMeta').textContent = t.date_text || '';
    const pill = $('sbOpenToggle');
    pill.className = `status-pill ${t.is_open ? 'open' : 'closed'}`;
    pill.textContent = t.is_open ? 'Anmeldung offen' : 'Anmeldung geschlossen';
    $('navCountRegs').textContent = state.registrations.length || '';
    const wl = allBewerbNames().reduce((s, b) => s + waitingIn(b).length, 0);
    $('navCountWl').textContent = wl ? `${wl} WL` : '';
}

function renderKasse() {
    const byTag = {};
    state.registrations.forEach(r => {
        if (!r.activeBewerbe.length) return;
        const v = (byTag[r.player_tag] ||= { people: 0, starts: 0, expected: 0, paid: 0 });
        v.people++;
        v.starts += r.activeBewerbe.length;
        v.expected += r.fee_expected;
        if (r.has_paid) v.paid += r.fee_expected;
    });
    renderFinance(totals(), byTag);
}

// ==========================================
// LADEN
// ==========================================
let setupFilledFor = null;
let lastLoad = 0;

async function loadEverything() {
    lastLoad = Date.now();
    try {
        await reloadAll();
        const t = state.tournament;
        if (!t) {
            showToast('Noch kein Turnier vorhanden.', true);
            return;
        }
        setFinanceTournamentId(t.id);
        setSetupTournamentId(t.id);
        setSetupTournaments(state.tournaments);
        setArchiveTournamentId(t.id);
        setArchiveTournaments(state.tournaments);

        // Setup-Formular nur befüllen, wenn sich das Turnier geändert hat (sonst gehen Eingaben verloren)
        if (setupFilledFor !== t.id) {
            fillSetup(t);
            setupFilledFor = t.id;
        }
        populateArchivDropdown();
        await loadBookkeeping();
        renderCurrent();
    } catch (err) {
        console.error('Fehler beim Laden:', err);
        showToast('Daten konnten nicht geladen werden: ' + (err.message || err), true);
    }
}

// ==========================================
// AUTH
// ==========================================
let appInitialized = false;

function showLogin() {
    $('loginScreen').classList.remove('hidden');
    $('appContent').classList.add('hidden');
}

async function showApp() {
    $('loginScreen').classList.add('hidden');
    $('appContent').classList.remove('hidden');
    if (!appInitialized) {
        appInitialized = true;
        initOnce();
    }
    await loadEverything();
}

function initOnce() {
    hydrateIcons();
    registrations.initRegistrationsView();
    bewerbe.initBewerbeView();
    checkin.initCheckinView();
    initFinanceView();
    initSetupEvents();
    initArchiveEvents();
    initFotoUpload();

    subscribe(renderCurrent);
    setFinanceChangeHandler(notify);
    setSetupSavedHandler(async () => {
        setupFilledFor = null;
        await loadEverything();
    });

    window.addEventListener('hashchange', route);
    route();

    // Globale Aktionen (Buttons mit data-action, auch in neu gerenderten Bereichen)
    document.addEventListener('click', async e => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const action = el.dataset.action;
        if (action === 'new-reg') registrations.openRegModal();
        if (action === 'refresh') { await loadEverything(); showToast('Aktualisiert'); }
        if (action === 'toggle-open') toggleOpen();
        if (action === 'mail-all') mailAll();
    });
    $('topAddBtn').addEventListener('click', () => registrations.openRegModal());
    $('sbOpenToggle').addEventListener('click', toggleOpen);
    $('menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
    $('scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

    // Daten aktuell halten, wenn der Tab wieder in den Vordergrund kommt (z.B. mehrere Leute am Check-in)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - lastLoad > 60000) loadEverything();
    });
}

async function toggleOpen() {
    const t = state.tournament;
    if (!t) return;
    const open = !t.is_open;
    const ok = await confirmDialog({
        title: open ? 'Anmeldung öffnen?' : 'Anmeldung schließen?',
        message: open
            ? 'Spieler können sich danach wieder über die Website anmelden.'
            : 'Das Anmeldeformular auf der Website wird deaktiviert. Im Admin kannst du weiterhin Nennungen anlegen.',
        confirmText: open ? 'Öffnen' : 'Schließen',
    });
    if (!ok) return;
    try {
        throwIfError(await supabase.from('tournaments').update({ is_open: open }).eq('id', t.id));
        t.is_open = open;
        const cb = $('setupIsOpen');
        cb.checked = open;
        cb.dispatchEvent(new Event('change'));
        showToast(open ? 'Anmeldung ist jetzt offen' : 'Anmeldung ist jetzt geschlossen');
        notify();
    } catch (err) {
        showToast('Konnte nicht gespeichert werden: ' + (err.message || err), true);
    }
}

function mailAll() {
    const emails = [...new Set(state.registrations.map(r => (r.email || '').trim()).filter(Boolean))];
    if (!emails.length) return showToast('Keine E-Mail-Adressen vorhanden.', true);
    openMail({ bcc: emails, subject: state.tournament?.name || 'NFS Trophy' });
}

// ==========================================
// THEME
// ==========================================
function initTheme() {
    const btn = $('themeToggle');
    const apply = theme => {
        document.documentElement.setAttribute('data-theme', theme);
        btn.innerHTML = icon(theme === 'light' ? 'moon' : 'sun');
        btn.title = theme === 'light' ? 'Dunkles Design' : 'Helles Design';
    };
    apply(document.documentElement.getAttribute('data-theme') || 'dark');
    btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        try { localStorage.setItem('admin-theme', next); } catch { /* privater Modus */ }
        apply(next);
    });
}

// ==========================================
// LOGIN / LOGOUT
// ==========================================
$('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('loginBtn');
    const errDiv = $('loginError');
    btn.disabled = true;
    btn.textContent = 'Prüfe…';
    errDiv.textContent = '';
    try {
        const { error } = await supabase.auth.signInWithPassword({
            email: $('loginEmail').value,
            password: $('loginPassword').value,
        });
        if (error) {
            errDiv.textContent = 'E-Mail oder Passwort ist falsch.';
            return;
        }
        $('loginPassword').value = '';
        await showApp();
    } catch (err) {
        console.error(err);
        errDiv.textContent = 'Anmeldung fehlgeschlagen. Bitte später erneut versuchen.';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Einloggen';
    }
});

$('logoutBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    showLogin();
});

// ==========================================
// START
// ==========================================
initTheme();

try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await showApp();
    else showLogin();
} catch (err) {
    console.error('Session-Check fehlgeschlagen:', err);
    showLogin();
}
