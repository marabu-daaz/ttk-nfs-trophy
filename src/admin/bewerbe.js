// src/admin/bewerbe.js
// Bewerbs-Übersicht: Startplätze, Wartelisten, Nachrücken, Abmelden, Mails

import { supabase } from '../shared/supabase.js';
import { esc, showToast } from '../shared/utils.js';
import {
    state, allBewerbNames, activeIn, waitingIn, capacityOf, bewerbConfig, findReg,
    setWaiting, removeFromBewerb, moveInWaitlist, reloadRegistrations, deleteRegistration,
} from './state.js';
import { icon, confirmDialog, openMail } from './ui.js';
import { openRegModal } from './registrations.js';

export function initBewerbeView() {
    document.getElementById('bewerbeRoot').addEventListener('click', onClick);
}

export function render() {
    const root = document.getElementById('bewerbeRoot');
    const names = allBewerbNames();
    if (!names.length) {
        root.innerHTML = `<div class="card empty">${icon('trophy')}<div>Noch keine Bewerbe. Lege sie im <a href="#/setup">Turnier-Setup</a> an.</div></div>`;
        return;
    }
    root.innerHTML = `<div class="bw-grid">${names.map(card).join('')}</div>`;
}

function card(b) {
    const cfg = bewerbConfig(b);
    const cap = capacityOf(b);
    const active = activeIn(b);
    const waiting = waitingIn(b);
    const free = Math.max(0, cap - active.length);
    const pct = Math.min(100, Math.round((active.length / cap) * 100));
    const known = state.bewerbe.some(x => x.name === b);
    const enc = encodeURIComponent(b);

    const nextUp = free > 0 && waiting.length
        ? `<div class="bw-free">${icon('chevronsUp')}
               <span style="flex:1;">${free} ${free === 1 ? 'Platz' : 'Plätze'} frei – nächster: <strong>${esc(waiting[0].fullName)}</strong></span>
               <button class="btn sm primary" data-act="promote" data-id="${esc(waiting[0].id)}" data-b="${enc}">Nachrücken</button>
           </div>`
        : '';

    return `
        <div class="card bw-card">
            <div class="bw-head">
                <div>
                    <h3>${esc(b)}</h3>
                    <div class="meta">${[cfg.time, cfg.min_rc > 0 ? `ab ${cfg.min_rc} RC` : '', cfg.prize ? `Preisgeld ${cfg.prize}` : ''].filter(Boolean).map(esc).join(' · ') || (known ? '' : 'nicht mehr im Setup')}</div>
                </div>
                <div class="bw-count num">${active.length}<small>/${cap}</small></div>
            </div>
            <div class="meter ${active.length >= cap ? 'full' : ''}"><span style="width:${pct}%"></span></div>
            ${nextUp}

            <div>
                <div class="bw-list-title"><span>Startplätze (${active.length})</span><span>nach RC</span></div>
                <div class="bw-list">
                    ${active.length ? active.map((r, i) => playerRow(r, b, i + 1, false)).join('') : '<div class="muted small" style="padding:6px;">Noch niemand genannt.</div>'}
                </div>
            </div>

            ${waiting.length ? `
            <div>
                <div class="bw-list-title"><span>${icon('hourglass')} Warteliste (${waiting.length})</span><span>nach Nennung</span></div>
                <div class="bw-list">
                    ${waiting.map((r, i) => playerRow(r, b, i + 1, true, i === 0, i === waiting.length - 1)).join('')}
                </div>
            </div>` : ''}

            <div class="bw-actions">
                <button class="btn sm" data-act="mail-active" data-b="${enc}" ${active.some(r => r.email) ? '' : 'disabled'}>${icon('mail')}Mail an Teilnehmer</button>
                ${waiting.length ? `<button class="btn sm" data-act="mail-wl" data-b="${enc}">${icon('mail')}Mail an Warteliste</button>` : ''}
                <button class="btn sm ghost" data-act="add" data-b="${enc}">${icon('userPlus')}Hinzufügen</button>
            </div>
        </div>`;
}

