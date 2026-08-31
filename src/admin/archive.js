// src/admin/archive.js
import { supabase, publicPdfUrl, publicFotoUrl } from '../shared/supabase.js';
import { esc, showToast } from '../shared/utils.js';
import { parseBewerbe } from '../shared/utils.js';

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
    select.innerHTML = '';

    allTournaments.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.name + (t.id === activeTournamentId ? " (Aktuelles Turnier)" : " (Archiv)");
        select.appendChild(option);
    });

    select.addEventListener('change', loadArchivData);
    loadArchivData();
}

export async function loadArchivData() {
    const tId = document.getElementById('archivSelect')?.value;
    if (!tId) return;

    try {
        const t = allTournaments.find(x => x.id === tId);

        // ÖTTV-Link
        const oettvInput = document.getElementById('archivOettvUrl');
        if (oettvInput) oettvInput.value = t?.oettv_url || '';

        // Hall of Fame
        await renderHallOfFame(t);

        // Ergebnisse (PDF) laden
        const { data: ergs, error: ergError } = await supabase
            .from('ergebnisse')
            .select('*')
            .eq('tournament_id', tId);

        if (ergError) throw ergError;

        const ergList = document.getElementById('ergList');
        if (ergList) {
            ergList.innerHTML = '';
            if (ergs && ergs.length > 0) {
                ergs.forEach(erg => {
                    const li = document.createElement('li');
                    li.style.marginBottom = "8px";
                    li.innerHTML = `
                        <strong>${esc(erg.label)}</strong> 
                        <span style="color:var(--text-muted); font-size:12px;">(${esc(erg.file_name)})</span> 
                        <button class="btn-outline btn-small delete-erg-btn" data-id="${erg.id}" data-path="${esc(erg.path)}" style="color: var(--error); border-color: var(--error); margin-left:10px;">Löschen</button>
                    `;
                    ergList.appendChild(li);
                });

                document.querySelectorAll('.delete-erg-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        if (!confirm("Ergebnis wirklich löschen?")) return;
                        try {
                            const path = e.currentTarget.getAttribute('data-path');
                            const id = e.currentTarget.getAttribute('data-id');

                            console.log('Lösche PDF:', { path, id }); // ← DEBUG

                            // Erst aus Storage löschen
                            const { error: storageError } = await supabase.storage.from('pdfs').remove([path]);
                            if (storageError) {
                                console.error('Storage-Fehler:', storageError);
                                // Falls Storage-Fehler, trotzdem Datenbank-Eintrag löschen?
                            }

                            // Dann aus Datenbank löschen
                            const { error: dbError } = await supabase.from('ergebnisse').delete().eq('id', id);
                            if (dbError) throw dbError;

                            await loadArchivData();
                            showToast('PDF gelöscht!');
                        } catch (err) {
                            console.error('Fehler beim Löschen:', err);
                            showToast('Fehler beim Löschen.', true);
                        }
                    });
                });
            } else {
                ergList.innerHTML = "<li style='color:var(--text-muted);'>Noch keine Ergebnisse hochgeladen.</li>";
            }
        }

        // Fotos laden
        await loadFotos(t);

    } catch (err) {
        console.error('Fehler beim Laden der Archiv-Daten:', err);
        showToast('Fehler beim Laden der Archiv-Daten.', true);
    }
}

