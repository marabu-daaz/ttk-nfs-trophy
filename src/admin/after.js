// src/admin/after.js
// Nach dem Turnier (im Archiv, für das gewählte Turnier):
// 1) Nicht Erschienene aus der Statistik nehmen  2) Turnierbericht  3) Danke-Mail an alle, die gespielt haben

import { supabase } from '../shared/supabase.js';
import { esc, showToast, throwIfError } from '../shared/utils.js';
import { parseList } from './state.js';
import { buildDialog, confirmDialog, withBusy } from './ui.js';
import { invalidatePlayers } from './players.js';

const THANKS_CLOSING_KEY = 'nfs-thanks-closing';
const DEFAULT_THANKS_CLOSING = 'Liebe Grüße\nChristian & Eric';
const SQL_HINT = 'Einmalig im Supabase-SQL-Editor ausführen: supabase/after-tournament.sql';

let current = null;   // gewähltes Turnier
let regs = [];        // Website-Nennungen dieses Turniers
let noShows = new Set();
let ready = true;     // Spalten aus after-tournament.sql vorhanden?

const $ = id => document.getElementById(id);
const activeOf = r => {
    const list = parseList(r.bewerbe_list).length ? parseList(r.bewerbe_list) : (r.bewerb ? [r.bewerb] : []);
    const wl = parseList(r.waitlist_bewerbe).length ? parseList(r.waitlist_bewerbe) : (r.waitlist ? list : []);
    return list.filter(b => !wl.includes(b));
};

export function initAfterTournament() {
    $('noShowBtn').addEventListener('click', openNoShowDialog);
    $('saveReportBtn').addEventListener('click', saveReport);
    $('thanksBtn').addEventListener('click', openThanksDialog);
}

/** Wird beim Wechsel des Turniers im Archiv aufgerufen */
export async function renderAfterTournament(t) {
    current = t;
    if (!t) return;
    $('reportText').value = t.report || '';
    $('reportText').disabled = !('report' in t);
    $('saveReportBtn').disabled = !('report' in t);
    ready = 'report' in t;
    $('afterBanner').innerHTML = ready ? '' : `<div class="banner warn" style="margin-bottom:12px;">Noch nicht eingerichtet. ${esc(SQL_HINT)}</div>`;

    regs = [];
    noShows = new Set();
    try {
        const [r, e] = await Promise.all([
            supabase.from('registrations').select('*').eq('tournament_id', t.id),
            supabase.from('player_entries').select('registration_id,no_show').eq('tournament_id', String(t.id)),
        ]);
        regs = throwIfError(r).data || [];
        if (!e.error) (e.data || []).filter(x => x.no_show).forEach(x => noShows.add(String(x.registration_id)));
    } catch (err) {
        console.error('Nennungen für „Nach dem Turnier“ nicht ladbar:', err);
    }
    if (current !== t) return;   // inzwischen anderes Turnier gewählt
    renderInfo();
}

function renderInfo() {
    const checked = regs.filter(r => r.checked_in).length;
    const info = $('noShowInfo');
    const btn = $('noShowBtn');
    if (!regs.length) {
        info.textContent = 'Keine Website-Nennungen für dieses Turnier (alte Turniere wurden aus den Ergebnislisten übernommen).';
        btn.disabled = true;
    } else if (!checked) {
        info.textContent = `Noch niemand eingecheckt (${regs.length} Nennungen). Die Liste stützt sich auf den Check-in am Turniertag.`;
        btn.disabled = !ready;
    } else {
        info.textContent = `${checked} von ${regs.length} eingecheckt · ${noShows.size ? `${noShows.size} als nicht erschienen markiert` : 'noch nicht abgeschlossen'}`;
        btn.disabled = !ready;
    }
    const sent = regs.filter(r => r.thanks_sent_at).length;
    $('thanksInfo').textContent = !checked
        ? 'Geht an alle, die eingecheckt waren – dafür braucht es den Check-in.'
        : sent ? `Schon an ${sent} Spieler verschickt.` : 'Geht an alle, die eingecheckt waren.';
    $('thanksBtn').disabled = !checked || !ready;
}

