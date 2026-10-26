// src/admin/state.js
// Zentraler Datenzustand des Admins: Turnier, Bewerbe, Nennungen + Hilfsfunktionen

import { supabase } from '../shared/supabase.js';
import { parseBewerbe, rcNum, throwIfError } from '../shared/utils.js';
import { DEFAULT_FEE_NORMAL, DEFAULT_FEE_NFS, DEFAULT_CAPACITY } from '../shared/constants.js';

export const state = {
    tournaments: [],
    tournament: null,
    bewerbe: [],            // [{ name, time, capacity, min_rc, prize, duration }]
    registrations: [],      // angereicherte Nennungen (siehe enrich)
    wlPositions: {},        // { [regId]: { [bewerb]: position } }
    fees: { normal: DEFAULT_FEE_NORMAL, nfs: DEFAULT_FEE_NFS },
    checkinSupported: true, // Spalte registrations.checked_in vorhanden?
};

// ---------- Änderungs-Benachrichtigung ----------
const subscribers = new Set();
export function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}
export function notify() {
    subscribers.forEach(fn => fn());
}

// ---------- Laden ----------
export async function loadTournaments() {
    const { data } = throwIfError(await supabase
        .from('tournaments')
        .select('*')
        .order('date_iso', { ascending: false }));
    state.tournaments = data || [];
    state.tournament = state.tournaments[0] || null;
    const t = state.tournament;
    state.bewerbe = t ? parseBewerbe(t) : [];
    state.fees = {
        normal: t?.fee_normal ?? DEFAULT_FEE_NORMAL,
        nfs: t?.fee_nfs ?? DEFAULT_FEE_NFS,
    };
}

export async function loadRegistrations() {
    if (!state.tournament) {
        state.registrations = [];
        return;
    }
    const { data } = throwIfError(await supabase
        .from('registrations')
        .select('*')
        .eq('tournament_id', state.tournament.id)
        .order('created_at', { ascending: true }));

    const rows = data || [];
    // Gibt es die Check-in-Spalte? (kommt per SQL-Migration dazu)
    if (rows.length > 0) state.checkinSupported = Object.prototype.hasOwnProperty.call(rows[0], 'checked_in');
    state.registrations = rows.map(enrich);
    computeWaitlistPositions();
}

export async function reloadAll() {
    await loadTournaments();
    await loadRegistrations();
    notify();
}

export async function reloadRegistrations() {
    await loadRegistrations();
    notify();
}

// ---------- Aufbereitung ----------
export function parseList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) {
        try {
            const p = JSON.parse(v);
            return Array.isArray(p) ? p : [];
        } catch {
            return v.split(',').map(s => s.trim()).filter(Boolean);
        }
    }
    return [];
}

export function autoTag(reg) {
    if (reg.player_tag) return reg.player_tag;
    const v = (reg.verein || '').toLowerCase();
    return v.includes('nfs') || v.includes('naturfreunde') ? 'nfs' : 'normal';
}

function enrich(reg) {
    let bewerbeArray = parseList(reg.bewerbe_list);
    if (bewerbeArray.length === 0 && reg.bewerb) bewerbeArray = [reg.bewerb];

    let wlBewerbe = parseList(reg.waitlist_bewerbe).filter(b => bewerbeArray.includes(b));
    if (wlBewerbe.length === 0 && reg.waitlist === true) wlBewerbe = [...bewerbeArray];

    const activeBewerbe = bewerbeArray.filter(b => !wlBewerbe.includes(b));
    const tag = autoTag(reg);

    return {
        ...reg,
        player_tag: tag,
        bewerbeArray,
        wlBewerbe,
        activeBewerbe,
        rcValue: rcNum(reg.rc),
        fullName: `${reg.vorname || ''} ${reg.nachname || ''}`.trim(),
        // Nenngeld nur für Bewerbe, in denen die Person einen Startplatz hat
        fee_expected: feeFor(tag, activeBewerbe.length),
        fee_full: activeBewerbe.length * state.fees.normal,
    };
}

export function feeFor(tag, starts) {
    if (tag === 'vip') return 0;
    return starts * (tag === 'nfs' ? state.fees.nfs : state.fees.normal);
}

function computeWaitlistPositions() {
    state.wlPositions = {};
    allBewerbNames().forEach(b => {
        waitingIn(b).forEach((r, i) => {
            (state.wlPositions[r.id] ||= {})[b] = i + 1;
        });
    });
}

