// src/admin/setup.js
// Turnier-Setup: Felder befüllen, Bewerbe/Zeitplan/Sponsoren bearbeiten, speichern, Saisonwechsel

import { supabase, publicSponsorUrl, publicPdfUrl } from '../shared/supabase.js';
import { esc, showToast, safeFileName, parseTurnierInfo, parseBewerbe, formatForDateTimeLocal, throwIfError } from '../shared/utils.js';
import { DEFAULT_FEE_NORMAL, DEFAULT_FEE_NFS, DEFAULT_BEWERBE } from '../shared/constants.js';
import { icon, confirmDialog, promptDialog, withBusy } from './ui.js';

let setupBewerbeList = [];
let allTournaments = [];
let activeTournamentId = null;
let onSaved = () => { };

export function setSetupTournamentId(id) { activeTournamentId = id; }
export function setSetupTournaments(data) { allTournaments = data; }
export function setSetupSavedHandler(fn) { onSaved = fn; }

// ==========================================
// FELDER BEFÜLLEN
// ==========================================
export function fillSetup(t) {
    const s = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val ?? '';
    };

    document.getElementById('setupIsOpen').checked = !!t.is_open;
    updateOpenLabel(!!t.is_open);
    document.getElementById('setupShowTtop').checked = t.show_ttop_button === true;
    s('setupTtopUrl', t.ttop_url);
    s('setupName', t.name);
    s('setupDateText', t.date_text);
    s('setupSubtitle', t.subtitle);
    s('setupOettvUrl', t.oettv_url);
    s('setupFeeNormal', t.fee_normal ?? DEFAULT_FEE_NORMAL);
    s('setupFeeNfs', t.fee_nfs ?? DEFAULT_FEE_NFS);
    s('setupDateIso', formatForDateTimeLocal(t.date_iso));

    const cur = document.getElementById('setupPdfCurrent');
    cur.innerHTML = t.ausschreibung_path
        ? `Aktuell: <a href="${esc(publicPdfUrl(t.ausschreibung_path))}" target="_blank" rel="noopener">${esc(t.ausschreibung_path.replace(/^\d+_/, ''))}</a>`
        : 'Noch keine Ausschreibung hochgeladen.';

    const info = parseTurnierInfo(t);
    s('setupBewerbeHeadline', info.bewerbeHeadline);
    s('setupBewerbeText', info.bewerbeText);
    [1, 2, 3, 4].forEach(n => {
        s(`setupFact${n}Title`, info[`fact${n}Title`]);
        s(`setupFact${n}Text`, info[`fact${n}Text`]);
    });

    document.getElementById('setupShowSchedule').checked = !!info.showSchedule;
    document.getElementById('scheduleContainer').innerHTML = '';
    (info.schedule?.length ? info.schedule : [{}]).forEach(item => renderScheduleRow(item.time, item.text));

    document.getElementById('setupShowSponsors').checked = !!info.showSponsors;
    document.getElementById('sponsorsContainer').innerHTML = '';
    if (info.sponsors?.length) {
        info.sponsors.forEach(sp => renderSponsorRow(sp.logoPath || '', sp.link, sp.logoUrl || (sp.logoPath ? publicSponsorUrl(sp.logoPath) : '')));
    } else {
        renderSponsorRow();
    }

    setupBewerbeList = parseBewerbe(t);
    renderSetupBewerbe();
    generateQRCodes(t.oettv_url);
}

function updateOpenLabel(isOpen) {
    const label = document.getElementById('setupIsOpenLabel');
    const hint = document.getElementById('setupIsOpenHint');
    label.innerHTML = `Anmeldung ist <span style="color:var(${isOpen ? '--accent' : '--danger'})">${isOpen ? 'geöffnet' : 'geschlossen'}</span>`;
    hint.textContent = isOpen ? 'Spieler können sich auf der Website anmelden.' : 'Das Formular auf der Website ist deaktiviert.';
}

// ==========================================
// BEWERBE
// ==========================================
export function renderSetupBewerbe() {
    const container = document.getElementById('bewerbeContainer');
    if (!container) return;
    container.innerHTML = setupBewerbeList.map((b, index) => `
        <div class="repeat-row">
            <div class="bewerb-editor">
                <div class="field"><label>Name</label><input type="text" class="input bewerb-name" value="${esc(b.name)}"></div>
                <div class="field"><label>Startzeit</label><input type="text" class="input bewerb-time" value="${esc(b.time || '')}" placeholder="Sa 09:00"></div>
                <div class="field"><label>Dauer (h)</label><input type="number" class="input bewerb-duration" value="${esc(b.duration || 3)}" min="1"></div>
                <div class="field"><label>Min. RC</label><input type="number" class="input bewerb-rc" value="${esc(b.min_rc || 0)}" min="0"></div>
                <div class="field"><label>Plätze</label><input type="number" class="input bewerb-cap" value="${esc(b.capacity || 20)}" min="1"></div>
                <div class="field"><label>Preisgeld</label><input type="text" class="input bewerb-prize" value="${esc(b.prize || '')}" placeholder="optional"></div>
                <button type="button" class="icon-btn danger remove-bewerb-btn" data-index="${index}" title="Bewerb entfernen" style="margin-bottom:4px;">${icon('trash')}</button>
            </div>
        </div>`).join('') || '<div class="muted small">Noch keine Bewerbe.</div>';
}

