// src/frontend/app.js
import { supabase, publicPdfUrl, publicFotoUrl } from '../shared/supabase.js';
import { esc, showToast, rcNum, istWartelisteFuer, parseBewerbe, parseTurnierInfo } from '../shared/utils.js';
import { DEFAULT_FEE_NORMAL, DEFAULT_FEE_NFS } from '../shared/constants.js';
import { initGallery, setGalleries, openLightbox } from './gallery.js';

// ==========================================
// GLOBALE VARIABLEN
// ==========================================
let activeTournament = null;
let cachedRegs = [];
let galleries = {};

// ==========================================
// INIT
// ==========================================
async function init() {
    try {
        const [tournamentsResult, ergebnisseResult, registrationsResult] = await Promise.all([
            supabase.from("tournaments").select("*").order("date_iso", { ascending: false, nullsFirst: false }),
            supabase.from("ergebnisse").select("*").order("created_at", { ascending: true }),
            supabase.from("public_registrations").select("*")
        ]);

        if (tournamentsResult.error) throw tournamentsResult.error;

        const tournaments = tournamentsResult.data || [];
        const ergebnisse = ergebnisseResult.data || [];
        const registrations = registrationsResult.data || [];

        if (!tournaments || tournaments.length === 0) {
            document.getElementById("archiveList").innerHTML = '<div class="loading">Noch keine Turniere angelegt</div>';
            return;
        }

        cachedRegs = registrations || [];
        activeTournament = tournaments[0];
        const archive = tournaments.filter(t => t.id !== activeTournament.id);

        // Bewerbe parsen
        activeTournament.parsedBewerbe = parseBewerbe(activeTournament);

        renderHero(activeTournament);
        renderTurnierInfo(activeTournament);
        renderBewerbe(activeTournament);
        renderForm(activeTournament);
        renderNennstand(activeTournament, cachedRegs);
        renderCurrentFiles(activeTournament);
        await renderArchive(archive, ergebnisse || []);

        // Gallery initialisieren
        initGallery();

        // Impressum Toggle
        setupImpressumToggle();

    } catch (err) {
        console.error('Fehler beim Initialisieren:', err);
        showToast('Fehler beim Laden der Daten.', true);
        document.getElementById("archiveList").innerHTML = '<div class="loading">Verbindung zu Supabase fehlgeschlagen</div>';
    }
}

// ==========================================
// IMPRESSUM TOGGLE
// ==========================================
// src/frontend/app.js

function setupImpressumToggle() {
    const impHeader = document.getElementById("impressumHeader");
    const impContent = document.getElementById("impressumContent");
    const impIcon = document.getElementById("impressumIcon");
    const footerLink = document.getElementById("footerImpressumLink");  // ← NEU

    // Toggle Funktion
    const toggleImpressum = () => {
        if (impContent.style.display === "none") {
            impContent.style.display = "grid";
            impIcon.textContent = "▼";
            impHeader.style.borderBottom = "1px solid var(--line)";
            impHeader.style.paddingBottom = "20px";
        } else {
            impContent.style.display = "none";
            impIcon.textContent = "▶";
            impHeader.style.borderBottom = "none";
            impHeader.style.paddingBottom = "0";
        }
    };

    // Header-Klick (bestehend)
    if (impHeader) {
        impHeader.addEventListener("click", toggleImpressum);
    }

    // Footer-Link Klick (NEU)
    if (footerLink) {
        footerLink.addEventListener("click", (e) => {
            e.preventDefault();
            // Scrolle zum Impressum-Bereich
            const impressumSection = document.getElementById("impressum");
            if (impressumSection) {
                impressumSection.scrollIntoView({ behavior: 'smooth' });
            }
            // Öffne das Impressum (falls geschlossen)
            if (impContent.style.display === "none") {
                toggleImpressum();
            }
        });
    }
}

// ==========================================
// RENDER FUNCTIONS
// ==========================================
function renderHero(t) {
    const heroDate = document.getElementById("heroDate");
    if (heroDate) heroDate.textContent = (t.date_text || "Termin folgt") + " Wien";

    const cleanName = (t.name || "NFS").replace(/\s*[-–—\s]\s*Trophy/i, "").trim();
    const heroTitle = document.getElementById("heroTitle");
    if (heroTitle) heroTitle.innerHTML = esc(cleanName) + '<br><em>Trophy</em>';

    const heroTagline = document.getElementById("heroTagline");
    if (heroTagline && t.subtitle) heroTagline.textContent = t.subtitle;

    const aus = document.getElementById("heroAusschreibung");
    if (aus && t.ausschreibung_path) {
        aus.href = publicPdfUrl(t.ausschreibung_path);
        aus.target = "_blank";
        aus.textContent = "Ausschreibung öffnen";
        aus.classList.remove("disabled");
    }
    startCountdown(t.date_iso);
}

