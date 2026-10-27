// src/admin/backup.js
// Datensicherung: alle Tabellen als eine JSON-Datei herunterladen
// (im Gratis-Tarif von Supabase gibt es keine Sicherungen, die man selbst zurückspielen kann)

import { supabase } from '../shared/supabase.js';
import { showToast } from '../shared/utils.js';
import { withBusy, relTime } from './ui.js';

const PAGE = 1000;
const LAST_KEY = 'nfs-last-backup';

// Tabelle → Spalte für eine stabile Reihenfolge beim seitenweisen Laden
const TABLES = {
    tournaments: 'id',
    registrations: 'id',
    ergebnisse: 'id',
    incomes: 'id',
    expenses: 'id',
    players: 'id',
    player_entries: 'id',
    player_aliases: 'name_key',
    player_distinct: 'a',
    audit_log: 'id',
};

async function fetchTable(table, orderBy) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from(table).select('*').order(orderBy).range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE) return rows;
    }
}

function lastBackup() {
    try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

export function renderBackupHint() {
    const el = document.getElementById('backupHint');
    if (!el) return;
    const last = lastBackup();
    const days = last ? (Date.now() - new Date(last).getTime()) / 864e5 : Infinity;
    el.textContent = last ? `Letzte Sicherung auf diesem Gerät: ${relTime(last)}` : 'Auf diesem Gerät noch nicht gesichert';
    el.classList.toggle('warn', days > 30);
}

export function initBackup() {
    const btn = document.getElementById('backupBtn');
    btn?.addEventListener('click', () => withBusy(btn, downloadBackup, 'Sichere…'));
    renderBackupHint();
}

async function downloadBackup() {
    const tables = {};
    const skipped = [];
    for (const [table, orderBy] of Object.entries(TABLES)) {
        try {
            tables[table] = await fetchTable(table, orderBy);
        } catch (err) {
            // Tabelle (noch) nicht eingerichtet → überspringen statt abbrechen
            if (/does not exist|42P01|PGRST205/i.test(`${err.code} ${err.message}`)) skipped.push(table);
            else {
                console.error(`Sicherung von ${table} fehlgeschlagen:`, err);
                showToast(`Sicherung fehlgeschlagen (${table}): ${err.message || err}`, true);
                return;
            }
        }
    }
    const { data: { session } } = await supabase.auth.getSession();
    const backup = {
        created_at: new Date().toISOString(),
        created_by: session?.user?.email || null,
        note: 'NFS Trophy – vollständige Datensicherung. Dateien (PDFs, Fotos) liegen im Supabase-Speicher und sind nicht enthalten.',
        counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
        skipped,
        tables,
    };
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nfs-trophy-sicherung_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    try { localStorage.setItem(LAST_KEY, backup.created_at); } catch { /* privater Modus */ }
    renderBackupHint();
    const total = Object.values(backup.counts).reduce((s, n) => s + n, 0);
    showToast(`Sicherung erstellt: ${total} Datensätze aus ${Object.keys(tables).length} Tabellen`);
}
