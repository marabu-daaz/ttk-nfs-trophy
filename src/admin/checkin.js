// src/admin/checkin.js
// Check-in am Turniertag: Anwesenheit + Bezahlung mit einem Tipp

import { esc, showToast } from '../shared/utils.js';
import { state, totals, findReg, updateRegistration, reloadRegistrations, notify } from './state.js';
import { icon, euro } from './ui.js';

let query = '';
let mode = 'open';

export function initCheckinView() {
    const search = document.getElementById('checkinSearch');
    search.addEventListener('input', () => { query = search.value.toLowerCase().trim(); renderList(); });
    search.addEventListener('keydown', e => {
        // Enter bei genau einem Treffer → einchecken + kassieren
        if (e.key !== 'Enter') return;
        const hits = visible();
        if (hits.length === 1) toggleBoth(hits[0]);
    });
    document.getElementById('checkinFilter').addEventListener('click', e => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        mode = b.dataset.v;
        document.querySelectorAll('#checkinFilter button').forEach(x => x.classList.toggle('on', x === b));
        renderList();
    });
    document.getElementById('checkinList').addEventListener('click', onClick);
}

export function render() {
    const banner = document.getElementById('checkinBanner');
    banner.innerHTML = state.checkinSupported ? '' : `
        <div class="banner warn">${icon('alert')}
            <div>Für die Anwesenheit fehlt noch eine Spalte in der Datenbank. Bis dahin funktioniert nur „Bezahlt“.
            Einmalig im Supabase-SQL-Editor ausführen: <code>supabase/admin-features.sql</code></div>
        </div>`;

    const t = totals();
    const relevantRegs = state.registrations.filter(r => r.activeBewerbe.length > 0);
    const relevant = relevantRegs.length;
    const done = relevantRegs.filter(isDone).length;
    document.getElementById('checkinStats').innerHTML = `
        <div class="tile accent"><div class="label">${icon('checkCircle')}Erledigt</div><div class="value num">${done}<span class="muted" style="font-size:16px;"> / ${relevant}</span></div></div>
        <div class="tile"><div class="label">${icon('wallet')}Kassiert</div><div class="value num">${euro(t.paid)}</div></div>
        <div class="tile ${t.outstanding > 0 ? 'warn' : ''}"><div class="label">${icon('clock')}Offen</div><div class="value num">${euro(t.outstanding)}</div></div>`;
    renderList();
}

/** Erledigt = bezahlt (bzw. nichts zu zahlen) und – falls unterstützt – eingecheckt */
function isDone(r) {
    const paidOk = r.has_paid || r.fee_expected === 0;
    return state.checkinSupported ? paidOk && r.checked_in : paidOk;
}

function visible() {
    return state.registrations
        .filter(r => {
            if (query && !`${r.vorname} ${r.nachname} ${r.nachname} ${r.vorname} ${r.verein || ''}`.toLowerCase().includes(query)) return false;
            if (mode === 'open' && isDone(r)) return false;
            if (mode === 'done' && !isDone(r)) return false;
            return true;
        })
        .sort((a, b) =>
            // Nur-Warteliste ans Ende, sonst alphabetisch
            ((a.activeBewerbe.length === 0) - (b.activeBewerbe.length === 0)) ||
            (a.nachname || '').localeCompare(b.nachname || '', 'de'));
}

function renderList() {
    const list = document.getElementById('checkinList');
    const items = visible();
    if (!items.length) {
        list.innerHTML = `<div class="empty">${icon(mode === 'open' ? 'checkCircle' : 'search')}<div>${
            mode === 'open' && !query ? 'Alle erledigt – stark! 🏓' : 'Keine Treffer.'}</div></div>`;
        return;
    }
    list.innerHTML = items.map(itemHtml).join('');
}

function itemHtml(r) {
    const onlyWl = r.activeBewerbe.length === 0;
    const chips = r.bewerbeArray.map(b => r.wlBewerbe.includes(b)
        ? `<span class="chip wl">${icon('hourglass')}WL · ${esc(b)}</span>`
        : `<span class="chip active">${icon('check')}${esc(b)}</span>`).join('');
    return `
        <div class="ci-item ${isDone(r) ? 'done' : ''}" data-id="${esc(r.id)}">
            <div>
                <div class="n">${esc(r.nachname)} ${esc(r.vorname)}</div>
                <div class="s">${esc(r.verein || 'ohne Verein')}${r.rc ? ' · RC ' + esc(r.rc) : ''}${r.player_tag !== 'normal' ? ' · ' + (r.player_tag === 'vip' ? 'VIP' : 'NFS') : ''}</div>
                <div class="chips">${chips}${onlyWl ? '<span class="chip">nur Warteliste</span>' : ''}</div>
                ${r.notiz ? `<div class="s">${icon('note')} ${esc(r.notiz)}</div>` : ''}
            </div>
            <div class="ci-btns">
                ${state.checkinSupported ? `
                <button class="ci-btn ${r.checked_in ? 'on' : ''}" data-act="here" aria-pressed="${!!r.checked_in}">
                    ${icon(r.checked_in ? 'checkCircle' : 'users')}${r.checked_in ? 'Da' : 'Anwesend?'}
                </button>` : ''}
                <button class="ci-btn ${r.has_paid ? 'on' : ''}" data-act="paid" aria-pressed="${!!r.has_paid}" ${r.fee_expected === 0 && !r.has_paid ? 'disabled' : ''}>
                    <span class="amount num">${euro(r.fee_expected)}</span>${r.has_paid ? '✓ bezahlt' : r.fee_expected === 0 ? 'gratis' : 'kassieren'}
                </button>
            </div>
        </div>`;
}

async function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const reg = findReg(btn.closest('.ci-item').dataset.id);
    if (!reg) return;
    if (btn.dataset.act === 'here') await save(reg, { checked_in: !reg.checked_in });
    if (btn.dataset.act === 'paid') await save(reg, { has_paid: !reg.has_paid });
}

async function toggleBoth(reg) {
    const patch = { has_paid: true };
    if (state.checkinSupported) patch.checked_in = true;
    await save(reg, patch);
    const s = document.getElementById('checkinSearch');
    s.value = '';
    query = '';
    renderList();
    s.focus();
}

/** Optimistisch speichern: sofort anzeigen, bei Fehler zurücknehmen */
async function save(reg, patch) {
    const before = { checked_in: reg.checked_in, has_paid: reg.has_paid };
    Object.assign(reg, patch);
    notify();
    try {
        await updateRegistration(reg.id, patch);
        if (patch.has_paid) showToast(`${reg.fullName}: ${euro(reg.fee_expected)} kassiert`);
    } catch (err) {
        Object.assign(reg, before);
        notify();
        showToast('Nicht gespeichert: ' + (err.message || err), true);
        await reloadRegistrations();
    }
}
