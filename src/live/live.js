// src/live/live.js
// Live-Ticker der NFS Trophy (Daten aus Supabase-Projekt B = Turnier-Software)

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL_B, SUPABASE_ANON_KEY_B } from '/config.js';
import { esc } from '../shared/utils.js';
import { calculateRanking } from './ranking.js';
import { computeStats } from './stats.js';
import { formatDuration, formatDurationSeconds } from './format.js';

const supabase = createClient(SUPABASE_URL_B, SUPABASE_ANON_KEY_B);
const $ = id => document.getElementById(id);

const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* privater Modus */ } },
};

const TABS = ['live', 'table', 'player', 'queue', 'pots', 'stats', 'system'];
// Links wie live.html?tab=table&bewerb=Offene%20Klasse öffnen direkt die passende Ansicht (z.B. für QR-Codes)
const params = new URLSearchParams(location.search);
const startTab = [params.get('tab'), store.get('live-tab')].find(t => TABS.includes(t)) || 'live';

const state = {
    players: [],
    matches: [],
    bewerbe: [],
    selectedBewerb: params.get('bewerb') || store.get('last_bewerb') || '',
    tab: startTab,
    favoriteId: params.get('fav') || store.get('live-fav') || null,
    tournamentName: 'NFS Trophy',
    loading: false,
    loadedOnce: false,
    lastUpdate: null,
    realtime: false,
    error: null,
};

// ==========================================
// HILFSFUNKTIONEN
// ==========================================
const sameId = (a, b) => String(a) === String(b);
const playerById = id => state.players.find(p => sameId(p.id, id));
const bewerbeOf = p => (p?.bewerbe || '').split(',').map(b => b.trim()).filter(Boolean);
const playersIn = b => state.players.filter(p => bewerbeOf(p).includes(b));
const matchesIn = b => state.matches.filter(m => m.bewerb === b);
const isFavMatch = m => state.favoriteId && (sameId(m.player1_id, state.favoriteId) || sameId(m.player2_id, state.favoriteId));
const favPlayer = () => (state.favoriteId ? playerById(state.favoriteId) : null);

function toast(msg, isError = false) {
    const el = document.createElement('div');
    el.className = `toast ${isError ? 'error' : ''}`;
    el.textContent = msg;
    $('toastContainer').appendChild(el);
    setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, 3500);
}

function empty(text, emoji = '🏓') {
    return `<div class="empty"><div class="big">${emoji}</div>${esc(text)}</div>`;
}

/** Satzergebnisse aus Sicht eines Spielers (bei Spieler 2 gespiegelt) */
function setsFor(m, asP1) {
    if (!m.set_details || m.set_details === '-') return '';
    return m.set_details.split(',').map(s => {
        const [a, b] = s.trim().split(':');
        return asP1 ? `${a}:${b}` : `${b}:${a}`;
    }).join(' · ');
}

// ==========================================
// DATEN LADEN
// ==========================================
async function loadData({ silent = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (!silent) setStatus();
    try {
        const [playersRes, settingsRes, matchesRes] = await Promise.all([
            supabase.from('players').select('*').eq('is_present', true).order('name'),
            supabase.from('settings').select('*'),
            supabase.from('matches').select('*'),
        ]);
        if (playersRes.error) throw playersRes.error;
        if (settingsRes.error) throw settingsRes.error;

        state.players = playersRes.data || [];
        const settings = settingsRes.data || [];
        state.tournamentName = settings.find(s => s.key === 'meta_name')?.value || 'NFS Trophy';

        const names = new Set();
        state.players.forEach(p => bewerbeOf(p).forEach(b => names.add(b)));
        state.bewerbe = [...names];
        if (!state.bewerbe.includes(state.selectedBewerb)) state.selectedBewerb = state.bewerbe[0] || '';

        if (matchesRes.error) {
            console.warn('Matches konnten nicht geladen werden:', matchesRes.error);
            state.matches = [];
        } else {
            state.matches = (matchesRes.data || []).map(m => {
                const p1 = playerById(m.player1_id);
                const p2 = playerById(m.player2_id);
                return {
                    ...m,
                    player1_name: p1 ? p1.name : 'Unbekannt',
                    player2_name: p2 ? p2.name : 'Unbekannt',
                    player1_rc: p1 ? p1.rc_points : 0,
                    player2_rc: p2 ? p2.rc_points : 0,
                    player1_club: p1 ? p1.club_short : '',
                    player2_club: p2 ? p2.club_short : '',
                };
            });
        }

        state.error = null;
        state.loadedOnce = true;
        state.lastUpdate = new Date();
        renderAll();
    } catch (err) {
        console.error('Fehler beim Laden:', err);
        state.error = err.message || String(err);
        if (!state.loadedOnce) renderError();
        else if (!silent) toast('Aktualisierung fehlgeschlagen', true);
    } finally {
        state.loading = false;
        setStatus();
    }
}

// ==========================================
// ECHTZEIT + FALLBACK-POLLING
// ==========================================
let reloadTimer = null;
function scheduleReload() {
    clearTimeout(reloadTimer);
    // mehrere Änderungen kurz hintereinander (z.B. Ergebnis + nächstes Spiel) zusammenfassen
    reloadTimer = setTimeout(() => loadData({ silent: true }), 400);
}

function initRealtime() {
    try {
        supabase
            .channel('live-ticker')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, scheduleReload)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, scheduleReload)
            .subscribe(status => {
                state.realtime = status === 'SUBSCRIBED';
                setStatus();
            });
    } catch (err) {
        console.warn('Echtzeit nicht verfügbar, nutze Polling:', err);
        state.realtime = false;
    }
}

