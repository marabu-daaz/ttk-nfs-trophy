// src/admin/finance.js
// Kasse: Kassenbuch (Einnahmen/Ausgaben) + Nenngeld-Übersicht

import { supabase } from '../shared/supabase.js';
import { esc, showToast, throwIfError } from '../shared/utils.js';
import { icon, euro, fmtDate, confirmDialog } from './ui.js';

let expenses = [];
let incomes = [];
let activeTournamentId = null;
let onChange = null;

/**
 * Callback, der nach jedem (Neu-)Laden der Buchhaltung aufgerufen wird
 * (z.B. um den Saldo im Dashboard neu zu berechnen)
 */
export function setFinanceChangeHandler(fn) {
    onChange = fn;
}

export function setFinanceTournamentId(id) {
    activeTournamentId = id;
}

export function getExpenses() { return expenses; }
export function getIncomes() { return incomes; }

export async function loadBookkeeping() {
    if (!activeTournamentId) return;
    try {
        const [expData, incData] = await Promise.all([
            supabase.from('expenses').select('*').eq('tournament_id', activeTournamentId).order('created_at', { ascending: false }),
            supabase.from('incomes').select('*').eq('tournament_id', activeTournamentId).order('created_at', { ascending: false })
        ]);
        throwIfError(expData);
        throwIfError(incData);

        // numeric-Spalten können als String kommen → in Zahlen umwandeln
        expenses = (expData.data || []).map(e => ({ ...e, amount: Number(e.amount) || 0 }));
        incomes = (incData.data || []).map(i => ({ ...i, amount: Number(i.amount) || 0 }));
        if (onChange) onChange();
    } catch (err) {
        console.error('Fehler beim Laden der Buchhaltung:', err);
        showToast('Fehler beim Laden der Buchhaltung.', true);
    }
}

export function initFinanceView() {
    document.getElementById('addIncomeBtn').addEventListener('click', () => addBuchEntry('incomes'));
    document.getElementById('addExpenseBtn').addEventListener('click', () => addBuchEntry('expenses'));
    document.getElementById('buchForm').addEventListener('submit', e => { e.preventDefault(); addBuchEntry('incomes'); });
    document.getElementById('buchBody').addEventListener('click', async e => {
        const btn = e.target.closest('[data-del]');
        if (!btn) return;
        const ok = await confirmDialog({ title: 'Eintrag löschen?', message: btn.dataset.desc, confirmText: 'Löschen', danger: true });
        if (!ok) return;
        try {
            throwIfError(await supabase.from(btn.dataset.table).delete().eq('id', btn.dataset.del));
            showToast('Eintrag gelöscht');
            await loadBookkeeping();
        } catch (err) {
            showToast('Löschen fehlgeschlagen: ' + (err.message || err), true);
        }
    });
}

/**
 * Rendert die Kasse. `tot` = Kennzahlen aus state.totals(), `byTag` = Aufschlüsselung
 */
export function renderFinance(tot, byTag) {
    const sumInc = incomes.reduce((s, i) => s + i.amount, 0);
    const sumExp = expenses.reduce((s, e) => s + e.amount, 0);
    const saldo = tot.paid + sumInc - sumExp;

    const tile = (label, value, foot, cls = '', ic = 'euro') => `
        <div class="tile ${cls}"><div class="label">${icon(ic)}${label}</div><div class="value num">${value}</div><div class="foot">${foot}</div></div>`;
    document.getElementById('kasseTiles').innerHTML = [
        tile('Nenngeld erwartet', euro(tot.expected), `${tot.starts} Startplätze`, '', 'users'),
        tile('Kassiert', euro(tot.paid), `${tot.expected ? Math.round((tot.paid / tot.expected) * 100) : 0} % vom Erwarteten`, 'accent', 'wallet'),
        tile('Noch offen', euro(tot.outstanding), 'Nenngeld ausständig', tot.outstanding > 0 ? 'warn' : '', 'clock'),
        tile('Kassenbuch', euro(sumInc - sumExp), `+${euro(sumInc)} / −${euro(sumExp)}`, '', 'receipt'),
        tile('Saldo', euro(saldo), 'Kassiert + Kassenbuch', saldo < 0 ? 'danger' : 'accent', 'euro'),
        tile('Rabatte & VIP', euro(tot.loss), 'gegenüber Normaltarif', '', 'star'),
    ].join('');

    const records = [
        ...incomes.map(i => ({ ...i, table: 'incomes', sign: 1 })),
        ...expenses.map(e => ({ ...e, table: 'expenses', sign: -1 })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    document.getElementById('buchBody').innerHTML = records.length ? records.map(r => `
        <div class="list-item">
            <span class="chip ${r.sign > 0 ? 'active' : 'danger'}">${r.sign > 0 ? '+ Einnahme' : '− Ausgabe'}</span>
            <div class="body">
                <div class="title">${esc(r.description)}</div>
                <div class="sub">${fmtDate(r.created_at)}</div>
            </div>
            <strong class="num">${r.sign > 0 ? '+' : '−'}${euro(r.amount)}</strong>
            <button class="icon-btn danger" data-del="${esc(r.id)}" data-table="${r.table}" data-desc="${esc(r.description)} (${euro(r.amount)})" title="Löschen">${icon('trash')}</button>
        </div>`).join('') : '<div class="muted small">Noch keine Einträge.</div>';

    const labels = { normal: 'Normal', nfs: 'NFS-Mitglieder', vip: 'VIP (gratis)' };
    document.getElementById('kasseBreakdown').innerHTML = `
        <table class="table">
            <thead><tr><th>Tarif</th><th class="right">Personen</th><th class="right">Starts</th><th class="right">Erwartet</th><th class="right">Kassiert</th></tr></thead>
            <tbody>
                ${Object.entries(byTag).map(([tag, v]) => `
                    <tr><td>${labels[tag] || esc(tag)}</td><td class="right num">${v.people}</td><td class="right num">${v.starts}</td><td class="right num">${euro(v.expected)}</td><td class="right num">${euro(v.paid)}</td></tr>`).join('')}
                <tr><td><strong>Gesamt</strong></td><td class="right num"><strong>${tot.activePeople}</strong></td><td class="right num"><strong>${tot.starts}</strong></td><td class="right num"><strong>${euro(tot.expected)}</strong></td><td class="right num"><strong>${euro(tot.paid)}</strong></td></tr>
            </tbody>
        </table>
        <p class="small muted" style="margin-top:12px;">Nenngeld wird nur für Bewerbe mit Startplatz berechnet – Wartelisten-Plätze sind kostenlos, bis jemand nachrückt.</p>`;
}

export async function addBuchEntry(table) {
    if (!activeTournamentId) {
        showToast('Kein aktives Turnier.', true);
        return;
    }

    const desc = document.getElementById('buchDesc')?.value.trim();
    const amt = parseFloat(document.getElementById('buchAmount')?.value);

    if (!desc || isNaN(amt) || amt <= 0) {
        showToast('Bitte Verwendungszweck und Betrag eingeben.', true);
        return;
    }

    try {
        throwIfError(await supabase.from(table).insert({
            tournament_id: activeTournamentId,
            description: desc,
            amount: amt
        }));

        document.getElementById('buchDesc').value = '';
        document.getElementById('buchAmount').value = '';
        await loadBookkeeping();
        showToast(table === 'incomes' ? 'Einnahme gebucht' : 'Ausgabe gebucht');
    } catch (err) {
        console.error('Fehler beim Speichern:', err);
        showToast('Fehler beim Speichern.', true);
    }
}
