// src/admin/players.js
// Spielerdatenbank: alle Personen über alle Turniere, Teilnahmen, Erfolge, Doppelte zusammenführen
// (Daten aus supabase/players.sql – Website-Nennungen werden per Trigger automatisch zugeordnet)

import { supabase } from '../shared/supabase.js';
import { esc, showToast, throwIfError } from '../shared/utils.js';
import { state } from './state.js';
import { icon, confirmDialog, withBusy, openMail } from './ui.js';
import { openInvitationDialog } from './invitation.js';

const STAMM_MIN = 3;          // ab so vielen Turnieren gilt man als Stammspieler
const PAGE = 1000;            // Supabase liefert höchstens 1000 Zeilen pro Abfrage

const data = {
    loaded: false,
    loadedAt: 0,
    missing: false,
    players: [],              // angereichert, siehe enrichAll
    byId: new Map(),
    distinct: new Set(),      // "a-b"
    dups: null,               // Zwischenspeicher für duplicateCandidates()
};
const filters = { search: '', mode: 'all', sort: 'name' };
let loading = null;

// ==========================================
// NAMEN & ERFOLGE
// ==========================================
/** Vergleichsschlüssel: klein, ohne Akzente, nur Buchstaben */
export function nameKey(...parts) {
    return parts.join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z]+/g, ' ').trim();
}

/** Wie nameKey, aber „jun./sen.“ immer ans Ende – „Rudolf jun. Holzer“ = „Rudolf Holzer jun.“ */
function hofKey(...parts) {
    const words = nameKey(...parts).split(' ').filter(Boolean);
    const SUFFIX = { jun: 'jun', jr: 'jun', sen: 'sen', sr: 'sen' };
    return [...words.filter(w => !SUFFIX[w]), ...words.filter(w => SUFFIX[w]).map(w => SUFFIX[w])].join(' ');
}

const POS = { p1: 1, p2: 2, p3_1: 3, p3_2: 3, trost: 'T' };
const POS_LABEL = { 1: 'Sieg', 2: '2. Platz', 3: '3. Platz', T: 'Trostbewerb' };

/** Hall of Fame aller Turniere → Map nameKey → [{ tournament, bewerb, pos }] */
function hallOfFameIndex() {
    const idx = new Map();
    state.tournaments.forEach(t => {
        Object.entries(t.hall_of_fame || {}).forEach(([bewerb, places]) => {
            Object.entries(places || {}).forEach(([key, text]) => {
                if (!POS[key] || !text) return;
                // „Vorname Nachname (VEREIN)“ bzw. bei Doppel „A B/C D (V1/V2)“
                String(text).replace(/\(.*?\)/g, '').split('/').forEach(name => {
                    const k = hofKey(name);
                    if (!k) return;
                    // Vor-/Nachname vertauscht, Zusatz (jun./sen.) bleibt hinten
                    const words = k.split(' ');
                    const sfx = ['jun', 'sen'].includes(words[words.length - 1]) ? [words.pop()] : [];
                    const swapped = [...words.slice(1), words[0], ...sfx].join(' ');
                    [k, swapped].forEach(kk => {
                        if (!idx.has(kk)) idx.set(kk, []);
                        idx.get(kk).push({ tournament: t, bewerb, pos: POS[key] });
                    });
                });
            });
        });
    });
    return idx;
}

// ==========================================
// LADEN
// ==========================================
async function fetchAll(table, columns = '*') {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
        const { data: chunk, error } = await supabase.from(table).select(columns).order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(chunk || []));
        if (!chunk || chunk.length < PAGE) return rows;
    }
}

async function fetchDistinct() {
    const { data: rows, error } = await supabase.from('player_distinct').select('a,b');
    if (error) throw error;
    return rows || [];
}

