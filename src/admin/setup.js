// src/admin/setup.js
import { supabase } from '../shared/supabase.js';
import { esc, showToast, formatForDateTimeLocal, parseBewerbe } from '../shared/utils.js';
import { DEFAULT_FEE_NORMAL, DEFAULT_FEE_NFS, DEFAULT_BEWERBE } from '../shared/constants.js';

const QRCode = window.QRCode;

let setupBewerbeList = [];
let allTournaments = [];
let activeTournamentId = null;

export function setSetupTournamentId(id) {
    activeTournamentId = id;
}

export function setSetupTournaments(data) {
    allTournaments = data;
}

export function renderSetupBewerbe() {
    const container = document.getElementById('bewerbeContainer');
    if (!container) return;
    container.innerHTML = '';

    setupBewerbeList.forEach((b, index) => {
        const div = document.createElement('div');
        div.style.background = "rgba(0,0,0,0.2)";
        div.style.padding = "15px";
        div.style.borderRadius = "6px";
        div.style.marginBottom = "10px";
        div.style.border = "1px solid rgba(255,255,255,0.05)";

        div.innerHTML = `
            <div class="frow" style="margin-bottom: 10px;">
                <div style="flex:2;"><label>Bewerbs-Name:</label><input type="text" class="input-field bewerb-name" value="${esc(b.name)}" style="width: 100%;"></div>
                <div style="flex:1;"><label>Startzeit (z.B. Sa 09:30):</label><input type="text" class="input-field bewerb-time" value="${esc(b.time || '')}" style="width: 100%;"></div>
                <div style="flex:1;"><label>Dauer (Std):</label><input type="number" class="input-field bewerb-duration" value="${b.duration || 3}" style="width: 100%;"></div>
            </div>
            <div class="frow" style="align-items: flex-end;">
                <div style="flex:1;"><label>Min RC-Punkte:</label><input type="number" class="input-field bewerb-rc" value="${b.min_rc || 0}" style="width: 100%;"></div>
                <div style="flex:1;"><label>Kapazität:</label><input type="number" class="input-field bewerb-cap" value="${b.capacity || 20}" style="width: 100%;"></div>
                <div style="flex:1;"><label>Preisgeld (Optional):</label><input type="text" class="input-field bewerb-prize" value="${esc(b.prize || '')}" style="width: 100%;"></div>
                <div><button type="button" class="btn-outline remove-bewerb-btn" data-index="${index}" style="color: var(--error); border-color: var(--error);">Entfernen</button></div>
            </div>
        `;
        container.appendChild(div);
    });

    document.querySelectorAll('.remove-bewerb-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            setupBewerbeList.splice(idx, 1);
            renderSetupBewerbe();
        });
    });
}

export function getBewerbeFromDOM() {
    const names = document.querySelectorAll('.bewerb-name');
    const times = document.querySelectorAll('.bewerb-time');
    const durations = document.querySelectorAll('.bewerb-duration');
    const rcs = document.querySelectorAll('.bewerb-rc');
    const caps = document.querySelectorAll('.bewerb-cap');
    const prizes = document.querySelectorAll('.bewerb-prize');

    const newList = [];
    for (let i = 0; i < names.length; i++) {
        if (names[i].value.trim() !== '') {
            newList.push({
                name: names[i].value.trim(),
                time: times[i].value,
                duration: parseInt(durations[i].value, 10) || 3,
                min_rc: parseInt(rcs[i].value, 10) || 0,
                capacity: parseInt(caps[i].value, 10) || 20,
                prize: prizes[i].value.trim()
            });
        }
    }
    return newList;
}

