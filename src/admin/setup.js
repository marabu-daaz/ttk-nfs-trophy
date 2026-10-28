// src/admin/setup.js
// Turnier-Setup: Felder befüllen, Bewerbe/Zeitplan/Sponsoren bearbeiten, speichern, Saisonwechsel

import { supabase, publicSponsorUrl, publicPdfUrl, publicFotoUrl } from '../shared/supabase.js';
import { esc, showToast, safeFileName, parseTurnierInfo, parseBewerbe, formatForDateTimeLocal, throwIfError } from '../shared/utils.js';
import { DEFAULT_FEE_NORMAL, DEFAULT_FEE_NFS, DEFAULT_BEWERBE } from '../shared/constants.js';
import { icon, confirmDialog, promptDialog, formDialog, withBusy, makeDropzone } from './ui.js';
import { countInBewerb, renameBewerbInRegistrations } from './state.js';
import { htmlToMarkup, markupToHtml, wrapSelection } from './richtext.js';
import { initPreview, refreshPreview } from './preview.js';

let setupBewerbeList = [];   // [{ ...bewerb, _orig: ursprünglicher Name | null }]
let allTournaments = [];
let activeTournamentId = null;
let onSaved = () => { };
let baseline = '';           // Formularzustand nach dem Laden/Speichern (für „ungespeichert“)
let baseRow = null;          // Turnier, wie es beim Befüllen in der Datenbank stand
let baseForm = null;         // readForm() direkt nach dem Befüllen – Vergleich „was habe ich geändert?“

/** Website-Texte mit *fett* / _kursiv_ (gespeichert als HTML). block: <strong> als eigene Zeile */
const FORMAT_FIELDS = {
    bewerbeHeadline: { id: 'setupBewerbeHeadline' },
    bewerbeText: { id: 'setupBewerbeText' },
    fact1Text: { id: 'setupFact1Text', block: true },
    fact2Text: { id: 'setupFact2Text', block: true },
    fact3Text: { id: 'setupFact3Text', block: true },
    fact4Text: { id: 'setupFact4Text', block: true },
};

export function setSetupTournamentId(id) { activeTournamentId = id; }
export function setSetupTournaments(data) { allTournaments = data; }
export function setSetupSavedHandler(fn) { onSaved = fn; }

const $ = id => document.getElementById(id);
const currentTournament = () => allTournaments.find(t => String(t.id) === String(activeTournamentId));

// ==========================================
// UNGESPEICHERTE ÄNDERUNGEN
// ==========================================
function snapshot() {
    return JSON.stringify([...document.querySelectorAll('#view-setup input, #view-setup select, #view-setup textarea')]
        .map(el => el.type === 'checkbox' ? el.checked : el.type === 'file' ? el.files.length : el.value));
}

export function isSetupDirty() {
    return baseline !== '' && snapshot() !== baseline;
}

function markClean() {
    baseline = snapshot();
    updateDirtyUi();
}

function updateDirtyUi() {
    const dirty = isSetupDirty();
    document.querySelector('#view-setup .save-bar')?.classList.toggle('dirty', dirty);
    const hint = $('setupDirtyHint');
    if (hint) hint.textContent = dirty ? 'Ungespeicherte Änderungen' : 'Alles gespeichert';
    // Punkt am Menüeintrag, damit man es auch aus anderen Bereichen sieht
    document.querySelector('#mainNav a[data-view="setup"]')?.classList.toggle('dirty', dirty);
}

// ==========================================
// FELDER BEFÜLLEN
// ==========================================
export function fillSetup(t) {
    const s = (id, val) => {
        const el = $(id);
        if (el) el.value = val ?? '';
    };

    $('setupIsOpen').checked = !!t.is_open;
    updateOpenLabel(!!t.is_open);
    $('setupShowTtop').checked = t.show_ttop_button === true;
    s('setupTtopUrl', t.ttop_url);
    s('setupName', t.name);
    s('setupDateText', t.date_text);
    s('setupSubtitle', t.subtitle);
    s('setupOettvUrl', t.oettv_url);
    s('setupFeeNormal', t.fee_normal ?? DEFAULT_FEE_NORMAL);
    s('setupFeeNfs', t.fee_nfs ?? DEFAULT_FEE_NFS);
    s('setupDateIso', formatForDateTimeLocal(t.date_iso));

    $('setupPdfCurrent').innerHTML = t.ausschreibung_path
        ? `Aktuell: <a href="${esc(publicPdfUrl(t.ausschreibung_path))}" target="_blank" rel="noopener">${esc(t.ausschreibung_path.replace(/^\d+_/, ''))}</a>`
        : 'Noch keine Ausschreibung hochgeladen.';

    const info = parseTurnierInfo(t);
    s('setupDeadline', info.registrationDeadline ? formatForDateTimeLocal(info.registrationDeadline) : '');
    Object.entries(FORMAT_FIELDS).forEach(([key, f]) => s(f.id, htmlToMarkup(info[key], f)));
    [1, 2, 3, 4].forEach(n => s(`setupFact${n}Title`, info[`fact${n}Title`]));

    $('setupShowSchedule').checked = !!info.showSchedule;
    $('scheduleContainer').innerHTML = '';
    (info.schedule?.length ? info.schedule : [{}]).forEach(item => renderScheduleRow(item.time, item.text));

    showHeroPhoto(info.heroPhoto || '');

    $('setupShowSponsors').checked = !!info.showSponsors;
    $('sponsorsContainer').innerHTML = '';
    if (info.sponsors?.length) {
        info.sponsors.forEach(sp => renderSponsorRow(sp.logoPath || '', sp.link, sp.logoUrl || (sp.logoPath ? publicSponsorUrl(sp.logoPath) : ''), sp.name || ''));
    } else {
        renderSponsorRow();
    }

    setupBewerbeList = parseBewerbe(t).map(b => ({ ...b, _orig: b.name }));
    openBewerbe.clear();
    renderSetupBewerbe();
    generateQRCodes(t.oettv_url);
    updateDeadlineHint();
    markClean();
    baseRow = structuredClone(t);
    baseForm = readForm();
    refreshPreview();
}