async function renderHallOfFame(t) {
    const hofContainer = document.getElementById('hallOfFameContainer');
    if (!hofContainer) return;

    hofContainer.innerHTML = '';
    const bewerbe = parseBewerbe(t);
    const hofData = t?.hall_of_fame || {};

    bewerbe.forEach(b => {
        const bName = b.name;
        const bData = hofData[bName] || { p1: '', p2: '', p3_1: '', p3_2: '', trost: '' };
        const p3_1_val = bData.p3_1 || bData.p3 || '';

        const html = `
            <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 6px; margin-bottom: 15px; border: 1px solid var(--border);">
                <h4 style="color: var(--text-main); margin-bottom: 10px;">${esc(bName)}</h4>
                <div class="frow" style="margin-bottom: 10px;">
                    <div style="flex:1;"><input type="text" class="input-field hof-input" data-bewerb="${esc(bName)}" data-pos="p1" placeholder="1. Platz" value="${esc(bData.p1)}" style="width:100%;"></div>
                    <div style="flex:1;"><input type="text" class="input-field hof-input" data-bewerb="${esc(bName)}" data-pos="p2" placeholder="2. Platz" value="${esc(bData.p2)}" style="width:100%;"></div>
                </div>
                <div class="frow" style="margin-bottom: 10px;">
                    <div style="flex:1;"><input type="text" class="input-field hof-input" data-bewerb="${esc(bName)}" data-pos="p3_1" placeholder="3. Platz" value="${esc(p3_1_val)}" style="width:100%;"></div>
                    <div style="flex:1;"><input type="text" class="input-field hof-input" data-bewerb="${esc(bName)}" data-pos="p3_2" placeholder="3. Platz (Optional)" value="${esc(bData.p3_2)}" style="width:100%;"></div>
                </div>
                <div class="frow">
                    <div style="flex:1;"><input type="text" class="input-field hof-input" data-bewerb="${esc(bName)}" data-pos="trost" placeholder="Trostbewerb Sieger (Optional)" value="${esc(bData.trost)}" style="width:100%;"></div>
                </div>
            </div>
        `;
        hofContainer.insertAdjacentHTML('beforeend', html);
    });
}

async function loadFotos(t) {
    const fotoGallery = document.getElementById('fotoGallery');
    if (!fotoGallery) return;

    fotoGallery.innerHTML = '';
    const prefix = t?.fotos_prefix;

    if (!prefix) {
        fotoGallery.innerHTML = "<div style='color:var(--text-muted);'>Noch keine Fotos hochgeladen.</div>";
        return;
    }

    try {
        const cleanPrefix = String(prefix).replace(/^\/+|\/+$/g, "");
        const { data: files, error } = await supabase.storage.from("fotos").list(cleanPrefix, { limit: 100 });

        if (error) throw error;

        if (!files || files.length === 0) {
            fotoGallery.innerHTML = "<div style='color:var(--text-muted);'>Noch keine Fotos hochgeladen.</div>";
            return;
        }

        const validFiles = files.filter(f => f.name && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name));

        if (validFiles.length === 0) {
            fotoGallery.innerHTML = "<div style='color:var(--text-muted);'>Noch keine Fotos hochgeladen.</div>";
            return;
        }

        validFiles.forEach(f => {
            const url = publicFotoUrl(`${cleanPrefix}/${f.name}`);
            if (!url) return;

            const div = document.createElement('div');
            div.style.position = "relative";
            div.innerHTML = `
                <img src="${url}" style="width: 100px; height: 100px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border);">
                <button class="delete-foto-btn" data-path="${cleanPrefix}/${f.name}" style="position: absolute; top: -5px; right: -5px; background: var(--error); color: #fff; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 12px; font-weight: bold;">×</button>
            `;
            fotoGallery.appendChild(div);
        });

        document.querySelectorAll('.delete-foto-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!confirm("Foto wirklich löschen?")) return;
                try {
                    await supabase.storage.from('fotos').remove([e.currentTarget.getAttribute('data-path')]);
                    await loadArchivData();
                    showToast('Foto gelöscht!');
                } catch (err) {
                    console.error('Fehler beim Löschen:', err);
                    showToast('Fehler beim Löschen.', true);
                }
            });
        });

    } catch (err) {
        console.error('Fehler beim Laden der Fotos:', err);
        fotoGallery.innerHTML = "<div style='color:var(--text-muted);'>Fehler beim Laden der Fotos.</div>";
    }
}