export function generateQRCodes(oettvUrl) {
    const anmeldeUrl = "https://nfs-trophy.com/#anmelden";
    const qrA = document.getElementById("qrAnmeldung");
    if (qrA) {
        qrA.innerHTML = "";
        try {
            new QRCode(qrA, { text: anmeldeUrl, width: 150, height: 150 });
        } catch (e) {
            qrA.innerHTML = '<span style="color: #000; font-size: 14px;">QR-Code konnte nicht geladen werden</span>';
        }
    }

    const qrE = document.getElementById("qrErgebnisse");
    const hint = document.getElementById("qrErgebnisseHint");
    const btn = document.getElementById("downloadQrErgebnisseBtn");

    if (qrE) {
        qrE.innerHTML = "";
        if (oettvUrl && oettvUrl.trim() !== "") {
            try {
                new QRCode(qrE, { text: oettvUrl, width: 150, height: 150 });
                if (hint) hint.textContent = "";
                if (btn) btn.style.display = "inline-block";
            } catch (e) {
                qrE.innerHTML = "<span style='color: #000; font-size: 14px;'>Fehler beim QR-Code</span>";
                if (hint) hint.textContent = "Bitte speichere erst eine ÖTTV-URL.";
                if (btn) btn.style.display = "none";
            }
        } else {
            qrE.innerHTML = "<span style='color: #000; font-size: 14px;'>Kein Link vorhanden</span>";
            if (hint) hint.textContent = "Bitte speichere erst eine ÖTTV-URL.";
            if (btn) btn.style.display = "none";
        }
    }
}

export function downloadQR(divId, filename) {
    const canvas = document.querySelector(`#${divId} canvas`);
    if (canvas) {
        const a = document.createElement('a');
        a.download = filename;
        a.href = canvas.toDataURL();
        a.click();
    } else {
        showToast('QR-Code nicht verfügbar.', true);
    }
}

export async function saveSetup() {
    if (!activeTournamentId) {
        showToast('Kein aktives Turnier.', true);
        return;
    }

    const btn = document.getElementById('saveSetupBtn');
    btn.textContent = "Speichere Einstellungen...";
    btn.disabled = true;

    try {
        const updatedBewerbeList = getBewerbeFromDOM();

        const infoObj = {
            bewerbeHeadline: document.getElementById('setupBewerbeHeadline')?.value.trim() || '',
            bewerbeText: document.getElementById('setupBewerbeText')?.value.trim() || '',
            fact1Title: document.getElementById('setupFact1Title')?.value.trim() || '',
            fact1Text: document.getElementById('setupFact1Text')?.value.trim() || '',
            fact2Title: document.getElementById('setupFact2Title')?.value.trim() || '',
            fact2Text: document.getElementById('setupFact2Text')?.value.trim() || '',
            fact3Title: document.getElementById('setupFact3Title')?.value.trim() || '',
            fact3Text: document.getElementById('setupFact3Text')?.value.trim() || '',
            fact4Title: document.getElementById('setupFact4Title')?.value.trim() || '',
            fact4Text: document.getElementById('setupFact4Text')?.value.trim() || ''
        };

        // ============================================
        // TTOP WERTE KORREKT SPEICHERN
        // ============================================
        const showTtop = document.getElementById('setupShowTtop')?.checked || false;
        const ttopUrl = document.getElementById('setupTtopUrl')?.value.trim() || '';

        console.log('💾 Speichere TTOP:', { showTtop, ttopUrl });

        const updateData = {
            is_open: document.getElementById('setupIsOpen')?.checked || false,
            name: document.getElementById('setupName')?.value.trim() || 'NFS Trophy',
            date_text: document.getElementById('setupDateText')?.value.trim() || '',
            date_iso: document.getElementById('setupDateIso')?.value ? new Date(document.getElementById('setupDateIso').value).toISOString() : new Date().toISOString(),
            subtitle: document.getElementById('setupSubtitle')?.value.trim() || '',
            oettv_url: document.getElementById('setupOettvUrl')?.value.trim() || '',
            fee_normal: parseInt(document.getElementById('setupFeeNormal')?.value, 10) || DEFAULT_FEE_NORMAL,
            fee_nfs: parseInt(document.getElementById('setupFeeNfs')?.value, 10) || DEFAULT_FEE_NFS,
            bewerbe: JSON.stringify(updatedBewerbeList),
            turnier_info: infoObj,
            // ============================================
            // DAS FEHLTE!
            // ============================================
            show_ttop_button: showTtop,
            ttop_url: ttopUrl
        };

        // PDF Upload
        const pdfInput = document.getElementById('setupPdf');
        if (pdfInput && pdfInput.files.length > 0) {
            const file = pdfInput.files[0];
            const { data: uploadData, error: uploadErr } = await supabase.storage.from('pdfs').upload(`${Date.now()}_${file.name}`, file);
            if (!uploadErr && uploadData) {
                updateData.ausschreibung_path = uploadData.path;
            }
        }

        const { error } = await supabase
            .from('tournaments')
            .update(updateData)
            .eq('id', activeTournamentId);

        if (error) throw error;

        setupBewerbeList = updatedBewerbeList;
        generateQRCodes(updateData.oettv_url);

        if (pdfInput) pdfInput.value = '';

        btn.textContent = "Einstellungen gespeichert!";
        showToast('Turnier-Einstellungen gespeichert!');
        setTimeout(() => {
            btn.textContent = "Turnier-Einstellungen speichern";
            btn.disabled = false;
        }, 2500);

    } catch (err) {
        console.error('Fehler beim Speichern:', err);
        showToast('Fehler beim Speichern.', true);
        btn.textContent = "Turnier-Einstellungen speichern";
        btn.disabled = false;
    }
}