// Mit Echtzeit nur selten zur Sicherheit nachladen, sonst alle 20 s
setInterval(() => {
    if (document.hidden) return;
    const age = state.lastUpdate ? Date.now() - state.lastUpdate.getTime() : Infinity;
    if (age > (state.realtime ? 120000 : 20000)) loadData({ silent: true });
}, 5000);

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!state.lastUpdate || Date.now() - state.lastUpdate.getTime() > 15000)) loadData({ silent: true });
});

function setStatus() {
    const dot = $('statusDot');
    const text = $('statusText');
    const time = state.lastUpdate ? state.lastUpdate.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) : '';
    if (state.loading && !state.loadedOnce) {
        dot.className = 'dot loading'; text.textContent = 'Lade…';
    } else if (state.error) {
        dot.className = 'dot offline'; text.textContent = 'Offline';
    } else if (state.realtime) {
        dot.className = 'dot live'; text.textContent = 'Live';
    } else {
        dot.className = 'dot poll'; text.textContent = time ? `Stand ${time}` : 'Verbinde…';
    }
    $('lastUpdate').textContent = state.lastUpdate
        ? `Stand: ${state.lastUpdate.toLocaleTimeString('de-AT')}${state.realtime ? ' · Echtzeit aktiv' : ''}`
        : '';
}

// ==========================================
// RENDERN
// ==========================================
function renderAll() {
    $('tournamentName').textContent = state.tournamentName;
    document.title = `Live · ${state.tournamentName}`;
    renderChips();
    renderTabs();
    renderFavBanner();
    renderTab();
}

function renderTab() {
    ({
        live: renderLive,
        table: renderTable,
        player: renderPlayer,
        queue: renderQueue,
        pots: renderPots,
        stats: renderStats,
        system: renderSystem,
    })[state.tab]();
}

function renderError() {
    const panel = $(`tab-${state.tab}`);
    const target = state.tab === 'table' ? $('tableContainer') : state.tab === 'player' ? $('playerContainer') : panel;
    target.innerHTML = `<div class="empty"><div class="big">📡</div>
        Die Live-Daten sind gerade nicht erreichbar.<br><span class="muted">Wir versuchen es automatisch weiter.</span></div>`;
}

function renderChips() {
    const box = $('bewerbChips');
    box.hidden = state.bewerbe.length <= 1 || state.tab === 'live' || state.tab === 'system' || state.tab === 'player';
    box.innerHTML = state.bewerbe.map(b => `
        <button role="tab" aria-selected="${b === state.selectedBewerb}" data-bewerb="${esc(b)}">
            ${esc(b)}<span class="cnt">${playersIn(b).length}</span>
        </button>`).join('');
}

function renderTabs() {
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    TABS.forEach(t => { $(`tab-${t}`).hidden = t !== state.tab; });
}

