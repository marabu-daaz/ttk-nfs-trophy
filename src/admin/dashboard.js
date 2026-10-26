// src/admin/dashboard.js
// Übersicht: Kennzahlen, Nennungsverlauf, Auslastung, Vereine, Schnellaktionen

import { esc } from '../shared/utils.js';
import { state, totals, allBewerbNames, activeIn, waitingIn, capacityOf, bewerbConfig } from './state.js';
import { getIncomes, getExpenses } from './finance.js';
import { icon, euro, initials, relTime } from './ui.js';

export function render() {
    const root = document.getElementById('dashRoot');
    const t = state.tournament;
    if (!t) {
        root.innerHTML = `<div class="card empty">${icon('trophy')}<div>Noch kein Turnier angelegt. Lege im Turnier-Setup eines an.</div></div>`;
        return;
    }

    const tot = totals();
    const saldo = tot.paid + sum(getIncomes()) - sum(getExpenses());
    const days = t.date_iso ? Math.ceil((new Date(t.date_iso) - Date.now()) / 864e5) : null;

    document.getElementById('dashSub').textContent =
        `${t.name || 'Turnier'}${t.date_text ? ' · ' + t.date_text : ''}` +
        (days !== null ? (days > 0 ? ` · noch ${days} ${days === 1 ? 'Tag' : 'Tage'}` : days === 0 ? ' · heute!' : '') : '');

    root.innerHTML = `
        <div class="grid cols-3">
            <div class="card hero span-2">
                <div>
                    <div class="label muted">Genannte Spieler</div>
                    <div class="big num">${tot.people}</div>
                    <div class="row">
                        <span><b>${tot.starts}</b> Startplätze belegt</span>
                        <span><b>${tot.wlEntries}</b> auf Wartelisten</span>
                        <span><b>${allBewerbNames().length}</b> Bewerbe</span>
                    </div>
                </div>
                <div class="chart" id="dashTimeline" style="margin-top:18px;"></div>
            </div>
            <div class="grid side-tiles" style="align-content:start;">
                ${tile('Kassiert', euro(tot.paid), `von ${euro(tot.expected)} erwartet`, 'accent', 'wallet')}
                ${tile('Noch offen', euro(tot.outstanding), `${state.registrations.filter(r => !r.has_paid && r.fee_expected > 0).length} Personen`, tot.outstanding > 0 ? 'warn' : '', 'clock')}
                ${tile('Saldo', euro(saldo), 'inkl. Kassenbuch', saldo < 0 ? 'danger' : '', 'euro')}
            </div>
        </div>

        <div class="grid cols-2" style="margin-top:16px;">
            <div class="card">
                <div class="card-head">
                    <h2>${icon('trophy')}Auslastung pro Bewerb</h2>
                    <a href="#/bewerbe" class="small">Details →</a>
                </div>
                <div class="meter-list">${bewerbMeters()}</div>
            </div>
            <div class="card">
                <div class="card-head">
                    <h2>${icon('users')}Neueste Nennungen</h2>
                    <a href="#/nennungen" class="small">Alle →</a>
                </div>
                <div class="list">${latestList()}</div>
            </div>
        </div>

        <div class="grid cols-3" style="margin-top:16px;">
            <div class="card">
                <div class="card-head"><h2>Vereine</h2><span class="hint">nach Anzahl Spieler</span></div>
                ${vereinBars()}
            </div>
            <div class="card">
                <div class="card-head"><h2>Spielerfeld</h2></div>
                ${fieldFacts()}
            </div>
            <div class="card">
                <div class="card-head"><h2>Schnellaktionen</h2></div>
                <div class="quick">
                    <button data-action="new-reg">${icon('userPlus')}<span>Nennung anlegen</span><small>Telefon / E-Mail</small></button>
                    <button data-go="checkin">${icon('checkCircle')}<span>Check-in</span><small>${tot.checkedIn}/${tot.activePeople} da</small></button>
                    <button data-action="mail-all">${icon('mail')}<span>Mail an alle</span><small>${state.registrations.filter(r => r.email).length} Adressen (BCC)</small></button>
                    <button data-action="toggle-open">${icon(t.is_open ? 'lock' : 'unlock')}<span>Anmeldung ${t.is_open ? 'schließen' : 'öffnen'}</span><small>aktuell ${t.is_open ? 'offen' : 'geschlossen'}</small></button>
                </div>
            </div>
        </div>
    `;

    root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.go; }));
    drawTimeline(document.getElementById('dashTimeline'));
}