/** Lädt Spieler + Teilnahmen (höchstens einmal pro Minute, außer force) */
export function ensurePlayers(force = false) {
    if (!force && data.loaded && Date.now() - data.loadedAt < 60000) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
        try {
            const [players, entries, distinct] = await Promise.all([fetchAll('players'), fetchAll('player_entries'), fetchDistinct()]);
            data.missing = false;
            data.distinct = new Set(distinct.map(d => `${d.a}-${d.b}`));
            enrichAll(players, entries);
            data.loaded = true;
            data.loadedAt = Date.now();
        } catch (err) {
            data.missing = /players|player_entries|player_distinct|does not exist|42P01|PGRST205/i.test(`${err.code} ${err.message}`);
            if (!data.missing) {
                console.error('Spieler konnten nicht geladen werden:', err);
                showToast('Spieler konnten nicht geladen werden: ' + (err.message || err), true);
            }
            data.players = [];
            data.byId = new Map();
            data.dups = null;
        } finally {
            loading = null;
        }
    })();
    return loading;
}

/** Alle (angereicherten) Spieler – z.B. für die Einladung */
export function getPlayers() {
    return data.players;
}

/** Nach dem Speichern einer Nennung neu laden lassen */
export function invalidatePlayers() {
    data.loadedAt = 0;
}

function tournamentTime(t) {
    return t?.date_iso ? new Date(t.date_iso).getTime() : 0;
}

function enrichAll(players, entries) {
    const tById = new Map(state.tournaments.map(t => [String(t.id), t]));
    const hof = hallOfFameIndex();
    const byPlayer = new Map();
    entries.forEach(e => {
        const t = tById.get(String(e.tournament_id));
        if (!t) return;
        if (!byPlayer.has(e.player_id)) byPlayer.set(e.player_id, []);
        byPlayer.get(e.player_id).push({ ...e, tournament: t });
    });

    data.players = players.map(p => {
        const list = (byPlayer.get(p.id) || []).sort((a, b) => tournamentTime(b.tournament) - tournamentTime(a.tournament));
        const key = nameKey(p.vorname, p.nachname);
        // Erfolge nur aus Turnieren, bei denen die Person auch dabei war
        const played = new Set(list.map(e => String(e.tournament.id)));
        const titles = (hof.get(hofKey(p.vorname, p.nachname)) || []).filter(h => played.has(String(h.tournament.id)));
        const last = list[0]?.tournament || null;
        return {
            ...p,
            key,
            nkey: nameKey(p.nachname),
            vkey: nameKey(p.vorname),
            fullName: `${p.vorname} ${p.nachname}`.trim(),
            entries: list,
            played,
            count: list.length,
            first: list[list.length - 1]?.tournament || null,
            last,
            lastTime: tournamentTime(last),
            titles,
            wins: titles.filter(h => h.pos === 1).length,
            podiums: titles.filter(h => h.pos !== 'T').length,
        };
    });
    data.byId = new Map(data.players.map(p => [p.id, p]));
    data.dups = null;
}

// ==========================================
// MÖGLICHE DOPPELTE
// ==========================================
function levenshtein(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 3;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

/** Gründe, warum zwei Einträge dieselbe Person sein könnten (leer = nein) */
function dupReason(a, b) {
    // Beide beim selben Turnier → sicher verschiedene Personen
    if ([...b.played].some(id => a.played.has(id))) return '';
    if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) return 'gleiche E-Mail';
    if (a.nkey === b.nkey) {
        if (a.vkey.startsWith(b.vkey) || b.vkey.startsWith(a.vkey)) return 'Vorname abgekürzt';
        if (a.vkey.slice(0, 3) === b.vkey.slice(0, 3)) return 'ähnlicher Vorname';
        if (levenshtein(a.vkey, b.vkey) <= 2) return 'ähnlicher Vorname';
    }
    if (a.vkey === b.vkey && levenshtein(a.nkey, b.nkey) <= 2) return 'ähnlicher Nachname';
    if (levenshtein(a.key, b.key) <= 2) return 'ähnliche Schreibweise';
    // Vor- und Nachname vertauscht
    if (a.vkey === b.nkey && a.nkey === b.vkey) return 'Vor-/Nachname vertauscht';
    return '';
}

function duplicateCandidates() {
    if (data.dups) return data.dups;
    const list = data.players;
    const out = [];
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
            if (data.distinct.has(`${lo}-${hi}`)) continue;
            const reason = dupReason(a, b);
            if (reason) out.push({ a, b, reason });
        }
    }
    data.dups = out.sort((x, y) => x.a.nachname.localeCompare(y.a.nachname, 'de'));
    return data.dups;
}

