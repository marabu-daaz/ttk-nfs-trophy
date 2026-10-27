// src/admin/invitation.js
// Einladung zum neuen Turnier an alle Spieler der Spielerdatenbank (über die Edge Function)

import { supabase } from '../shared/supabase.js';
import { esc, showToast } from '../shared/utils.js';
import { state, registrationStatus } from './state.js';
import { buildDialog, confirmDialog, withBusy } from './ui.js';
import { ensurePlayers, getPlayers } from './players.js';

const hasMail = p => (p.email || '').includes('@');

/** Wer würde eingeladen? (gleiche Logik wie in der Edge Function: eine Mail pro Adresse) */
function counts(resend) {
    const tid = String(state.tournament.id);
    const groups = new Map();
    getPlayers().filter(p => hasMail(p) && !p.no_invites).forEach(p => {
        const key = p.email.trim().toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    });
    const all = [...groups.values()];
    const open = resend ? all : all.filter(ps => ps.some(p => p.invited_tournament !== tid));
    return {
        total: all.length,
        open: open.length,
        done: all.length - open.length,
        excluded: getPlayers().filter(p => p.no_invites).length,
        noMail: getPlayers().filter(p => !hasMail(p)).length,
    };
}

const DAYS = { mo: 'Montag', di: 'Dienstag', mi: 'Mittwoch', do: 'Donnerstag', fr: 'Freitag', sa: 'Samstag', so: 'Sonntag' };
const joinAnd = list => list.length > 1 ? `${list.slice(0, -1).join(', ')} und ${list.at(-1)}` : (list[0] || '');
const CLOSING_KEY = 'nfs-invite-closing';
const DEFAULT_CLOSING = 'Wir freuen uns auf deine Teilnahme!\nLiebe Grüße\nChristian & Eric';

/** Vorschlag für den Text – nach der bisherigen Einladung, befüllt aus den Turnierdaten */
function defaultText() {
    const t = state.tournament;
    const reg = registrationStatus(t);
    const bewerbe = state.bewerbe.filter(b => b.name && !/^tba\b/i.test(b.name));

    // Bewerbe nach Tag gruppieren („Sa 09:00“ → Samstag)
    const byDay = new Map();
    bewerbe.forEach(b => {
        const day = DAYS[String(b.time || '').trim().slice(0, 2).toLowerCase()] || '';
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(b.name);
    });
    const program = [...byDay.entries()].map(([day, names], i) => {
        const what = `${names.length === 1 ? 'der Bewerb' : 'die Bewerbe'} ${joinAnd(names)}`;
        if (!day) return `Auf dem Programm stehen ${what}.`;
        return i === 0 ? `Am ${day} ${names.length === 1 ? 'steht' : 'stehen'} ${what} am Programm.` : `Am ${day} ${what}.`;
    }).join('\n');

    const caps = [...new Set(bewerbe.map(b => b.capacity || 20))];
    const capText = caps.length === 1
        ? `Die Bewerbe sind wieder auf jeweils ${caps[0]} Spieler beschränkt, berücksichtigt wird das Einlangen der Nennung.`
        : 'Die Plätze sind wieder beschränkt, berücksichtigt wird das Einlangen der Nennung.';
    const deadline = reg.deadline
        ? `Nennschluss ist am ${reg.deadline.toLocaleString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} Uhr.`
        : '';
    const name = /^\d+\./.test(t.name || '') ? `unsere mittlerweile ${t.name}` : `die ${t.name}`;

    return [
        `wir veranstalten${t.date_text ? ` am ${t.date_text}` : ''} ${name} als RC-Turnier in unserer Halle in Stadlau!`,
        program,
        [capText, 'In den Bewerben 1–5 wird es wieder ein oberes und unteres Playoff geben.', deadline].filter(Boolean).join('\n'),
        'Mit dem Knopf unten kommst du direkt zur Nennung. Der Nennstand ist auf nfs-trophy.com laufend einsehbar, alle weiteren Details findest du in der Ausschreibung.',
    ].filter(Boolean).join('\n\n');
}

function savedClosing() {
    try { return localStorage.getItem(CLOSING_KEY) || DEFAULT_CLOSING; } catch { return DEFAULT_CLOSING; }
}

