// src/admin/archive.js
// Archiv & Medien: ÖTTV-Link, Ergebnis-PDFs, Hall of Fame, Fotos, Bewerbe nachtragen

import { supabase, publicFotoUrl, publicPdfUrl } from '../shared/supabase.js';
import { esc, showToast, parseBewerbe, safeFileName, throwIfError } from '../shared/utils.js';
import { icon, confirmDialog, withBusy } from './ui.js';

let allTournaments = [];
let activeTournamentId = null;

export function setArchiveTournamentId(id) {
    activeTournamentId = id;
}

export function setArchiveTournaments(data) {
    allTournaments = data;
}

export function populateArchivDropdown() {
    const select = document.getElementById('archivSelect');
    if (!select) return;
    const prev = select.value;
    select.innerHTML = allTournaments.map(t => `
        <option value="${esc(t.id)}">${esc(t.name)}${t.date_text ? ' · ' + esc(t.date_text) : ''}${String(t.id) === String(activeTournamentId) ? ' (aktuell)' : ''}</option>`).join('');
    if (prev && allTournaments.some(t => String(t.id) === prev)) select.value = prev;
    loadArchivData();
}

// Select-Werte sind immer Strings, IDs aus der DB evtl. Zahlen → als String vergleichen
function findTournament(id) {
    return allTournaments.find(x => String(x.id) === String(id));
}

const selectedId = () => document.getElementById('archivSelect')?.value;

export async function loadArchivData() {
    const tId = selectedId();
    if (!tId) return;

    try {
        const t = findTournament(tId);
        document.getElementById('archivOettvUrl').value = t?.oettv_url || '';
        renderHallOfFame(t);

        const { data: ergs } = throwIfError(await supabase.from('ergebnisse').select('*').eq('tournament_id', tId));
        document.getElementById('ergList').innerHTML = ergs?.length
            ? ergs.map(erg => `
                <li>
                    ${icon('file')}
                    <div class="grow">
                        <div><a href="${esc(publicPdfUrl(erg.path))}" target="_blank" rel="noopener">${esc(erg.label)}</a></div>
                        <div class="small muted">${esc(erg.file_name)}</div>
                    </div>
                    <button class="icon-btn danger" data-del-erg="${esc(erg.id)}" data-path="${esc(erg.path)}" data-label="${esc(erg.label)}" title="Löschen">${icon('trash')}</button>
                </li>`).join('')
            : '<li class="muted small">Noch keine Ergebnisse hochgeladen.</li>';

        await loadFotos(t);
    } catch (err) {
        console.error('Fehler beim Laden der Archiv-Daten:', err);
        showToast('Fehler beim Laden der Archiv-Daten.', true);
    }
}

function renderHallOfFame(t) {
    const box = document.getElementById('hallOfFameContainer');
    const bewerbe = parseBewerbe(t);
    const hof = t?.hall_of_fame || {};
    if (!bewerbe.length) {
        box.innerHTML = '<div class="muted small">Für dieses Turnier sind keine Bewerbe hinterlegt – über „Bewerbe nachtragen“ ergänzen.</div>';
        return;
    }
    box.innerHTML = bewerbe.map(b => {
        const d = hof[b.name] || {};
        const inp = (pos, ph, val) => `<input type="text" class="input hof-input" data-bewerb="${esc(b.name)}" data-pos="${pos}" placeholder="${ph}" value="${esc(val || '')}">`;
        return `
            <div class="hof-block">
                <h4>${esc(b.name)}</h4>
                <div class="hof-grid">
                    ${inp('p1', '🥇 1. Platz', d.p1)}
                    ${inp('p2', '🥈 2. Platz', d.p2)}
                    ${inp('p3_1', '🥉 3. Platz', d.p3_1 || d.p3)}
                    ${inp('p3_2', '🥉 3. Platz (optional)', d.p3_2)}
                </div>
                <div style="margin-top:8px;">${inp('trost', 'Trostbewerb-Sieger (optional)', d.trost)}</div>
            </div>`;
    }).join('');
}