// ==========================================
// ANSICHT
// ==========================================
export function initPlayersView() {
    const $ = id => document.getElementById(id);
    $('plSearch').addEventListener('input', e => { filters.search = nameKey(e.target.value); renderBody(); });
    $('plSort').addEventListener('change', e => { filters.sort = e.target.value; renderBody(); });
    $('plFilter').addEventListener('click', e => {
        const b = e.target.closest('button[data-v]');
        if (b) setMode(b.dataset.v);
    });
    $('plExport').addEventListener('click', exportExcel);
    $('plMail').addEventListener('click', mailFiltered);
    $('plInvite').addEventListener('click', () => openInvitationDialog());
    $('plRoot').addEventListener('click', onRootClick);
    initPlayerModal();
}

function setMode(mode) {
    filters.mode = mode;
    document.querySelectorAll('#plFilter button').forEach(x => x.classList.toggle('on', x.dataset.v === mode));
    renderBody();
}

export async function render() {
    const root = document.getElementById('plRoot');
    if (!data.loaded) root.innerHTML = `<div class="card empty">${icon('users')}<div>Lade Spieler…</div></div>`;
    await ensurePlayers();
    renderBody();
}

/** Turniere, die schon stattgefunden haben bzw. Teilnahmen haben – älteste zuerst */
function timelineTournaments() {
    const withEntries = new Set(data.players.flatMap(p => p.entries.map(e => String(e.tournament.id))));
    return [...state.tournaments]
        .filter(t => withEntries.has(String(t.id)))
        .sort((a, b) => tournamentTime(a) - tournamentTime(b));
}

function applyFilters() {
    const { search, mode, sort } = filters;
    const list = data.players.filter(p => {
        if (search && !`${p.key} ${nameKey(p.verein || '')} ${(p.email || '').toLowerCase()}`.includes(search)) return false;
        if (mode === 'stamm' && p.count < STAMM_MIN) return false;
        if (mode === 'titles' && !p.podiums) return false;
        return true;
    });
    const cmp = {
        name: (a, b) => a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de'),
        count: (a, b) => b.count - a.count || b.lastTime - a.lastTime,
        last: (a, b) => b.lastTime - a.lastTime || a.nachname.localeCompare(b.nachname, 'de'),
        rc: (a, b) => (b.rc || 0) - (a.rc || 0),
        titles: (a, b) => b.wins - a.wins || b.podiums - a.podiums,
    }[sort];
    return list.sort(cmp);
}

function renderBody() {
    const root = document.getElementById('plRoot');
    if (data.missing) {
        root.innerHTML = `<div class="banner warn">${icon('alert')}<div>Die Spielerdatenbank ist noch nicht eingerichtet. Einmalig im Supabase-SQL-Editor ausführen: <code>supabase/players.sql</code>. Danach werden alle Website-Nennungen automatisch übernommen.</div></div>`;
        return;
    }
    const dups = duplicateCandidates();
    const stamm = data.players.filter(p => p.count >= STAMM_MIN).length;
    const timeline = timelineTournaments();
    const latest = timeline[timeline.length - 1];
    const newcomers = latest ? data.players.filter(p => p.count === 1 && String(p.entries[0].tournament.id) === String(latest.id)).length : 0;

    const dupBtn = document.querySelector('#plFilter button[data-v="dups"]');
    dupBtn.innerHTML = `Doppelte prüfen${dups.length ? ` <span class="count">${dups.length}</span>` : ''}`;

    const tiles = `
        <div class="grid tiles" style="margin-bottom:16px;">
            ${tile('Spieler gesamt', data.players.length, `aus ${timeline.length} Turnieren`, '', 'users')}
            ${tile('Stammspieler', stamm, `mindestens ${STAMM_MIN} Turniere`, 'accent', 'star')}
            ${tile('Neu dabei', newcomers, latest ? `zum ersten Mal: ${latest.name}` : '–', '', 'userPlus')}
            ${tile('Mögliche Doppelte', dups.length, dups.length ? 'bitte prüfen' : 'alles sauber', dups.length ? 'warn' : '', 'copy', 'dups')}
        </div>`;

    if (filters.mode === 'dups') {
        root.innerHTML = tiles + dupsHtml(dups);
        return;
    }

    const list = applyFilters();
    root.innerHTML = tiles + `
        <div class="result-count">${list.length} von ${data.players.length} Spielern</div>
        <div class="table-wrap">
            <table class="table responsive players-table">
                <thead>
                    <tr>
                        <th>Spieler</th>
                        <th>Verein · RC</th>
                        <th>Teilnahmen</th>
                        <th>Erfolge</th>
                        <th>Zuletzt</th>
                        <th class="right"></th>
                    </tr>
                </thead>
                <tbody>${list.length ? list.map(p => rowHtml(p, timeline)).join('') : `<tr><td colspan="6"><div class="empty">${icon('users')}<div>${data.players.length ? 'Keine Treffer.' : 'Noch keine Spieler. Sie entstehen automatisch aus den Nennungen.'}</div></div></td></tr>`}</tbody>
            </table>
        </div>`;
}

