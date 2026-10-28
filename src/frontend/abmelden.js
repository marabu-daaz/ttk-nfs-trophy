// src/frontend/abmelden.js
// Nennung verwalten per Link aus der Bestätigungsmail (/abmelden?t=<token>):
// abmelden, Bewerbe dazunehmen, Angaben ändern

import { supabase } from '../shared/supabase.js';
import { esc, showToast } from '../shared/utils.js';

const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('t');
const FN = 'send-registration-email';
const DATA_FIELDS = { email: 'dEmail', telefon: 'dTelefon', verein: 'dVerein', rc: 'dRc', notiz: 'dNotiz' };

let current = null;   // zuletzt geladene Nennung

function show(state) {
    ['stateLoading', 'stateFound', 'stateDone', 'stateRequest'].forEach(id => { $(id).hidden = id !== state; });
}

function showRequest(reason) {
    const r = $('requestReason');
    r.hidden = !reason;
    r.textContent = reason || '';
    show('stateRequest');
}

async function load() {
    const { data, error } = await supabase.rpc('registration_by_token', { p_token: token });
    if (error) {
        console.error(error);
        showRequest('Der Link konnte gerade nicht geprüft werden. Bitte versuch es später noch einmal oder fordere einen neuen Link an.');
        return false;
    }
    if (!data) {
        showRequest('Zu diesem Link gibt es keine Nennung (mehr) – vielleicht bist du schon abgemeldet. Hier kannst du einen neuen Link anfordern.');
        return false;
    }
    current = data;
    renderFound(data);
    return true;
}

async function init() {
    if (!token) return showRequest();
    if (!/^[0-9a-f-]{36}$/i.test(token)) return showRequest('Dieser Link ist ungültig. Fordere hier einen neuen an.');
    await load();
}

// ==========================================
// ANZEIGE
// ==========================================
function renderFound(d) {
    const editable = !!d.abmeldbar;
    $('manageTitle').innerHTML = `Hallo <em>${esc(d.vorname)}</em>`;
    $('foundIntro').innerHTML = `Deine Nennung für die <strong>${esc(d.turnier)}</strong>${d.datum ? ` (${esc(d.datum)})` : ''}:`;
    const wl = d.warteliste || [];
    $('foundBewerbe').innerHTML = (d.bewerbe || []).map(b => `
        <label class="manage-bewerb">
            <input type="checkbox" value="${esc(b)}" ${editable ? '' : 'disabled'}>
            <span class="name">${esc(b)}</span>
            <span class="tag ${wl.includes(b) ? 'wl' : ''}">${wl.includes(b) ? 'Warteliste' : 'Startplatz'}</span>
        </label>`).join('');
    $('foundActions').hidden = !editable;
    $('foundTooLate').hidden = editable;
    updateCancelButton();

    renderDataCard(d, editable);
    renderAddCard(d, editable, []);
    show('stateFound');
}

/** RC-Grenze eines Bewerbs als Text („ab 1000 RC“) */
function rcText(b) {
    if (b.min_rc && b.max_rc) return `${b.min_rc}–${b.max_rc} RC`;
    if (b.min_rc) return `ab ${b.min_rc} RC`;
    if (b.max_rc) return `bis ${b.max_rc} RC`;
    return '';
}

function renderAddCard(d, editable, keep = selectedAdd()) {
    // Ältere Datenbank-Version liefert kein Angebot → Karte bleibt aus
    const offer = (d.angebot || []).filter(b => !(d.bewerbe || []).includes(b.name));
    $('addCard').hidden = !editable || !Array.isArray(d.angebot) || offer.length === 0;
    if ($('addCard').hidden) return;

    const open = !!d.anmeldung_offen;
    $('addHint').textContent = open
        ? 'Volle Bewerbe kannst du trotzdem wählen – du kommst dann auf die Warteliste.'
        : 'Die Anmeldung ist geschlossen – neue Bewerbe können nicht mehr dazugenommen werden.';
    const rc = parseInt(String($('dataCard').hidden ? d.rc || '' : $('dRc').value).replace(/\D/g, ''), 10) || 0;
    $('addBewerbe').innerHTML = offer.map(b => {
        const tooLow = b.min_rc && rc < b.min_rc, tooHigh = b.max_rc && rc > b.max_rc;
        const blocked = !open || tooLow || tooHigh;
        const meta = [b.time, rcText(b)].filter(Boolean).join(' · ');
        const tag = tooLow || tooHigh
            ? `<span class="tag wl">${tooLow ? 'zu wenig RC' : 'zu viele RC'}</span>`
            : b.frei > 0
                ? `<span class="tag">${b.frei} ${b.frei === 1 ? 'Platz' : 'Plätze'} frei</span>`
                : `<span class="tag wl">Warteliste</span>`;
        return `
        <label class="manage-bewerb ${blocked ? 'disabled' : ''}">
            <input type="checkbox" value="${esc(b.name)}" ${blocked ? 'disabled' : keep.includes(b.name) ? 'checked' : ''}>
            <span class="name">${esc(b.name)}${meta ? `<br><span class="meta">${esc(meta)}</span>` : ''}</span>
            ${tag}
        </label>`;
    }).join('');
    updateAddButton();
}