const sum = list => list.reduce((s, x) => s + (Number(x.amount) || 0), 0);

function tile(label, value, foot, cls, ic) {
    return `
        <div class="tile ${cls}">
            <div class="label">${icon(ic)}${esc(label)}</div>
            <div class="value num">${value}</div>
            <div class="foot">${esc(foot)}</div>
        </div>`;
}

function bewerbMeters() {
    const names = allBewerbNames();
    if (!names.length) return '<div class="muted">Keine Bewerbe konfiguriert.</div>';
    return names.map(b => {
        const cap = capacityOf(b);
        const act = activeIn(b).length;
        const wl = waitingIn(b).length;
        const pct = Math.min(100, Math.round((act / cap) * 100));
        const full = act >= cap;
        const cfg = bewerbConfig(b);
        return `
            <div class="meter-row">
                <div class="top">
                    <span class="name">${esc(b)}${cfg.time ? ` <span class="muted small">· ${esc(cfg.time)}</span>` : ''}</span>
                    <span class="val num">${act}/${cap}${full ? ' · voll' : ''}${wl ? ` · <span class="chip wl">${icon('hourglass')}${wl} WL</span>` : ''}</span>
                </div>
                <div class="meter ${full ? 'full' : ''}" role="meter" aria-valuenow="${act}" aria-valuemin="0" aria-valuemax="${cap}" aria-label="${esc(b)}"><span style="width:${pct}%"></span></div>
            </div>`;
    }).join('');
}

function latestList() {
    const latest = [...state.registrations].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
    if (!latest.length) return '<div class="muted">Noch keine Nennungen.</div>';
    return latest.map(r => `
        <div class="list-item">
            <span class="avatar">${esc(initials(r.vorname, r.nachname).toUpperCase())}</span>
            <div class="body">
                <div class="title">${esc(r.fullName)}</div>
                <div class="sub">${esc(r.verein || 'ohne Verein')} · ${esc(r.bewerbeArray.join(', '))}</div>
            </div>
            <span class="small muted" style="white-space:nowrap;">${relTime(r.created_at)}</span>
        </div>`).join('');
}