export function getBewerbeFromDOM() {
    const q = cls => document.querySelectorAll(`#bewerbeContainer .${cls}`);
    const names = q('bewerb-name'), times = q('bewerb-time'), durations = q('bewerb-duration'),
        rcs = q('bewerb-rc'), caps = q('bewerb-cap'), prizes = q('bewerb-prize');
    const list = [];
    names.forEach((n, i) => {
        if (!n.value.trim()) return;
        list.push({
            name: n.value.trim(),
            time: times[i].value.trim(),
            duration: parseInt(durations[i].value, 10) || 3,
            min_rc: parseInt(rcs[i].value, 10) || 0,
            capacity: parseInt(caps[i].value, 10) || 20,
            prize: prizes[i].value.trim()
        });
    });
    return list;
}

// ==========================================
// ZEITPLAN & SPONSOREN
// ==========================================
export function renderScheduleRow(time = '', text = '') {
    const container = document.getElementById('scheduleContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'repeat-row compact schedule-row';
    div.innerHTML = `
        <input type="text" class="input sched-time" placeholder="08:00" value="${esc(time)}" style="width:110px;">
        <input type="text" class="input sched-text grow" placeholder="z.B. Hallenöffnung" value="${esc(text)}" style="flex:1;">
        <button type="button" class="icon-btn danger" title="Entfernen">${icon('x')}</button>`;
    div.querySelector('button').addEventListener('click', () => div.remove());
    container.appendChild(div);
}

export function renderSponsorRow(logoPath = '', link = '', logoUrl = '') {
    const container = document.getElementById('sponsorsContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'repeat-row sponsor-row';
    div.innerHTML = `
        <div class="grow field">
            <label>Logo</label>
            <input type="file" class="input spon-file" accept="image/*">
            <input type="hidden" class="spon-logo-path" value="${esc(logoPath)}">
            ${logoUrl ? `<img class="sponsor-preview" src="${esc(logoUrl)}" alt="">` : ''}
        </div>
        <div class="grow field">
            <label>Website</label>
            <input type="url" class="input spon-link" placeholder="https://…" value="${esc(link)}">
        </div>
        <button type="button" class="icon-btn danger" title="Entfernen" style="margin-top:22px;">${icon('x')}</button>`;
    div.querySelector('button').addEventListener('click', () => div.remove());
    container.appendChild(div);
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

    const qrA = document.getElementById('qrAnmeldung');
    if (qrA) make(qrA, 'https://nfs-trophy.com/#anmelden');

    const qrE = document.getElementById('qrErgebnisse');
    const hint = document.getElementById('qrErgebnisseHint');
    const btn = document.getElementById('downloadQrErgebnisseBtn');
    if (!qrE) return;
    const ok = oettvUrl && oettvUrl.trim() && make(qrE, oettvUrl.trim());
    if (!ok) qrE.textContent = 'Kein Link hinterlegt';
    hint.textContent = ok ? '' : 'Erst eine ÖTTV-URL speichern.';
    btn.style.display = ok ? '' : 'none';
}

export function downloadQR(divId, filename) {
    const box = document.getElementById(divId);
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

export async function saveSetup() {
    if (!activeTournamentId) {
        showToast('Kein aktives Turnier.', true);
        return;
    }

    await withBusy(document.getElementById('saveSetupBtn'), async () => {
        try {
            const updatedBewerbeList = getBewerbeFromDOM();
            const val = id => document.getElementById(id)?.value.trim() || '';

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

            const infoObj = {
                bewerbeHeadline: val('setupBewerbeHeadline'),
                bewerbeText: val('setupBewerbeText'),
                showSchedule: document.getElementById('setupShowSchedule').checked,
                schedule: scheduleData,
                showSponsors: document.getElementById('setupShowSponsors').checked,
                sponsors: sponsorsData
            };
            [1, 2, 3, 4].forEach(n => {
                infoObj[`fact${n}Title`] = val(`setupFact${n}Title`);
                infoObj[`fact${n}Text`] = val(`setupFact${n}Text`);
            });

            const dateIso = document.getElementById('setupDateIso').value;
            const updateData = {
                is_open: document.getElementById('setupIsOpen').checked,
                name: val('setupName') || 'NFS Trophy',
                date_text: val('setupDateText'),
                date_iso: dateIso ? new Date(dateIso).toISOString() : new Date().toISOString(),
                subtitle: val('setupSubtitle'),
                oettv_url: val('setupOettvUrl'),
                fee_normal: parseFee(document.getElementById('setupFeeNormal').value, DEFAULT_FEE_NORMAL),
                fee_nfs: parseFee(document.getElementById('setupFeeNfs').value, DEFAULT_FEE_NFS),
                bewerbe: JSON.stringify(updatedBewerbeList),
                turnier_info: JSON.stringify(infoObj),
                show_ttop_button: document.getElementById('setupShowTtop').checked,
                ttop_url: val('setupTtopUrl')
            };

            // PDF Upload
            const pdfInput = document.getElementById('setupPdf');
            if (pdfInput && pdfInput.files.length > 0) {
                const file = pdfInput.files[0];
                const { data: uploadData, error: uploadErr } = await supabase.storage
                    .from('pdfs')
                    .upload(`${Date.now()}_${safeFileName(file.name)}`, file);
                if (uploadErr) throw uploadErr;
                updateData.ausschreibung_path = uploadData.path;
            }

            throwIfError(await supabase.from('tournaments').update(updateData).eq('id', activeTournamentId));

            setupBewerbeList = updatedBewerbeList;
            if (pdfInput) pdfInput.value = '';
            showToast('Turnier-Einstellungen gespeichert');
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
    const ok = await confirmDialog({
        title: 'Saisonwechsel durchführen?',
        message: 'Das aktuelle Turnier wandert ins Archiv. Danach wird ein neues, leeres Turnier angelegt – Nennliste und Kassenbuch starten bei null.',
        confirmText: 'Weiter',
    });
    if (!ok) return;

    const newName = await promptDialog({
        title: 'Neues Turnier',
        label: 'Name des neuen Turniers',
        placeholder: 'z.B. 10. NFS Trophy',
        confirmText: 'Turnier anlegen',
    });
    if (!newName) return;

    try {
        throwIfError(await supabase.from('tournaments').insert({
            name: newName,
            date_iso: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
            is_open: false,
            capacity: 20,
            fee_normal: DEFAULT_FEE_NORMAL,
            fee_nfs: DEFAULT_FEE_NFS,
            bewerbe: JSON.stringify(DEFAULT_BEWERBE)
        }));
        showToast('Neues Turnier angelegt – bitte jetzt die Daten im Setup anpassen.');
        await onSaved();
    } catch (err) {
        console.error('Fehler beim Erstellen:', err);
        showToast('Fehler beim Erstellen des neuen Turniers.', true);
    }
}

export async function deleteTournament() {
    if (allTournaments.length <= 1) {
        showToast('Das ist das einzige Turnier – Löschen nicht möglich.', true);
        return;
    }
    const current = allTournaments.find(t => String(t.id) === String(activeTournamentId));
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
    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', e => { e.preventDefault(); fn(); });
    on('addScheduleBtn', () => renderScheduleRow());
    on('addSponsorBtn', () => renderSponsorRow());
    on('addBewerbBtn', () => {
        setupBewerbeList = getBewerbeFromDOM();
        setupBewerbeList.push({ name: 'Neuer Bewerb', time: 'Sa 09:00', min_rc: 0, prize: '', capacity: 20, duration: 3 });
        renderSetupBewerbe();
        const names = document.querySelectorAll('#bewerbeContainer .bewerb-name');
        names[names.length - 1]?.select();
    });
    on('saveSetupBtn', saveSetup);
    on('createNewTournamentBtn', createNewTournament);
    on('deleteTournamentBtn', deleteTournament);
    on('downloadQrAnmeldungBtn', () => downloadQR('qrAnmeldung', 'QR_Anmeldung.png'));
    on('downloadQrErgebnisseBtn', () => downloadQR('qrErgebnisse', 'QR_Ergebnisse.png'));

    document.getElementById('bewerbeContainer').addEventListener('click', e => {
        const btn = e.target.closest('.remove-bewerb-btn');
        if (!btn) return;
        setupBewerbeList = getBewerbeFromDOM();
        setupBewerbeList.splice(parseInt(btn.dataset.index, 10), 1);
        renderSetupBewerbe();
    });
    document.getElementById('setupIsOpen').addEventListener('change', e => updateOpenLabel(e.target.checked));
}