function updateOpenLabel(isOpen) {
    $('setupIsOpenLabel').innerHTML = `<span style="color:var(${isOpen ? '--accent' : '--danger'})">${isOpen ? 'Geöffnet' : 'Geschlossen'}</span>`;
    $('setupIsOpenHint').textContent = isOpen ? 'Spieler können sich auf der Website anmelden.' : 'Das Formular auf der Website ist deaktiviert.';
}

/** Von außen (z.B. Seitenleiste) geändert – ohne die Seite als „ungespeichert“ zu markieren */
export function setSetupOpenState(open) {
    const wasClean = !isSetupDirty();
    $('setupIsOpen').checked = open;
    updateOpenLabel(open);
    if (wasClean) markClean();
    // gilt als bereits gespeichert – nicht als eigene oder fremde Änderung werten
    if (baseRow) baseRow.is_open = open;
    if (baseForm) baseForm.columns.is_open = open;
    refreshPreview();
}

function updateDeadlineHint() {
    const v = $('setupDeadline').value;
    const hint = $('setupDeadlineHint');
    if (!v) { hint.textContent = 'Ab diesem Zeitpunkt ist das Anmeldeformular automatisch geschlossen.'; return; }
    const d = new Date(v);
    hint.textContent = d < new Date()
        ? '⚠️ Liegt in der Vergangenheit – die Anmeldung ist damit auf der Website geschlossen.'
        : `Anmeldung schließt automatisch am ${d.toLocaleString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`;
}

// ==========================================
// BEWERBE
// ==========================================
const openBewerbe = new Set();   // Index der aufgeklappten Bewerbe

/** Zusammenfassung einer Bewerbs-Zeile („Sa 09:00 · 16 Plätze · ab 800 RC · 300 €“) */
function bewerbSummary(b, regs) {
    const parts = [];
    if (b.time) parts.push(b.time);
    parts.push(`${b.capacity || 20} Plätze`);
    const min = parseInt(b.min_rc, 10) || 0, max = parseInt(b.max_rc, 10) || 0;
    if (min && max) parts.push(`${min}–${max} RC`);
    else if (min) parts.push(`ab ${min} RC`);
    else if (max) parts.push(`bis ${max} RC`);
    if (b.prize) parts.push(b.prize);
    if (regs) parts.push(`${regs} ${regs === 1 ? 'Nennung' : 'Nennungen'}`);
    return parts.join(' · ');
}

export function renderSetupBewerbe() {
    const container = $('bewerbeContainer');
    const n = setupBewerbeList.length;
    $('setupBewerbeCount').textContent = n || '';
    container.innerHTML = setupBewerbeList.map((b, index) => {
        const regs = b._orig ? countInBewerb(b._orig) : 0;
        const open = openBewerbe.has(index);
        return `
        <div class="bw-item bewerb-row ${open ? 'open' : ''}" data-index="${index}">
            <div class="bw-sum">
                <div class="order-btns">
                    <button type="button" class="icon-btn" data-move="-1" title="Nach oben" ${index === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button>
                    <button type="button" class="icon-btn" data-move="1" title="Nach unten" ${index === n - 1 ? 'disabled' : ''}>${icon('arrowDown')}</button>
                </div>
                <button type="button" class="bw-toggle" aria-expanded="${open}">
                    <span class="bw-sum-name">${esc(b.name) || '<em>Ohne Namen</em>'}</span>
                    <span class="bw-sum-meta">${esc(bewerbSummary(b, regs))}</span>
                </button>
                <button type="button" class="icon-btn" data-toggle title="${open ? 'Zuklappen' : 'Bearbeiten'}">${icon(open ? 'x' : 'edit')}</button>
                <button type="button" class="icon-btn danger remove-bewerb-btn" title="Bewerb entfernen">${icon('trash')}</button>
            </div>
            <div class="bw-edit">
                <div class="field span-all"><label>Name</label><input type="text" class="input bewerb-name" value="${esc(b.name)}"></div>
                <div class="field"><label>Startzeit</label><input type="text" class="input bewerb-time" value="${esc(b.time || '')}" placeholder="Sa 09:00"></div>
                <div class="field"><label>Dauer (Std.)</label><input type="number" class="input bewerb-duration" value="${esc(b.duration || 3)}" min="1"></div>
                <div class="field"><label>Plätze</label><input type="number" class="input bewerb-cap" value="${esc(b.capacity || 20)}" min="1"></div>
                <div class="field"><label>Min. RC</label><input type="number" class="input bewerb-rc" value="${esc(b.min_rc || '')}" min="0" placeholder="–"></div>
                <div class="field"><label>Max. RC</label><input type="number" class="input bewerb-maxrc" value="${esc(b.max_rc || '')}" min="0" placeholder="–"></div>
                <div class="field"><label>Preisgeld</label><input type="text" class="input bewerb-prize" value="${esc(b.prize || '')}" placeholder="optional"></div>
                ${regs ? `<div class="help span-all">${regs} ${regs === 1 ? 'Nennung' : 'Nennungen'} – beim Umbenennen werden sie automatisch mitgenommen.</div>` : ''}
            </div>
        </div>`;
    }).join('') || '<div class="muted small">Noch keine Bewerbe.</div>';
    updateDirtyUi();
}

/** Zusammenfassung beim Tippen aktualisieren, ohne neu zu rendern (Fokus bleibt) */
function refreshSummary(row) {
    const idx = parseInt(row.dataset.index, 10);
    const b = getBewerbeFromDOM()[idx];
    if (!b) return;
    row.querySelector('.bw-sum-name').textContent = b.name || 'Ohne Namen';
    row.querySelector('.bw-sum-meta').textContent = bewerbSummary(b, b._orig ? countInBewerb(b._orig) : 0);
}

