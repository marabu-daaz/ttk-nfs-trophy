// src/admin/setup.js
// Turnier-Setup: Felder befüllen, Bewerbe/Zeitplan/Sponsoren bearbeiten, speichern, Saisonwechsel

import { supabase, publicSponsorUrl, publicPdfUrl } from '../shared/supabase.js';
import { esc, showToast, safeFileName, parseTurnierInfo, parseBewerbe, formatForDateTimeLocal, throwIfError } from '../shared/utils.js';
import { DEFAULT_FEE_NORMAL, DEFAULT_FEE_NFS, DEFAULT_BEWERBE } from '../shared/constants.js';
import { icon, confirmDialog, promptDialog, formDialog, withBusy } from './ui.js';
import { countInBewerb, renameBewerbInRegistrations } from './state.js';

let setupBewerbeList = [];   // [{ ...bewerb, _orig: ursprünglicher Name | null }]
let allTournaments = [];
let activeTournamentId = null;
let onSaved = () => { };
let baseline = '';           // Formularzustand nach dem Laden/Speichern (für „ungespeichert“)

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
    s('setupBewerbeHeadline', info.bewerbeHeadline);
    s('setupBewerbeText', info.bewerbeText);
    [1, 2, 3, 4].forEach(n => {
        s(`setupFact${n}Title`, info[`fact${n}Title`]);
        s(`setupFact${n}Text`, info[`fact${n}Text`]);
    });

    $('setupShowSchedule').checked = !!info.showSchedule;
    $('scheduleContainer').innerHTML = '';
    (info.schedule?.length ? info.schedule : [{}]).forEach(item => renderScheduleRow(item.time, item.text));

    $('setupShowSponsors').checked = !!info.showSponsors;
    $('sponsorsContainer').innerHTML = '';
    if (info.sponsors?.length) {
        info.sponsors.forEach(sp => renderSponsorRow(sp.logoPath || '', sp.link, sp.logoUrl || (sp.logoPath ? publicSponsorUrl(sp.logoPath) : '')));
    } else {
        renderSponsorRow();
    }

    setupBewerbeList = parseBewerbe(t).map(b => ({ ...b, _orig: b.name }));
    openBewerbe.clear();
    renderSetupBewerbe();
    generateQRCodes(t.oettv_url);
    updateDeadlineHint();
    markClean();
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