async function loadFotos(t) {
    const gallery = document.getElementById('fotoGallery');
    const prefix = t?.fotos_prefix;
    if (!prefix) {
        gallery.innerHTML = '<div class="muted small">Noch keine Fotos hochgeladen.</div>';
        return;
    }
    try {
        const cleanPrefix = String(prefix).replace(/^\/+|\/+$/g, '');
        const { data: files } = throwIfError(await supabase.storage.from('fotos').list(cleanPrefix, { limit: 1000 }));
        const valid = (files || []).filter(f => f.name && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name));
        gallery.innerHTML = valid.length
            ? valid.map(f => {
                const path = `${cleanPrefix}/${f.name}`;
                return `
                    <div class="thumb">
                        <img src="${esc(publicFotoUrl(path))}" loading="lazy" alt="">
                        <button data-del-foto="${esc(path)}" title="Foto löschen">${icon('x')}</button>
                    </div>`;
            }).join('')
            : '<div class="muted small">Noch keine Fotos hochgeladen.</div>';
    } catch (err) {
        console.error('Fehler beim Laden der Fotos:', err);
        gallery.innerHTML = '<div class="muted small">Fehler beim Laden der Fotos.</div>';
    }
}

export async function saveHallOfFame() {
    const tId = selectedId();
    if (!tId) return;
    await withBusy(document.getElementById('saveHallOfFameBtn'), async () => {
        try {
            const hofData = {};
            document.querySelectorAll('.hof-input').forEach(inp => {
                const b = inp.dataset.bewerb;
                hofData[b] ||= {};
                const val = inp.value.trim();
                if (val) hofData[b][inp.dataset.pos] = val;
            });
            throwIfError(await supabase.from('tournaments').update({ hall_of_fame: hofData }).eq('id', tId));
            const t = findTournament(tId);
            if (t) t.hall_of_fame = hofData;
            showToast('Hall of Fame gespeichert');
        } catch (err) {
            console.error('Fehler beim Speichern:', err);
            showToast('Fehler beim Speichern.', true);
        }
    });
}

export async function saveArchivOettv() {
    const tId = selectedId();
    const url = document.getElementById('archivOettvUrl').value.trim();
    await withBusy(document.getElementById('saveArchivOettvBtn'), async () => {
        try {
            throwIfError(await supabase.from('tournaments').update({ oettv_url: url }).eq('id', tId));
            const t = findTournament(tId);
            if (t) t.oettv_url = url;
            showToast('ÖTTV-Link gespeichert');
        } catch (err) {
            console.error('Fehler beim Speichern:', err);
            showToast('Fehler beim Speichern.', true);
        }
    }, '…');
}

export async function uploadErgebnisPdf() {
    const tId = selectedId();
    const label = document.getElementById('ergLabel').value.trim();
    const fileInput = document.getElementById('ergFile');
    if (!tId || !label || fileInput.files.length === 0) {
        showToast('Bitte Bezeichnung eingeben und PDF auswählen.', true);
        return;
    }
    await withBusy(document.getElementById('uploadErgBtn'), async () => {
        try {
            const file = fileInput.files[0];
            const { data: uploadData, error: uploadErr } = await supabase.storage
                .from('pdfs')
                .upload(`${Date.now()}_${safeFileName(file.name)}`, file);
            if (uploadErr) throw uploadErr;
            throwIfError(await supabase.from('ergebnisse').insert({
                tournament_id: tId, label, path: uploadData.path, file_name: file.name
            }));
            document.getElementById('ergLabel').value = '';
            fileInput.value = '';
            await loadArchivData();
            showToast('PDF hochgeladen');
        } catch (err) {
            console.error('Fehler beim Upload:', err);
            showToast('Fehler beim Upload: ' + (err.message || err), true);
        }
    }, 'Lädt…');
}

