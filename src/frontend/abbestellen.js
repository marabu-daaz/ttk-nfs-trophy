// src/frontend/abbestellen.js
// Einladungen abbestellen über den Link aus der Einladungsmail (?t=<invite_token>)

import { supabase } from '../shared/supabase.js';
import { showToast } from '../shared/utils.js';

const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('t') || '';

function show(id) {
    ['stateAsk', 'stateDone', 'stateInvalid'].forEach(s => { $(s).hidden = s !== id; });
}

if (!/^[0-9a-f-]{36}$/i.test(token)) show('stateInvalid');

$('unsubBtn').addEventListener('click', async () => {
    const btn = $('unsubBtn');
    btn.disabled = true;
    btn.textContent = 'Einen Moment…';
    try {
        const { data, error } = await supabase.rpc('player_unsubscribe', { p_token: token });
        if (error) throw error;
        if (!data?.ok) return show('stateInvalid');
        if (data.vorname) $('doneText').textContent = `Erledigt, ${data.vorname} – du bekommst keine Einladungen mehr.`;
        show('stateDone');
    } catch (err) {
        console.error('Abbestellen fehlgeschlagen:', err);
        showToast('Das hat leider nicht geklappt. Bitte versuche es später noch einmal.', true);
        btn.disabled = false;
        btn.textContent = 'Ja, abbestellen';
    }
});