export async function openInvitationDialog() {
    const t = state.tournament;
    if (!t) return;
    await ensurePlayers();
    if (!getPlayers().length) return showToast('Keine Spieler vorhanden (supabase/players.sql ausgeführt?).', true);

    const reg = registrationStatus(t);
    const warnings = [
        !t.ausschreibung_path ? 'Noch keine Ausschreibung hochgeladen – der Link fehlt dann in der Mail.' : '',
        !reg.open ? 'Die Anmeldung ist derzeit geschlossen – Eingeladene könnten noch nicht nennen.' : '',
        state.bewerbe.some(b => /^tba\b/i.test(b.name || '')) ? 'Einige Bewerbe heißen noch „TBA“.' : '',
    ].filter(Boolean);

    let busy = false;
    new Promise(resolve => {
        const { dlg, finish } = buildDialog('', resolve, null);
        dlg.innerHTML = `
            <div class="modal-head"><h2>Einladung: ${esc(t.name)}</h2></div>
            <div class="modal-body">
                ${warnings.map(w => `<div class="banner warn" style="margin-bottom:10px;">${esc(w)}</div>`).join('')}
                <div class="reminder-stats" id="invStats"></div>
                <div class="field full" style="margin-top:14px;">
                    <label for="invSubject">Betreff</label>
                    <input id="invSubject" class="input" value="${esc(`Einladung: ${t.name}${t.date_text ? ` – ${t.date_text}` : ''}`)}">
                </div>
                <div class="field full" style="margin-top:12px;">
                    <label for="invText">Text</label>
                    <textarea id="invText" class="input" rows="14">${esc(defaultText())}</textarea>
                    <div class="help">Die Mail beginnt mit „Hallo &lt;Vorname&gt;,“. Darunter kommen automatisch der Knopf
                        „Jetzt nennen“ (Formular mit Name, E-Mail, Telefon und Verein vorausgefüllt) und der Link zur Ausschreibung,
                        dann der Gruß und ganz unten ein Link zum Abbestellen. Leerzeile = neuer Absatz.</div>
                </div>
                <div class="field full" style="margin-top:12px;">
                    <label for="invClosing">Gruß (unter dem Knopf)</label>
                    <textarea id="invClosing" class="input" rows="3">${esc(savedClosing())}</textarea>
                </div>
                <label class="switch" style="margin-top:12px;"><input type="checkbox" id="invResend"><span class="track"></span>Auch an bereits Eingeladene erneut senden</label>
                <p class="help" style="margin-top:12px;">Gratis-Tarif von Resend: 100 Mails pro Tag. Wird das Limit erreicht, morgen einfach
                    erneut senden – es geht nur an die, die noch keine Einladung haben.</p>
            </div>
            <div class="modal-foot">
                <button type="button" class="btn" data-cancel>Schließen</button>
                <span class="spacer"></span>
                <button type="button" class="btn" id="invTest">Testmail an mich</button>
                <button type="button" class="btn primary" id="invSend">Senden</button>
            </div>`;

        const $ = id => dlg.querySelector('#' + id);
        const opts = () => ({ subject: $('invSubject').value.trim(), text: $('invText').value.trim(), closing: $('invClosing').value.trim(), resend: $('invResend').checked });
        // Gruß für das nächste Mal merken
        $('invClosing').addEventListener('change', () => { try { localStorage.setItem(CLOSING_KEY, $('invClosing').value.trim()); } catch { /* egal */ } });
        const refresh = () => {
            const c = counts(opts().resend);
            $('invStats').innerHTML = `
                <span><b class="num">${c.open}</b> ${c.open === 1 ? 'Adresse' : 'Adressen'} werden eingeladen</span>
                ${c.done ? `<span><b class="num">${c.done}</b> schon eingeladen</span>` : ''}
                ${c.excluded ? `<span><b class="num">${c.excluded}</b> ausgenommen / abbestellt</span>` : ''}
                ${c.noMail ? `<span><b class="num">${c.noMail}</b> Spieler ohne E-Mail</span>` : ''}`;
            $('invSend').disabled = c.open === 0 || busy;
            $('invSend').textContent = c.open ? `An ${c.open} senden` : 'Alle eingeladen';
        };
        dlg.addEventListener('change', refresh);
        dlg.querySelector('[data-cancel]').addEventListener('click', () => finish(null));

        $('invTest').addEventListener('click', e => withBusy(e.currentTarget, async () => {
            const res = await invoke({ ...opts(), test: true });
            if (res?.ok) showToast(res.sample ? `Testmail an ${res.to} gesendet (Beispiel: ${res.sample} – du selbst bist mit dieser Adresse nicht in der Spielerliste)` : `Testmail an ${res.to} gesendet – mit deinen eigenen Daten`);
        }, 'Sende…'));

        $('invSend').addEventListener('click', async e => {
            if (!opts().subject || !opts().text) return showToast('Bitte Betreff und Text ausfüllen.', true);
            const n = counts(opts().resend).open;
            const ok = await confirmDialog({
                title: `Einladung an ${n} ${n === 1 ? 'Adresse' : 'Adressen'} senden?`,
                message: 'Tipp: vorher eine Testmail an dich schicken und ansehen.',
                confirmText: 'Jetzt senden',
            });
            if (!ok) return;
            busy = true;
            await withBusy(e.currentTarget, async () => {
                const res = await invoke(opts());
                if (res) report(res);
            }, 'Sende…');
            busy = false;
            await ensurePlayers(true);
            refresh();
        });

        refresh();
        dlg.showModal();
    });
}

async function invoke(body) {
    const { data, error } = await supabase.functions.invoke('send-registration-email', { body: { action: 'send_invitation', ...body } });
    if (error || !data) {
        console.error('Einladung fehlgeschlagen:', error || data);
        showToast('Senden fehlgeschlagen. Sind invitations.sql ausgeführt und die Mail-Funktion neu deployt?', true);
        return null;
    }
    if (data.reason === 'nobody') showToast('Niemand einzuladen.', true);
    return data;
}

function report(res) {
    if (res.stopped === 'limit') {
        showToast(`Tageslimit erreicht: ${res.sent} versendet, ${res.remaining} offen. Morgen einfach erneut senden.`, true);
    } else if (res.stopped) {
        showToast(`Abgebrochen nach ${res.sent} Mails (${res.remaining} offen). Details im Supabase-Log der Funktion.`, true);
    } else {
        showToast(`Einladung an ${res.sent} ${res.sent === 1 ? 'Adresse' : 'Adressen'} gesendet`);
    }
}