export function initArchiveEvents() {
    document.getElementById('archivSelect').addEventListener('change', loadArchivData);
    document.getElementById('saveArchivOettvBtn').addEventListener('click', saveArchivOettv);
    document.getElementById('saveHallOfFameBtn').addEventListener('click', saveHallOfFame);
    document.getElementById('uploadErgBtn').addEventListener('click', uploadErgebnisPdf);
    document.getElementById('editBewerbeBtn').addEventListener('click', openBewerbeEditor);

    document.getElementById('ergList').addEventListener('click', async e => {
        const btn = e.target.closest('[data-del-erg]');
        if (!btn) return;
        const ok = await confirmDialog({ title: 'Ergebnis löschen?', message: btn.dataset.label, confirmText: 'Löschen', danger: true });
        if (!ok) return;
        try {
            // Datei evtl. schon weg → DB-Eintrag trotzdem löschen, damit kein toter Link bleibt
            const { error: storageError } = await supabase.storage.from('pdfs').remove([btn.dataset.path]);
            if (storageError) console.error('Storage-Fehler:', storageError);
            throwIfError(await supabase.from('ergebnisse').delete().eq('id', btn.dataset.delErg));
            await loadArchivData();
            showToast('PDF gelöscht');
        } catch (err) {
            console.error('Fehler beim Löschen:', err);
            showToast('Fehler beim Löschen.', true);
        }
    });

    document.getElementById('fotoGallery').addEventListener('click', async e => {
        const btn = e.target.closest('[data-del-foto]');
        if (!btn) return;
        const ok = await confirmDialog({ title: 'Foto löschen?', message: 'Das Foto wird aus der Galerie entfernt.', confirmText: 'Löschen', danger: true });
        if (!ok) return;
        try {
            throwIfError(await supabase.storage.from('fotos').remove([btn.dataset.delFoto]));
            await loadArchivData();
            showToast('Foto gelöscht');
        } catch (err) {
            console.error('Fehler beim Löschen:', err);
            showToast('Fehler beim Löschen.', true);
        }
    });
}

export function initFotoUpload() {
    const dropZone = document.getElementById('dropZone');
    const fotoFiles = document.getElementById('fotoFiles');
    const uploadBtn = document.getElementById('uploadFotosBtn');
    const label = dropZone.querySelector('strong');

    const picked = n => {
        uploadBtn.style.display = n ? '' : 'none';
        label.textContent = n ? `${n} ${n === 1 ? 'Bild' : 'Bilder'} ausgewählt` : 'Bilder hierher ziehen';
    };

    dropZone.addEventListener('click', () => fotoFiles.click());
    dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fotoFiles.click(); } });
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag');
        if (e.dataTransfer.files.length) {
            fotoFiles.files = e.dataTransfer.files;
            picked(fotoFiles.files.length);
        }
    });
    fotoFiles.addEventListener('change', () => picked(fotoFiles.files.length));
    uploadBtn.addEventListener('click', () => uploadFotos(() => picked(0)));
}

async function uploadFotos(done) {
    const tId = selectedId();
    const t = findTournament(tId);
    const status = document.getElementById('fotoStatus');
    const uploadBtn = document.getElementById('uploadFotosBtn');
    const fotoFiles = document.getElementById('fotoFiles');
    if (!t) return;

    uploadBtn.disabled = true;
    try {
        let prefix = t.fotos_prefix;
        if (!prefix) {
            prefix = tId;
            throwIfError(await supabase.from('tournaments').update({ fotos_prefix: prefix }).eq('id', tId));
            t.fotos_prefix = prefix;
        }

        const files = Array.from(fotoFiles.files);
        let ok = 0;
        for (let i = 0; i < files.length; i++) {
            status.textContent = `Lade Bild ${i + 1} von ${files.length} …`;
            const { error } = await supabase.storage
                .from('fotos')
                .upload(`${prefix}/${Date.now()}_${safeFileName(files[i].name)}`, files[i]);
            if (error) console.error(`Upload fehlgeschlagen (${files[i].name}):`, error);
            else ok++;
        }
        const failed = files.length - ok;
        status.textContent = failed ? `${ok} hochgeladen, ${failed} fehlgeschlagen` : `${ok} Bilder hochgeladen`;
        showToast(failed ? `${failed} Bild(er) konnten nicht hochgeladen werden.` : `${ok} Bilder hochgeladen`, failed > 0);
        fotoFiles.value = '';
        done();
        await loadArchivData();
    } catch (err) {
        console.error('Fehler beim Upload:', err);
        showToast('Fehler beim Hochladen.', true);
    } finally {
        uploadBtn.disabled = false;
        setTimeout(() => { status.textContent = ''; }, 4000);
    }
}

/**
 * Dialog zum Bearbeiten der Bewerbe eines (alten) Turniers
 */