/** Liest die Bewerbe aus dem Formular (inkl. ursprünglichem Namen für Umbenennungen) */
export function getBewerbeFromDOM() {
    const list = [];
    document.querySelectorAll('#bewerbeContainer .bewerb-row').forEach(row => {
        const v = cls => row.querySelector('.' + cls).value.trim();
        const orig = setupBewerbeList[parseInt(row.dataset.index, 10)]?._orig ?? null;
        const num = (val, fallback) => { const n = parseInt(val, 10); return Number.isNaN(n) ? fallback : n; };
        list.push({
            ...(setupBewerbeList[parseInt(row.dataset.index, 10)] || {}),
            name: v('bewerb-name'),
            time: v('bewerb-time'),
            duration: num(v('bewerb-duration'), 3) || 3,
            min_rc: num(v('bewerb-rc'), 0),
            max_rc: num(v('bewerb-maxrc'), 0),
            capacity: num(v('bewerb-cap'), 20) || 20,
            prize: v('bewerb-prize'),
            _orig: orig,
        });
    });
    return list;
}

// ==========================================
// ZEITPLAN & SPONSOREN
// ==========================================
export function renderScheduleRow(time = '', text = '') {
    const container = $('scheduleContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'repeat-row compact schedule-row';
    div.innerHTML = `
        <input type="text" class="input sched-time" placeholder="08:00" value="${esc(time)}" style="width:110px;">
        <input type="text" class="input sched-text grow" placeholder="z.B. Hallenöffnung" value="${esc(text)}" style="flex:1;">
        <button type="button" class="icon-btn danger" title="Entfernen">${icon('x')}</button>`;
    div.querySelector('button').addEventListener('click', () => { div.remove(); updateDirtyUi(); });
    container.appendChild(div);
    updateDirtyUi();
}

// ==========================================
// TITELFOTO
// ==========================================
function showHeroPhoto(path) {
    $('setupHeroPhotoPath').value = path;
    $('setupHeroPhoto').value = '';
    $('setupHeroPhoto').dispatchEvent(new Event('change'));
    const img = $('heroPhotoPreview');
    img.hidden = !path;
    if (path) img.src = publicFotoUrl(path);
    else img.removeAttribute('src');
    $('heroPhotoRemove').hidden = !path;
}

/** Bild im Browser auf max. maxPx verkleinern (spart Ladezeit auf der Website) */
async function shrinkImage(file, maxPx, quality) {
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const f = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * f);
        canvas.height = Math.round(img.naturalHeight * f);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) throw new Error('toBlob lieferte nichts');
        return blob;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function initHeroPhoto() {
    makeDropzone($('setupHeroPhoto'), { text: 'Titelfoto hierher ziehen' });
    $('setupHeroPhoto').addEventListener('change', () => {
        const file = $('setupHeroPhoto').files[0];
        const img = $('heroPhotoPreview');
        if (file) { img.src = URL.createObjectURL(file); img.hidden = false; $('heroPhotoRemove').hidden = false; }
    });
    $('heroPhotoRemove').addEventListener('click', () => { showHeroPhoto(''); updateDirtyUi(); });
}