function vereinBars() {
    const counts = {};
    state.registrations.forEach(r => {
        const v = (r.verein || '').trim() || 'ohne Verein';
        counts[v] = (counts[v] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!top.length) return '<div class="muted">Noch keine Daten.</div>';
    const max = top[0][1];
    return `<div class="bar-list">${top.map(([name, n]) => `
        <div class="bar-item" title="${esc(name)}: ${n}">
            <span class="name">${esc(name)}</span>
            <span><span class="bar" style="display:block; width:${Math.max(3, (n / max) * 100)}%"></span></span>
            <span class="v">${n}</span>
        </div>`).join('')}</div>`;
}

function fieldFacts() {
    const rcs = state.registrations.map(r => r.rcValue).filter(v => v > 0);
    const avg = rcs.length ? Math.round(rcs.reduce((a, b) => a + b, 0) / rcs.length) : 0;
    const top = [...state.registrations].sort((a, b) => b.rcValue - a.rcValue)[0];
    const nfs = state.registrations.filter(r => r.player_tag === 'nfs').length;
    const receipts = state.registrations.filter(r => r.needs_receipt).length;
    const fact = (k, v) => `<div class="list-item"><div class="body"><div class="sub">${k}</div><div class="title">${v}</div></div></div>`;
    return `<div class="list">
        ${fact('Ø RC-Punkte', avg ? avg.toLocaleString('de-AT') : '–')}
        ${fact('Stärkster Spieler', top && top.rcValue > 0 ? `${esc(top.fullName)} <span class="muted">(${top.rcValue})</span>` : '–')}
        ${fact('NFS-Mitglieder', nfs)}
        ${fact('Belege gewünscht', receipts)}
    </div>`;
}

// ==========================================
// DIAGRAMM: Nennungen über die Zeit (kumuliert)
// ==========================================
function drawTimeline(el) {
    const regs = [...state.registrations].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (regs.length < 2) {
        el.innerHTML = '<div class="muted small">Der Verlauf erscheint ab zwei Nennungen.</div>';
        return;
    }

    // Tageswerte (kumuliert) vom ersten Nennungstag bis heute bzw. letzter Nennung
    const day = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const start = day(regs[0].created_at);
    const end = Math.max(day(regs[regs.length - 1].created_at), Math.min(day(Date.now()), day(state.tournament?.date_iso || Date.now())));
    const points = [];
    let i = 0, count = 0;
    for (let d = start; d <= end; d += 864e5) {
        while (i < regs.length && day(regs[i].created_at) <= d) { count++; i++; }
        points.push({ d, v: count });
    }
    if (points.length < 2) points.unshift({ d: start - 864e5, v: 0 });

    // In echter Pixelbreite zeichnen, damit die Schrift nicht mitskaliert
    const W = Math.max(280, Math.round(el.getBoundingClientRect().width) || 640);
    const H = W < 500 ? 150 : 170, ml = 34, mr = 34, mt = 12, mb = 24;
    const maxV = niceMax(points[points.length - 1].v);
    const x = idx => ml + (idx / (points.length - 1)) * (W - ml - mr);
    const y = v => mt + (1 - v / maxV) * (H - mt - mb);
    const ticks = [0, maxV / 2, maxV];
    const fmt = d => new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' });

    const line = points.map((p, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
    const last = points[points.length - 1];

    el.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nennungen kumuliert, ${points[0].v} bis ${last.v}">
            ${ticks.map(tk => `
                <line class="grid-line" x1="${ml}" x2="${W - mr}" y1="${y(tk)}" y2="${y(tk)}"/>
                <text class="axis-text" x="${ml - 8}" y="${y(tk) + 4}" text-anchor="end">${Math.round(tk)}</text>`).join('')}
            <text class="axis-text" x="${x(0)}" y="${H - 4}" text-anchor="start">${fmt(points[0].d)}</text>
            <text class="axis-text" x="${x(points.length - 1)}" y="${H - 4}" text-anchor="end">${fmt(last.d)}</text>
            <path class="area" d="${area}"/>
            <path class="line" d="${line}"/>
            <circle class="dot" cx="${x(points.length - 1)}" cy="${y(last.v)}" r="4.5"/>
            <text class="end-label" x="${x(points.length - 1) + 9}" y="${y(last.v) + 4}">${last.v}</text>
            <line class="crosshair" y1="${mt}" y2="${H - mb}" style="display:none"/>
            <circle class="dot hover-dot" r="4.5" style="display:none"/>
            <rect x="${ml}" y="0" width="${W - ml - mr}" height="${H}" fill="transparent" class="hit"/>
        </svg>
        <div class="chart-tooltip" role="status"></div>`;

    const svg = el.querySelector('svg');
    const cross = svg.querySelector('.crosshair');
    const hdot = svg.querySelector('.hover-dot');
    const tip = el.querySelector('.chart-tooltip');

    const show = clientX => {
        const r = svg.getBoundingClientRect();
        const vx = ((clientX - r.left) / r.width) * W;
        const k = Math.max(0, Math.min(points.length - 1, Math.round(((vx - ml) / (W - ml - mr)) * (points.length - 1))));
        const p = points[k];
        cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.style.display = '';
        hdot.setAttribute('cx', x(k)); hdot.setAttribute('cy', y(p.v)); hdot.style.display = '';
        tip.textContent = '';
        const strong = document.createElement('strong');
        strong.textContent = `${p.v} Nennungen`;
        tip.append(strong, document.createTextNode(new Date(p.d).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit' })));
        tip.style.left = `${(x(k) / W) * 100}%`;
        tip.style.top = `${(y(p.v) / H) * 100}%`;
        tip.classList.add('show');
    };
    const hide = () => { cross.style.display = 'none'; hdot.style.display = 'none'; tip.classList.remove('show'); };
    svg.addEventListener('pointermove', e => show(e.clientX));
    svg.addEventListener('pointerleave', hide);
}

// Bei Größenänderung neu zeichnen (z.B. Handy drehen)
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const el = document.getElementById('dashTimeline');
        if (el && el.offsetParent) drawTimeline(el);
    }, 150);
});

function niceMax(v) {
    if (v <= 4) return 4;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 2 ? 2 : n <= 5 ? 5 : 10;
    const max = Math.ceil(v / (step * pow / 2)) * (step * pow / 2);
    // gerade Zahl, damit die Mittellinie ganzzahlig beschriftet ist
    return Math.ceil(max / 2) * 2;
}