/** Banner oben: Was macht mein Favorit gerade? */
function renderFavBanner() {
    const box = $('favBanner');
    const p = favPlayer();
    if (!p || state.tab === 'player') { box.innerHTML = ''; return; }
    const st = playerStatus(p.id);
    box.innerHTML = `
        <button class="fav-banner" data-goto-player>
            <span class="star">★</span>
            <span class="body">
                <span class="who">${esc(p.name)}</span>
                <span class="what">${esc(st.text)}</span>
            </span>
            <span class="muted">›</span>
        </button>`;
}

/** Aktueller Status eines Spielers über alle Bewerbe */
function playerStatus(id) {
    const own = state.matches.filter(m => !m.is_played && (sameId(m.player1_id, id) || sameId(m.player2_id, id)));
    const opp = m => (sameId(m.player1_id, id) ? m.player2_name : m.player1_name);
    const running = own.find(m => m.table_number != null);
    if (running) return { kind: 'run', text: `Spielt gerade auf Tisch ${running.table_number} gegen ${opp(running)}`, short: `gegen ${opp(running)} · ${running.bewerb}`, match: running };
    const queued = own.filter(m => m.queue_pos != null).sort((a, b) => a.queue_pos - b.queue_pos)[0];
    if (queued) return { kind: 'queue', text: `Warteschlange Platz ${queued.queue_pos} · ${queued.bewerb} gegen ${opp(queued)}`, short: `gegen ${opp(queued)} · ${queued.bewerb}`, match: queued };
    if (own.length) return { kind: 'open', text: `Nächstes Spiel noch nicht angesetzt (${own.length} offen)` };
    return { kind: 'idle', text: 'Aktuell keine offenen Spiele' };
}

// ---------- LIVE ----------
function renderLive() {
    const panel = $('tab-live');
    if (!state.loadedOnce) { panel.innerHTML = empty('Lade Live-Daten…', '⏳'); return; }

    // Tische sind für alle Bewerbe gemeinsam → alle laufenden Spiele zeigen
    const running = state.matches.filter(m => !m.is_played && m.table_number != null);
    const maxTable = Math.max(5, ...running.map(m => Number(m.table_number) || 0));

    let html = `<div class="section-title"><span>Tische</span><span>${running.length} laufen</span></div><div class="tables">`;
    for (let t = 1; t <= maxTable; t++) {
        const m = running.find(x => Number(x.table_number) === t);
        if (!m) {
            html += `<div class="card tcard free"><div class="tnr">Tisch ${t}</div><div>frei</div></div>`;
            continue;
        }
        const fav = isFavMatch(m);
        const multi = state.bewerbe.length > 1;
        html += `
            <div class="card tcard ${fav ? 'is-fav' : ''}">
                <div class="thead">
                    <span class="tnr">Tisch ${t}${m.round_name ? `<small>${esc(m.round_name)}</small>` : ''}</span>
                    ${m.start_time ? `<span class="timer num" data-since="${esc(m.start_time)}">${formatDuration(m.start_time)}</span>` : '<span class="badge open">startet</span>'}
                </div>
                <div class="vs">
                    <div class="pl"><span>${sameId(m.player1_id, state.favoriteId) ? '<span class="fav-mark">★</span> ' : ''}${esc(m.player1_name)}</span><span class="club">${esc(m.player1_club || '')}</span></div>
                    <div class="pl"><span>${sameId(m.player2_id, state.favoriteId) ? '<span class="fav-mark">★</span> ' : ''}${esc(m.player2_name)}</span><span class="club">${esc(m.player2_club || '')}</span></div>
                </div>
                ${multi ? `<div><span class="bewerb-tag">${esc(m.bewerb)}</span></div>` : ''}
            </div>`;
    }
    html += '</div>';

    // Als nächstes (alle Bewerbe, nach Warteschlangen-Position)
    const queued = state.matches.filter(m => !m.is_played && m.table_number == null && m.queue_pos != null)
        .sort((a, b) => (a.queue_pos - b.queue_pos) || String(a.bewerb).localeCompare(String(b.bewerb)))
        .slice(0, 5);
    if (queued.length) {
        html += `<div class="section-title"><span>Als nächstes</span></div><div class="card list">` +
            queued.map(m => `
                <div class="list-row ${isFavMatch(m) ? 'is-fav' : ''}">
                    <span class="lead num">${m.queue_pos}</span>
                    <div class="players">
                        <div class="p">${esc(m.player1_name)} – ${esc(m.player2_name)}</div>
                        <div class="meta">${esc(m.bewerb)}${m.round_name ? ' · ' + esc(m.round_name) : ''}</div>
                    </div>
                    <span></span>
                </div>`).join('') + '</div>';
    }

    // Zuletzt beendet
    const recent = state.matches.filter(m => m.is_played)
        .sort((a, b) => new Date(b.end_time || 0) - new Date(a.end_time || 0))
        .slice(0, 8);
    if (recent.length) {
        html += `<div class="section-title"><span>Zuletzt beendet</span></div><div class="card list">` +
            recent.map(m => {
                const p1won = (m.sets_p1 || 0) > (m.sets_p2 || 0);
                return `
                <div class="list-row ${isFavMatch(m) ? 'is-fav' : ''}">
                    <span class="lead">✓</span>
                    <div class="players">
                        <div class="p ${p1won ? 'win' : 'lose'}">${esc(m.player1_name)}</div>
                        <div class="p ${p1won ? 'lose' : 'win'}">${esc(m.player2_name)}</div>
                        <div class="meta">${esc(m.bewerb)}${m.round_name ? ' · ' + esc(m.round_name) : ''}${m.set_details && m.set_details !== '-' ? ' · ' + esc(setsFor(m, true)) : ''}</div>
                    </div>
                    <span class="score num">${m.sets_p1 || 0}:${m.sets_p2 || 0}${m.end_time ? `<small>${new Date(m.end_time).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}</small>` : ''}</span>
                </div>`;
            }).join('') + '</div>';
    }

    if (!running.length && !queued.length && !recent.length) html = empty('Noch keine Spiele angesetzt.');
    panel.innerHTML = html;
}