export function renderSponsorRow(logoPath = '', link = '', logoUrl = '', name = '') {
    const container = $('sponsorsContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'repeat-row sponsor-row';
    div.innerHTML = `
        <div class="grow field">
            <label>Logo</label>
            <input type="file" class="input spon-file" accept="image/*,.svg">
            <input type="hidden" class="spon-logo-path" value="${esc(logoPath)}">
            <img class="sponsor-preview" src="${esc(logoUrl)}" alt="" ${logoUrl ? '' : 'hidden'}>
        </div>
        <div class="grow field">
            <label>Name</label>
            <input type="text" class="input spon-name" placeholder="Sponsorname" value="${esc(name)}">
        </div>
        <div class="grow field">
            <label>Website</label>
            <input type="url" class="input spon-link" placeholder="https://…" value="${esc(link)}">
        </div>
        <button type="button" class="icon-btn danger" title="Entfernen" style="margin-top:22px;">${icon('x')}</button>`;
    div.querySelector('button').addEventListener('click', () => { div.remove(); updateDirtyUi(); });
    makeDropzone(div.querySelector('.spon-file'), { text: logoPath ? 'Neues Logo hierher ziehen' : 'Logo hierher ziehen', compact: true });
    // Vorschau des neu gewählten Logos
    div.querySelector('.spon-file').addEventListener('change', e => {
        const file = e.target.files[0];
        const img = div.querySelector('.sponsor-preview');
        if (file) { img.src = URL.createObjectURL(file); img.hidden = false; }
    });
    container.appendChild(div);
    updateDirtyUi();
}

// ==========================================
// QR-CODES
// ==========================================
export function generateQRCodes(oettvUrl) {
    const QRCode = window.QRCode;
    const make = (el, text) => {
        el.innerHTML = '';
        try {
            new QRCode(el, { text, width: 150, height: 150 });
            return true;
        } catch {
            el.textContent = 'QR-Code konnte nicht erstellt werden';
            return false;
        }
    };

    const qrA = $('qrAnmeldung');
    if (qrA) make(qrA, 'https://nfs-trophy.com/#anmelden');

    const qrE = $('qrErgebnisse');
    const hint = $('qrErgebnisseHint');
    const btn = $('downloadQrErgebnisseBtn');
    if (!qrE) return;
    const ok = oettvUrl && oettvUrl.trim() && make(qrE, oettvUrl.trim());
    if (!ok) qrE.textContent = 'Kein Link hinterlegt';
    hint.textContent = ok ? '' : 'Erst eine ÖTTV-URL speichern.';
    btn.style.display = ok ? '' : 'none';
}

export function downloadQR(divId, filename) {
    const box = $(divId);
    const canvas = box?.querySelector('canvas');
    const img = box?.querySelector('img');
    const src = canvas ? canvas.toDataURL() : img?.src;
    if (!src) {
        showToast('QR-Code nicht verfügbar.', true);
        return;
    }
    const a = document.createElement('a');
    a.download = filename;
    a.href = src;
    a.click();
}

// ==========================================
// FORMULAR AUSLESEN (ohne Uploads)
// ==========================================
/**
 * Liest das Formular in die Form, in der es gespeichert wird. Neu gewählte Dateien
 * (Titelfoto, Sponsor-Logos) stehen als file drin – hochgeladen wird erst beim Speichern.
 */
function readForm() {
    const val = id => $(id)?.value.trim() || '';
    const dateIso = $('setupDateIso').value;
    const deadline = $('setupDeadline').value;

    const schedule = [];
    document.querySelectorAll('.schedule-row').forEach(row => {
        const time = row.querySelector('.sched-time').value.trim();
        const text = row.querySelector('.sched-text').value.trim();
        if (time || text) schedule.push({ time, text });
    });

    const sponsors = [];
    document.querySelectorAll('.sponsor-row').forEach(row => {
        const logoPath = row.querySelector('.spon-logo-path').value.trim();
        const file = row.querySelector('.spon-file').files[0] || null;
        if (!logoPath && !file) return;
        const name = row.querySelector('.spon-name').value.trim();
        sponsors.push({ logoPath, link: row.querySelector('.spon-link').value.trim(), ...(name ? { name } : {}), file });
    });

    const info = {
        showSchedule: $('setupShowSchedule').checked,
        schedule,
        heroPhoto: $('setupHeroPhotoPath').value.trim(),
        showSponsors: $('setupShowSponsors').checked,
        sponsors,
        registrationDeadline: deadline ? new Date(deadline).toISOString() : '',
    };
    Object.entries(FORMAT_FIELDS).forEach(([key, f]) => { info[key] = markupToHtml(val(f.id), f); });
    [1, 2, 3, 4].forEach(n => { info[`fact${n}Title`] = val(`setupFact${n}Title`); });

    return {
        columns: {
            is_open: $('setupIsOpen').checked,
            name: val('setupName') || 'NFS Trophy',
            date_text: val('setupDateText'),
            date_iso: dateIso ? new Date(dateIso).toISOString() : null,
            subtitle: val('setupSubtitle'),
            oettv_url: val('setupOettvUrl'),
            fee_normal: parseFee($('setupFeeNormal').value, DEFAULT_FEE_NORMAL),
            fee_nfs: parseFee($('setupFeeNfs').value, DEFAULT_FEE_NFS),
            show_ttop_button: $('setupShowTtop').checked,
            ttop_url: val('setupTtopUrl'),
        },
        bewerbe: getBewerbeFromDOM().map(({ _orig, ...b }) => {
            if (!b.max_rc) delete b.max_rc;
            return b;
        }),
        info,
        heroFile: $('setupHeroPhoto').files[0] || null,
        pdfFile: $('setupPdf')?.files[0] || null,
    };
}

// Vorschau: neu gewählte Bilder als lokale Adresse (blob:), je Datei nur einmal erzeugt
const blobUrls = new WeakMap();
const blobUrl = file => {
    if (!blobUrls.has(file)) blobUrls.set(file, URL.createObjectURL(file));
    return blobUrls.get(file);
};

/** Ungespeicherter Stand als Turnier-Zeile – für die Live-Vorschau */
function buildDraft() {
    if (!baseRow) return null;
    const f = readForm();
    const info = { ...parseTurnierInfo(baseRow), ...f.info };
    info.sponsors = f.info.sponsors.map(({ file, ...s }) => (file ? { ...s, _src: blobUrl(file) } : s));
    if (f.heroFile) info._heroSrc = blobUrl(f.heroFile);
    return {
        ...baseRow,
        ...f.columns,
        date_iso: f.columns.date_iso || baseRow.date_iso,
        bewerbe: JSON.stringify(f.bewerbe),
        turnier_info: JSON.stringify(info),
    };
}

// ==========================================
// SPEICHERN
// ==========================================
/**
 * Gebühr parsen: leeres Feld → Standard, 0 ist erlaubt (z.B. Gratis-Turnier)
 */
function parseFee(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isNaN(n) || n < 0 ? fallback : n;
}

/** Prüft die Bewerbe. Liefert eine Fehlermeldung oder null. */
function validateBewerbe(list) {
    const names = list.map(b => b.name.toLowerCase());
    if (list.some(b => !b.name)) return 'Jeder Bewerb braucht einen Namen.';
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) return `Der Bewerbsname „${list[names.indexOf(dup)].name}“ kommt doppelt vor – Platzhalter bitte unterscheiden, z.B. „TBA 1“, „TBA 2“.`;
    const bad = list.find(b => b.max_rc > 0 && b.min_rc > b.max_rc);
    if (bad) return `„${bad.name}“: Min. RC ist größer als Max. RC.`;
    // Gelöschte Bewerbe, für die es noch Nennungen gibt?
    const keptOrig = new Set(list.map(b => b._orig).filter(Boolean));
    const removed = (parseBewerbe(currentTournament()) || []).map(b => b.name).filter(n => !keptOrig.has(n) && countInBewerb(n) > 0);
    if (removed.length) return `„${removed[0]}“ hat noch ${countInBewerb(removed[0])} Nennungen und kann nicht entfernt werden. Bitte zuerst im Bereich „Bewerbe“ abmelden – oder den Bewerb umbenennen statt löschen.`;
    return null;
}