function playerRow(r, b, pos, isWl, first = false, last = false) {
    const id = esc(r.id);
    const enc = encodeURIComponent(b);
    const sub = [r.verein, r.rc ? `RC ${r.rc}` : ''].filter(Boolean).join(' · ');
    const acts = isWl
        ? `<button class="icon-btn" data-act="up" data-id="${id}" data-b="${enc}" title="Nach oben" ${first ? 'disabled' : ''}>${icon('arrowUp')}</button>
           <button class="icon-btn" data-act="down" data-id="${id}" data-b="${enc}" title="Nach unten" ${last ? 'disabled' : ''}>${icon('arrowDown')}</button>
           <button class="icon-btn" data-act="promote" data-id="${id}" data-b="${enc}" title="Nachrücken lassen">${icon('chevronsUp')}</button>`
        : `<button class="icon-btn" data-act="demote" data-id="${id}" data-b="${enc}" title="Auf Warteliste setzen">${icon('hourglass')}</button>`;
    return `
        <div class="bw-player ${isWl ? 'wl' : ''}">
            <span class="pos">${isWl ? 'WL' : ''}${pos}</span>
            <div class="who">
                <div class="n" data-act="edit" data-id="${id}" style="cursor:pointer;" title="Bearbeiten">${esc(r.nachname)} ${esc(r.vorname)}</div>
                <div class="s">${esc(sub)}</div>
            </div>
            <div class="acts">
                ${acts}
                ${r.email ? `<button class="icon-btn" data-act="mail-one" data-id="${id}" data-b="${enc}" title="E-Mail schreiben">${icon('mail')}</button>` : ''}
                <button class="icon-btn danger" data-act="remove" data-id="${id}" data-b="${enc}" title="Aus Bewerb abmelden">${icon('userMinus')}</button>
            </div>
        </div>`;
}

async function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    const b = btn.dataset.b ? decodeURIComponent(btn.dataset.b) : null;
    const reg = btn.dataset.id ? findReg(btn.dataset.id) : null;

    try {
        switch (act) {
            case 'edit': return openRegModal(reg);
            case 'add': return openRegModal(null, { bewerb: b });
            case 'promote': return promote(reg, b);
            case 'demote':
                await setWaiting(reg, b, true);
                showToast(`${reg.fullName} steht in „${b}“ jetzt auf der Warteliste`);
                return reloadRegistrations();
            case 'up':
            case 'down': {
                const pos = state.wlPositions[reg.id]?.[b] || 1;
                await moveInWaitlist(reg, b, act === 'up' ? pos - 1 : pos + 1);
                return reloadRegistrations();
            }
            case 'remove': return remove(reg, b);
            case 'mail-one': return mailPlayer(reg, b, reg.wlBewerbe.includes(b) ? 'waiting' : 'info');
            case 'mail-active': return mailGroup(activeIn(b), b, 'Teilnehmer');
            case 'mail-wl': return mailGroup(waitingIn(b), b, 'Warteliste');
        }
    } catch (err) {
        console.error(err);
        showToast('Aktion fehlgeschlagen: ' + (err.message || err), true);
        await reloadRegistrations();
    }
}

async function promote(reg, b) {
    const free = capacityOf(b) - activeIn(b).length;
    if (free <= 0) {
        const ok = await confirmDialog({
            title: 'Bewerb ist voll',
            message: `„${b}“ ist bereits voll (${activeIn(b).length}/${capacityOf(b)}). Trotzdem ${reg.fullName} einen Startplatz geben?`,
            confirmText: 'Trotzdem nachrücken',
        });
        if (!ok) return;
    }
    await setWaiting(reg, b, false);
    await reloadRegistrations();
    showToast(`${reg.fullName} ist in „${b}“ nachgerückt`);

    if (reg.email) {
        const send = await confirmDialog({
            title: 'Nachrücker informieren?',
            message: `${reg.fullName} bekommt eine E-Mail an ${reg.email}: Startplatz in „${b}“ ist fix (mit Startzeit und Abmeldelink).`,
            confirmText: 'E-Mail senden',
            cancelText: 'Nicht senden',
        });
        if (send) await notifyPromoted(findReg(reg.id) || reg, b);
    } else {
        showToast(`${reg.fullName} hat keine E-Mail-Adresse – bitte telefonisch informieren.`, true);
    }
}