function tile(label, value, foot, cls, ic, go = '') {
    return `
        <div class="tile ${cls}${go ? ' clickable' : ''}" ${go ? `data-go-mode="${go}" role="button" tabindex="0"` : ''}>
            <div class="label">${icon(ic)}${esc(label)}</div>
            <div class="value num">${value}</div>
            <div class="foot">${esc(foot)}</div>
        </div>`;
}

function shortName(t) {
    const year = t.date_iso ? new Date(t.date_iso).getFullYear() : '';
    return `${t.name}${year ? ' ' + year : ''}`;
}

function attendDots(p, timeline) {
    const ids = new Set(p.entries.map(e => String(e.tournament.id)));
    return `<div class="attend" aria-label="${p.count} Teilnahmen">${timeline.map(t =>
        `<span class="${ids.has(String(t.id)) ? 'on' : ''}" title="${esc(shortName(t))}"></span>`).join('')}</div>`;
}

function titleChips(p) {
    if (!p.titles.length) return '<span class="muted">–</span>';
    const n = pos => p.titles.filter(h => h.pos === pos).length;
    const chips = [];
    if (n(1)) chips.push(`<span class="chip medal gold" title="Siege">${icon('trophy')}${n(1)}×</span>`);
    if (n(2)) chips.push(`<span class="chip medal silver" title="2. Plätze">${n(2)}× 2.</span>`);
    if (n(3)) chips.push(`<span class="chip medal bronze" title="3. Plätze">${n(3)}× 3.</span>`);
    if (n('T')) chips.push(`<span class="chip" title="Trostbewerb gewonnen">${n('T')}× Trost</span>`);
    return `<div class="chips">${chips.join('')}</div>`;
}

function rowHtml(p, timeline) {
    return `
        <tr data-pid="${p.id}" class="clickable">
            <td data-label="Spieler" class="person">
                <div class="name">${esc(p.nachname)} ${esc(p.vorname)}
                    ${p.count >= STAMM_MIN ? `<span class="chip active" title="${p.count} Turniere">${icon('star')}Stamm</span>` : ''}
                    ${p.no_invites ? `<span class="chip" title="Bekommt keine Einladungen">${icon('mail')}keine Einladung</span>` : ''}
                </div>
                <div class="sub">${esc(p.email || '')}${p.telefon ? ' · ' + esc(p.telefon) : ''}</div>
            </td>
            <td data-label="Verein · RC">
                <div>${esc(p.verein || '–')}</div>
                <div class="sub muted num">RC ${p.rc ?? '–'}</div>
            </td>
            <td data-label="Teilnahmen">
                <div class="attend-wrap"><b class="num">${p.count}</b>${attendDots(p, timeline)}</div>
            </td>
            <td data-label="Erfolge">${titleChips(p)}</td>
            <td data-label="Zuletzt"><span class="small">${p.last ? esc(shortName(p.last)) : '–'}</span></td>
            <td class="right"><button class="icon-btn" data-act="edit" title="Details">${icon('edit')}</button></td>
        </tr>`;
}