function renderTurnierInfo(t) {
    const tInfo = parseTurnierInfo(t);

    if (tInfo.bewerbeHeadline) {
        const h = document.getElementById("pubBewerbeHeadline");
        if (h) h.innerHTML = tInfo.bewerbeHeadline;
    }
    if (tInfo.bewerbeText) {
        const pt = document.getElementById("pubBewerbeText");
        if (pt) pt.innerHTML = tInfo.bewerbeText;
    }

    const factsGrid = document.getElementById("pubFactsGrid");
    if (factsGrid && tInfo.fact1Title) {
        factsGrid.innerHTML = `
            <div class="fact"><div class="k mono">${esc(tInfo.fact1Title)}</div><div class="v">${tInfo.fact1Text || ''}</div></div>
            <div class="fact"><div class="k mono">${esc(tInfo.fact2Title)}</div><div class="v">${tInfo.fact2Text || ''}</div></div>
            <div class="fact"><div class="k mono">${esc(tInfo.fact3Title)}</div><div class="v">${tInfo.fact3Text || ''}</div></div>
            <div class="fact"><div class="k mono">${esc(tInfo.fact4Title)}</div><div class="v">${tInfo.fact4Text || ''}</div></div>
        `;
    }
}

function renderBewerbe(t) {
    const grid = document.getElementById("bewerbeGrid");
    if (!grid) return;

    grid.innerHTML = t.parsedBewerbe.map((b, i) => {
        const cap = b.capacity ? parseInt(b.capacity, 10) : 20;
        return `
            <div class="bewerb">
                <div class="n">Bewerb ${i + 1}</div>
                <h3>${esc(b.name)}</h3>
                <div class="t">Start ${esc(b.time)} &nbsp;|&nbsp; Max. ${cap} Plätze</div>
                ${b.prize && b.prize.trim() !== '' ? `<div class="p mono">Preisgeld ${esc(b.prize)}</div>` : ""}
            </div>
        `;
    }).join("");

    const feeNormal = t.fee_normal || DEFAULT_FEE_NORMAL;
    const feeNfs = t.fee_nfs || DEFAULT_FEE_NFS;
    const noteEl = document.getElementById("bewerbeNote");
    if (noteEl) {
        noteEl.textContent = `Nenngeld pro Bewerb ${feeNormal} €, für NFS-Mitglieder ${feeNfs} €. Barzahlung vor Ort. Die Teilnehmerzahl pro Bewerb ist begrenzt.`;
    }
}

