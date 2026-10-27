// src/admin/reminder.js
// Erinnerungsmail vor dem Turnier: persönliche Mail an alle Genannten (über die Edge Function)

import { supabase } from '../shared/supabase.js';
import { esc, showToast } from '../shared/utils.js';
import { state } from './state.js';
import { buildDialog, confirmDialog, withBusy, relTime } from './ui.js';

const hasMail = r => (r.email || '').includes('@');
const key = r => r.email.trim().toLowerCase();

/** Wie viele Adressen würden angeschrieben? (gleiche Logik wie in der Edge Function) */
function counts(includeWaitlist, resend) {
    const groups = new Map();
    state.registrations
        .filter(r => hasMail(r) && (r.activeBewerbe.length > 0 || (includeWaitlist && r.wlBewerbe.length > 0)))
        .forEach(r => {
            if (!groups.has(key(r))) groups.set(key(r), []);
            groups.get(key(r)).push(r);
        });
    const all = [...groups.values()];
    const open = resend ? all : all.filter(rs => rs.some(r => !r.reminder_sent_at));
    const noMail = state.registrations.filter(r => !hasMail(r) && r.activeBewerbe.length > 0).length;
    const last = state.registrations.map(r => r.reminder_sent_at).filter(Boolean).sort().pop();
    return { total: all.length, open: open.length, done: all.length - open.length, noMail, last };
}

export function openReminderDialog() {
    if (!state.tournament) return;
    let busy = false;
    new Promise(resolve => {
        const { dlg, finish } = buildDialog('', resolve, null);
        dlg.innerHTML = `
            <div class="modal-head"><h2>Erinnerung an alle senden</h2></div>
            <div class="modal-body">
                <p class="confirm-text" style="margin-bottom:14px;">Jede Person bekommt eine persönliche E-Mail mit ihren Bewerben,
                    Startzeiten und ihrem Abmeldelink. Mehrere Nennungen mit derselben Adresse kommen in eine Mail.</p>
                <div class="reminder-stats" id="remStats"></div>
                <div class="field full" style="margin-top:14px;">
                    <label for="remText">Zusätzlicher Text (optional)</label>
                    <textarea id="remText" class="input" rows="4" placeholder="z.B. Bitte spätestens 30 Minuten vor Bewerbsbeginn in der Halle sein. Parkplätze gibt es direkt vor der Halle."></textarea>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
                    <label class="switch"><input type="checkbox" id="remWl"><span class="track"></span>Auch Personen nur auf der Warteliste</label>
                    <label class="switch"><input type="checkbox" id="remResend"><span class="track"></span>Auch an bereits Erinnerte erneut senden</label>
                </div>
                <p class="help" style="margin-top:12px;">Im Gratis-Tarif von Resend sind 100 Mails pro Tag möglich. Wird das Limit erreicht,
                    einfach am nächsten Tag erneut senden – es geht nur an die, die noch keine Erinnerung haben.</p>
            </div>
            <div class="modal-foot">
                <button type="button" class="btn" data-cancel>Schließen</button>
                <span class="spacer"></span>
                <button type="button" class="btn" id="remTest">Testmail an mich</button>
                <button type="button" class="btn primary" id="remSend">Senden</button>
            </div>`;

        const $ = id => dlg.querySelector('#' + id);
        const opts = () => ({ include_waitlist: $('remWl').checked, resend: $('remResend').checked, text: $('remText').value.trim() });
        const refresh = () => {
            const c = counts(opts().include_waitlist, opts().resend);
            $('remStats').innerHTML = `
                <span><b class="num">${c.open}</b> ${c.open === 1 ? 'Adresse' : 'Adressen'} werden angeschrieben</span>
                ${c.done ? `<span><b class="num">${c.done}</b> bereits erinnert${c.last ? ` (zuletzt ${esc(relTime(c.last))})` : ''}</span>` : ''}
                ${c.noMail ? `<span class="warn"><b class="num">${c.noMail}</b> ohne E-Mail – bitte anders informieren</span>` : ''}`;
            $('remSend').disabled = c.open === 0 || busy;
            $('remSend').textContent = c.open ? `An ${c.open} senden` : 'Alle erinnert';
        };
        dlg.addEventListener('change', refresh);
        dlg.querySelector('[data-cancel]').addEventListener('click', () => finish(null));

        $('remTest').addEventListener('click', e => withBusy(e.currentTarget, async () => {
            const res = await invoke({ ...opts(), test: true });
            if (res?.ok) showToast(`Testmail an ${res.to} gesendet`);
        }, 'Sende…'));

        $('remSend').addEventListener('click', async e => {
            const n = counts(opts().include_waitlist, opts().resend).open;
            const ok = await confirmDialog({
                title: `Erinnerung an ${n} ${n === 1 ? 'Adresse' : 'Adressen'} senden?`,
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
            await reloadReminderState();
            refresh();
        });

        refresh();
        dlg.showModal();
    });
}

async function invoke(body) {
    const { data, error } = await supabase.functions.invoke('send-registration-email', { body: { action: 'send_reminder', ...body } });
    if (error || !data) {
        console.error('Erinnerung fehlgeschlagen:', error || data);
        showToast('Senden fehlgeschlagen. Ist die neue Version der Mail-Funktion deployt?', true);
        return null;
    }
    if (data.reason === 'nobody') showToast('Niemand anzuschreiben.', true);
    return data;
}

function report(res) {
    if (res.stopped === 'limit') {
        showToast(`Tageslimit erreicht: ${res.sent} versendet, ${res.remaining} offen. Morgen einfach erneut senden.`, true);
    } else if (res.stopped) {
        showToast(`Abgebrochen nach ${res.sent} Mails (${res.remaining} offen). Details im Supabase-Log der Funktion.`, true);
    } else {
        showToast(`Erinnerung an ${res.sent} ${res.sent === 1 ? 'Adresse' : 'Adressen'} gesendet`);
    }
}

/** reminder_sent_at nachladen, ohne alles neu zu rendern */
async function reloadReminderState() {
    const { data } = await supabase.from('registrations').select('id,reminder_sent_at').eq('tournament_id', state.tournament.id);
    const map = new Map((data || []).map(r => [String(r.id), r.reminder_sent_at]));
    state.registrations.forEach(r => { if (map.has(String(r.id))) r.reminder_sent_at = map.get(String(r.id)); });
}