// ==========================================
// 1) NICHT ERSCHIENEN
// ==========================================
function openNoShowDialog() {
    const t = current;
    const candidates = regs
        .filter(r => !r.checked_in || noShows.has(String(r.id)))
        .sort((a, b) => a.nachname.localeCompare(b.nachname, 'de'));
    const checked = regs.length - candidates.length;

    new Promise(resolve => {
        const { dlg, finish } = buildDialog('', resolve, null);
        dlg.innerHTML = `
            <div class="modal-head"><h2>Nicht erschienen – ${esc(t.name)}</h2></div>
            <div class="modal-body">
                <p class="help" style="margin-bottom:12px;">Diese Nennungen haben keinen Check-in. Markierte zählen in der Spielerdatenbank
                    nicht als Teilnahme (Statistik, Stammspieler, Danke-Mail). Die Nennung selbst bleibt erhalten und lässt sich jederzeit wieder umstellen.</p>
                ${candidates.length ? `
                <div class="shared-players">${candidates.map(r => {
                    const active = activeOf(r);
                    return `<label class="shared-row"><input type="checkbox" value="${esc(r.id)}" checked>
                        <span class="grow">${esc(r.vorname)} ${esc(r.nachname)}</span>
                        <span class="muted small">${active.length ? esc(active.join(', ')) : 'nur Warteliste'}${r.checked_in ? ' · war eingecheckt' : ''}</span></label>`;
                }).join('')}</div>` : '<div class="muted">Alle Genannten waren eingecheckt. 🎉</div>'}
                <p class="small muted" style="margin-top:12px;">${checked} ${checked === 1 ? 'Spieler war' : 'Spieler waren'} eingecheckt und zählen normal.</p>
            </div>
            <div class="modal-foot">
                <button type="button" class="btn" data-cancel>Abbrechen</button>
                <span class="spacer"></span>
                <button type="button" class="btn primary" id="noShowSave">Speichern</button>
            </div>`;
        dlg.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
        dlg.querySelector('#noShowSave').addEventListener('click', e => withBusy(e.currentTarget, async () => {
            const ids = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
            const { error } = await supabase.rpc('nfs_set_no_shows', { p_tournament_id: String(t.id), p_registration_ids: ids });
            if (error) {
                console.error(error);
                return showToast(`Speichern fehlgeschlagen. ${SQL_HINT}`, true);
            }
            noShows = new Set(ids.map(String));
            invalidatePlayers();
            renderInfo();
            showToast(ids.length ? `${ids.length} als nicht erschienen markiert – zählen nicht mehr in der Statistik` : 'Alle zählen als Teilnehmer');
            finish(true);
        }, '…'));
        dlg.showModal();
    });
}

// ==========================================
// 2) TURNIERBERICHT
// ==========================================
async function saveReport() {
    const t = current;
    const report = $('reportText').value.trim();
    await withBusy($('saveReportBtn'), async () => {
        try {
            throwIfError(await supabase.from('tournaments').update({ report: report || null }).eq('id', t.id));
            t.report = report || null;
            showToast(report ? 'Turnierbericht gespeichert – ist auf der Website im Archiv zu sehen' : 'Turnierbericht entfernt');
        } catch (err) {
            console.error(err);
            showToast('Speichern fehlgeschlagen: ' + (err.message || err), true);
        }
    }, '…');
}

// ==========================================
// 3) DANKE-MAIL
// ==========================================
function savedClosing() {
    try { return localStorage.getItem(THANKS_CLOSING_KEY) || DEFAULT_THANKS_CLOSING; } catch { return DEFAULT_THANKS_CLOSING; }
}

function defaultText(t) {
    return [
        `vielen Dank, dass du bei der ${t.name} dabei warst!`,
        'Die Ergebnisse, den Turnierbericht und die Fotos findest du ab sofort auf unserer Website – einfach auf den Knopf unten tippen.',
        'Wir hoffen, dich auch beim nächsten Mal wieder in Stadlau begrüßen zu dürfen!',
    ].join('\n\n');
}

async function invoke(body) {
    const { data, error } = await supabase.functions.invoke('send-registration-email', { body: { action: 'send_thanks', tournament_id: String(current.id), ...body } });
    if (error || !data) {
        console.error('Danke-Mail fehlgeschlagen:', error || data);
        showToast('Senden fehlgeschlagen. Ist die Mail-Funktion neu deployt?', true);
        return null;
    }
    if (data.reason === 'nobody') showToast('Niemand anzuschreiben.', true);
    return data;
}