function renderForm(t) {
    const eyebrow = document.getElementById("anmeldeEyebrow");
    if (eyebrow) eyebrow.textContent = "Nennung " + (t.name || "");

    const open = t.is_open;
    const leadEl = document.getElementById("anmeldeLead");
    if (leadEl) {
        leadEl.textContent = open ? "Die Nennung kann auch per E-Mail oder Telefon erfolgen." : "Für dieses Turnier ist die Anmeldung aktuell geschlossen.";
    }

    const capNote = document.getElementById("capNote");
    if (capNote) {
        capNote.textContent = `Die Bewerbe sind in der Teilnehmerzahl begrenzt. Weitere Nennungen werden auf eine Warteliste gesetzt und rücken bei Absagen nach.`;
    }

    const feeNEl = document.getElementById("feeNormalDisplay");
    if (feeNEl) feeNEl.textContent = `${t.fee_normal || DEFAULT_FEE_NORMAL} €`;
    const feeNfsEl = document.getElementById("feeNfsDisplay");
    if (feeNfsEl) feeNfsEl.textContent = `${t.fee_nfs || DEFAULT_FEE_NFS} €`;

    const checks = document.getElementById("bewerbChecks");
    if (checks) {
        checks.innerHTML = t.parsedBewerbe.map((b) => {
            const cap = b.capacity ? parseInt(b.capacity, 10) : 20;
            const inThisBewerb = cachedRegs.filter(r =>
                r.tournament_id === t.id &&
                ((r.bewerbe_list && r.bewerbe_list.length) ? r.bewerbe_list : [r.bewerb]).includes(b.name)
            );

            const activeCount = inThisBewerb.filter(r => !istWartelisteFuer(r, b.name)).length;
            const waitingCount = inThisBewerb.filter(r => istWartelisteFuer(r, b.name)).length;

            let badge = "";
            if (activeCount >= cap) {
                badge = `<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(212, 160, 23, 0.2); color:#966f08; font-weight:600; text-transform:uppercase; margin-left:8px; vertical-align:middle; display:inline-block;">WL Pos. ${waitingCount + 1}</span>`;
            }

            return `
                <label>
                    <input type="checkbox" name="bewerb" value="${esc(b.name)}" />
                    <span style="display:flex; align-items:center;">${esc(b.name)} ${badge}</span>
                </label>
            `;
        }).join("");
    }

    const form = document.getElementById("regForm");
    const btn = document.getElementById("submitBtn");
    if (!form) return;

    if (!open) {
        form.style.opacity = ".5";
        form.style.pointerEvents = "none";
    }

    form.onsubmit = async (e) => {
        e.preventDefault();

        if (!t.is_open) {
            showToast("Die Anmeldung für dieses Turnier ist derzeit geschlossen.", true);
            return;
        }

        const v = id => document.getElementById(id)?.value.trim() || "";
        const selected = Array.from(document.querySelectorAll('input[name="bewerb"]:checked')).map(x => x.value);
        const agbChecked = document.getElementById("agb")?.checked || false;

        if (!v("vorname") || !v("nachname") || !v("email") || selected.length === 0 || !agbChecked) {
            showToast("Bitte Pflichtfelder ausfüllen, mindestens einen Bewerb wählen und AGB akzeptieren.", true);
            return;
        }

        btn.disabled = true;
        btn.textContent = "Sende...";

        try {
            const rcWert = rcNum(v("rc"));
            const waitlistBewerbe = [];

            for (const bewerbName of selected) {
                const bewerbObj = t.parsedBewerbe.find(b => b.name === bewerbName);
                const cap = bewerbObj?.capacity ? parseInt(bewerbObj.capacity, 10) : 20;
                const minRc = bewerbObj?.min_rc ? parseInt(bewerbObj.min_rc, 10) : 0;
                const tatsaechlicherRc = rcWert === -1 ? 0 : rcWert;

                if (minRc > 0 && tatsaechlicherRc < minRc) {
                    showToast(`Fehler: Für den Bewerb "${bewerbName}" benötigst du mindestens ${minRc} RC-Punkte!`, true);
                    btn.disabled = false;
                    btn.textContent = "Nennung absenden";
                    return;
                }

                const aktiveInBewerb = cachedRegs.filter(r => {
                    if (r.tournament_id !== t.id) return false;
                    const list = (r.bewerbe_list && r.bewerbe_list.length) ? r.bewerbe_list : [r.bewerb];
                    if (!list.includes(bewerbName)) return false;
                    return !istWartelisteFuer(r, bewerbName);
                }).length;

                const istVoll = aktiveInBewerb >= cap;
                if (istVoll) waitlistBewerbe.push(bewerbName);
            }

            let computedTag = 'normal';
            const checkVerein = v("verein").toLowerCase();
            if (checkVerein.includes('nfs') || checkVerein.includes('naturfreunde')) {
                computedTag = 'nfs';
            }

            const receiptChecked = document.getElementById("receipt")?.checked || false;

            const { error } = await supabase.from("registrations").insert({
                tournament_id: t.id,
                vorname: v("vorname"),
                nachname: v("nachname"),
                email: v("email"),
                telefon: v("telefon"),
                verein: v("verein"),
                rc: v("rc"),
                bewerb: selected[0],
                bewerbe_list: selected,
                notiz: v("notiz"),
                waitlist: waitlistBewerbe.length === selected.length,
                waitlist_bewerbe: waitlistBewerbe,
                player_tag: computedTag,
                needs_receipt: receiptChecked
            });

            if (error) throw error;

            form.reset();
            localStorage.removeItem('nfs_form_draft');
            document.querySelectorAll("#regForm input").forEach(i => i.classList.remove("valid", "invalid"));

            // Erfolgsmeldung mit Kalender-Button
            showSuccessMessage(t, selected, waitlistBewerbe, form);

            // Nennstand aktualisieren
            const { data: regs } = await supabase.from("public_registrations").select("*");
            cachedRegs = regs || [];
            renderNennstand(activeTournament, cachedRegs);

        } catch (err) {
            console.error('Fehler beim Senden:', err);
            showToast("Fehler beim Senden. Bitte später erneut versuchen.", true);
        } finally {
            btn.disabled = false;
            btn.textContent = "Nennung absenden";
        }
    };
}