function dupsHtml(dups) {
    if (!dups.length) {
        return `<div class="card empty">${icon('checkCircle')}<div>Keine möglichen Doppelten. Alles sauber!</div></div>`;
    }
    const side = p => `
        <div class="dup-side">
            <div class="name">${esc(p.vorname)} ${esc(p.nachname)}</div>
            <div class="sub">${esc(p.verein || '–')} · RC ${p.rc ?? '–'}</div>
            <div class="sub">${p.count} ${p.count === 1 ? 'Turnier' : 'Turniere'}: ${esc(p.entries.map(e => shortName(e.tournament)).join(', ') || '–')}</div>
            ${p.email ? `<div class="sub">${esc(p.email)}</div>` : ''}
        </div>`;
    return `
        <p class="muted small" style="margin-bottom:12px;">Diese Einträge könnten dieselbe Person sein (z.B. „Sammy“ und „Samuel“). Beim Zusammenführen bleibt der Name des gewählten Eintrags, alle Teilnahmen werden übernommen. Spätere Nennungen mit der anderen Schreibweise landen automatisch bei der richtigen Person.</p>
        <div class="dup-list">${dups.map(({ a, b, reason }) => `
            <div class="card dup-card" data-a="${a.id}" data-b="${b.id}">
                <div class="dup-reason"><span class="chip wl">${esc(reason)}</span></div>
                <div class="dup-pair">
                    ${side(a)}
                    <div class="dup-vs">?</div>
                    ${side(b)}
                </div>
                <div class="dup-actions">
                    <button class="btn sm" data-act="keep" data-keep="${a.id}" data-drop="${b.id}">„${esc(a.vorname)} ${esc(a.nachname)}“ behalten</button>
                    <button class="btn sm" data-act="keep" data-keep="${b.id}" data-drop="${a.id}">„${esc(b.vorname)} ${esc(b.nachname)}“ behalten</button>
                    <span class="spacer"></span>
                    <button class="btn sm ghost" data-act="distinct">Verschiedene Personen</button>
                </div>
            </div>`).join('')}
        </div>`;
}

async function onRootClick(e) {
    const goMode = e.target.closest('[data-go-mode]');
    if (goMode) return setMode(goMode.dataset.goMode);

    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('.dup-card');
    if (btn && card) {
        if (btn.dataset.act === 'keep') return merge(Number(btn.dataset.keep), Number(btn.dataset.drop), btn);
        if (btn.dataset.act === 'distinct') return markDistinct(Number(card.dataset.a), Number(card.dataset.b), btn);
        return;
    }
    const tr = e.target.closest('tr[data-pid]');
    if (tr) openPlayerModal(data.byId.get(Number(tr.dataset.pid)));
}

async function merge(keepId, dropId, btn) {
    const keep = data.byId.get(keepId), drop = data.byId.get(dropId);
    if (!keep || !drop) return;
    const ok = await confirmDialog({
        title: 'Zusammenführen?',
        message: `„${drop.fullName}“ wird in „${keep.fullName}“ übernommen (${drop.count} ${drop.count === 1 ? 'Teilnahme' : 'Teilnahmen'}). Das lässt sich nicht automatisch rückgängig machen.`,
        confirmText: 'Zusammenführen',
    });
    if (!ok) return false;
    return withBusy(btn, async () => {
        try {
            throwIfError(await supabase.rpc('nfs_merge_players', { p_keep: keepId, p_drop: dropId }));
            showToast(`${keep.fullName}: zusammengeführt`);
            await ensurePlayers(true);
            renderBody();
            return true;
        } catch (err) {
            showToast('Zusammenführen fehlgeschlagen: ' + (err.message || err), true);
            return false;
        }
    }, 'Führe zusammen…');
}

async function markDistinct(a, b, btn) {
    await withBusy(btn, async () => {
        try {
            throwIfError(await supabase.from('player_distinct').insert({ a: Math.min(a, b), b: Math.max(a, b) }));
            data.distinct.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
            data.dups = null;
            renderBody();
        } catch (err) {
            showToast('Speichern fehlgeschlagen: ' + (err.message || err), true);
        }
    });
}

// ==========================================
// DETAIL-DIALOG
// ==========================================
let current = null;