// ---------- Abfragen ----------
/** Alle Bewerbe: konfigurierte + ggf. alte Namen aus Nennungen */
export function allBewerbNames() {
    const names = state.bewerbe.map(b => b.name);
    state.registrations.forEach(r => r.bewerbeArray.forEach(b => {
        if (!names.includes(b)) names.push(b);
    }));
    return names;
}

export function bewerbConfig(name) {
    return state.bewerbe.find(b => b.name === name) || { name, capacity: DEFAULT_CAPACITY };
}

export function capacityOf(name) {
    return parseInt(bewerbConfig(name).capacity, 10) || DEFAULT_CAPACITY;
}

export function isWaiting(reg, bewerb) {
    return reg.wlBewerbe.includes(bewerb);
}

/** Startplätze in einem Bewerb, nach RC absteigend */
export function activeIn(bewerb) {
    return state.registrations
        .filter(r => r.bewerbeArray.includes(bewerb) && !isWaiting(r, bewerb))
        .sort((a, b) => b.rcValue - a.rcValue);
}

/** Warteliste eines Bewerbs, nach Nennzeitpunkt */
export function waitingIn(bewerb) {
    return state.registrations
        .filter(r => r.bewerbeArray.includes(bewerb) && isWaiting(r, bewerb))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export function findReg(id) {
    return state.registrations.find(r => String(r.id) === String(id));
}

/** Kennzahlen über alle Nennungen */
export function totals(regs = state.registrations) {
    const t = { people: regs.length, activePeople: 0, starts: 0, wlEntries: 0, expected: 0, paid: 0, loss: 0, checkedIn: 0, receipts: 0 };
    regs.forEach(r => {
        t.starts += r.activeBewerbe.length;
        t.wlEntries += r.wlBewerbe.length;
        if (r.activeBewerbe.length > 0) {
            t.activePeople++;
            t.expected += r.fee_expected;
            t.loss += r.fee_full - r.fee_expected;
            if (r.has_paid) t.paid += r.fee_expected;
        }
        if (r.checked_in) t.checkedIn++;
        if (r.needs_receipt) t.receipts++;
    });
    t.outstanding = t.expected - t.paid;
    return t;
}

// ---------- Schreiben ----------
export async function updateRegistration(id, patch) {
    throwIfError(await supabase.from('registrations').update(patch).eq('id', id));
}

/** Berechnet waitlist-Felder für eine Liste von Bewerben + Wartelisten-Bewerben */
export function waitlistFields(bewerbe, wl) {
    const clean = wl.filter(b => bewerbe.includes(b));
    return {
        waitlist_bewerbe: clean,
        waitlist: clean.length > 0 && clean.length === bewerbe.length,
    };
}

/** Setzt eine Person in einem Bewerb auf Warteliste bzw. holt sie davon herunter */
export async function setWaiting(reg, bewerb, waiting) {
    const wl = waiting
        ? [...new Set([...reg.wlBewerbe, bewerb])]
        : reg.wlBewerbe.filter(b => b !== bewerb);
    await updateRegistration(reg.id, waitlistFields(reg.bewerbeArray, wl));
}

/** Entfernt eine Person aus einem Bewerb. Liefert false, wenn danach kein Bewerb mehr übrig ist. */
export async function removeFromBewerb(reg, bewerb) {
    const bewerbe = reg.bewerbeArray.filter(b => b !== bewerb);
    if (bewerbe.length === 0) return false;
    await updateRegistration(reg.id, {
        bewerb: bewerbe[0],
        bewerbe_list: bewerbe,
        ...waitlistFields(bewerbe, reg.wlBewerbe),
    });
    return true;
}

export async function deleteRegistration(id) {
    throwIfError(await supabase.from('registrations').delete().eq('id', id));
}

/**
 * Verschiebt eine Person auf Position `targetPos` (1-basiert) der Warteliste.
 * Die Reihenfolge ergibt sich aus created_at, daher wird dieser Zeitstempel angepasst.
 */
export async function moveInWaitlist(reg, bewerb, targetPos) {
    const others = waitingIn(bewerb).filter(r => r.id !== reg.id);
    const ts = r => new Date(r.created_at).getTime();
    let newTime;
    if (others.length === 0) newTime = Date.now();
    else if (targetPos <= 1) newTime = ts(others[0]) - 1000;
    else if (targetPos > others.length) newTime = ts(others[others.length - 1]) + 1000;
    else newTime = (ts(others[targetPos - 2]) + ts(others[targetPos - 1])) / 2;
    await updateRegistration(reg.id, { created_at: new Date(newTime).toISOString() });
}