export async function saveHallOfFame() {
    const tId = document.getElementById('archivSelect')?.value;
    if (!tId) {
        showToast('Bitte wähle ein Turnier aus.', true);
        return;
    }

    const btn = document.getElementById('saveHallOfFameBtn');
    btn.textContent = "Speichere...";
    btn.disabled = true;

    try {
        const inputs = document.querySelectorAll('.hof-input');
        const hofData = {};

        inputs.forEach(inp => {
            const bName = inp.getAttribute('data-bewerb');
            const pos = inp.getAttribute('data-pos');
            if (!hofData[bName]) hofData[bName] = {};
            const val = inp.value.trim();
            if (val) hofData[bName][pos] = val;
        });

        const { error } = await supabase
            .from('tournaments')
            .update({ hall_of_fame: hofData })
            .eq('id', tId);

        if (error) throw error;

        // Update local cache
        const t = allTournaments.find(x => x.id === tId);
        if (t) t.hall_of_fame = hofData;

        btn.textContent = "Erfolgreich gespeichert!";
        showToast('Hall of Fame gespeichert!');
        setTimeout(() => {
            btn.textContent = "🏆 Sieger speichern";
            btn.disabled = false;
        }, 2000);

    } catch (err) {
        console.error('Fehler beim Speichern:', err);
        showToast('Fehler beim Speichern.', true);
        btn.textContent = "🏆 Sieger speichern";
        btn.disabled = false;
    }
}

export async function saveArchivOettv() {
    const tId = document.getElementById('archivSelect')?.value;
    const url = document.getElementById('archivOettvUrl')?.value.trim();
    const btn = document.getElementById('saveArchivOettvBtn');

    btn.textContent = "...";
    btn.disabled = true;

    try {
        const { error } = await supabase
            .from('tournaments')
            .update({ oettv_url: url })
            .eq('id', tId);

        if (error) throw error;

        const t = allTournaments.find(x => x.id === tId);
        if (t) t.oettv_url = url;

        btn.textContent = "Gespeichert!";
        showToast('ÖTTV-Link gespeichert!');
        setTimeout(() => {
            btn.textContent = "Speichern";
            btn.disabled = false;
        }, 2000);

    } catch (err) {
        console.error('Fehler beim Speichern:', err);
        showToast('Fehler beim Speichern.', true);
        btn.textContent = "Speichern";
        btn.disabled = false;
    }
}

export async function uploadErgebnisPdf() {
    const tId = document.getElementById('archivSelect')?.value;
    const label = document.getElementById('ergLabel')?.value.trim();
    const fileInput = document.getElementById('ergFile');

    if (!tId || !label || !fileInput || fileInput.files.length === 0) {
        showToast('Bitte Bezeichnung eingeben und PDF auswählen.', true);
        return;
    }

    const btn = document.getElementById('uploadErgBtn');
    btn.textContent = "Lädt...";
    btn.disabled = true;

    try {
        const file = fileInput.files[0];
        const { data: uploadData, error: uploadErr } = await supabase
            .storage
            .from('pdfs')
            .upload(`${Date.now()}_${file.name}`, file);

        if (uploadErr) throw uploadErr;

        const { error } = await supabase
            .from('ergebnisse')
            .insert({
                tournament_id: tId,
                label: label,
                path: uploadData.path,
                file_name: file.name
            });

        if (error) throw error;

        document.getElementById('ergLabel').value = '';
        fileInput.value = '';
        await loadArchivData();
        showToast('PDF hochgeladen!');

    } catch (err) {
        console.error('Fehler beim Upload:', err);
        showToast('Fehler beim Upload.', true);
    } finally {
        btn.textContent = "Hochladen";
        btn.disabled = false;
    }
}

export function initArchiveEvents() {
    document.getElementById('saveArchivOettvBtn')?.addEventListener('click', saveArchivOettv);
    document.getElementById('saveHallOfFameBtn')?.addEventListener('click', saveHallOfFame);
    document.getElementById('uploadErgBtn')?.addEventListener('click', uploadErgebnisPdf);
    document.getElementById('editBewerbeBtn')?.addEventListener('click', openBewerbeEditor);
}

