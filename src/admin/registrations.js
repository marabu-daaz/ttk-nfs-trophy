// src/admin/registrations.js
// Nennungen: Tabelle, Filter, Anlegen/Bearbeiten, Exporte, Beleg

import { supabase } from '../shared/supabase.js';
import { esc, showToast, throwIfError } from '../shared/utils.js';
import { RECEIPT_SIGNER } from '../shared/constants.js';
import {
    state, reloadRegistrations, allBewerbNames, findReg, activeIn, capacityOf,
    feeFor, autoTag, updateRegistration, deleteRegistration, waitlistFields,
} from './state.js';
import { icon, euro, relTime, confirmDialog, withBusy } from './ui.js';

const filters = { search: '', bewerb: 'all', status: 'all', sort: 'time_desc' };
let filtered = [];

// ==========================================
// TABELLE
// ==========================================
export function initRegistrationsView() {
    const $ = id => document.getElementById(id);

    $('searchInput').addEventListener('input', e => { filters.search = e.target.value.toLowerCase().trim(); render(); });
    $('filterBewerb').addEventListener('change', e => { filters.bewerb = e.target.value; render(); });
    $('sortOrder').addEventListener('change', e => { filters.sort = e.target.value; render(); });
    $('filterStatus').addEventListener('click', e => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        filters.status = b.dataset.v;
        $('filterStatus').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        render();
    });

    // Event-Delegation für die Tabellenzeilen
    $('tableBody').addEventListener('click', onTableClick);
    $('tableBody').addEventListener('change', onTableChange);

    $('copyEmailsBtn').addEventListener('click', copyEmails);
    $('exportAdminBtn').addEventListener('click', exportExcel);
    $('exportPdfBtn').addEventListener('click', exportPdf);

    initRegModal();
}

export function render() {
    const select = document.getElementById('filterBewerb');
    const names = allBewerbNames();
    // Bewerbs-Filter nur neu aufbauen, wenn sich die Bewerbe geändert haben
    const sig = names.join('|');
    if (select.dataset.sig !== sig) {
        select.innerHTML = '<option value="all">Alle Bewerbe</option>' +
            names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
        select.dataset.sig = sig;
        if (!names.includes(filters.bewerb)) filters.bewerb = 'all';
        select.value = filters.bewerb;
    }

    filtered = applyFilters();
    const tbody = document.getElementById('tableBody');
    document.getElementById('resultCount').textContent =
        `${filtered.length} von ${state.registrations.length} Nennungen`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty">${icon('users')}<div>${state.registrations.length ? 'Keine Treffer für diese Filter.' : 'Noch keine Nennungen.'}</div></div></td></tr>`;
        return;
    }
    tbody.innerHTML = filtered.map(rowHtml).join('');
}

function applyFilters() {
    const { search, bewerb, status, sort } = filters;
    const list = state.registrations.filter(r => {
        if (search && !`${r.fullName} ${r.nachname} ${r.verein || ''} ${r.email || ''}`.toLowerCase().includes(search)) return false;
        if (bewerb !== 'all' && !r.bewerbeArray.includes(bewerb)) return false;
        const inScope = bewerb === 'all' ? r.bewerbeArray : [bewerb];
        if (status === 'active' && !inScope.some(b => !r.wlBewerbe.includes(b))) return false;
        if (status === 'wl' && !inScope.some(b => r.wlBewerbe.includes(b))) return false;
        if (status === 'unpaid' && (r.has_paid || r.fee_expected === 0)) return false;
        if (status === 'receipt' && !r.needs_receipt) return false;
        return true;
    });
    const cmp = {
        time_desc: (a, b) => new Date(b.created_at) - new Date(a.created_at),
        time_asc: (a, b) => new Date(a.created_at) - new Date(b.created_at),
        name_asc: (a, b) => (a.nachname || '').localeCompare(b.nachname || '', 'de'),
        rc_desc: (a, b) => b.rcValue - a.rcValue,
        verein_asc: (a, b) => (a.verein || '~').localeCompare(b.verein || '~', 'de'),
    }[sort];
    return list.sort(cmp);
}