// Laufzeiten jede Sekunde aktualisieren, ohne alles neu zu zeichnen
setInterval(() => {
    document.querySelectorAll('[data-since]').forEach(el => { el.textContent = formatDuration(el.dataset.since); });
}, 1000);

// ---------- TABELLE ----------
function renderTable() {
    const box = $('tableContainer');
    const b = state.selectedBewerb;
    if (!state.loadedOnce) { box.innerHTML = empty('Lade Tabelle…', '⏳'); return; }
    if (!b) { box.innerHTML = empty('Noch keine Bewerbe.'); return; }
    const players = playersIn(b);
    if (!players.length) { box.innerHTML = empty('Noch keine Spieler in diesem Bewerb.'); return; }

    const ranking = calculateRanking(players, matchesIn(b));
    const q = $('tableSearch').value.toLowerCase().trim();
    const rows = q ? ranking.filter(p => p.name.toLowerCase().includes(q) || (p.verein || '').toLowerCase().includes(q)) : ranking;
    if (!rows.length) { box.innerHTML = empty('Kein Treffer.', '🔍'); return; }

    const medal = r => r === 1 ? '<span class="medal g">1</span>' : r === 2 ? '<span class="medal s">2</span>' : r === 3 ? '<span class="medal b">3</span>' : r;
    box.innerHTML = `
        <div class="card table-wrap">
            <table class="rank-table">
                <thead><tr>
                    <th class="rk">#</th><th class="l">Spieler</th>
                    <th title="Spiele">Sp</th><th title="Siege">S</th><th title="Satzverhältnis">Sätze</th><th class="hide-xs" title="Ballverhältnis">Bälle</th>
                </tr></thead>
                <tbody>
                    ${rows.map(p => {
                        const rank = ranking.indexOf(p) + 1;
                        const st = p.stats;
                        return `
                        <tr class="${sameId(p.id, state.favoriteId) ? 'is-fav' : ''}" data-player="${esc(p.id)}">
                            <td class="rk">${medal(rank)}</td>
                            <td class="l nm">${sameId(p.id, state.favoriteId) ? '<span class="fav-mark">★</span> ' : ''}${esc(p.name)}${st.tie_symbol ? `<span class="tie" title="Platzierung durch direkten Vergleich">${st.tie_symbol}</span>` : ''}<span class="club">${esc(p.verein || '')}${p.rc ? ' · ' + esc(p.rc) + ' RC' : ''}</span></td>
                            <td>${st.matches}</td>
                            <td class="w">${st.wins}</td>
                            <td>${st.sets_won}:${st.sets_lost}</td>
                            <td class="hide-xs">${st.balls_won}:${st.balls_lost}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <p class="legend">⚔️ = Platzierung durch direkten Vergleich (Minitabelle). Tippe auf einen Spieler für seinen Spielplan.</p>`;
}

// ---------- SPIELER ----------
function renderPlayer() {
    renderSuggest();
    const box = $('playerContainer');
    const p = favPlayer();
    if (!state.loadedOnce) { box.innerHTML = empty('Lade…', '⏳'); return; }
    if (!p) {
        box.innerHTML = empty('Such oben deinen Namen – dann siehst du hier dein nächstes Spiel, deine Ergebnisse und deinen Tabellenplatz.', '🔍');
        return;
    }

    const st = playerStatus(p.id);
    const nextCls = st.kind === 'run' ? '' : st.kind === 'queue' ? 'wait' : 'idle';
    const nextBig = st.kind === 'run' ? `T${st.match.table_number}` : st.kind === 'queue' ? `#${st.match.queue_pos}` : '–';
    const nextLabel = st.kind === 'run' ? `Spielt jetzt auf Tisch ${st.match.table_number}` : st.kind === 'queue' ? `Warteschlange Platz ${st.match.queue_pos}` : 'Nächstes Spiel';

    let html = `
        <div class="card player-hero">
            <div class="ph-top">
                <div>
                    <h2>${esc(p.name)}</h2>
                    <div class="ph-meta">${esc(p.club_short || '')}${p.rc_points ? ' · ' + esc(p.rc_points) + ' RC' : ''}</div>
                </div>
                <div class="ph-actions">
                    <button data-share title="Link teilen">Teilen</button>
                    <button data-unfav class="on" title="Favorit entfernen">★</button>
                </div>
            </div>
            <div class="next-up ${nextCls}">
                <div class="big num">${nextBig}</div>
                <div>
                    <div class="k">${nextLabel}</div>
                    <div class="v">${esc(st.short || st.text)}</div>
                </div>
            </div>
        </div>`;

    bewerbeOf(p).forEach(b => {
        const ranking = calculateRanking(playersIn(b), matchesIn(b));
        const me = ranking.find(x => sameId(x.id, p.id));
        const rank = me ? ranking.indexOf(me) + 1 : '–';
        const s = me?.stats || { matches: 0, wins: 0, sets_won: 0, sets_lost: 0 };
        const mine = matchesIn(b).filter(m => sameId(m.player1_id, p.id) || sameId(m.player2_id, p.id));

        let pot = '';
        try {
            const potNr = p.pot_data ? JSON.parse(p.pot_data)[b] : null;
            const seed = p.seed_data ? JSON.parse(p.seed_data)[b] : null;
            if (potNr) pot = `Topf ${potNr}${seed ? ` · Setzung ${seed}` : ''}`;
        } catch { /* ungültige Daten ignorieren */ }

        html += `
            <div class="bw-block">
                <div class="bw-block-head"><h3>${esc(b)}</h3><span class="muted">${esc(pot)}</span></div>
                <div class="kpis">
                    <div class="kpi"><div class="k">Rang</div><div class="v num">${rank}<span class="muted" style="font-size:13px;">/${ranking.length}</span></div></div>
                    <div class="kpi"><div class="k">Siege</div><div class="v num">${s.wins}</div></div>
                    <div class="kpi"><div class="k">Niederl.</div><div class="v num">${s.matches - s.wins}</div></div>
                    <div class="kpi"><div class="k">Sätze</div><div class="v num">${s.sets_won}:${s.sets_lost}</div></div>
                </div>
                <div class="card list" style="margin-top:10px;">
                    ${mine.length ? mine.map(m => matchRow(m, p.id)).join('') : '<div class="empty">Noch keine Spiele angesetzt.</div>'}
                </div>
            </div>`;
    });

    box.innerHTML = html;
}