function initPlayerModal() {
    const dlg = document.getElementById('playerModal');
    dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
    document.getElementById('playerForm').addEventListener('submit', savePlayer);
    document.getElementById('pfDelete').addEventListener('click', deletePlayer);
    document.getElementById('pfMail').addEventListener('click', () => {
        if (current?.email) openMail({ to: [current.email], subject: 'NFS Trophy', body: `Hallo ${current.vorname},\n\n` });
    });
}

function openPlayerModal(p) {
    if (!p) return;
    current = p;
    const $ = id => document.getElementById(id);
    $('pfTitle').textContent = p.fullName;
    $('pfVorname').value = p.vorname || '';
    $('pfNachname').value = p.nachname || '';
    $('pfEmail').value = p.email || '';
    $('pfTelefon').value = p.telefon || '';
    $('pfVerein').value = p.verein || '';
    $('pfRc').value = p.rc ?? '';
    $('pfNotiz').value = p.notiz || '';
    $('pfMail').disabled = !p.email;
    // Einladungen (Spalten aus supabase/invitations.sql)
    $('pfInvitesWrap').hidden = !('no_invites' in p);
    $('pfInvites').checked = !p.no_invites;
    $('pfInvitesInfo').textContent = p.no_invites && p.no_invites_at
        ? `Abbestellt bzw. ausgenommen am ${new Date(p.no_invites_at).toLocaleDateString('de-AT')}`
        : (p.invited_at ? `Zuletzt eingeladen am ${new Date(p.invited_at).toLocaleDateString('de-AT')}` : '');

    const since = p.first ? new Date(p.first.date_iso).getFullYear() : null;
    $('pfSummary').innerHTML = `
        <span><b class="num">${p.count}</b> ${p.count === 1 ? 'Turnier' : 'Turniere'}</span>
        ${since ? `<span>dabei seit <b class="num">${since}</b></span>` : ''}
        ${p.wins ? `<span><b class="num">${p.wins}</b> ${p.wins === 1 ? 'Sieg' : 'Siege'}</span>` : ''}
        ${p.podiums ? `<span><b class="num">${p.podiums}</b>× am Podest</span>` : ''}`;

    $('pfHistory').innerHTML = p.entries.length ? p.entries.map(e => {
        const t = e.tournament;
        const titles = p.titles.filter(h => String(h.tournament.id) === String(t.id));
        return `
            <div class="pl-hist">
                <div class="when">
                    <div class="t">${esc(t.name)}</div>
                    <div class="muted small">${esc(t.date_text || (t.date_iso ? new Date(t.date_iso).toLocaleDateString('de-AT') : ''))}</div>
                </div>
                <div class="what">
                    <div class="chips">
                        ${e.bewerbe.map(b => `<span class="chip">${esc(b)}</span>`).join('')}
                        ${e.warteliste.map(b => `<span class="chip wl" title="nur Warteliste">${icon('hourglass')}${esc(b)}</span>`).join('')}
                        ${titles.map(h => `<span class="chip medal ${h.pos === 1 ? 'gold' : h.pos === 2 ? 'silver' : h.pos === 3 ? 'bronze' : ''}">${icon('trophy')}${esc(POS_LABEL[h.pos])} · ${esc(h.bewerb)}</span>`).join('')}
                    </div>
                    <div class="muted small">${esc(e.verein || '')}${e.rc ? ` · RC ${e.rc}` : ''}${e.source === 'import' ? ' · aus alter Nennliste' : ''}</div>
                </div>
            </div>`;
    }).join('') : '<div class="muted small">Keine Teilnahmen.</div>';

    $('playerModal').showModal();
}

