// src/admin/audit.js
// Änderungsprotokoll: wer hat wann was geändert (Daten kommen vom DB-Trigger nfs_audit)

import { supabase } from '../shared/supabase.js';
import { esc } from '../shared/utils.js';
import { state } from './state.js';
import { icon, euro } from './ui.js';

const PAGE = 150;
let filter = 'all';
let query = '';
let limit = PAGE;
let entries = [];
let missingTable = false;

// ---------- Beschriftungen ----------
const FIELD_LABELS = {
    registrations: {
        vorname: 'Vorname', nachname: 'Nachname', email: 'E-Mail', telefon: 'Telefon', verein: 'Verein', rc: 'RC',
        bewerbe_list: 'Bewerbe', waitlist_bewerbe: 'Warteliste', player_tag: 'Tarif', has_paid: 'Bezahlt',
        checked_in: 'Anwesend', needs_receipt: 'Beleg', notiz: 'Anmerkung', created_at: 'Wartelisten-Reihenfolge',
    },
    tournaments: {
        name: 'Name', date_text: 'Datum', date_iso: 'Turnierbeginn', subtitle: 'Untertitel', is_open: 'Anmeldung',
        fee_normal: 'Nenngeld', fee_nfs: 'Nenngeld NFS', bewerbe: 'Bewerbe', turnier_info: 'Website-Texte/Zeitplan/Sponsoren',
        hall_of_fame: 'Hall of Fame', oettv_url: 'ÖTTV-Link', ttop_url: 'TTOP-Link', show_ttop_button: 'TTOP-Button',
        ausschreibung_path: 'Ausschreibung', fotos_prefix: 'Fotos',
    },
};
// Technische Felder (Mail-Versand) – Änderungen daran sind kein eigener Protokolleintrag
const HIDDEN = new Set(['bewerb', 'waitlist', 'id', 'tournament_id', '_name', 'link_sent_at', 'reminder_sent_at']);
const TAG = { normal: 'Normal', nfs: 'NFS', vip: 'VIP' };
const LONG = new Set(['bewerbe', 'turnier_info', 'hall_of_fame', 'created_at']);

function fmtValue(table, key, v) {
    if (v === null || v === undefined || v === '') return '–';
    if (typeof v === 'boolean') {
        if (table === 'tournaments' && key === 'is_open') return v ? 'offen' : 'geschlossen';
        return v ? 'Ja' : 'Nein';
    }
    if (key === 'player_tag') return TAG[v] || v;
    if (Array.isArray(v)) return v.length ? v.join(', ') : '–';
    if (key === 'date_iso') return new Date(v).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' });
    if (key === 'ausschreibung_path') return String(v).replace(/^\d+_/, '');
    return String(v);
}

/** Wandelt einen Protokolleintrag in { icon, title, changes[] } */
export function describe(e) {
    const t = e.table_name;
    const o = e.old_data || {};
    const n = e.new_data || {};
    const name = r => `${r.vorname || ''} ${r.nachname || ''}`.trim();

    if (t === 'registrations') {
        if (e.action === 'INSERT') return { ic: 'userPlus', title: `Neue Nennung: ${name(n)}`, sub: (n.bewerbe_list || []).join(', '), changes: [] };
        if (e.action === 'DELETE') return { ic: 'userMinus', title: `Nennung gelöscht: ${name(o)}`, sub: (o.bewerbe_list || []).join(', '), changes: [] };
    }
    if (t === 'incomes' || t === 'expenses') {
        const kind = t === 'incomes' ? 'Einnahme' : 'Ausgabe';
        const r = e.action === 'DELETE' ? o : n;
        return { ic: 'receipt', title: `${kind} ${e.action === 'DELETE' ? 'gelöscht' : 'gebucht'}: ${r.description || ''} (${euro(r.amount)})`, changes: [] };
    }
    if (t === 'ergebnisse') {
        const r = e.action === 'DELETE' ? o : n;
        return { ic: 'file', title: `Ergebnis-PDF ${e.action === 'DELETE' ? 'gelöscht' : 'hochgeladen'}: ${r.label || ''}`, changes: [] };
    }
    if (t === 'tournaments' && e.action !== 'UPDATE') {
        const r = e.action === 'DELETE' ? o : n;
        return { ic: 'trophy', title: `Turnier ${e.action === 'DELETE' ? 'gelöscht' : 'angelegt'}: ${r.name || ''}`, changes: [] };
    }

    // UPDATE: geänderte Felder auflisten
    const labels = FIELD_LABELS[t] || {};
    const changes = Object.keys(n).filter(k => !HIDDEN.has(k)).flatMap(k => {
        // Warteliste als „Nachgerückt“ / „Auf Warteliste“ statt Listenvergleich
        if (t === 'registrations' && k === 'waitlist_bewerbe') {
            const before = Array.isArray(o[k]) ? o[k] : [];
            const after = Array.isArray(n[k]) ? n[k] : [];
            const up = before.filter(b => !after.includes(b));
            const down = after.filter(b => !before.includes(b));
            return [
                ...(up.length ? [{ label: 'Nachgerückt', from: null, to: up.join(', ') }] : []),
                ...(down.length ? [{ label: 'Auf Warteliste', from: null, to: down.join(', ') }] : []),
            ];
        }
        return [{
            label: labels[k] || k,
            from: LONG.has(k) ? null : fmtValue(t, k, o[k]),
            to: LONG.has(k) ? 'geändert' : fmtValue(t, k, n[k]),
        }];
    });
    const ic = t === 'tournaments' ? 'sliders' : ('has_paid' in n ? 'wallet' : 'checked_in' in n ? 'checkCircle' : 'waitlist_bewerbe' in n ? 'hourglass' : 'edit');
    return { ic, title: o._name || (t === 'tournaments' ? 'Turnier' : 'Eintrag'), changes };
}