function bewerbChips(r) {
    return r.bewerbeArray.map(b => {
        if (r.wlBewerbe.includes(b)) {
            const pos = state.wlPositions[r.id]?.[b] || '–';
            return `<span class="chip wl" title="Warteliste">${icon('hourglass')}WL ${pos} · ${esc(b)}</span>`;
        }
        return `<span class="chip active" title="Startplatz">${icon('check')}${esc(b)}</span>`;
    }).join('');
}

function rowHtml(r) {
    const nfsDiscount = state.fees.normal - state.fees.nfs;
    const id = esc(r.id);
    return `
        <tr data-id="${id}">
            <td data-label="Spieler" class="person">
                <div class="name">${esc(r.nachname)} ${esc(r.vorname)}
                    ${r.needs_receipt ? `<span class="chip info" title="Zahlungsbestätigung gewünscht">${icon('receipt')}Beleg</span>` : ''}
                    ${r.checked_in ? `<span class="chip active" title="Eingecheckt">${icon('checkCircle')}Da</span>` : ''}
                </div>
                <div class="sub">${esc(r.email || '')}${r.telefon ? ' · ' + esc(r.telefon) : ''}</div>
                ${r.notiz ? `<div class="sub" title="Anmerkung">${icon('note')} ${esc(r.notiz)}</div>` : ''}
                <div class="sub">${relTime(r.created_at)}</div>
            </td>
            <td data-label="Verein · RC">
                <div>${esc(r.verein || '–')}</div>
                <div class="sub muted num">RC ${esc(r.rc || '–')}</div>
            </td>
            <td data-label="Bewerbe"><div class="chips">${bewerbChips(r)}</div></td>
            <td data-label="Tarif">
                <select class="input tag-select" aria-label="Tarif">
                    <option value="normal" ${r.player_tag === 'normal' ? 'selected' : ''}>Normal</option>
                    <option value="nfs" ${r.player_tag === 'nfs' ? 'selected' : ''}>NFS (−${nfsDiscount} €)</option>
                    <option value="vip" ${r.player_tag === 'vip' ? 'selected' : ''}>VIP (gratis)</option>
                </select>
            </td>
            <td data-label="Nenngeld" class="right num"><strong>${euro(r.fee_expected)}</strong></td>
            <td data-label="Bezahlt">
                <label class="switch"><input type="checkbox" class="paid-checkbox" ${r.has_paid ? 'checked' : ''}><span class="track"></span></label>
            </td>
            <td class="right">
                <div class="row-actions">
                    <button class="icon-btn" data-act="edit" title="Bearbeiten">${icon('edit')}</button>
                    <button class="icon-btn" data-act="receipt" title="Beleg (PDF)">${icon('file')}</button>
                    <button class="icon-btn danger" data-act="delete" title="Löschen">${icon('trash')}</button>
                </div>
            </td>
        </tr>`;
}

async function onTableClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const reg = findReg(btn.closest('tr').dataset.id);
    if (!reg) return;
    if (btn.dataset.act === 'edit') openRegModal(reg);
    if (btn.dataset.act === 'receipt') downloadReceipt(reg);
    if (btn.dataset.act === 'delete') confirmDelete(reg);
}

async function onTableChange(e) {
    const tr = e.target.closest('tr');
    const reg = tr && findReg(tr.dataset.id);
    if (!reg) return;
    const el = e.target;
    try {
        if (el.classList.contains('paid-checkbox')) {
            await updateRegistration(reg.id, { has_paid: el.checked });
            showToast(el.checked ? `${reg.fullName}: bezahlt ✓` : `${reg.fullName}: als offen markiert`);
        } else if (el.classList.contains('tag-select')) {
            await updateRegistration(reg.id, { player_tag: el.value });
            showToast('Tarif aktualisiert');
        } else return;
        await reloadRegistrations();
    } catch (err) {
        console.error(err);
        showToast('Speichern fehlgeschlagen: ' + (err.message || err), true);
        if (el.type === 'checkbox') el.checked = !el.checked;
        await reloadRegistrations();
    }
}