export function renderSponsorRow(logoPath = '', link = '', logoUrl = '') {
    const container = $('sponsorsContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'repeat-row sponsor-row';
    div.innerHTML = `
        <div class="grow field">
            <label>Logo</label>
            <input type="file" class="input spon-file" accept="image/*">
            <input type="hidden" class="spon-logo-path" value="${esc(logoPath)}">
            <img class="sponsor-preview" src="${esc(logoUrl)}" alt="" ${logoUrl ? '' : 'hidden'}>
        </div>
        <div class="grow field">
            <label>Website</label>
            <input type="url" class="input spon-link" placeholder="https://…" value="${esc(link)}">
        </div>
        <button type="button" class="icon-btn danger" title="Entfernen" style="margin-top:22px;">${icon('x')}</button>`;
    div.querySelector('button').addEventListener('click', () => { div.remove(); updateDirtyUi(); });
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

export async function saveSetup() {
    if (!activeTournamentId) {
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
    const renames = bewerbeList.filter(b => b._orig && b._orig !== b.name && countInBewerb(b._orig) > 0);
    if (renames.length) {
        const ok = await confirmDialog({
            title: 'Bewerb umbenennen?',
            message: renames.map(b => `„${b._orig}“ → „${b.name}“ (${countInBewerb(b._orig)} Nennungen werden mitgenommen)`).join('\n'),
            confirmText: 'Umbenennen & speichern',
        });
        if (!ok) return;
    }
    const noTime = bewerbeList.filter(b => b.time && !/\d{1,2}[:.]\d{2}/.test(b.time));

    await withBusy($('saveSetupBtn'), async () => {
        try {
            const val = id => $(id)?.value.trim() || '';

            const scheduleData = [];
            document.querySelectorAll('.schedule-row').forEach(row => {
                const time = row.querySelector('.sched-time').value.trim();
                const text = row.querySelector('.sched-text').value.trim();
                if (time || text) scheduleData.push({ time, text });
            });

            const sponsorsData = [];
            for (const row of document.querySelectorAll('.sponsor-row')) {
                const link = row.querySelector('.spon-link').value.trim();
                const fileInput = row.querySelector('.spon-file');
                let logoPath = row.querySelector('.spon-logo-path').value.trim();

                // Wenn neue Datei gewählt → hochladen
                if (fileInput.files.length > 0) {
                    const file = fileInput.files[0];
                    const { data: up, error: upErr } = await supabase.storage
                        .from('sponsoren')
                        .upload(`${Date.now()}_${safeFileName(file.name)}`, file);
                    if (upErr) {
                        console.error('Sponsor-Upload fehlgeschlagen:', upErr);
                        showToast('Sponsor-Bild konnte nicht hochgeladen werden: ' + upErr.message, true);
                    } else if (up) {
                        logoPath = up.path;
                    }
                }

                if (logoPath) sponsorsData.push({ logoPath, link });
            }

            const deadline = $('setupDeadline').value;
            const infoObj = {
                bewerbeHeadline: val('setupBewerbeHeadline'),
                bewerbeText: val('setupBewerbeText'),
                showSchedule: $('setupShowSchedule').checked,
                schedule: scheduleData,
                showSponsors: $('setupShowSponsors').checked,
                sponsors: sponsorsData,
                registrationDeadline: deadline ? new Date(deadline).toISOString() : '',
            };
            [1, 2, 3, 4].forEach(n => {
                infoObj[`fact${n}Title`] = val(`setupFact${n}Title`);
                infoObj[`fact${n}Text`] = val(`setupFact${n}Text`);
            });

            const cleanBewerbe = bewerbeList.map(({ _orig, ...b }) => {
                if (!b.max_rc) delete b.max_rc;
                return b;
            });

            const dateIso = $('setupDateIso').value;
            const updateData = {
                is_open: $('setupIsOpen').checked,
                name: val('setupName') || 'NFS Trophy',
                date_text: val('setupDateText'),
                date_iso: dateIso ? new Date(dateIso).toISOString() : new Date().toISOString(),
                subtitle: val('setupSubtitle'),
                oettv_url: val('setupOettvUrl'),
                fee_normal: parseFee($('setupFeeNormal').value, DEFAULT_FEE_NORMAL),
                fee_nfs: parseFee($('setupFeeNfs').value, DEFAULT_FEE_NFS),
                bewerbe: JSON.stringify(cleanBewerbe),
                turnier_info: JSON.stringify(infoObj),
                show_ttop_button: $('setupShowTtop').checked,
                ttop_url: val('setupTtopUrl')
            };

            // Hall of Fame hängt am Bewerbsnamen → Umbenennungen übernehmen
            const t = currentTournament();
            const allRenames = bewerbeList.filter(b => b._orig && b._orig !== b.name);
            if (t?.hall_of_fame && allRenames.some(b => t.hall_of_fame[b._orig])) {
                const hof = {};
                const map = Object.fromEntries(allRenames.map(b => [b._orig, b.name]));
                Object.entries(t.hall_of_fame).forEach(([k, v]) => { hof[map[k] || k] = v; });
                updateData.hall_of_fame = hof;
            }

            // PDF Upload
            const pdfInput = $('setupPdf');
            if (pdfInput && pdfInput.files.length > 0) {
                const file = pdfInput.files[0];
                const { data: uploadData, error: uploadErr } = await supabase.storage
                    .from('pdfs')
                    .upload(`${Date.now()}_${safeFileName(file.name)}`, file);
                if (uploadErr) throw uploadErr;
                updateData.ausschreibung_path = uploadData.path;
            }

            throwIfError(await supabase.from('tournaments').update(updateData).eq('id', activeTournamentId));

            // Nennungen auf neue Bewerbsnamen umstellen
            let moved = 0;
            for (const b of renames) moved += await renameBewerbInRegistrations(b._orig, b.name);

            if (pdfInput) pdfInput.value = '';
            showToast(moved ? `Gespeichert – ${moved} Nennungen auf neue Bewerbsnamen umgestellt` : 'Turnier-Einstellungen gespeichert');
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
// EVENTS (einmalig binden)
// ==========================================
export function initSetupEvents() {
    const on = (id, fn) => $(id)?.addEventListener('click', e => { e.preventDefault(); fn(); });
    on('addScheduleBtn', () => renderScheduleRow());
    on('addSponsorBtn', () => renderSponsorRow());
    on('addBewerbBtn', () => {
        setupBewerbeList = getBewerbeFromDOM();
        setupBewerbeList.push({ name: 'Neuer Bewerb', time: 'Sa 09:00', min_rc: 0, prize: '', capacity: 20, duration: 3, _orig: null });
        openBewerbe.add(setupBewerbeList.length - 1);
        renderSetupBewerbe();
        const names = document.querySelectorAll('#bewerbeContainer .bewerb-name');
        names[names.length - 1]?.select();
    });
    on('saveSetupBtn', saveSetup);
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
