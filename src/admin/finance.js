// src/admin/finance.js
import { supabase } from '../shared/supabase.js';
import { esc, showToast, throwIfError } from '../shared/utils.js';

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

export async function loadBookkeeping() {
    try {
        const [expData, incData] = await Promise.all([
            supabase.from('expenses').select('*').eq('tournament_id', activeTournamentId).order('created_at', { ascending: false }),
            supabase.from('incomes').select('*').eq('tournament_id', activeTournamentId).order('created_at', { ascending: false })
        ]);

        if (expData.error) throw expData.error;
        if (incData.error) throw incData.error;

        // numeric-Spalten können als String kommen → in Zahlen umwandeln
        expenses = (expData.data || []).map(e => ({ ...e, amount: Number(e.amount) || 0 }));
        incomes = (incData.data || []).map(i => ({ ...i, amount: Number(i.amount) || 0 }));
        renderBookkeeping();
        if (onChange) onChange();
    } catch (err) {
        console.error('Fehler beim Laden der Buchhaltung:', err);
        showToast('Fehler beim Laden der Buchhaltung.', true);
    }
}

function renderBookkeeping() {
    const tbody = document.getElementById('buchBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const allRecords = [
        ...expenses.map(e => ({ ...e, type: 'expense' })),
        ...incomes.map(i => ({ ...i, type: 'income' }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (allRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">Keine Einträge vorhanden.</td></tr>';
        return;
    }

    allRecords.forEach(rec => {
        const isIncome = rec.type === 'income';
        const color = isIncome ? '#4CAF50' : 'var(--error)';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(rec.created_at).toLocaleDateString('de-AT')}</td>
            <td><span class="badge" style="background: ${color}33; color: ${color};">${isIncome ? 'Einnahme' : 'Ausgabe'}</span></td>
            <td><strong>${esc(rec.description)}</strong></td>
            <td style="color: ${color}; font-weight: bold;">${isIncome ? '+' : '-'} ${rec.amount} €</td>
            <td><button class="btn-outline btn-small delete-buch-btn" data-id="${rec.id}" data-type="${rec.type}" style="color: var(--error); border-color: var(--error);">🗑️</button></td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.delete-buch-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const table = e.currentTarget.getAttribute('data-type') === 'income' ? 'incomes' : 'expenses';
            const id = e.currentTarget.getAttribute('data-id');
            if (!confirm('Eintrag wirklich löschen?')) return;
            try {
                throwIfError(await supabase.from(table).delete().eq('id', id));
                await loadBookkeeping();
            } catch (err) {
                console.error('Fehler beim Löschen:', err);
                showToast('Fehler beim Löschen.', true);
            }
        });
    });
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
        showToast('Eintrag gespeichert!');
    } catch (err) {
        console.error('Fehler beim Speichern:', err);
        showToast('Fehler beim Speichern.', true);
    }
}

export function getExpenses() { return expenses; }
export function getIncomes() { return incomes; }