function renderDataCard(d, editable) {
    // Ältere Datenbank-Version liefert keine Angaben → Karte bleibt aus
    $('dataCard').hidden = !editable || !('email' in d);
    if ($('dataCard').hidden) return;
    $('dataName').textContent = `Genannt als ${d.vorname} ${d.nachname}. Name falsch geschrieben? Bitte kurz der Turnierleitung schreiben.`;
    Object.entries(DATA_FIELDS).forEach(([k, id]) => { $(id).value = d[k] || ''; });
    $('dQuittung').checked = !!d.quittung;
    updateDataButton();
}

// ==========================================
// ABMELDEN
// ==========================================
const selectedCancel = () => [...document.querySelectorAll('#foundBewerbe input:checked')].map(i => i.value);

function updateCancelButton() {
    const n = selectedCancel().length;
    $('cancelSelectedBtn').disabled = n === 0 || n === (current?.bewerbe || []).length;
    $('cancelSelectedBtn').textContent = n ? `${n === 1 ? 'Diesen Bewerb' : n + ' Bewerbe'} abmelden` : 'Ausgewählte abmelden';
}

async function cancel(bewerbe) {
    const d = current;
    const what = bewerbe ? bewerbe.join(', ') : 'allen Bewerben';
    if (!confirm(`Wirklich von ${what} abmelden? Das kann nicht rückgängig gemacht werden.`)) return;

    const btns = [$('cancelSelectedBtn'), $('cancelAllBtn')];
    btns.forEach(b => { b.disabled = true; });
    $('cancelAllBtn').textContent = 'Melde ab…';
    try {
        const { data, error } = await supabase.functions.invoke(FN, { body: { action: 'cancel', token, bewerbe } });
        if (error) throw error;
        if (!data?.ok) {
            const msg = {
                not_found: 'Diese Nennung gibt es nicht mehr – vielleicht bist du schon abgemeldet.',
                too_late: 'Das Turnier hat bereits begonnen – bitte melde dich direkt bei der Turnierleitung.',
            }[data?.reason] || 'Abmelden hat nicht geklappt. Bitte versuch es später noch einmal.';
            showToast(msg, true);
            btns.forEach(b => { b.disabled = false; });
            $('cancelAllBtn').textContent = 'Komplett abmelden';
            return;
        }
        $('doneText').innerHTML = data.deleted
            ? `Du bist von der <strong>${esc(d.turnier)}</strong> abgemeldet.`
            : `Du bist von <strong>${data.removed.map(esc).join(', ')}</strong> abgemeldet. Weiterhin genannt: ${data.remaining.map(esc).join(', ')}.`;
        show('stateDone');
    } catch (err) {
        console.error(err);
        showToast('Abmelden hat nicht geklappt. Bitte versuch es später noch einmal.', true);
        btns.forEach(b => { b.disabled = false; });
        $('cancelAllBtn').textContent = 'Komplett abmelden';
    }
}

// ==========================================
// ÄNDERN (Bewerbe dazunehmen, Angaben)
// ==========================================
const selectedAdd = () => [...document.querySelectorAll('#addBewerbe input:checked')].map(i => i.value);

function updateAddButton() {
    const n = selectedAdd().length;
    $('addBtn').disabled = n === 0;
    $('addBtn').textContent = n > 1 ? `${n} Bewerbe dazunehmen` : 'Dazunehmen';
}

/** Nur geänderte Angaben (leere E-Mail bleibt unverändert) */
function dataChanges() {
    if (!current) return {};
    const out = {};
    Object.entries(DATA_FIELDS).forEach(([k, id]) => {
        const v = $(id).value.trim();
        if (v !== (current[k] || '').trim()) out[k] = v;
    });
    if ($('dQuittung').checked !== !!current.quittung) out.quittung = $('dQuittung').checked;
    return out;
}