export function initFotoUpload() {
    const dropZone = document.getElementById('dropZone');
    const fotoFiles = document.getElementById('fotoFiles');
    const uploadFotosBtn = document.getElementById('uploadFotosBtn');

    if (!dropZone || !fotoFiles || !uploadFotosBtn) return;

    dropZone.addEventListener('click', () => fotoFiles.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.background = 'rgba(92,184,116,0.2)';
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.background = 'rgba(92,184,116,0.05)';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.background = 'rgba(92,184,116,0.05)';
        if (e.dataTransfer.files.length > 0) {
            fotoFiles.files = e.dataTransfer.files;
            uploadFotosBtn.style.display = 'block';
            const label = dropZone.querySelector('div:nth-child(2)');
            if (label) label.textContent = `${e.dataTransfer.files.length} Bilder ausgewählt`;
        }
    });

    fotoFiles.addEventListener('change', () => {
        if (fotoFiles.files.length > 0) {
            uploadFotosBtn.style.display = 'block';
            const label = dropZone.querySelector('div:nth-child(2)');
            if (label) label.textContent = `${fotoFiles.files.length} Bilder ausgewählt`;
        }
    });

    uploadFotosBtn.addEventListener('click', uploadFotos);
}

async function uploadFotos() {
    const tId = document.getElementById('archivSelect')?.value;
    const t = allTournaments.find(x => x.id === tId);
    const statusDiv = document.getElementById('fotoStatus');
    const uploadBtn = document.getElementById('uploadFotosBtn');
    const fotoFiles = document.getElementById('fotoFiles');

    if (!tId || !t) {
        showToast('Bitte wähle ein Turnier aus.', true);
        return;
    }

    uploadBtn.disabled = true;
    let prefix = t.fotos_prefix;

    try {
        if (!prefix) {
            prefix = tId;
            const { error } = await supabase
                .from('tournaments')
                .update({ fotos_prefix: prefix })
                .eq('id', tId);
            if (error) throw error;
            t.fotos_prefix = prefix;
        }

        const files = Array.from(fotoFiles.files);
        let successCount = 0;

        for (let i = 0; i < files.length; i++) {
            if (statusDiv) statusDiv.textContent = `Lade Bild ${i + 1} von ${files.length} hoch...`;
            const file = files[i];
            const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const { error } = await supabase
                .storage
                .from('fotos')
                .upload(`${prefix}/${Date.now()}_${safeName}`, file);
            if (!error) successCount++;
        }

        if (statusDiv) {
            statusDiv.textContent = `${successCount} Bilder erfolgreich hochgeladen!`;
        }

        fotoFiles.value = '';
        uploadBtn.style.display = 'none';
        const label = document.getElementById('dropZone')?.querySelector('div:nth-child(2)');
        if (label) label.textContent = 'Bilder hierher ziehen';

        showToast(`${successCount} Bilder hochgeladen!`);
        await loadArchivData();

    } catch (err) {
        console.error('Fehler beim Upload:', err);
        showToast('Fehler beim Hochladen.', true);
    } finally {
        uploadBtn.disabled = false;
        setTimeout(() => {
            if (statusDiv) statusDiv.textContent = '';
        }, 3000);
    }
}

/**
 * Öffnet ein Modal zum Bearbeiten der Bewerbe eines Turniers
 */