function matchRow(m, pid) {
    const asP1 = sameId(m.player1_id, pid);
    const opp = asP1 ? m.player2_name : m.player1_name;
    const oppClub = asP1 ? m.player2_club : m.player1_club;
    const mySets = asP1 ? m.sets_p1 : m.sets_p2;
    const oppSets = asP1 ? m.sets_p2 : m.sets_p1;
    let badge;
    if (m.is_played) badge = (mySets || 0) > (oppSets || 0) ? '<span class="badge win">Sieg</span>' : '<span class="badge loss">Niederlage</span>';
    else if (m.table_number != null) badge = `<span class="badge run">Tisch ${esc(m.table_number)}</span>`;
    else if (m.queue_pos != null) badge = `<span class="badge queue">Wartet #${esc(m.queue_pos)}</span>`;
    else badge = '<span class="badge open">offen</span>';
    return `
        <div class="match">
            <div>
                <div class="round">${esc(m.round_name || '')}</div>
                <div class="opp">gegen ${esc(opp)} <span class="muted" style="font-weight:500; font-size:12px;">${esc(oppClub || '')}</span></div>
                ${m.is_played && setsFor(m, asP1) ? `<div class="sets num">${esc(setsFor(m, asP1))}</div>` : ''}
            </div>
            <div class="res">
                ${m.is_played ? `<span class="sc num">${mySets || 0}:${oppSets || 0}</span>` : ''}
                ${badge}
            </div>
        </div>`;
}