/** Bezeichnungen für die Meldung „hat inzwischen jemand anderes geändert“ */
const LABELS = {
    is_open: 'Anmeldung offen/geschlossen', name: 'Name', date_text: 'Datum', date_iso: 'Turnierbeginn',
    subtitle: 'Untertitel', oettv_url: 'ÖTTV-Link', fee_normal: 'Nenngeld', fee_nfs: 'Nenngeld NFS',
    show_ttop_button: 'TTOP-Knopf', ttop_url: 'TTOP-Link', bewerbe: 'Bewerbe',
    bewerbeHeadline: 'Bewerbe-Überschrift', bewerbeText: 'Bewerbe-Beschreibung',
    showSchedule: 'Zeitplan', schedule: 'Zeitplan', showSponsors: 'Sponsoren', sponsors: 'Sponsoren',
    heroPhoto: 'Titelfoto', registrationDeadline: 'Anmeldeschluss',
    fact1Title: 'Fakten-Kachel 1', fact1Text: 'Fakten-Kachel 1', fact2Title: 'Fakten-Kachel 2', fact2Text: 'Fakten-Kachel 2',
    fact3Title: 'Fakten-Kachel 3', fact3Text: 'Fakten-Kachel 3', fact4Title: 'Fakten-Kachel 4', fact4Text: 'Fakten-Kachel 4',
};

/** Vergleichbare Darstellung: Datei → Name/Größe, Datumsangaben → Zeitpunkt, leer = leer */
function norm(v) {
    if (v === undefined || v === null || v === '') return '""';
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && !isNaN(Date.parse(v))) return String(Date.parse(v));
    return JSON.stringify(v, (k, x) => (x instanceof File ? `${x.name}:${x.size}` : x));
}
const changed = (a, b) => norm(a) !== norm(b);

/**
 * Vergleicht meine Eingaben (gegenüber dem Stand beim Laden) mit dem aktuellen Stand in der Datenbank.
 * mine: was ich geändert habe; theirs: was jemand anderes seitdem gespeichert hat;
 * conflicts: beide am selben Feld, mit unterschiedlichem Ergebnis.
 */
function diffAgainst(form, fresh) {
    const baseInfo = parseTurnierInfo(baseRow), freshInfo = parseTurnierInfo(fresh);
    const mine = { columns: [], bewerbe: false, info: [] };
    const theirs = new Set(), conflicts = new Set();

    for (const k of Object.keys(form.columns)) {
        const meChanged = changed(form.columns[k], baseForm.columns[k]);
        const otherChanged = changed(fresh[k], baseRow[k]);
        if (meChanged) mine.columns.push(k);
        if (otherChanged) (meChanged && changed(form.columns[k], fresh[k]) ? conflicts : theirs).add(LABELS[k] || k);
    }

    mine.bewerbe = changed(form.bewerbe, baseForm.bewerbe);
    if (changed(parseBewerbe(fresh), parseBewerbe(baseRow))) (mine.bewerbe ? conflicts : theirs).add(LABELS.bewerbe);

    const keys = new Set([...Object.keys(form.info), ...Object.keys(baseInfo), ...Object.keys(freshInfo)]);
    for (const k of keys) {
        const meChanged = k in form.info && changed(form.info[k], baseForm.info[k]);
        const otherChanged = changed(freshInfo[k], baseInfo[k]);
        if (meChanged) mine.info.push(k);
        if (otherChanged) (meChanged && changed(form.info[k], freshInfo[k]) ? conflicts : theirs).add(LABELS[k] || k);
    }
    // Was ich selbst auch geändert habe, ist kein „übernommen“
    conflicts.forEach(l => theirs.delete(l));
    return { mine, theirs: [...theirs], conflicts: [...conflicts] };
}

/** Nur meine Änderungen auf den aktuellen Stand anwenden → Patch + erwartete Werte (gegen Überschreiben) */
function makePatch(form, fresh, mine, uploaded, renames) {
    const patch = {};
    for (const k of mine.columns) patch[k] = form.columns[k];
    if ('date_iso' in patch && !patch.date_iso) patch.date_iso = new Date().toISOString();
    if (mine.bewerbe) patch.bewerbe = JSON.stringify(form.bewerbe);

    if (mine.info.length) {
        const merged = parseTurnierInfo(fresh);
        for (const k of mine.info) merged[k] = form.info[k];
        if (uploaded.heroPhoto) merged.heroPhoto = uploaded.heroPhoto;
        if (mine.info.includes('sponsors')) {
            merged.sponsors = form.info.sponsors
                .map(({ file, ...s }, i) => (file ? { ...s, logoPath: uploaded.sponsors[i] || s.logoPath } : s))
                .filter(s => s.logoPath);
        }
        patch.turnier_info = JSON.stringify(merged);
    }
    if (uploaded.pdf) patch.ausschreibung_path = uploaded.pdf;

    // Hall of Fame hängt am Bewerbsnamen → Umbenennungen übernehmen
    const hof = fresh.hall_of_fame;
    if (hof && Object.keys(renames).some(k => hof[k])) {
        patch.hall_of_fame = Object.fromEntries(Object.entries(hof).map(([k, v]) => [renames[k] || k, v]));
    }

    const expect = Object.fromEntries(Object.keys(patch).map(k => [k, fresh[k] ?? null]));
    return { patch, expect };
}

