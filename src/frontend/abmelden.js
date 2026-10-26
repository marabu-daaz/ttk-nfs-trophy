// src/frontend/abmelden.js
// Selbst-Abmeldung per Link aus der Bestätigungsmail (/abmelden?t=<token>)

import { supabase } from '../shared/supabase.js';
import { esc, showToast } from '../shared/utils.js';

const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('t');
const FN = 'send-registration-email';

function show(state) {
    ['stateLoading', 'stateFound', 'stateDone', 'stateRequest'].forEach(id => { $(id).hidden = id !== state; });
}

function showRequest(reason) {
    const r = $('requestReason');
    r.hidden = !reason;
    r.textContent = reason || '';
    show('stateRequest');
}

async function init() {
    if (!token) return showRequest();
    if (!/^[0-9a-f-]{36}$/i.test(token)) return showRequest('Dieser Link ist ungültig. Fordere hier einen neuen an.');

    const { data, error } = await supabase.rpc('registration_by_token', { p_token: token });
    if (error) {
        console.error(error);
        return showRequest('Der Link konnte gerade nicht geprüft werden. Bitte versuch es später noch einmal oder fordere einen neuen Link an.');
    }
    if (!data) return showRequest('Zu diesem Link gibt es keine Nennung (mehr) – vielleicht bist du schon abgemeldet. Hier kannst du einen neuen Link anfordern.');

    renderFound(data);
}

function renderFound(d) {
    $('manageTitle').innerHTML = `Hallo <em>${esc(d.vorname)}</em>`;
    $('foundIntro').innerHTML = `Deine Nennung für die <strong>${esc(d.turnier)}</strong>${d.datum ? ` (${esc(d.datum)})` : ''}:`;
    const wl = d.warteliste || [];
    $('foundBewerbe').innerHTML = (d.bewerbe || []).map(b => `
        <label class="manage-bewerb">
            <input type="checkbox" value="${esc(b)}" ${d.abmeldbar ? '' : 'disabled'}>
            <span class="name">${esc(b)}</span>
            <span class="tag ${wl.includes(b) ? 'wl' : ''}">${wl.includes(b) ? 'Warteliste' : 'Startplatz'}</span>
        </label>`).join('');

    $('foundActions').hidden = !d.abmeldbar;
    $('foundTooLate').hidden = !!d.abmeldbar;
    show('stateFound');

    const selected = () => [...document.querySelectorAll('#foundBewerbe input:checked')].map(i => i.value);
    $('foundBewerbe').addEventListener('change', () => {
        const n = selected().length;
        $('cancelSelectedBtn').disabled = n === 0 || n === d.bewerbe.length;
        $('cancelSelectedBtn').textContent = n ? `${n === 1 ? 'Diesen Bewerb' : n + ' Bewerbe'} abmelden` : 'Ausgewählte abmelden';
    });
    $('cancelSelectedBtn').addEventListener('click', () => cancel(selected(), d));
    $('cancelAllBtn').addEventListener('click', () => cancel(null, d));
}

async function cancel(bewerbe, d) {
    const what = bewerbe ? bewerbe.join(', ') : 'allen Bewerben';
    if (!confirm(`Wirklich von ${what} abmelden? Das kann nicht rückgängig gemacht werden.`)) return;

    const btns = [$('cancelSelectedBtn'), $('cancelAllBtn')];
    btns.forEach(b => { b.disabled = true; });
    $('cancelAllBtn').textContent = 'Melde ab…';
    try {
        const { data, error } = await supabase.functions.invoke(FN, { body: { action: 'cancel', token, bewerbe } });
        if (error) throw error;
        if (!data?.ok) {
            const msg = {
                not_found: 'Diese Nennung gibt es nicht mehr – vielleicht bist du schon abgemeldet.',
                too_late: 'Das Turnier hat bereits begonnen – bitte melde dich direkt bei der Turnierleitung.',
            }[data?.reason] || 'Abmelden hat nicht geklappt. Bitte versuch es später noch einmal.';
            showToast(msg, true);
            btns.forEach(b => { b.disabled = false; });
            $('cancelAllBtn').textContent = 'Komplett abmelden';
            return;
        }
        $('doneText').innerHTML = data.deleted
            ? `Du bist von der <strong>${esc(d.turnier)}</strong> abgemeldet.`
            : `Du bist von <strong>${data.removed.map(esc).join(', ')}</strong> abgemeldet. Weiterhin genannt: ${data.remaining.map(esc).join(', ')}.`;
        show('stateDone');
    } catch (err) {
        console.error(err);
        showToast('Abmelden hat nicht geklappt. Bitte versuch es später noch einmal.', true);
        btns.forEach(b => { b.disabled = false; });
        $('cancelAllBtn').textContent = 'Komplett abmelden';
    }
}

$('requestForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('requestBtn');
    btn.disabled = true;
    btn.textContent = 'Sende…';
    try {
        const { error } = await supabase.functions.invoke(FN, { body: { action: 'resend_link', email: $('requestEmail').value.trim() } });
        if (error) throw error;
        $('requestForm').hidden = true;
        $('requestDone').hidden = false;
    } catch (err) {
        console.error(err);
        showToast('Das hat nicht geklappt. Bitte versuch es später noch einmal.', true);
        btn.disabled = false;
        btn.textContent = 'Link zusenden';
    }
});

init();