export async function createNewTournament() {
    if (!confirm("Saisonwechsel durchführen?\n\nDadurch wird das aktuelle Turnier endgültig archiviert. Die Nennliste und das Kassenbuch werden geleert und ein komplett neues Turnier wird angelegt.\n\nMöchtest du wirklich fortfahren?")) return;

    const newName = prompt("Wie lautet der Name des NEUEN Turniers? (z.B. '9. NFS Trophy')");
    if (!newName) return;

    try {
        const newTournament = {
            name: newName,
            date_iso: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
            is_open: false,
            capacity: 20,
            fee_normal: DEFAULT_FEE_NORMAL,
            fee_nfs: DEFAULT_FEE_NFS,
            bewerbe: JSON.stringify(DEFAULT_BEWERBE)
        };

        const { error } = await supabase.from('tournaments').insert(newTournament);
        if (error) throw error;

        alert("Saisonwechsel erfolgreich! Die Seite lädt nun neu. Bitte passe im Turnier-Setup die restlichen Daten des neuen Turniers an.");
        window.location.reload();
    } catch (err) {
        console.error('Fehler beim Erstellen:', err);
        showToast('Fehler beim Erstellen des neuen Turniers.', true);
    }
}

export async function deleteTournament(allTournaments) {
    if (allTournaments.length <= 1) {
        alert("Das ist das einzige Turnier in der Datenbank. Löschen nicht möglich.");
        return;
    }

    if (!confirm("⚠️ GEFAHRENZONE!\n\nMöchtest du das AKTUELLE Turnier wirklich löschen? Dieser Schritt kann nicht rückgängig gemacht werden. Das vorherige Turnier (aus dem Archiv) wird dadurch wieder zum aktiven Turnier!")) return;

    try {
        const { error } = await supabase.from('tournaments').delete().eq('id', activeTournamentId);
        if (error) throw error;

        alert("Turnier gelöscht! Die Seite wird neu geladen und das vorherige Turnier ist wieder aktiv.");
        window.location.reload();
    } catch (err) {
        console.error('Fehler beim Löschen:', err);
        showToast('Fehler beim Löschen des Turniers.', true);
    }
}

export function initSetupEvents() {
    document.getElementById('addBewerbBtn')?.addEventListener('click', () => {
        setupBewerbeList.push({ name: `Neuer Bewerb`, time: "Sa 09:00", min_rc: 0, prize: "", capacity: 20, duration: 3 });
        renderSetupBewerbe();
    });

    document.getElementById('saveSetupBtn')?.addEventListener('click', saveSetup);
    document.getElementById('createNewTournamentBtn')?.addEventListener('click', createNewTournament);
    document.getElementById('deleteTournamentBtn')?.addEventListener('click', () => deleteTournament(allTournaments));

    document.getElementById('downloadQrAnmeldungBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        downloadQR('qrAnmeldung', 'QR_Anmeldung.png');
    });

    document.getElementById('downloadQrErgebnisseBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        downloadQR('qrErgebnisse', 'QR_Ergebnisse.png');
    });
}

export function getSetupBewerbeList() { return setupBewerbeList; }
export function setSetupBewerbeList(data) { setupBewerbeList = data; }