/** Neu gewählte Dateien hochladen (einmal pro Speichern) */
async function uploadFiles(form) {
    const uploaded = { sponsors: [] };
    if (form.heroFile) {
        // Verkleinern klappt nicht? Dann das Original hochladen statt hängenzubleiben
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Zeitüberschreitung')), 15000));
        const blob = await Promise.race([shrinkImage(form.heroFile, 1200, 0.82), timeout])
            .catch(err => { console.warn('Verkleinern nicht möglich:', err); return null; });
        const base = safeFileName(form.heroFile.name.replace(/\.[^.]+$/, ''));
        const ext = blob ? 'jpg' : (form.heroFile.name.split('.').pop() || 'jpg').toLowerCase();
        const { data: up, error } = await supabase.storage
            .from('fotos')
            .upload(`titelfoto/${Date.now()}_${base}.${ext}`, blob || form.heroFile, { contentType: blob ? 'image/jpeg' : form.heroFile.type });
        if (error) {
            console.error('Titelfoto-Upload fehlgeschlagen:', error);
            showToast('Titelfoto konnte nicht hochgeladen werden: ' + error.message, true);
        } else {
            uploaded.heroPhoto = up.path;
        }
    }

    for (const [i, s] of form.info.sponsors.entries()) {
        if (!s.file) continue;
        // SVG ausdrücklich als SVG kennzeichnen (manche Systeme liefern keinen Typ mit)
        const isSvg = /\.svg$/i.test(s.file.name);
        const { data: up, error } = await supabase.storage
            .from('sponsoren')
            .upload(`${Date.now()}_${safeFileName(s.file.name)}`, s.file, { contentType: isSvg ? 'image/svg+xml' : (s.file.type || undefined) });
        if (error) {
            console.error('Sponsor-Upload fehlgeschlagen:', error);
            showToast('Sponsor-Bild konnte nicht hochgeladen werden: ' + error.message, true);
        } else {
            uploaded.sponsors[i] = up.path;
        }
    }

    if (form.pdfFile) {
        const { data, error } = await supabase.storage
            .from('pdfs')
            .upload(`${Date.now()}_${safeFileName(form.pdfFile.name)}`, form.pdfFile);
        if (error) throw error;
        uploaded.pdf = data.path;
    }
    return uploaded;
}