function renderSuggest() {
    const box = $('playerSuggest');
    const q = $('playerSearch').value.toLowerCase().trim();
    if (!q) { box.innerHTML = ''; return; }
    const hits = state.players.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = hits.length
        ? hits.map(p => `
            <button data-player="${esc(p.id)}">
                <span><span class="s-name">${esc(p.name)}</span><br><span class="s-meta">${esc(p.club_short || '')} · ${esc(bewerbeOf(p).join(', '))}</span></span>
                <span class="muted">›</span>
            </button>`).join('')
        : '<div class="muted" style="padding:6px 2px;">Kein Spieler gefunden.</div>';
}

function selectPlayer(id) {
    state.favoriteId = String(id);
    store.set('live-fav', state.favoriteId);
    const url = new URL(location.href);
    url.searchParams.set('fav', state.favoriteId);
    history.replaceState({}, '', url);
    $('playerSearch').value = '';
    switchTab('player');
}

function clearFavorite() {
    state.favoriteId = null;
    store.set('live-fav', null);
    const url = new URL(location.href);
    url.searchParams.delete('fav');
    history.replaceState({}, '', url);
    renderAll();
}

async function sharePlayer() {
    const p = favPlayer();
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('fav', p.id);
    const data = { title: `${p.name} · ${state.tournamentName}`, text: `Live-Spielplan von ${p.name}`, url: url.toString() };
    try {
        if (navigator.share) await navigator.share(data);
        else {
            await navigator.clipboard.writeText(data.url);
            toast('Link kopiert');
        }
    } catch { /* Teilen abgebrochen */ }
}

// ---------- WARTESCHLANGE ----------
function renderQueue() {
    const panel = $('tab-queue');
    const b = state.selectedBewerb;
    if (!state.loadedOnce) { panel.innerHTML = empty('Lade…', '⏳'); return; }
    const queued = matchesIn(b).filter(m => !m.is_played && m.queue_pos != null)
        .sort((a, c) => (a.queue_pos || 999) - (c.queue_pos || 999));
    if (!queued.length) { panel.innerHTML = empty('Die Warteschlange ist gerade leer.', '✨'); return; }
    panel.innerHTML = `<div class="card list">` + queued.map(m => `
        <div class="list-row ${isFavMatch(m) ? 'is-fav' : ''}">
            <span class="lead num">${esc(m.queue_pos)}</span>
            <div class="players">
                <div class="p">${esc(m.player1_name)} – ${esc(m.player2_name)}</div>
                <div class="meta">${esc(m.round_name || '')}</div>
            </div>
            ${isFavMatch(m) ? '<span class="fav-mark">★</span>' : '<span></span>'}
        </div>`).join('') + '</div>';
}