export async function confirmDelete(reg) {
    const ok = await confirmDialog({
        title: 'Nennung löschen?',
        message: `${reg.fullName} wird mit allen Bewerben endgültig gelöscht.`,
        confirmText: 'Löschen',
        danger: true,
    });
    if (!ok) return false;
    try {
        await deleteRegistration(reg.id);
        showToast('Nennung gelöscht');
        await reloadRegistrations();
        return true;
    } catch (err) {
        showToast('Löschen fehlgeschlagen: ' + (err.message || err), true);
        return false;
    }
}

// ==========================================
// DIALOG: ANLEGEN / BEARBEITEN
// ==========================================
let editing = null; // null = neu, sonst Nennung

function initRegModal() {
    const dlg = document.getElementById('regModal');
    dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
    document.getElementById('regForm').addEventListener('submit', onRegSubmit);
    document.getElementById('rfDelete').addEventListener('click', async () => {
        if (editing && await confirmDelete(editing)) dlg.close();
    });
    document.getElementById('rfTag').addEventListener('change', updateFeePreview);
    document.getElementById('rfVerein').addEventListener('change', () => {
        // Tarif automatisch vorschlagen, solange er nicht manuell gesetzt wurde
        if (!editing) document.getElementById('rfTag').value = autoTag({ verein: document.getElementById('rfVerein').value });
        updateFeePreview();
    });
    document.getElementById('rfBewerbe').addEventListener('change', e => {
        const opt = e.target.closest('.opt');
        if (opt && e.target.type === 'checkbox') {
            opt.classList.toggle('on', e.target.checked);
            opt.querySelector('select').disabled = !e.target.checked;
        }
        updateFeePreview();
    });
}

/**
 * Öffnet den Dialog. reg = null → neue Nennung; preset = { bewerb } für Vorauswahl
 */
export function openRegModal(reg = null, preset = {}) {
    editing = reg;
    const $ = id => document.getElementById(id);
    $('regModalTitle').textContent = reg ? `${reg.fullName} bearbeiten` : 'Nennung anlegen';
    $('rfDelete').style.display = reg ? '' : 'none';
    $('rfCheckedInWrap').style.display = state.checkinSupported ? '' : 'none';

    $('rfVorname').value = reg?.vorname || '';
    $('rfNachname').value = reg?.nachname || '';
    $('rfEmail').value = reg?.email || '';
    $('rfTelefon').value = reg?.telefon || '';
    $('rfVerein').value = reg?.verein || '';
    $('rfRc').value = reg?.rc || '';
    $('rfNotiz').value = reg?.notiz || '';
    $('rfTag').value = reg?.player_tag || 'normal';
    $('rfPaid').checked = !!reg?.has_paid;
    $('rfCheckedIn').checked = !!reg?.checked_in;
    $('rfReceipt').checked = !!reg?.needs_receipt;

    // Vereinsvorschläge aus bisherigen Nennungen
    const vereine = [...new Set(state.registrations.map(r => (r.verein || '').trim()).filter(Boolean))].sort();
    $('vereinList').innerHTML = vereine.map(v => `<option value="${esc(v)}">`).join('');

    // Bewerbs-Auswahl mit Auslastung
    $('rfBewerbe').innerHTML = allBewerbNames().map(b => {
        const has = reg ? reg.bewerbeArray.includes(b) : preset.bewerb === b;
        const cap = capacityOf(b);
        const taken = activeIn(b).filter(r => r.id !== reg?.id).length;
        const full = taken >= cap;
        const isWl = reg ? reg.wlBewerbe.includes(b) : full;
        return `
            <div class="opt ${has ? 'on' : ''}" data-bewerb="${esc(b)}">
                <input type="checkbox" ${has ? 'checked' : ''} aria-label="${esc(b)}">
                <div>
                    <div>${esc(b)}</div>
                    <div class="cap num">${taken}/${cap} belegt${full ? ' · voll' : ''}</div>
                </div>
                <select class="input" ${has ? '' : 'disabled'} aria-label="Status in ${esc(b)}">
                    <option value="active" ${!isWl ? 'selected' : ''}>Startplatz</option>
                    <option value="wl" ${isWl ? 'selected' : ''}>Warteliste</option>
                </select>
            </div>`;
    }).join('') || '<div class="muted small">Noch keine Bewerbe im Turnier-Setup angelegt.</div>';

    updateFeePreview();
    document.getElementById('regModal').showModal();
    $('rfVorname').focus();
}