async function savePlayer(e) {
    e.preventDefault();
    if (!current) return;
    const v = id => document.getElementById(id).value.trim();
    if (!v('pfVorname') || !v('pfNachname')) return showToast('Bitte Vor- und Nachname eingeben.', true);
    const rc = parseInt(v('pfRc'), 10);
    const patch = {
        vorname: v('pfVorname'), nachname: v('pfNachname'),
        email: v('pfEmail') || null, telefon: v('pfTelefon') || null,
        verein: v('pfVerein') || null, rc: Number.isFinite(rc) ? rc : null,
        notiz: v('pfNotiz') || null,
    };
    if ('no_invites' in current) {
        const noInvites = !document.getElementById('pfInvites').checked;
        if (noInvites !== !!current.no_invites) {
            patch.no_invites = noInvites;
            patch.no_invites_at = noInvites ? new Date().toISOString() : null;
        }
    }
    await withBusy(document.getElementById('pfSave'), async () => {
        try {
            throwIfError(await supabase.from('players').update(patch).eq('id', current.id));
            showToast('Gespeichert');
            document.getElementById('playerModal').close();
            await ensurePlayers(true);
            renderBody();
        } catch (err) {
            showToast('Speichern fehlgeschlagen: ' + (err.message || err), true);
        }
    });
}

async function deletePlayer() {
    if (!current) return;
    const p = current;
    const fromWebsite = p.entries.some(e => e.registration_id);
    const ok = await confirmDialog({
        title: 'Spieler löschen?',
        message: `${p.fullName} wird mit ${p.count} ${p.count === 1 ? 'Teilnahme' : 'Teilnahmen'} aus der Spielerdatenbank gelöscht (z.B. auf Wunsch nach DSGVO).${fromWebsite ? ' Nennungen bleiben in den Turnieren erhalten – ändert jemand eine davon, legt sie die Person wieder an.' : ''}`,
        confirmText: 'Löschen',
        danger: true,
    });
    if (!ok) return;
    try {
        throwIfError(await supabase.from('players').delete().eq('id', p.id));
        showToast('Spieler gelöscht');
        document.getElementById('playerModal').close();
        await ensurePlayers(true);
        renderBody();
    } catch (err) {
        showToast('Löschen fehlgeschlagen: ' + (err.message || err), true);
    }
}

// ==========================================
// AUTOVERVOLLSTÄNDIGUNG (Nennung anlegen)
// ==========================================
/** Bis zu `limit` Spieler, deren Name zu den Eingaben passt */
export function searchPlayers(vorname, nachname, limit = 5) {
    const q = nameKey(vorname, nachname);
    if (q.length < 2) return [];
    const words = q.split(' ');
    return data.players
        .filter(p => words.every(w => p.key.split(' ').some(k => k.startsWith(w))))
        .sort((a, b) => b.lastTime - a.lastTime || b.count - a.count)
        .slice(0, limit);
}

// ==========================================
// EXPORT & MAIL
// ==========================================
function currentList() {
    return filters.mode === 'dups' ? data.players : applyFilters();
}

async function exportExcel() {
    try {
        const XLSX = await import('xlsx');
        const timeline = timelineTournaments();
        const rows = [['Nachname', 'Vorname', 'Verein', 'RC', 'E-Mail', 'Telefon', 'Turniere', 'Siege', 'Podestplätze', ...timeline.map(shortName), 'Notiz']];
        currentList().forEach(p => {
            const ids = new Set(p.entries.map(e => String(e.tournament.id)));
            rows.push([p.nachname, p.vorname, p.verein || '', p.rc ?? '', p.email || '', p.telefon || '', p.count, p.wins, p.podiums,
                ...timeline.map(t => (ids.has(String(t.id)) ? 'x' : '')), p.notiz || '']);
        });
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = rows[0].map((h, i) => ({ wch: i < 2 ? 16 : i === 4 ? 26 : Math.max(6, Math.min(18, String(h).length + 2)) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Spieler');
        XLSX.writeFile(wb, `Spieler_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('Excel-Datei erstellt');
    } catch (err) {
        console.error(err);
        showToast('Excel-Export fehlgeschlagen.', true);
    }
}

function mailFiltered() {
    const emails = [...new Set(currentList().map(p => (p.email || '').trim()).filter(Boolean))];
    if (!emails.length) return showToast('Keine E-Mail-Adressen in der aktuellen Ansicht.', true);
    openMail({
        bcc: emails,
        subject: 'NFS Trophy',
        note: 'Für die Einladung zum neuen Turnier besser „Einladung versenden“ nutzen – mit Nenn-Knopf und Abbestell-Link.',
    });
}