/** Nachrück-Mail über die Edge Function – bei Problemen auf das eigene Mailprogramm ausweichen */
async function notifyPromoted(reg, b) {
    const { data, error } = await supabase.functions.invoke('send-registration-email', {
        body: { action: 'notify_promoted', registration_id: reg.id, bewerb: b },
    });
    if (!error && data?.ok) {
        showToast(`E-Mail an ${reg.fullName} gesendet`);
        return;
    }
    console.error('Nachrück-Mail fehlgeschlagen:', error || data);
    const fallback = await confirmDialog({
        title: 'E-Mail konnte nicht gesendet werden',
        message: 'Soll stattdessen dein Mailprogramm mit einem fertigen Text geöffnet werden?',
        confirmText: 'Mailprogramm öffnen',
    });
    if (fallback) mailPlayer(reg, b, 'promoted');
}

/**
 * Nach dem Entfernen/Ändern einer Nennung: für jeden frei gewordenen Startplatz
 * den nächsten auf der Warteliste vorschlagen.
 */
export async function suggestPromotions(freedBewerbe, excludeId = null) {
    for (const b of freedBewerbe) {
        // Wer gerade selbst auf die Warteliste gesetzt wurde, ist nicht „der Nächste“
        const next = waitingIn(b).find(r => String(r.id) !== String(excludeId));
        if (!next || activeIn(b).length >= capacityOf(b)) continue;
        const go = await confirmDialog({
            title: 'Platz frei geworden',
            message: `In „${b}“ ist jetzt ein Platz frei. ${next.fullName} (WL 1) nachrücken lassen?`,
            confirmText: 'Nachrücken',
            cancelText: 'Nein',
        });
        if (go) await promote(next, b);
    }
}

async function remove(reg, b) {
    const onlyOne = reg.bewerbeArray.length === 1;
    const ok = await confirmDialog({
        title: onlyOne ? 'Nennung löschen?' : 'Aus Bewerb abmelden?',
        message: onlyOne
            ? `${reg.fullName} ist nur für „${b}“ genannt. Die gesamte Nennung wird gelöscht.`
            : `${reg.fullName} wird aus „${b}“ abgemeldet. Die anderen Bewerbe bleiben bestehen.`,
        confirmText: onlyOne ? 'Löschen' : 'Abmelden',
        danger: true,
    });
    if (!ok) return;

    const wasActive = !reg.wlBewerbe.includes(b);
    if (onlyOne) await deleteRegistration(reg.id);
    else await removeFromBewerb(reg, b);
    await reloadRegistrations();
    showToast(`${reg.fullName} aus „${b}“ abgemeldet`);

    // Platz frei geworden → Nachrücker vorschlagen
    if (wasActive) await suggestPromotions([b]);
}

function mailPlayer(reg, b, kind) {
    const t = state.tournament?.name || 'NFS Trophy';
    const date = state.tournament?.date_text ? ` am ${state.tournament.date_text}` : '';
    const texts = {
        promoted: {
            subject: `${t}: Du bist im Bewerb „${b}“ nachgerückt`,
            body: `Hallo ${reg.vorname},\n\ngute Nachrichten: Für den Bewerb „${b}“ ist ein Platz frei geworden und du bist von der Warteliste nachgerückt. Dein Startplatz bei der ${t}${date} ist damit fix.\n\nFalls du doch nicht teilnehmen kannst, gib uns bitte kurz Bescheid, damit der Platz weitergegeben werden kann.\n\nSportliche Grüße\nDie Turnierleitung`,
        },
        waiting: {
            subject: `${t}: Warteliste „${b}“`,
            body: `Hallo ${reg.vorname},\n\ndu stehst für den Bewerb „${b}“ aktuell auf Position ${state.wlPositions[reg.id]?.[b] || '–'} der Warteliste. Sobald ein Platz frei wird, melden wir uns.\n\nSportliche Grüße\nDie Turnierleitung`,
        },
        info: { subject: `${t}: ${b}`, body: `Hallo ${reg.vorname},\n\n` },
    };
    openMail({ to: [reg.email], ...texts[kind] });
}

function mailGroup(regs, b, label) {
    const emails = [...new Set(regs.map(r => (r.email || '').trim()).filter(Boolean))];
    if (!emails.length) {
        showToast('Keine E-Mail-Adressen vorhanden.', true);
        return;
    }
    const t = state.tournament?.name || 'NFS Trophy';
    openMail({ bcc: emails, subject: `${t}: ${b} (${label})` });
}