function who(actor) {
    if (!actor) return 'unbekannt';
    if (actor === 'Website' || actor === 'Selbst-Abmeldung') return actor;
    return actor.includes('@') ? actor.split('@')[0] : actor;
}

// ---------- Laden ----------
async function load() {
    if (!state.tournament) return;
    let q = supabase.from('audit_log').select('*')
        .eq('tournament_id', String(state.tournament.id))
        .order('created_at', { ascending: false })
        .limit(limit);
    if (filter === 'reg') q = q.eq('table_name', 'registrations');
    if (filter === 'turnier') q = q.eq('table_name', 'tournaments');
    const { data, error } = await q;
    if (error) {
        // Tabelle existiert noch nicht → Hinweis auf SQL-Datei
        missingTable = /audit_log|does not exist|42P01|PGRST205/i.test(`${error.code} ${error.message}`);
        entries = [];
        if (!missingTable) console.error('Protokoll konnte nicht geladen werden:', error);
        return;
    }
    missingTable = false;
    entries = (data || []).filter(e => filter !== 'kasse' || ['incomes', 'expenses'].includes(e.table_name));
}

export function initAuditView() {
    document.getElementById('auditFilter').addEventListener('click', async e => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        filter = b.dataset.v;
        limit = PAGE;
        document.querySelectorAll('#auditFilter button').forEach(x => x.classList.toggle('on', x === b));
        await render();
    });
    document.getElementById('auditSearch').addEventListener('input', e => { query = e.target.value.toLowerCase().trim(); renderList(); });
    document.getElementById('auditMore').addEventListener('click', async () => { limit += PAGE; await render(); });
}

export async function render() {
    await load();
    renderList();
}

function renderList() {
    const box = document.getElementById('auditList');
    const more = document.getElementById('auditMore');
    if (missingTable) {
        box.innerHTML = `<div class="banner warn">${icon('alert')}<div>Das Protokoll ist noch nicht eingerichtet. Einmalig im Supabase-SQL-Editor ausführen: <code>supabase/audit-log.sql</code>. Ab dann wird jede Änderung aufgezeichnet.</div></div>`;
        more.hidden = true;
        return;
    }
    const items = entries.map(e => ({ e, d: describe(e) }))
        .filter(({ e, d }) => !(e.action === 'UPDATE' && !d.changes.length))
        .filter(({ e, d }) => !query || `${d.title} ${d.sub || ''} ${e.actor} ${d.changes.map(c => c.label + c.to).join(' ')}`.toLowerCase().includes(query));
    if (!items.length) {
        box.innerHTML = `<div class="empty">${icon('clock')}<div>${entries.length ? 'Keine Treffer.' : 'Noch keine Einträge für dieses Turnier.'}</div></div>`;
        more.hidden = true;
        return;
    }

    let lastDay = '';
    box.innerHTML = items.map(({ e, d }) => {
        const dt = new Date(e.created_at);
        const day = dt.toLocaleDateString('de-AT', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
        const head = day !== lastDay ? `<div class="audit-day">${esc(day)}</div>` : '';
        lastDay = day;
        return `${head}
            <div class="audit-item">
                <span class="audit-ic">${icon(d.ic)}</span>
                <div class="body">
                    <div class="title">${esc(d.title)}${d.sub ? ` <span class="muted small">· ${esc(d.sub)}</span>` : ''}</div>
                    ${d.changes.length ? `<div class="audit-changes">${d.changes.map(c => `
                        <span><b>${esc(c.label)}:</b> ${c.from !== null ? `${esc(c.from)} → ` : ''}${esc(c.to)}</span>`).join('')}</div>` : ''}
                </div>
                <div class="audit-meta">
                    <div>${dt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div class="muted small">${esc(who(e.actor))}</div>
                </div>
            </div>`;
    }).join('');
    more.hidden = entries.length < limit;
}

/** Verlauf einer einzelnen Nennung (für den Bearbeiten-Dialog) */
export async function historyFor(regId) {
    const { data, error } = await supabase.from('audit_log').select('*')
        .eq('table_name', 'registrations').eq('record_id', String(regId))
        .order('created_at', { ascending: false }).limit(30);
    if (error) return null;
    return (data || []).map(e => ({ e, d: describe(e) })).filter(({ e, d }) => !(e.action === 'UPDATE' && !d.changes.length));
}