/** Wer hat das Turnier zuletzt geändert? (aus dem Änderungsprotokoll, für die Rückfrage) */
async function lastEditor() {
    try {
        const { data } = await supabase.from('audit_log').select('actor, created_at')
            .eq('table_name', 'tournaments').eq('record_id', String(activeTournamentId))
            .order('created_at', { ascending: false }).limit(1);
        const e = data?.[0];
        if (!e) return '';
        const when = new Date(e.created_at).toLocaleString('de-AT', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return `${e.actor || 'Jemand'} (${when})`;
    } catch {
        return '';
    }
}

/**
 * Schreibt Turnier + Umbenennungen in einem Schritt (nfs_save_tournament, siehe supabase/setup-save.sql).
 * Gibt es die Funktion noch nicht, wird wie bisher direkt gespeichert.
 */
async function writeTournament(patch, expect, renames) {
    const { data, error } = await supabase.rpc('nfs_save_tournament', {
        p_id: String(activeTournamentId), p_patch: patch, p_expect: expect, p_renames: renames,
    });
    if (error?.code === 'PGRST202') {
        console.warn('nfs_save_tournament fehlt – setup-save.sql ausführen. Speichere wie bisher.');
        if (Object.keys(patch).length) throwIfError(await supabase.from('tournaments').update(patch).eq('id', activeTournamentId));
        let moved = 0;
        for (const [from, to] of Object.entries(renames)) {
            if (countInBewerb(from) > 0) moved += await renameBewerbInRegistrations(from, to);
        }
        return { ok: true, moved };
    }
    if (error) throw error;
    return data;
}

export async function saveSetup() {
    if (!activeTournamentId || !baseRow) {
        showToast('Kein aktives Turnier.', true);
        return;
    }

    const bewerbeList = getBewerbeFromDOM();
    const problem = validateBewerbe(bewerbeList);
    if (problem) {
        showToast(problem, true);
        document.querySelector('#setupTabs [data-panel="bewerbe"]').click();
        return;
    }
    const renameList = bewerbeList.filter(b => b._orig && b._orig !== b.name);
    const withRegs = renameList.filter(b => countInBewerb(b._orig) > 0);
    if (withRegs.length) {
        const ok = await confirmDialog({
            title: 'Bewerb umbenennen?',
            message: withRegs.map(b => `„${b._orig}“ → „${b.name}“ (${countInBewerb(b._orig)} Nennungen werden mitgenommen)`).join('\n'),
            confirmText: 'Umbenennen & speichern',
        });
        if (!ok) return;
    }
    const renames = Object.fromEntries(renameList.map(b => [b._orig, b.name]));
    const noTime = bewerbeList.filter(b => b.time && !/\d{1,2}[:.]\d{2}/.test(b.time));

    await withBusy($('saveSetupBtn'), async () => {
        try {
            const form = readForm();
            const accepted = new Set();
            let uploaded = null, result = null, theirs = [];

            // Bis zu 3 Versuche: falls genau zwischen Prüfen und Schreiben jemand anderes speichert
            for (let attempt = 0; attempt < 3 && !result; attempt++) {
                const { data: fresh, error } = await supabase.from('tournaments').select('*').eq('id', activeTournamentId).single();
                if (error) throw error;

                const diff = diffAgainst(form, fresh);
                theirs = diff.theirs;
                const newConflicts = diff.conflicts.filter(c => !accepted.has(c));
                if (newConflicts.length) {
                    const who = await lastEditor();
                    const ok = await confirmDialog({
                        title: 'Inzwischen von jemand anderem geändert',
                        message: `${who || 'Jemand'} hat während deiner Bearbeitung dieselben Felder gespeichert:\n• ${newConflicts.join('\n• ')}\n\n` +
                            '„Meine Version speichern“ überschreibt diese Felder mit deinen Eingaben.\n' +
                            'Andere Version ansehen: Abbrechen und Seite neu laden (F5) – deine Eingaben gehen dabei verloren.',
                        confirmText: 'Meine Version speichern',
                        danger: true,
                    });
                    if (!ok) return;
                    newConflicts.forEach(c => accepted.add(c));
                }

                const mineCount = diff.mine.columns.length + diff.mine.info.length + (diff.mine.bewerbe ? 1 : 0) + (form.pdfFile ? 1 : 0);
                if (!mineCount && !renameList.length) {
                    showToast('Keine Änderungen zu speichern.');
                    baseline = '';
                    await onSaved();
                    return;
                }

                uploaded ??= await uploadFiles(form);
                const { patch, expect } = makePatch(form, fresh, diff.mine, uploaded, renames);
                const res = await writeTournament(patch, expect, renames);
                if (res?.ok) result = res;
                else if (res?.reason !== 'conflict') throw new Error(res?.message || res?.reason || 'Unbekannter Fehler');
            }
            if (!result) throw new Error('Das Turnier wird gerade von jemand anderem bearbeitet – bitte gleich noch einmal speichern.');

            const pdfInput = $('setupPdf');
            if (pdfInput) { pdfInput.value = ''; pdfInput.dispatchEvent(new Event('change')); }
            const moved = result.moved || 0;
            showToast(moved ? `Gespeichert – ${moved} Nennungen auf neue Bewerbsnamen umgestellt` : 'Turnier-Einstellungen gespeichert');
            if (theirs.length) showToast(`Änderungen von jemand anderem (${theirs.join(', ')}) wurden übernommen und bleiben erhalten.`);
            if (noTime.length) showToast(`Hinweis: Startzeit von „${noTime[0].name}“ enthält keine Uhrzeit (z.B. „Sa 09:00“) – der Kalender-Eintrag auf der Website braucht sie.`, true);
            baseline = '';
            await onSaved();
        } catch (err) {
            console.error('Fehler beim Speichern:', err);
            showToast('Fehler beim Speichern: ' + (err.message || err), true);
        }
    });
}

// ==========================================
// SAISONWECHSEL / LÖSCHEN
// ==========================================
export async function createNewTournament() {
    const cur = currentTournament();
    const next = new Date(cur?.date_iso || Date.now());
    next.setMonth(next.getMonth() + 6);
    const res = await formDialog({
        title: 'Saisonwechsel: neues Turnier',
        intro: 'Das aktuelle Turnier wandert ins Archiv. Nennliste und Kassenbuch des neuen Turniers starten leer. Die Anmeldung ist zunächst geschlossen.',
        fields: [
            { id: 'name', label: 'Name des neuen Turniers', placeholder: 'z.B. 10. NFS Trophy', required: true },
            { id: 'dateText', label: 'Datum (Text auf der Website)', placeholder: 'z.B. 12.–13. September 2027', half: true },
            { id: 'dateIso', label: 'Turnierbeginn', type: 'datetime-local', value: formatForDateTimeLocal(next.toISOString()), half: true },
            { id: 'copy', label: 'Einstellungen übernehmen', type: 'checkbox', checked: true, help: 'Bewerbe, Nenngeld, Untertitel, Website-Texte, Zeitplan und Sponsoren vom aktuellen Turnier.' },
        ],
        confirmText: 'Neues Turnier anlegen',
    });
    if (!res || !res.name) return;

    const newTournament = {
        name: res.name,
        date_text: res.dateText,
        date_iso: res.dateIso ? new Date(res.dateIso).toISOString() : next.toISOString(),
        is_open: false,
        capacity: 20,
        fee_normal: DEFAULT_FEE_NORMAL,
        fee_nfs: DEFAULT_FEE_NFS,
        bewerbe: JSON.stringify(DEFAULT_BEWERBE),
    };
    if (res.copy && cur) {
        const info = parseTurnierInfo(cur);
        delete info.registrationDeadline; // Anmeldeschluss gehört zum alten Turnier
        Object.assign(newTournament, {
            fee_normal: cur.fee_normal ?? DEFAULT_FEE_NORMAL,
            fee_nfs: cur.fee_nfs ?? DEFAULT_FEE_NFS,
            subtitle: cur.subtitle || '',
            bewerbe: JSON.stringify(parseBewerbe(cur)),
            turnier_info: JSON.stringify(info),
        });
    }

    try {
        throwIfError(await supabase.from('tournaments').insert(newTournament));
        showToast(`„${res.name}“ angelegt – bitte Daten prüfen und Anmeldung öffnen, wenn es losgeht.`);
        baseline = '';
        await onSaved();
    } catch (err) {
        console.error('Fehler beim Erstellen:', err);
        showToast('Fehler beim Erstellen des neuen Turniers: ' + (err.message || err), true);
    }
}

export async function deleteTournament() {
    if (allTournaments.length <= 1) {
        showToast('Das ist das einzige Turnier – Löschen nicht möglich.', true);
        return;
    }
    const current = currentTournament();
    const name = await promptDialog({
        title: 'Turnier endgültig löschen?',
        label: `Zur Bestätigung den Namen eintippen: ${current?.name || ''}`,
        confirmText: 'Endgültig löschen',
        help: 'Das kann nicht rückgängig gemacht werden. Das vorherige Turnier wird wieder aktiv.',
    });
    if (!name) return;
    if (name !== (current?.name || '')) {
        showToast('Name stimmt nicht überein – nichts gelöscht.', true);
        return;
    }

    try {
        throwIfError(await supabase.from('tournaments').delete().eq('id', activeTournamentId));
        showToast('Turnier gelöscht');
        baseline = '';
        await onSaved();
    } catch (err) {
        console.error('Fehler beim Löschen:', err);
        showToast('Fehler beim Löschen: ' + (err.message || err), true);
    }
}

// ==========================================
// FORMATIERUNG (*fett*, _kursiv_)
// ==========================================
/** Knöpfe F / K an jedes Website-Textfeld, dazu Strg+B / Strg+I */
function initFormatBars() {
    document.querySelectorAll('#view-setup textarea[data-format]').forEach(ta => {
        const wrap = document.createElement('div');
        wrap.className = 'fmt-wrap';
        ta.replaceWith(wrap);
        wrap.append(ta);
        const bar = document.createElement('div');
        bar.className = 'fmt-bar';
        bar.innerHTML = `<button type="button" data-wrap="*" title="Fett: *Text* (Strg+B)"><b>F</b></button><button type="button" data-wrap="_" title="Kursiv: _Text_ (Strg+I)"><i>K</i></button>`;
        bar.addEventListener('mousedown', e => e.preventDefault());   // Markierung im Feld behalten
        bar.addEventListener('click', e => {
            const b = e.target.closest('[data-wrap]');
            if (b) wrapSelection(ta, b.dataset.wrap);
        });
        wrap.append(bar);
        ta.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const mark = { b: '*', i: '_' }[e.key.toLowerCase()];
            if (!mark) return;
            e.preventDefault();
            wrapSelection(ta, mark);
        });
    });
}