function readBewerbe() {
    const sel = [], wl = [];
    document.querySelectorAll('#rfBewerbe .opt').forEach(opt => {
        if (!opt.querySelector('input').checked) return;
        sel.push(opt.dataset.bewerb);
        if (opt.querySelector('select').value === 'wl') wl.push(opt.dataset.bewerb);
    });
    return { sel, wl };
}

function updateFeePreview() {
    const { sel, wl } = readBewerbe();
    const fee = feeFor(document.getElementById('rfTag').value, sel.length - wl.length);
    document.getElementById('rfFee').textContent = euro(fee);
}

async function onRegSubmit(e) {
    e.preventDefault();
    const $ = id => document.getElementById(id);
    const v = id => $(id).value.trim();
    const { sel, wl } = readBewerbe();

    if (!v('rfVorname') || !v('rfNachname')) {
        showToast('Bitte Vor- und Nachname eingeben.', true);
        return;
    }
    if (sel.length === 0) {
        showToast('Bitte mindestens einen Bewerb wählen.', true);
        return;
    }

    const payload = {
        vorname: v('rfVorname'),
        nachname: v('rfNachname'),
        email: v('rfEmail'),
        telefon: v('rfTelefon'),
        verein: v('rfVerein'),
        rc: v('rfRc'),
        notiz: v('rfNotiz'),
        bewerb: sel[0],
        bewerbe_list: sel,
        ...waitlistFields(sel, wl),
        player_tag: $('rfTag').value,
        has_paid: $('rfPaid').checked,
        needs_receipt: $('rfReceipt').checked,
    };
    if (state.checkinSupported) payload.checked_in = $('rfCheckedIn').checked;

    await withBusy($('rfSave'), async () => {
        try {
            if (editing) {
                throwIfError(await supabase.from('registrations').update(payload).eq('id', editing.id));
                showToast('Änderungen gespeichert');
            } else {
                throwIfError(await supabase.from('registrations').insert({ ...payload, tournament_id: state.tournament.id }));
                showToast(`${payload.vorname} ${payload.nachname} wurde genannt`);
            }
            document.getElementById('regModal').close();
            await reloadRegistrations();
        } catch (err) {
            console.error(err);
            if (err.code === '23505') showToast('Diese Person ist für dieses Turnier bereits genannt.', true);
            else showToast('Speichern fehlgeschlagen: ' + (err.message || err), true);
        }
    });
}

// ==========================================
// EXPORTE
// ==========================================
async function copyEmails() {
    const emails = [...new Set(filtered.map(r => (r.email || '').trim()).filter(Boolean))];
    if (emails.length === 0) {
        showToast('Keine E-Mail-Adressen in der aktuellen Ansicht.', true);
        return;
    }
    const text = emails.join('; ');
    try {
        await navigator.clipboard.writeText(text);
        showToast(`${emails.length} E-Mail-Adressen kopiert`);
    } catch {
        window.prompt('Kopieren fehlgeschlagen – bitte manuell kopieren:', text);
    }
}

function exportCellFor(r, b) {
    if (r.wlBewerbe.includes(b)) return `WL ${state.wlPositions[r.id]?.[b] || ''}`.trim();
    return r.bewerbeArray.includes(b) ? 'x' : '';
}