function showSuccessMessage(t, selected, waitlistBewerbe, form) {
    form.style.display = "none";
    const successDiv = document.createElement("div");
    successDiv.style.textAlign = "center";
    successDiv.style.padding = "40px 20px";
    successDiv.style.background = "var(--green-dark)";
    successDiv.style.border = "1px solid var(--line)";
    successDiv.style.borderRadius = "8px";

    const tName = t.name || 'NFS Trophy';

    // ICS-Kalender erstellen
    let icsEvents = "";
    selected.forEach(bewerbName => {
        const bewerbObj = t.parsedBewerbe.find(b => b.name === bewerbName);
        const isWl = waitlistBewerbe.includes(bewerbName);
        const wlText = isWl ? " (Warteliste)" : "";
        const eventTitle = `${tName} - ${bewerbName}${wlText}`;

        let dStart = new Date(t.date_iso || Date.now());
        let bewerbDauer = 3;
        if (bewerbObj) {
            if (bewerbObj.duration) bewerbDauer = parseInt(bewerbObj.duration, 10);
            if (bewerbObj.time) {
                const tStr = bewerbObj.time.toLowerCase();
                if (tStr.includes('so')) {
                    dStart.setDate(dStart.getDate() + 1);
                } else if (tStr.includes('fr')) {
                    dStart.setDate(dStart.getDate() - 1);
                }
                const timeMatch = bewerbObj.time.match(/(\d{1,2})[:.](\d{2})/);
                if (timeMatch) {
                    dStart.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0, 0);
                }
            }
        }
        let dEnd = new Date(dStart.getTime() + bewerbDauer * 60 * 60 * 1000);

        const formatICS = (d) => {
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
        };

        icsEvents += `BEGIN:VEVENT
SUMMARY:${eventTitle}
DESCRIPTION:Tischtennisturnier - TTK Naturfreunde Stadlau.\\nBewerb: ${bewerbName}
LOCATION:Erzherzog-Karl-Straße 108\\, 1220 Wien
DTSTART:${formatICS(dStart)}
DTEND:${formatICS(dEnd)}
END:VEVENT
`;
    });

    const icsData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//NFS Trophy//DE