// ==========================================
// EVENTS (einmalig binden)
// ==========================================
export function initSetupEvents() {
    const on = (id, fn) => $(id)?.addEventListener('click', e => { e.preventDefault(); fn(); });
    on('addScheduleBtn', () => renderScheduleRow());
    on('addSponsorBtn', () => renderSponsorRow());
    makeDropzone($('setupPdf'), { text: 'Ausschreibung (PDF) hierher ziehen' });
    initHeroPhoto();
    on('addBewerbBtn', () => {
        setupBewerbeList = getBewerbeFromDOM();
        setupBewerbeList.push({ name: 'Neuer Bewerb', time: 'Sa 09:00', min_rc: 0, prize: '', capacity: 20, duration: 3, _orig: null });
        openBewerbe.add(setupBewerbeList.length - 1);
        renderSetupBewerbe();
        const names = document.querySelectorAll('#bewerbeContainer .bewerb-name');
        names[names.length - 1]?.select();
    });
    on('saveSetupBtn', saveSetup);
    initFormatBars();
    initPreview({ draft: buildDraft });
    on('createNewTournamentBtn', createNewTournament);
    on('deleteTournamentBtn', deleteTournament);
    on('downloadQrAnmeldungBtn', () => downloadQR('qrAnmeldung', 'QR_Anmeldung.png'));
    on('downloadQrErgebnisseBtn', () => downloadQR('qrErgebnisse', 'QR_Ergebnisse.png'));

    $('bewerbeContainer').addEventListener('click', e => {
        const row = e.target.closest('.bewerb-row');
        if (!row) return;
        const idx = parseInt(row.dataset.index, 10);
        if (e.target.closest('.bw-toggle, [data-toggle]')) {
            const open = !row.classList.contains('open');
            row.classList.toggle('open', open);
            open ? openBewerbe.add(idx) : openBewerbe.delete(idx);
            row.querySelector('.bw-toggle').setAttribute('aria-expanded', String(open));
            const t = row.querySelector('[data-toggle]');
            t.innerHTML = icon(open ? 'x' : 'edit');
            t.title = open ? 'Zuklappen' : 'Bearbeiten';
            if (open) row.querySelector('.bewerb-name').focus();
            return;
        }
        const move = e.target.closest('[data-move]');
        if (move && !move.disabled) {
            setupBewerbeList = getBewerbeFromDOM();
            const to = idx + parseInt(move.dataset.move, 10);
            [setupBewerbeList[idx], setupBewerbeList[to]] = [setupBewerbeList[to], setupBewerbeList[idx]];
            // Aufklapp-Status mitverschieben
            const wasOpen = [openBewerbe.has(idx), openBewerbe.has(to)];
            openBewerbe.delete(idx); openBewerbe.delete(to);
            if (wasOpen[0]) openBewerbe.add(to);
            if (wasOpen[1]) openBewerbe.add(idx);
            renderSetupBewerbe();
            return;
        }
        if (e.target.closest('.remove-bewerb-btn')) {
            setupBewerbeList = getBewerbeFromDOM();
            const b = setupBewerbeList[idx];
            const n = b._orig ? countInBewerb(b._orig) : 0;
            if (n > 0) {
                showToast(`„${b._orig}“ hat noch ${n} Nennungen – bitte zuerst im Bereich „Bewerbe“ abmelden.`, true);
                return;
            }
            setupBewerbeList.splice(idx, 1);
            // Indizes nach dem gelöschten Bewerb rücken eins nach vorne
            const shifted = [...openBewerbe].filter(i => i !== idx).map(i => (i > idx ? i - 1 : i));
            openBewerbe.clear();
            shifted.forEach(i => openBewerbe.add(i));
            renderSetupBewerbe();
        }
    });

    $('setupIsOpen').addEventListener('change', e => updateOpenLabel(e.target.checked));
    $('setupDeadline').addEventListener('input', updateDeadlineHint);
    $('setupDeadlineClear').addEventListener('click', () => { $('setupDeadline').value = ''; updateDeadlineHint(); updateDirtyUi(); });

    // Unter-Reiter (zuletzt gewählter bleibt in dieser Sitzung erhalten)
    const showPanel = name => {
        document.querySelectorAll('#setupTabs button').forEach(b => b.classList.toggle('on', b.dataset.panel === name));
        document.querySelectorAll('#view-setup .setup-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
        try { sessionStorage.setItem('setup-panel', name); } catch { /* egal */ }
    };
    $('setupTabs').addEventListener('click', e => {
        const b = e.target.closest('button[data-panel]');
        if (b) showPanel(b.dataset.panel);
    });
    let lastPanel = null;
    try { lastPanel = sessionStorage.getItem('setup-panel'); } catch { /* egal */ }
    if (lastPanel && document.querySelector(`#setupTabs [data-panel="${lastPanel}"]`)) showPanel(lastPanel);

    $('bewerbeContainer').addEventListener('input', e => {
        const row = e.target.closest('.bewerb-row');
        if (row) refreshSummary(row);
    });

    // Ungespeicherte Änderungen erkennen
    const view = $('view-setup');
    view.addEventListener('input', updateDirtyUi);
    view.addEventListener('change', updateDirtyUi);
    window.addEventListener('beforeunload', e => {
        if (isSetupDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
}