async function exportExcel() {
    try {
        const XLSX = await import('xlsx');
        const names = allBewerbNames();
        const rows = [['Nachname', 'Vorname', 'E-Mail', 'Telefon', 'Verein', 'RC', ...names, 'Nenngeld', 'Bezahlt', 'Tarif', 'Anmerkung', 'Genannt am']];
        filtered.forEach(r => rows.push([
            r.nachname, r.vorname, r.email || '', r.telefon || '', r.verein || '', r.rc || '',
            ...names.map(b => exportCellFor(r, b)),
            r.fee_expected, r.has_paid ? 'Ja' : 'Nein', r.player_tag, r.notiz || '',
            new Date(r.created_at).toLocaleString('de-AT'),
        ]));
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = rows[0].map((h, i) => ({ wch: i < 2 ? 16 : i === 2 ? 26 : Math.max(8, String(h).length + 2) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Nennungen');
        XLSX.writeFile(wb, `Nennungen_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('Excel-Datei erstellt');
    } catch (err) {
        console.error(err);
        showToast('Excel-Export fehlgeschlagen.', true);
    }
}

function exportPdf() {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('landscape');
        const names = allBewerbNames();
        doc.setFontSize(16);
        doc.text(`Kassen- und Nennliste · ${state.tournament?.name || 'NFS Trophy'}`, 14, 18);
        doc.setFontSize(9);
        doc.text(`Stand: ${new Date().toLocaleString('de-AT')} · ${filtered.length} Personen`, 14, 25);

        const onlyWl = r => r.activeBewerbe.length === 0;
        const data = [...filtered].sort((a, b) =>
            (onlyWl(a) - onlyWl(b)) || (a.nachname || '').localeCompare(b.nachname || '', 'de'));

        doc.autoTable({
            startY: 30,
            head: [['Da', 'Name', 'Verein', 'RC', ...names, 'Betrag', 'Bez.']],
            body: data.map(r => [
                r.checked_in ? 'X' : '', `${r.nachname} ${r.vorname}`, r.verein || '–', r.rc || '–',
                ...names.map(b => exportCellFor(r, b)),
                `${r.fee_expected} EUR`, r.has_paid ? 'Ja' : '',
            ]),
            theme: 'grid',
            headStyles: { fillColor: [31, 81, 48] },
            styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle' },
            columnStyles: { 0: { cellWidth: 10 }, 1: { halign: 'left', cellWidth: 40 }, 2: { halign: 'left', cellWidth: 32 } },
        });
        doc.save(`Nennliste_${new Date().toISOString().slice(0, 10)}.pdf`);
        showToast('PDF erstellt');
    } catch (err) {
        console.error(err);
        showToast('PDF-Export fehlgeschlagen.', true);
    }
}

export function downloadReceipt(reg) {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const tName = state.tournament?.name || 'NFS Trophy';
        doc.setFontSize(22);
        doc.text('Nenngeld-Bestätigung', 20, 30);
        doc.setFontSize(12);
        doc.text(`Turnier: ${tName}`, 20, 45);
        if (state.tournament?.date_text) doc.text(`Datum: ${state.tournament.date_text}`, 20, 52);
        doc.text(`Ausgestellt am: ${new Date().toLocaleDateString('de-AT')}`, 20, 59);
        doc.line(20, 65, 190, 65);
        doc.text(`Name: ${reg.vorname} ${reg.nachname}`, 20, 77);
        doc.text(`Verein: ${reg.verein || '–'}`, 20, 85);
        doc.text(`Bewerbe: ${reg.activeBewerbe.join(', ') || '–'}`, 20, 93);
        doc.line(20, 101, 190, 101);
        doc.setFontSize(16);
        doc.text(`Betrag dankend erhalten: ${reg.fee_expected} EUR`, 20, 117);
        doc.setFontSize(10);
        doc.line(20, 145, 90, 145);
        doc.text(RECEIPT_SIGNER, 20, 151);
        doc.save(`Beleg_${reg.nachname}_${reg.vorname}.pdf`);
    } catch (err) {
        console.error(err);
        showToast('Beleg konnte nicht erstellt werden.', true);
    }
}