function updateDataButton() {
    $('dataBtn').disabled = Object.keys(dataChanges()).length === 0;
}

const UPDATE_ERRORS = {
    not_found: 'Diese Nennung gibt es nicht mehr – vielleicht bist du schon abgemeldet.',
    too_late: 'Das Turnier hat bereits begonnen – Änderungen bitte direkt bei der Turnierleitung.',
    closed: 'Die Anmeldung ist inzwischen geschlossen – neue Bewerbe können nicht mehr dazugenommen werden.',
    invalid_email: 'Bitte eine gültige E-Mail-Adresse eingeben.',
    duplicate: 'Mit dieser E-Mail-Adresse bist du für dieses Turnier schon ein zweites Mal genannt. Bitte melde dich bei der Turnierleitung.',
    nothing_changed: 'Es gab nichts zu ändern.',
    unknown_bewerb: 'Diesen Bewerb gibt es nicht mehr – bitte lade die Seite neu.',
};

async function sendUpdate(data, btn, busyText) {
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyText;
    try {
        const { data: res, error } = await supabase.functions.invoke(FN, { body: { action: 'update', token, data } });
        if (error) throw error;
        if (!res?.ok) {
            const msg = res?.reason === 'rc_low' ? `Für „${res.bewerb}“ brauchst du mindestens ${res.limit} RC-Punkte.`
                : res?.reason === 'rc_high' ? `„${res.bewerb}“ ist nur bis ${res.limit} RC-Punkte offen.`
                : UPDATE_ERRORS[res?.reason] || 'Das hat nicht geklappt. Bitte versuch es später noch einmal.';
            showToast(msg, true);
            return false;
        }
        const wl = res.added_waitlist || [];
        showToast(res.added?.length
            ? `${res.added.join(', ')} dazugenommen${wl.length ? ` (${wl.join(', ')} auf der Warteliste)` : ''}. Bestätigung kommt per E-Mail.`
            : 'Gespeichert. Bestätigung kommt per E-Mail.');
        await load();
        return true;
    } catch (err) {
        console.error(err);
        showToast('Das hat nicht geklappt. Bitte versuch es später noch einmal.', true);
        return false;
    } finally {
        btn.textContent = prev;
        updateAddButton();
        updateDataButton();
    }
}

// ==========================================
// EVENTS (einmalig)
// ==========================================
$('foundBewerbe').addEventListener('change', updateCancelButton);
$('cancelSelectedBtn').addEventListener('click', () => cancel(selectedCancel()));
$('cancelAllBtn').addEventListener('click', () => cancel(null));

$('addBewerbe').addEventListener('change', updateAddButton);
$('addBtn').addEventListener('click', () => {
    const add = selectedAdd();
    if (!add.length) return;
    // Geänderte RC-Punkte gleich mitschicken (für die RC-Grenzen der Bewerbe)
    const changes = dataChanges();
    sendUpdate({ add, ...('rc' in changes ? { rc: changes.rc } : {}) }, $('addBtn'), 'Speichere…');
});

$('dataForm').addEventListener('input', () => {
    updateDataButton();
    // RC geändert → Angebot neu bewerten (RC-Grenzen)
    if (current) renderAddCard(current, !!current.abmeldbar);
});
$('dataForm').addEventListener('change', updateDataButton);
$('dataForm').addEventListener('submit', e => {
    e.preventDefault();
    const changes = dataChanges();
    if ('email' in changes && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)) {
        showToast(UPDATE_ERRORS.invalid_email, true);
        $('dEmail').focus();
        return;
    }
    if ('email' in changes && !confirm(`E-Mail-Adresse auf ${changes.email} ändern? Bestätigungen und Erinnerungen gehen dann dorthin.`)) return;
    sendUpdate(changes, $('dataBtn'), 'Speichere…');
});

$('requestForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('requestBtn');
    btn.disabled = true;
    btn.textContent = 'Sende…';
    try {
        const { error } = await supabase.functions.invoke(FN, { body: { action: 'resend_link', email: $('requestEmail').value.trim() } });
        if (error) throw error;
        $('requestForm').hidden = true;
        $('requestDone').hidden = false;
    } catch (err) {
        console.error(err);
        showToast('Das hat nicht geklappt. Bitte versuch es später noch einmal.', true);
        btn.disabled = false;
        btn.textContent = 'Link zusenden';
    }
});

init();