${icsEvents}END:VCALENDAR`;

    const icsFile = new File([icsData], "nfs_trophy.ics", { type: 'text/calendar' });
    const icsUrl = URL.createObjectURL(icsFile);

    let msg = waitlistBewerbe.length
        ? `Gespeichert! Du stehst für <strong>${waitlistBewerbe.map(esc).join(", ")}</strong> auf der Warteliste.`
        : `Nennung erfolgreich! Wir bestätigen in Kürze per E-Mail.`;

    successDiv.innerHTML = `
        <div style="font-size: 40px; margin-bottom: 16px;">🏓</div>
        <h3 style="margin-bottom: 12px; font-family: 'Archivo'; font-size: 24px; color: var(--green-neon);">Wir freuen uns auf dich!</h3>
        <p style="margin-bottom: 30px; color: var(--muted); line-height: 1.6;">${msg}</p>
        <button id="addToCalBtn" class="btn primary" style="width: 100%; max-width: 280px; margin-bottom: 20px;">📅 In den Kalender eintragen</button>
        <br>
        <button id="newRegBtn" style="background:none; border:none; color:var(--muted); text-decoration:underline; cursor:pointer; font-family:inherit;">Weitere Person anmelden</button>
    `;

    form.parentNode.insertBefore(successDiv, form);

    document.getElementById("addToCalBtn").onclick = async (ev) => {
        ev.preventDefault();
        if (navigator.canShare && navigator.canShare({ files: [icsFile] })) {
            try {
                await navigator.share({ files: [icsFile], title: 'Turnier Termine' });
            } catch (err) {
                console.log("Teilen abgebrochen", err);
            }
        } else {
            const a = document.createElement('a');
            a.href = icsUrl;
            a.download = "nfs_trophy.ics";
            a.click();
        }
    };

    document.getElementById("newRegBtn").onclick = (ev) => {
        ev.preventDefault();
        successDiv.remove();
        form.style.display = "grid";
        URL.revokeObjectURL(icsUrl);
    };
}

function renderNennstand(t, regs) {
    const grid = document.getElementById("standGrid");
    if (!grid) return;

    const myRegs = regs.filter(r => r.tournament_id === t.id);

    grid.innerHTML = t.parsedBewerbe.map((b, i) => {
        const inThisBewerb = myRegs.filter(r => {
            const list = (r.bewerbe_list && r.bewerbe_list.length) ? r.bewerbe_list : [r.bewerb];
            return list.includes(b.name);
        });

        const active = inThisBewerb.filter(r => !istWartelisteFuer(r, b.name))
            .sort((a, c) => rcNum(c.rc) - rcNum(a.rc));
        const waiting = inThisBewerb.filter(r => istWartelisteFuer(r, b.name))
            .sort((a, c) => new Date(a.created_at) - new Date(c.created_at));

        const liActive = active.map(r =>
            `<li><span>${esc(r.nachname)} ${esc(r.vorname)}</span>${r.verein ? `<span class="verein">${esc(r.verein)}${r.rc ? ", " + esc(r.rc) : ""}</span>` : (r.rc ? `<span class="verein">${esc(r.rc)}</span>` : "")}</li>`
        ).join("");

        const liWait = waiting.length
            ? `<div class="wait-hd">Warteliste (${waiting.length})</div><ol>` +
            waiting.map(r =>
                `<li class="wait"><span>${esc(r.nachname)} ${esc(r.vorname)}</span>${r.verein ? `<span class="verein">${esc(r.verein)}${r.rc ? ", " + esc(r.rc) : ""}</span>` : (r.rc ? `<span class="verein">${esc(r.rc)}</span>` : "")}</li>`
            ).join("") + `</ol>`
            : "";

        const body = active.length
            ? `<ol>${liActive}</ol>${liWait}`
            : `<div class="stand-empty">Noch keine Nennungen</div>${liWait}`;

        const cap = b.capacity ? parseInt(b.capacity, 10) : 20;
        const isFull = active.length >= cap;
        const percentage = Math.min((active.length / cap) * 100, 100);

        return `
            <div class="stand-card">
                <h4>Bewerb ${i + 1}</h4>
                <div class="sub">${esc(b.name)}</div>
                <div class="count">${active.length}<small>von ${cap}</small></div>
                <div class="progress-bar">
                    <div class="progress-fill ${isFull ? 'full' : ''}" style="width: ${percentage}%"></div>
                </div>
                ${body}
            </div>
        `;
    }).join("");

    const total = myRegs.length;
    const metaEl = document.getElementById("standMeta");
    if (metaEl) {
        metaEl.textContent = `Stand ${new Date().toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}, ${total} Nennungen gesamt`;
    }
}

function renderCurrentFiles(t) {
    const aus = document.getElementById("ergAusschreibung");
    if (aus && t.ausschreibung_path) {
        aus.href = publicPdfUrl(t.ausschreibung_path);
        aus.target = "_blank";
        aus.textContent = "Ausschreibung öffnen";
        aus.classList.remove("disabled");
    }

    // ÖTTV Button
    const live = document.getElementById("ergLive");
    if (live && t.oettv_url) {
        live.href = t.oettv_url;
        live.classList.remove("disabled");
        live.textContent = "Zum ÖTTV-Ergebnissystem";
    }

    // ============================================
    // TTOP Button (in der gleichen Kachel)
    // ============================================
    const ttopBtn = document.getElementById("ergTtop");
    console.log('TTOP Button:', ttopBtn);
    console.log('show_ttop_button:', t.show_ttop_button);
    console.log('ttop_url:', t.ttop_url);

    if (ttopBtn) {
        // Prüfe ob der Button angezeigt werden soll UND ob eine URL vorhanden ist
        if (t.show_ttop_button && t.ttop_url && t.ttop_url.trim() !== '') {
            ttopBtn.style.display = 'inline-block';
            ttopBtn.href = t.ttop_url;
            ttopBtn.target = "_blank";
            ttopBtn.rel = "noreferrer";
            ttopBtn.classList.remove("disabled");
            ttopBtn.textContent = "TTOP Bewerbe";
            console.log('TTOP Button wird angezeigt mit URL:', t.ttop_url);
        } else {
            ttopBtn.style.display = 'none';
            console.log('TTOP Button wird ausgeblendet. show_ttop_button:', t.show_ttop_button, 'ttop_url:', t.ttop_url);
        }
    }
}

// ==========================================
// ARCHIV
// ==========================================
async function renderArchive(tournaments, ergebnisse) {
    const ergFor = (tid) => ergebnisse.filter(e => e.tournament_id === tid);
    const container = document.getElementById("archiveList");
    if (!container) return;

    if (tournaments.length === 0) {
        container.innerHTML = '<div class="loading">Noch keine vergangenen Turniere im Archiv</div>';
        return;
    }

    // src/frontend/app.js - ca. Zeile 450-470
    const fotosByTournament = {};
    await Promise.all(tournaments.map(async (t) => {
        if (!t.fotos_prefix) return;
        const prefix = String(t.fotos_prefix).replace(/^\/+|\/+$/g, "");
        try {
            const { data: files, error } = await supabase.storage.from("fotos").list(prefix, {
                limit: 200,
                sortBy: { column: "name", order: "asc" },
            });
            if (error || !files) return;

            // ====== NEU: Sortierung und Gruppierung ======
            // Hole die Bewerbe für dieses Turnier
            const bewerbe = parseBewerbe(t);
            const bewerbNames = bewerbe.map(b => b.name.toLowerCase());

            // Filtere und sortiere die Fotos nach Bewerb-Namen
            const sortedFiles = files
                .filter(f => f.name && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name))
                .sort((a, b) => {
                    // Versuche den Bewerb-Namen aus dem Dateinamen zu extrahieren
                    const aName = a.name.toLowerCase();
                    const bName = b.name.toLowerCase();

                    // Finde welcher Bewerb in welcher Datei vorkommt
                    let aIndex = bewerbNames.findIndex(b => aName.includes(b));
                    let bIndex = bewerbNames.findIndex(b => bName.includes(b));

                    // Wenn keine Übereinstimmung, nach Dateiname sortieren
                    if (aIndex === -1) aIndex = 999;
                    if (bIndex === -1) bIndex = 999;

                    return aIndex - bIndex;
                });

            // Erstelle URLs mit Metadaten
            // src/frontend/app.js - ca. Zeile 460-480

            fotosByTournament[t.id] = sortedFiles.map(f => {
                const url = publicFotoUrl(`${prefix}/${f.name}`);
                if (!url) return null;

                // Extrahiere Bewerb-Namen für Unterschrift
                let caption = '';
                const lowerName = f.name.toLowerCase();

                // Entferne Zeitstempel und Sonderzeichen für besseren Vergleich
                const cleanName = lowerName
                    .replace(/^\d+[\s_\-]/, '')  // Entferne führenden Zeitstempel (Zahlen + Leerzeichen/Unterstrich)
                    .replace(/[_\-.]+/g, ' ')     // Ersetze _, -, . durch Leerzeichen
                    .trim();

                // Suche nach Bewerb-Namen im bereinigten Dateinamen
                const bewerbMatch = bewerbe.find(b => {
                    const bLower = b.name.toLowerCase();
                    // Prüfe ob der Bewerb-Name im Dateinamen vorkommt
                    return cleanName.includes(bLower) || lowerName.includes(bLower);
                });

                if (bewerbMatch) {
                    caption = bewerbMatch.name;
                } else {
                    // Fallback: Dateiname ohne Erweiterung und ohne Zeitstempel
                    caption = f.name
                        .replace(/\.[^.]+$/, '')           // Entferne Erweiterung
                        .replace(/^\d+[\s_\-]/, '')        // Entferne Zeitstempel
                        .replace(/[_-]/g, ' ')             // Ersetze _ und - mit Leerzeichen
                        .trim();
                }

                return { url, caption, name: f.name };
            }).filter(item => item !== null);

        } catch (err) {
            console.error('Fehler beim Laden der Fotos für', t.name, err);
        }
    }));

    galleries = fotosByTournament;
    setGalleries(galleries);

    container.innerHTML = tournaments.map((t, idx) => {
        const chips = [];
        if (t.ausschreibung_path) chips.push(`<a class="chip" href="${publicPdfUrl(t.ausschreibung_path)}" target="_blank">Ausschreibung</a>`);
        if (t.oettv_url) chips.push(`<a class="chip" href="${esc(t.oettv_url)}" target="_blank">Ergebnisse ÖTTV</a>`);
        ergFor(t.id).forEach(e => chips.push(`<a class="chip" href="${publicPdfUrl(e.path)}" target="_blank">${esc(e.label)}</a>`));

        const fotos = fotosByTournament[t.id] || [];
        const hasGallery = fotos.length > 0;

        let galleryHtml = "";

        if (hasGallery) {
            const preview = fotos.slice(0, 11);
            const rest = fotos.length - preview.length;

            const imgs = preview.map((item, i) => {
                // Unterstützt beide Formate
                const url = typeof item === 'object' ? item.url : item;
                const caption = typeof item === 'object' ? (item.caption || '') : '';
                const alt = caption || 'Foto';
                return `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" data-gallery="${esc(t.id)}" data-index="${i}" title="${esc(caption)}" />`;
            }).join("");

            const moreBtn = rest > 0 ? `<div class="more" data-gallery="${esc(t.id)}" data-index="${preview.length}">+${rest}</div>` : "";
            galleryHtml = `<div class="gallery" style="margin-top:20px;">${imgs}${moreBtn}</div>`;
        }

        // HALL OF FAME
        let hofHtml = "";
        const hofData = t.hall_of_fame;
        if (hofData && Object.keys(hofData).length > 0) {
            const bewerbe = parseBewerbe(t);
            const bCards = bewerbe.map(b => {
                const data = hofData[b.name];
                if (!data || (!data.p1 && !data.p2 && !data.p3_1 && !data.p3_2 && !data.trost)) return "";
                const p3_1_val = data.p3_1 || data.p3 || '';

                let list = "";
                if (data.p1) list += `<li><span class="pos" style="color:var(--text-muted); display:inline-block; width:20px;">1.</span> <strong>${esc(data.p1)}</strong></li>`;
                if (data.p2) list += `<li><span class="pos" style="color:var(--text-muted); display:inline-block; width:20px;">2.</span> <strong>${esc(data.p2)}</strong></li>`;
                if (p3_1_val) list += `<li><span class="pos" style="color:var(--text-muted); display:inline-block; width:20px;">3.</span> <strong>${esc(p3_1_val)}</strong></li>`;
                if (data.p3_2) list += `<li><span class="pos" style="color:var(--text-muted); display:inline-block; width:20px;">3.</span> <strong>${esc(data.p3_2)}</strong></li>`;

                let trostStr = data.trost ? `<div style="margin-top:12px; font-size:13px; padding-top:10px; border-top:1px dashed var(--border); color:var(--text-main);"><strong>Trostbewerb:</strong> ${esc(data.trost)}</div>` : "";

                return `
                    <div class="hof-card" style="background:rgba(255,255,255,0.03); padding:20px; border-radius:8px; border:1px solid var(--border);">
                        <h4 style="margin-bottom:16px; color:var(--accent); font-family:'Archivo'; font-size:18px; letter-spacing:0.5px;">${esc(b.name)}</h4>
                        <ul style="list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; font-size:15px;">
                            ${list}
                        </ul>
                        ${trostStr}
                    </div>
                `;
            }).filter(h => h !== "").join("");

            if (bCards !== "") {
                hofHtml = `
                    <div class="hof-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:20px; margin-top:20px; margin-bottom:10px;">
                        ${bCards}
                    </div>
                `;
            }
        }

        if (chips.length === 0 && !hasGallery && hofHtml === "") {
            chips.push(`<span class="chip off">Keine Materialien</span>`);
        }

        const isOpen = idx === 0;
        const displayStyle = isOpen ? "block" : "none";
        const toggleIcon = isOpen ? "▼" : "▶";
        const borderStyle = isOpen && (hofHtml !== "" || hasGallery) ? "1px solid var(--border)" : "none";
        const paddingStyle = isOpen && (hofHtml !== "" || hasGallery) ? "20px" : "0";

        return `
            <div class="arow archive-item" style="display:block; padding: 24px; background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 24px;">
                <div class="archive-header" style="cursor:pointer; display:flex; justify-content:space-between; gap:18px; align-items:flex-start; flex-wrap:wrap; border-bottom: ${borderStyle}; padding-bottom: ${paddingStyle}; transition: all 0.2s;">
                    <div style="flex:1; min-width:250px;">
                        <div class="name" style="font-size:22px; font-family:'Archivo'; font-weight:600; display:flex; align-items:center; gap:12px;">
                            <span class="toggle-icon" style="font-size:14px; color:var(--accent); width:15px;">${toggleIcon}</span> 
                            ${esc(t.name)}
                        </div>
                        <div class="date" style="color:var(--text-muted); font-size:14px; margin-top:6px; margin-left: 27px;">${esc(t.date_text)}</div>
                    </div>
                    <div class="files" style="display:flex; flex-wrap:wrap; gap:8px;" onclick="event.stopPropagation()">
                        ${chips.join("")}
                    </div>
                </div>
                <div class="archive-content" style="display: ${displayStyle}; margin-top: ${isOpen && (hofHtml !== "" || hasGallery) ? "20px" : "0"};">
                    ${hofHtml}
                    ${galleryHtml}
                </div>
            </div>
        `;
    }).join("");

    // Accordion Toggle
    container.querySelectorAll('.archive-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const icon = header.querySelector('.toggle-icon');
            const hasContent = content.innerHTML.trim() !== "";

            if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.textContent = '▼';
                if (hasContent) {
                    header.style.borderBottom = "1px solid var(--border)";
                    header.style.paddingBottom = "20px";
                    content.style.marginTop = "20px";
                }
            } else {
                content.style.display = 'none';
                icon.textContent = '▶';
                header.style.borderBottom = "none";
                header.style.paddingBottom = "0";
                content.style.marginTop = "0";
            }
        });
    });

    // Gallery Click Events
    container.querySelectorAll("[data-gallery]").forEach(el => {
        el.addEventListener("click", () => {
            openLightbox(el.getAttribute("data-gallery"), parseInt(el.getAttribute("data-index"), 10));
        });
    });
}