export function openBewerbeEditor() {
    const t = findTournament(selectedId());
    if (!t) return;
    const bewerbe = parseBewerbe(t);

    const rowHtml = (b = {}, i = null) => `
        <div class="repeat-row compact bw-edit-row" ${i !== null ? `data-orig-index="${i}"` : ''}>
            <input type="text" class="input" value="${esc(b.name || '')}" placeholder="Name" style="flex:2;">
            <input type="text" class="input" value="${esc(b.time || '')}" placeholder="Startzeit" style="flex:1;">
            <input type="number" class="input" value="${esc(b.min_rc || 0)}" title="Min. RC" style="width:80px;">
            <input type="number" class="input" value="${esc(b.capacity || 20)}" title="Plätze" style="width:80px;">
            <button type="button" class="icon-btn danger" data-remove title="Entfernen">${icon('x')}</button>
        </div>`;

    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
        <div class="modal-head">
            <h2>Bewerbe: ${esc(t.name)}</h2>
            <button type="button" class="icon-btn" data-close aria-label="Schließen">${icon('x')}</button>
        </div>
        <div class="modal-body">
            <p class="small muted" style="margin-bottom:12px;">Name · Startzeit · Min. RC · Plätze. Umbenennungen werden in die Hall of Fame übernommen.</p>
            <div class="repeat-list" id="bewerbeEditorList">${bewerbe.map(rowHtml).join('')}</div>
            <button type="button" class="btn block" data-add style="margin-top:10px;">${icon('plus')}Bewerb hinzufügen</button>
        </div>
        <div class="modal-foot">
            <button type="button" class="btn" data-close>Abbrechen</button>
            <button type="button" class="btn primary" id="saveBewerbeEditorBtn">Bewerbe speichern</button>
        </div>`;
    document.body.appendChild(dlg);
    const closeDlg = () => { if (dlg.open) dlg.close(); dlg.remove(); };
    dlg.addEventListener('close', closeDlg);
    dlg.showModal();

    const list = dlg.querySelector('#bewerbeEditorList');
    dlg.addEventListener('click', e => {
        if (e.target.closest('[data-close]')) closeDlg();
        if (e.target.closest('[data-add]')) list.insertAdjacentHTML('beforeend', rowHtml());
        const rm = e.target.closest('[data-remove]');
        if (rm) {
            if (list.children.length > 1) rm.closest('.bw-edit-row').remove();
            else showToast('Mindestens ein Bewerb muss bleiben.', true);
        }
    });

    dlg.querySelector('#saveBewerbeEditorBtn').addEventListener('click', async () => {
        const newBewerbe = [];
        const renamed = {}; // alter Name → neuer Name
        list.querySelectorAll('.bw-edit-row').forEach(row => {
            const inputs = row.querySelectorAll('input');
            const name = inputs[0].value.trim();
            if (!name) return;
            // Bestehenden Bewerb als Basis nehmen, damit Felder wie prize/duration erhalten bleiben
            const origIndex = row.getAttribute('data-orig-index');
            const orig = origIndex !== null ? bewerbe[parseInt(origIndex, 10)] : null;
            if (orig && orig.name !== name) renamed[orig.name] = name;
            newBewerbe.push({
                duration: 3,
                ...(orig || {}),
                name,
                time: inputs[1].value.trim(),
                min_rc: parseInt(inputs[2].value, 10) || 0,
                capacity: parseInt(inputs[3].value, 10) || 20
            });
        });

        if (!newBewerbe.length) {
            showToast('Mindestens ein Bewerb benötigt.', true);
            return;
        }

        // Hall of Fame hängt am Bewerbsnamen → Umbenennungen übernehmen
        let newHof = t.hall_of_fame;
        if (newHof && Object.keys(renamed).length > 0) {
            newHof = {};
            for (const [key, val] of Object.entries(t.hall_of_fame)) newHof[renamed[key] || key] = val;
        }

        try {
            const update = { bewerbe: JSON.stringify(newBewerbe) };
            if (newHof !== t.hall_of_fame) update.hall_of_fame = newHof;
            throwIfError(await supabase.from('tournaments').update(update).eq('id', t.id));
            t.bewerbe = newBewerbe;
            if (update.hall_of_fame) t.hall_of_fame = newHof;
            closeDlg();
            showToast('Bewerbe gespeichert');
            await loadArchivData();
        } catch (err) {
            console.error('Fehler beim Speichern:', err);
            showToast('Fehler beim Speichern.', true);
        }
    });
}