export function openBewerbeEditor() {
    const tId = document.getElementById('archivSelect')?.value;
    if (!tId) {
        showToast('Bitte wähle ein Turnier aus.', true);
        return;
    }

    const t = allTournaments.find(x => x.id === tId);
    if (!t) {
        showToast('Turnier nicht gefunden.', true);
        return;
    }

    // Bestehende Bewerbe laden
    let bewerbe = [];
    try {
        bewerbe = typeof t.bewerbe === 'string' ? JSON.parse(t.bewerbe) : (t.bewerbe || []);
    } catch (e) {
        bewerbe = [];
    }

    // Modal erstellen
    const modal = document.createElement('dialog');
    modal.className = 'admin-modal';
    modal.innerHTML = `
        <div class="modal-header">
            <h3>Bewerbe bearbeiten: ${esc(t.name)}</h3>
            <button class="close-btn" onclick="this.closest('dialog').close()">×</button>
        </div>
        <div class="modal-body">
            <div id="bewerbeEditorList">
                ${bewerbe.map((b, i) => `
                    <div class="bewerb-row" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                        <input type="text" class="input-field" value="${esc(b.name)}" placeholder="Bewerb Name" style="flex:2; min-width:150px;">
                        <input type="text" class="input-field" value="${esc(b.time || '')}" placeholder="Startzeit" style="flex:1; min-width:100px;">
                        <input type="number" class="input-field" value="${b.min_rc || 0}" placeholder="Min RC" style="flex:1; min-width:80px;">
                        <input type="number" class="input-field" value="${b.capacity || 20}" placeholder="Kapazität" style="flex:1; min-width:80px;">
                        <button class="btn-outline btn-small remove-bewerb-editor" style="color:var(--error); border-color:var(--error);">✕</button>
                    </div>
                `).join('')}
            </div>
            <button id="addBewerbEditorBtn" class="btn-outline" style="margin-top:10px; width:100%;">+ Bewerb hinzufügen</button>
            <div style="margin-top:20px; display:flex; gap:10px;">
                <button id="saveBewerbeEditorBtn" class="btn-outline" style="background:var(--accent); color:#000; font-weight:bold; flex:1;">Bewerbe speichern</button>
                <button class="btn-outline" onclick="this.closest('dialog').close()" style="flex:1;">Abbrechen</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.showModal();

    // Event: Bewerb hinzufügen
    modal.querySelector('#addBewerbEditorBtn').addEventListener('click', () => {
        const list = modal.querySelector('#bewerbeEditorList');
        const row = document.createElement('div');
        row.className = 'bewerb-row';
        row.style.cssText = 'display:flex; gap:10px; align-items:center; flex-wrap:wrap;';
        row.innerHTML = `
            <input type="text" class="input-field" placeholder="Bewerb Name" style="flex:2; min-width:150px;">
            <input type="text" class="input-field" placeholder="Startzeit" style="flex:1; min-width:100px;">
            <input type="number" class="input-field" value="0" placeholder="Min RC" style="flex:1; min-width:80px;">
            <input type="number" class="input-field" value="20" placeholder="Kapazität" style="flex:1; min-width:80px;">
            <button class="btn-outline btn-small remove-bewerb-editor" style="color:var(--error); border-color:var(--error);">✕</button>
        `;
        list.appendChild(row);

        row.querySelector('.remove-bewerb-editor').addEventListener('click', () => {
            if (list.children.length > 1) {
                row.remove();
            } else {
                showToast('Mindestens ein Bewerb muss bleiben.', true);
            }
        });
    });

    // Event: Bewerb entfernen (für bestehende)
    modal.querySelectorAll('.remove-bewerb-editor').forEach(btn => {
        btn.addEventListener('click', () => {
            const list = modal.querySelector('#bewerbeEditorList');
            if (list.children.length > 1) {
                btn.closest('.bewerb-row').remove();
            } else {
                showToast('Mindestens ein Bewerb muss bleiben.', true);
            }
        });
    });

    // Event: Speichern
    modal.querySelector('#saveBewerbeEditorBtn').addEventListener('click', async () => {
        const rows = modal.querySelectorAll('#bewerbeEditorList .bewerb-row');
        const newBewerbe = [];

        rows.forEach(row => {
            const inputs = row.querySelectorAll('input');
            const name = inputs[0].value.trim();
            if (name) {
                newBewerbe.push({
                    name: name,
                    time: inputs[1].value.trim(),
                    min_rc: parseInt(inputs[2].value, 10) || 0,
                    capacity: parseInt(inputs[3].value, 10) || 20,
                    duration: 3
                });
            }
        });

        if (newBewerbe.length === 0) {
            showToast('Mindestens ein Bewerb benötigt.', true);
            return;
        }

        try {
            const { error } = await supabase
                .from('tournaments')
                .update({ bewerbe: JSON.stringify(newBewerbe) })
                .eq('id', tId);

            if (error) throw error;

            // Lokalen Cache aktualisieren
            t.bewerbe = newBewerbe;

            modal.close();
            showToast('Bewerbe gespeichert!');

            // Archiv neu laden (für Hall of Fame)
            await loadArchivData();

        } catch (err) {
            console.error('Fehler beim Speichern:', err);
            showToast('Fehler beim Speichern.', true);
        }
    });
}