// ==========================================
// COUNTDOWN
// ==========================================
let cdTimer = null;

function startCountdown(iso) {
    if (cdTimer) clearInterval(cdTimer);
    const target = new Date(iso).getTime();
    const cap = document.getElementById("cdCap");
    if (!cap) return;
    const pad = n => String(n).padStart(2, "0");
    const tick = () => {
        const diff = target - Date.now();
        if (isNaN(target) || diff < 0) {
            cap.textContent = "Termin folgt";
            ["cdD", "cdH", "cdM", "cdS"].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = "00";
            });
            return;
        }
        document.getElementById("cdD").textContent = pad(Math.floor(diff / 864e5));
        document.getElementById("cdH").textContent = pad(Math.floor((diff % 864e5) / 36e5));
        document.getElementById("cdM").textContent = pad(Math.floor((diff % 36e5) / 6e4));
        document.getElementById("cdS").textContent = pad(Math.floor((diff % 6e4) / 1e3));
    };
    tick();
    cdTimer = setInterval(tick, 1000);
}

// ==========================================
// EXPORT (Excel)
// ==========================================
document.getElementById("exportBtn")?.addEventListener("click", () => {
    if (!activeTournament) return;
    try {
        const t = activeTournament;
        const myRegs = cachedRegs.filter(r => r.tournament_id === t.id);
        const wb = XLSX.utils.book_new();

        t.parsedBewerbe.forEach((b, idx) => {
            const inThis = myRegs.filter(r => {
                const list = (r.bewerbe_list && r.bewerbe_list.length) ? r.bewerbe_list : [r.bewerb];
                return list.includes(b.name);
            });
            const active = inThis.filter(r => !istWartelisteFuer(r, b.name))
                .sort((a, c) => rcNum(c.rc) - rcNum(a.rc));
            const waiting = inThis.filter(r => istWartelisteFuer(r, b.name))
                .sort((a, c) => new Date(a.created_at) - new Date(c.created_at));

            const rows = [];
            rows.push(["Stand", new Date().toLocaleDateString("de-AT")]);
            rows.push([]);
            rows.push([b.name.toUpperCase()]);
            rows.push(["", "Nachname", "Vorname", "Verein", "RC-Punkte"]);
            active.forEach((r, i) => rows.push([i + 1, r.nachname, r.vorname, r.verein || "", r.rc || ""]));
            rows.push([]);
            rows.push(["Anzahl Warteliste", waiting.length]);
            waiting.forEach((r, i) => rows.push([i + 1, r.nachname, r.vorname, r.verein || "", r.rc || ""]));

            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws["!cols"] = [{ wch: 6 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }];
            const sheetName = `B${idx + 1}`.slice(0, 31);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });

        const fileName = `Nennstand_${(t.name || "NFS").replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);
        showToast('Excel-Export erfolgreich!');
    } catch (err) {
        console.error('Export-Fehler:', err);
        showToast('Fehler beim Export.', true);
    }
});

// ==========================================
// MENU TOGGLE & INITIALISIERUNG
// ==========================================
document.getElementById("menuBtn")?.addEventListener("click", () => {
    document.getElementById("navList").classList.toggle("open");
});

document.querySelectorAll("#navList a").forEach(a => {
    a.addEventListener("click", () => {
        document.getElementById("navList").classList.remove("open");
    });
});

// Jahr im Footer
document.getElementById("year").textContent = new Date().getFullYear();

// Start
init();