async function openThanksDialog() {
    const t = current;
    const warnings = [
        !t.report ? 'Noch kein Turnierbericht gespeichert.' : '',
        !t.oettv_url && !document.querySelector('#ergList a') ? 'Noch keine Ergebnisse (PDF oder ÖTTV-Link) hinterlegt.' : '',
    ].filter(Boolean);

    let busy = false;
    new Promise(resolve => {
        const { dlg, finish } = buildDialog('', resolve, null);
        dlg.innerHTML = `
            <div class="modal-head"><h2>Danke-Mail: ${esc(t.name)}</h2></div>
            <div class="modal-body">
                ${warnings.map(w => `<div class="banner warn" style="margin-bottom:10px;">${esc(w)}</div>`).join('')}
                <div class="reminder-stats" id="thxStats"><span class="muted">Zähle Empfänger…</span></div>
                <div class="field full" style="margin-top:14px;">
                    <label for="thxSubject">Betreff</label>
                    <input id="thxSubject" class="input" value="${esc(`Danke für deine Teilnahme an der ${t.name}!`)}">
                </div>
                <div class="field full" style="margin-top:12px;">
                    <label for="thxText">Text</label>
                    <textarea id="thxText" class="input" rows="8">${esc(defaultText(t))}</textarea>
                    <div class="help">Die Mail beginnt mit „Hallo &lt;Vorname&gt;,“. Darunter kommen automatisch der Knopf zur Website
                        (Bericht, Ergebnisse, Fotos) und die Links zu den Ergebnis-PDFs. Leerzeile = neuer Absatz.</div>
                </div>
                <div class="field full" style="margin-top:12px;">
                    <label for="thxClosing">Gruß</label>
                    <textarea id="thxClosing" class="input" rows="2">${esc(savedClosing())}</textarea>
                </div>
                <label class="switch" style="margin-top:12px;"><input type="checkbox" id="thxResend"><span class="track"></span>Auch an die senden, die sie schon bekommen haben</label>
                <p class="help" style="margin-top:12px;">Geht an alle, die eingecheckt waren – nicht an Nicht-Erschienene, Abbestellte und eure eigenen
                    Admin-Adressen. Eine Mail pro Adresse. Gratis-Tarif: 100 Mails pro Tag, danach morgen einfach erneut senden.</p>
            </div>
            <div class="modal-foot">
                <button type="button" class="btn" data-cancel>Schließen</button>
                <span class="spacer"></span>
                <button type="button" class="btn" id="thxTest">Testmail an mich</button>
                <button type="button" class="btn primary" id="thxSend" disabled>Senden</button>
            </div>`;

        const q = id => dlg.querySelector('#' + id);
        const opts = () => ({ subject: q('thxSubject').value.trim(), text: q('thxText').value.trim(), closing: q('thxClosing').value.trim(), resend: q('thxResend').checked });
        q('thxClosing').addEventListener('change', () => { try { localStorage.setItem(THANKS_CLOSING_KEY, q('thxClosing').value.trim()); } catch { /* egal */ } });

        let counts = null;
        const refresh = async () => {
            const res = await invoke({ dry: true, resend: q('thxResend').checked });
            if (!res) return;
            counts = res;
            q('thxStats').innerHTML = `
                <span><b class="num">${res.open}</b> ${res.open === 1 ? 'Adresse' : 'Adressen'} werden angeschrieben</span>
                ${res.total - res.open ? `<span><b class="num">${res.total - res.open}</b> schon bedankt</span>` : ''}
                ${res.skipped ? `<span><b class="num">${res.skipped}</b> ausgelassen (abbestellt, nicht erschienen oder ohne Adresse)</span>` : ''}`;
            q('thxSend').disabled = busy || !res.open;
            q('thxSend').textContent = res.open ? `An ${res.open} senden` : 'Alle bedankt';
        };
        q('thxResend').addEventListener('change', refresh);
        dlg.querySelector('[data-cancel]').addEventListener('click', () => finish(null));

        q('thxTest').addEventListener('click', e => withBusy(e.currentTarget, async () => {
            const res = await invoke({ ...opts(), test: true });
            if (res?.ok) showToast(`Testmail an ${res.to} gesendet${res.sample ? ` (Beispiel: ${res.sample})` : ''}`);
        }, 'Sende…'));

        q('thxSend').addEventListener('click', async e => {
            if (!opts().subject || !opts().text) return showToast('Bitte Betreff und Text ausfüllen.', true);
            const n = counts?.open || 0;
            const ok = await confirmDialog({
                title: `Danke-Mail an ${n} ${n === 1 ? 'Adresse' : 'Adressen'} senden?`,
                message: 'Tipp: vorher eine Testmail an dich schicken und ansehen.',
                confirmText: 'Jetzt senden',
            });
            if (!ok) return;
            busy = true;
            await withBusy(e.currentTarget, async () => {
                const res = await invoke(opts());
                if (!res) return;
                if (res.stopped === 'limit') showToast(`Tageslimit erreicht: ${res.sent} versendet, ${res.remaining} offen. Morgen einfach erneut senden.`, true);
                else if (res.stopped) showToast(`Abgebrochen nach ${res.sent} Mails (${res.remaining} offen). Details im Supabase-Log der Funktion.`, true);
                else showToast(`Danke-Mail an ${res.sent} ${res.sent === 1 ? 'Adresse' : 'Adressen'} gesendet`);
            }, 'Sende…');
            busy = false;
            await renderAfterTournament(t);
            refresh();
        });

        dlg.showModal();
        refresh();
    });
}