// ---------- TÖPFE ----------
function renderPots() {
    const panel = $('tab-pots');
    const b = state.selectedBewerb;
    if (!state.loadedOnce) { panel.innerHTML = empty('Lade…', '⏳'); return; }
    const players = playersIn(b);
    if (players.length < 8) {
        panel.innerHTML = empty(`Für die Topf-Einteilung werden mindestens 8 Spieler benötigt (aktuell ${players.length}).`, '🏺');
        return;
    }
    // Einteilung wie bisher: nach RC sortiert, 4 gleich große Töpfe (Rest in Topf 4)
    const sorted = [...players].sort((a, c) => (c.rc_points || 0) - (a.rc_points || 0));
    const potSize = Math.floor(sorted.length / 4);
    const pots = { 1: [], 2: [], 3: [], 4: [] };
    sorted.forEach((p, i) => {
        const seed = i + 1;
        const nr = seed <= potSize ? 1 : seed <= 2 * potSize ? 2 : seed <= 3 * potSize ? 3 : 4;
        pots[nr].push({ ...p, seed });
    });
    panel.innerHTML = `<div class="pots">` + [1, 2, 3, 4].map(i => `
        <div class="card pot">
            <h3>Topf ${i}<small>Setzung ${(i - 1) * potSize + 1}–${i < 4 ? i * potSize : sorted.length}</small></h3>
            ${pots[i].map(p => `
                <div class="row ${sameId(p.id, state.favoriteId) ? 'is-fav' : ''}">
                    <span class="sd">#${p.seed}</span>
                    <span>${sameId(p.id, state.favoriteId) ? '<span class="fav-mark">★</span> ' : ''}${esc(p.name)}</span>
                    <span class="muted num">${esc(p.rc_points || '?')}</span>
                </div>`).join('')}
        </div>`).join('') + '</div>';
}

// ---------- STATISTIK ----------
function renderStats() {
    const panel = $('tab-stats');
    const b = state.selectedBewerb;
    if (!state.loadedOnce) { panel.innerHTML = empty('Lade…', '⏳'); return; }
    const played = matchesIn(b).filter(m => m.is_played);
    if (!played.length) { panel.innerHTML = empty('Noch keine beendeten Spiele für Statistiken.', '📊'); return; }

    const s = computeStats(played, state);
    const tile = (k, v) => `<div class="card stat-tile"><div class="k">${k}</div><div class="v num">${v}</div></div>`;
    const list = (title, items, fmt, emptyText = 'Noch keine Daten') => `
        <div class="card top-list">
            <h4>${title}</h4>
            ${items.length ? `<ol>${items.map((it, i) => `<li><span class="n"><b>${i + 1}.</b>${fmt.name(it)}</span><span class="val">${fmt.val(it)}</span></li>`).join('')}</ol>` : `<div class="empty">${emptyText}</div>`}
        </div>`;
    const byName = { name: it => esc(it.name) };
    const match = { name: d => `${esc(d.p1)} – ${esc(d.p2)}`, val: d => formatDurationSeconds(d.sec) };

    panel.innerHTML = `
        <div class="stat-tiles">
            ${tile('Beendete Spiele', played.length)}
            ${tile('Gespielte Sätze', s.totalSets)}
            ${tile('Gespielte Bälle', s.totalBalls.toLocaleString('de-AT'))}
            ${tile('Ø Spieldauer', formatDurationSeconds(s.avgDuration))}
            ${tile('3:0-Siege', s.count30)}
            ${tile('3:1-Siege', s.count31)}
            ${tile('5-Satz-Krimis', s.count32)}
            ${tile('Nach 0:2 gewonnen', s.countReverseSweeps)}
            ${tile('11:0-Sätze', s.countDonut)}
            ${tile('Teilnehmer', playersIn(b).length)}
        </div>
        ${s.biggestUpset ? `
        <div class="card upset">
            <div class="k">😱 Größte Überraschung</div>
            <div class="v">${esc(s.biggestUpset.winner)} (${s.biggestUpset.wRc} RC) schlägt ${esc(s.biggestUpset.loser)} (${s.biggestUpset.lRc} RC) mit ${s.biggestUpset.score}
                <span class="muted"> · ${s.biggestUpset.diff} RC Unterschied</span></div>
        </div>` : ''}
        <div class="top-lists">
            ${list('🏆 Meiste Siege', s.topWins, { ...byName, val: it => it.wins })}
            ${list('💪 Meiste 3:0-Siege', s.topSweeps, { ...byName, val: it => it.count })}
            ${list('🎯 Meiste 5-Satz-Spiele', s.topFiveSets, { ...byName, val: it => it.count })}
            ${list('🍩 Meiste 11:0-Sätze', s.topDonuts, { ...byName, val: it => it.count }, 'Keine 11:0-Sätze')}
            ${list('🐢 Längste Spiele', s.longest5, match)}
            ${list('⚡ Kürzeste Spiele', s.shortest5, match)}
            ${list('🏃 Schnellste Spieler (Ø)', s.fastest, { ...byName, val: it => formatDurationSeconds(it.avg) })}
            ${list('🐌 Langsamste Spieler (Ø)', s.slowest, { ...byName, val: it => formatDurationSeconds(it.avg) })}
            ${list('🔢 Häufigste Satzergebnisse', s.topSetScores, { name: ([score]) => esc(score), val: ([, c]) => `${c}×` })}
        </div>`;
}

// ---------- SYSTEM ----------
function renderSystem() {
    $('tab-system').innerHTML = `
        <div class="card system">
            <h3>🏓 Das Turniersystem</h3>
            <p>Gespielt wird nach dem <strong>Champions-League-System</strong> (einem angepassten Schweizer System).</p>
            <p>Das Teilnehmerfeld wird nach RC-Punkten in <strong>4 gleich große Töpfe</strong> eingeteilt. Jeder Spieler bestreitet genau <strong>4 Spiele</strong> – und trifft dabei auf je einen Gegner aus jedem Topf. So ist die Spielstärke der Gegner für alle ausgeglichen.</p>
            <hr>
            <h3>📋 Reihung in der Tabelle</h3>
            <p>Bei gleich vielen Siegen entscheidet der Reihe nach:</p>
            <ol>
                <li><span class="hl">Siege</span> – Anzahl gewonnener Spiele.</li>
                <li><span class="hl">Direkter Vergleich (Minitabelle)</span> – nur wenn <strong>alle</strong> Spieler einer gleichauf liegenden Gruppe gegeneinander gespielt haben. Wer so vorgereiht wird, ist in der Tabelle mit ⚔️ markiert. Die Minitabelle wird selbst wieder nach Siegen, Sätzen, Bällen und RC aufgelöst.</li>
                <li><span class="hl">Satzverhältnis</span> – gewonnene zu verlorenen Sätzen.</li>
                <li><span class="hl">Ballverhältnis</span> – gewonnene zu verlorenen Punkten.</li>
                <li><span class="hl">RC-Wertung</span> – bei weiterhin Gleichstand wird der Spieler mit <strong>niedrigerem</strong> RC vorgereiht.</li>
            </ol>
            <p class="note">💡 Der direkte Vergleich wird auf jeder Stufe (Siege, Sätze, Bälle, RC) geprüft – unabhängig von der Gruppengröße.</p>
        </div>`;
}

// ==========================================
// EVENTS
// ==========================================
function switchTab(tab) {
    state.tab = tab;
    store.set('live-tab', tab);
    renderAll();
    window.scrollTo({ top: 0 });
}

$('tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) switchTab(b.dataset.tab);
});

$('bewerbChips').addEventListener('click', e => {
    const b = e.target.closest('button[data-bewerb]');
    if (!b) return;
    state.selectedBewerb = b.dataset.bewerb;
    store.set('last_bewerb', state.selectedBewerb);
    renderAll();
});

document.addEventListener('click', e => {
    const pl = e.target.closest('[data-player]');
    if (pl) return selectPlayer(pl.dataset.player);
    if (e.target.closest('[data-goto-player]')) return switchTab('player');
    if (e.target.closest('[data-unfav]')) return clearFavorite();
    if (e.target.closest('[data-share]')) return sharePlayer();
});

$('tableSearch').addEventListener('input', renderTable);
$('playerSearch').addEventListener('input', renderSuggest);
$('playerSearch').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const first = $('playerSuggest').querySelector('[data-player]');
    if (first) selectPlayer(first.dataset.player);
});

$('statusBtn').addEventListener('click', async () => {
    await loadData();
    if (!state.error) toast('Aktualisiert');
});

// ---------- THEME ----------
const SUN = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const MOON = '<svg class="icon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('themeToggle').innerHTML = t === 'light' ? MOON : SUN;
}
applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
$('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    store.set('theme', next);
    applyTheme(next);
});

// ==========================================
// START
// ==========================================
renderAll();
setStatus();
loadData();
initRealtime();
