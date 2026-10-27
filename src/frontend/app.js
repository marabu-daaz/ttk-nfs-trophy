// src/frontend/app.js
import { supabase, publicPdfUrl, publicFotoUrl, publicSponsorUrl } from '../shared/supabase.js';
import { esc, showToast, rcNum, istWartelisteFuer, parseBewerbe, parseTurnierInfo, safeUrl, sanitizeHtml } from '../shared/utils.js';
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
/** Öffentlicher Nennstand – nur das aktuelle Turnier (Supabase liefert max. 1000 Zeilen pro Abfrage) */
async function loadRegs(tournamentId) {
    const { data, error } = await supabase.from("public_registrations").select("*").eq("tournament_id", tournamentId);
    if (error) throw error;
    return data || [];
}

/** Handy-Ansicht: schmal oder Touch-Gerät bis 1100 px (gleiche Bedingung wie in style.css) */
const PHONE_QUERY = "(max-width: 760px), (pointer: coarse) and (max-width: 1100px)";

async function init() {
    try {
        const [tournamentsResult, ergebnisseResult] = await Promise.all([
            supabase.from("tournaments").select("*").order("date_iso", { ascending: false, nullsFirst: false }),
            supabase.from("ergebnisse").select("*").order("created_at", { ascending: true }),
        ]);

        if (tournamentsResult.error) throw tournamentsResult.error;

        const tournaments = tournamentsResult.data || [];
        const ergebnisse = ergebnisseResult.data || [];

        if (!tournaments || tournaments.length === 0) {
            document.getElementById("archiveList").innerHTML = '<div class="loading">Noch keine Turniere angelegt</div>';
            return;
        }

        activeTournament = tournaments[0];
        let regsFailed = false;
        cachedRegs = await loadRegs(activeTournament.id).catch(err => {
            console.error('Nennstand konnte nicht geladen werden:', err);
            regsFailed = true;
            return [];
        });
        // Das aktuelle Turnier kommt ins Archiv, sobald es vorbei ist (Bericht oder Ergebnisse hinterlegt)
        const finished = t => !!(String(t.report || "").trim() || ergebnisse.some(e => e.tournament_id === t.id));
        const archive = tournaments.filter(t => t.id !== activeTournament.id || finished(t));

        // Bewerbe parsen
        activeTournament.parsedBewerbe = parseBewerbe(activeTournament);

        renderHero(activeTournament);
        renderTurnierInfo(activeTournament);
        renderBewerbe(activeTournament);
        renderForm(activeTournament);
        prefillFromInvitation();
        if (regsFailed) showNennstandError();
        else renderNennstand(activeTournament, cachedRegs);
        renderCurrentFiles(activeTournament);
        await renderArchive(archive, ergebnisse || []);
        renderRekorde(tournaments);

        // Gallery initialisieren
        initGallery();

        // Impressum Toggle
        setupImpressumToggle();

        // Scroll Spy initialisieren
        initScrollSpy();

    } catch (err) {
        console.error('Fehler beim Initialisieren:', err);
        showToast('Fehler beim Laden der Daten.', true);
        document.getElementById("archiveList").innerHTML = '<div class="loading">Das Archiv kann gerade nicht geladen werden. Bitte versuche es später noch einmal.</div>';
        showNennstandError();
        document.getElementById("heroPhotoWrap")?.remove();
        const heroDate = document.getElementById("heroDate");
        if (heroDate) heroDate.textContent = "Wien";
    }
}

// ==========================================
// IMPRESSUM TOGGLE
// ==========================================
function setupImpressumToggle() {
    setupAccordion('impressumHeader', 'impressumContent', 'impressumIcon', 'footerImpressumLink', 'impressum');
    setupAccordion('datenschutzHeader', 'datenschutzContent', 'datenschutzIcon', 'footerDatenschutzLink', 'datenschutz');
}

/**
 * Macht ein Element zu einem Aufklapp-Schalter: per Klick UND Tastatur (Enter/Leertaste)
 * bedienbar, mit aria-expanded für Screenreader. onToggle liefert den neuen Zustand (offen?).
 */
function makeToggle(el, onToggle, expanded = false) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-expanded', String(expanded));
    const run = () => el.setAttribute('aria-expanded', String(!!onToggle()));
    el.addEventListener('click', run);
    el.addEventListener('keydown', e => {
        if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        run();
    });
}

/**
 * Generischer Accordion-Setup für Impressum, Datenschutz und Rekorde
 */
function setupAccordion(headerId, contentId, iconId, footerLinkId, sectionId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    const icon = document.getElementById(iconId);
    const footerLink = footerLinkId ? document.getElementById(footerLinkId) : null;

    if (!header || !content || !icon) return;

    const toggle = () => {
        const isHidden = content.style.display === "none" || !content.style.display;
        if (isHidden) {
            content.style.display = "grid";
            icon.textContent = "▼";
            header.style.borderBottom = "1px solid var(--line)";
            header.style.paddingBottom = "20px";
        } else {
            content.style.display = "none";
            icon.textContent = "▶";
            header.style.borderBottom = "none";
            header.style.paddingBottom = "0";
        }
        return isHidden;
    };

    header.setAttribute('aria-controls', contentId);
    makeToggle(header, toggle);

    if (footerLink) {
        footerLink.addEventListener("click", (e) => {
            e.preventDefault();
            const section = document.getElementById(sectionId);
            if (section) section.scrollIntoView({ behavior: 'smooth' });
            if (content.style.display === "none" || !content.style.display) {
                header.setAttribute('aria-expanded', String(toggle()));
            }
        });
    }
}

// ==========================================
// RENDER FUNCTIONS
// ==========================================
function renderHero(t) {
    const heroDate = document.getElementById("heroDate");
    if (heroDate) heroDate.textContent = (t.date_text || "Termin folgt") + " · Wien";

    const cleanName = (t.name || "NFS").replace(/\s*[-–—\s]\s*Trophy/i, "").trim();
    const heroTitle = document.getElementById("heroTitle");
    // Desktop: zwei Zeilen; Handy: eine Zeile, falls Platz (Umbruch nur zwischen Name und „Trophy“)
    if (heroTitle) heroTitle.innerHTML = `<span class="t-part">${esc(cleanName)}</span><br class="t-br"> <em class="t-part">Trophy</em>`;

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
    renderEventSchema(t);
}

/**
 * Strukturierte Daten (schema.org), damit Google das Turnier als Veranstaltung anzeigen kann.
 * Nur mit festem Termin – „Frühjahr 2027“ hat ein Platzhalter-Datum und würde falsch angezeigt.
 */
function renderEventSchema(t) {
    document.getElementById("eventSchema")?.remove();
    const start = t.date_iso ? new Date(t.date_iso) : null;
    if (!start || isNaN(start) || !/\d{1,2}\./.test(t.date_text || "")) return;

    // Zweitägig, wenn ein Bewerb am Sonntag startet
    const twoDays = (t.parsedBewerbe || []).some(b => /\bso\b|sonntag/i.test(b.time || ""));
    const end = new Date(start);
    end.setDate(end.getDate() + (twoDays ? 1 : 0));
    end.setHours(20, 0, 0, 0);

    const reg = registrationState(t);
    const data = {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        name: `${t.name} – Tischtennisturnier`,
        sport: "Tischtennis",
        description: t.subtitle || "RC-Ranglistenturnier des TTK Naturfreunde Stadlau in Wien-Donaustadt",
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        image: ["https://nfs-trophy.com/og-image.png"],
        url: "https://nfs-trophy.com/",
        location: {
            "@type": "Place",
            name: "TTK Naturfreunde Stadlau",
            address: {
                "@type": "PostalAddress",
                streetAddress: "Erzherzog-Karl-Straße 108",
                postalCode: "1220",
                addressLocality: "Wien",
                addressCountry: "AT",
            },
        },
        organizer: { "@type": "Organization", name: "TTK Naturfreunde Stadlau", url: "https://nfs-trophy.com/" },
        offers: {
            "@type": "Offer",
            price: String(t.fee_normal ?? DEFAULT_FEE_NORMAL),
            priceCurrency: "EUR",
            url: "https://nfs-trophy.com/#anmelden",
            availability: reg.open ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
        },
    };
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = "eventSchema";
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
}

/**
 * Blendet eine Sektion samt Menüpunkt ein/aus
 */
function toggleSection(sectionId, visible) {
    const sec = document.getElementById(sectionId);
    if (sec) sec.style.display = visible ? "block" : "none";
    const navLink = document.querySelector(`#navList a[href="#${sectionId}"]`);
    if (navLink?.parentElement) navLink.parentElement.style.display = visible ? "" : "none";
}

/** Titelfoto (im Admin pro Turnier): rechts im Kopfbereich, Countdown als Karte darunter */
function renderHeroPhoto(path) {
    const wrap = document.getElementById('heroPhotoWrap');
    if (!wrap) return;
    const src = path ? publicFotoUrl(path) : null;
    if (!src) {
        wrap.remove();   // kein Foto: nur der Countdown
        return;
    }
    if (wrap.querySelector('img')) return;
    wrap.innerHTML = `<img class="hero-photo" src="${esc(src)}" alt="Siegerehrung bei der NFS Trophy" fetchpriority="high">`;
    document.querySelector('header.hero')?.classList.add('has-photo');
}

function renderTurnierInfo(t) {
    const tInfo = parseTurnierInfo(t);
    renderHeroPhoto(tInfo.heroPhoto);

    // Zeitplan
    const timelineGrid = document.getElementById("timelineGrid");
    const showSchedule = !!(tInfo.showSchedule && tInfo.schedule && tInfo.schedule.length > 0);
    toggleSection("zeitplan", showSchedule);
    if (showSchedule && timelineGrid) {
        timelineGrid.innerHTML = tInfo.schedule.map(item => `
            <div class="timeline-item">
                <div style="font-family: 'Archivo', sans-serif; font-weight: 700; color: var(--green-neon); font-size: 15px; letter-spacing: 0.05em; margin-bottom: 4px;">${esc(item.time)}</div>
                <div style="color: #fff; font-size: 14px; line-height: 1.4;">${esc(item.text)}</div>
            </div>
        `).join("");
    }

    // Sponsoren (im Code „partner“: Werbeblocker blenden Elemente mit „sponsor“ im Namen oft aus)
    const partnerGrid = document.getElementById("partnerGrid");
    const showSponsors = !!(tInfo.showSponsors && tInfo.sponsors && tInfo.sponsors.length > 0);
    toggleSection("partner", showSponsors);
    if (showSponsors && partnerGrid) {
        partnerGrid.innerHTML = tInfo.sponsors.map(s => {
            // Logo über die eigene Domain (/partner-logo/…, Netlify-Weiterleitung) – kein fremder Server,
            // kein „sponsoren“ in der Adresse. Rückfall: direkt vom Speicherdienst. Alt: logoUrl (externe URL)
            const direct = s.logoPath ? publicSponsorUrl(s.logoPath) : safeUrl(s.logoUrl);
            if (!direct) return '';
            const src = s.logoPath ? `/partner-logo/${encodeURIComponent(s.logoPath)}` : direct;
            const name = String(s.name || '').trim();
            // Fotos ohne Transparenz (JPG) bekommen eine Kachel; SVG/PNG-Logos stehen frei auf dem Band
            const opaque = /\.jpe?g$/i.test(s.logoPath || s.logoUrl || '');
            const img = `<img src="${esc(src)}" data-fallback="${esc(direct)}" alt="${esc(name || 'Partner')}"${opaque ? ' class="opaque"' : ''}>`;
            const link = safeUrl(s.link);
            return link
                ? `<a class="partner-logo" href="${esc(link)}" target="_blank" rel="noreferrer"${name ? ` title="${esc(name)}"` : ''}>${img}</a>`
                : `<div class="partner-logo">${img}</div>`;
        }).join("");
        partnerGrid.querySelectorAll("img[data-fallback]").forEach(img => {
            img.addEventListener("error", () => {
                if (img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
            }, { once: true });
        });
    }

    if (tInfo.bewerbeHeadline) {
        const h = document.getElementById("pubBewerbeHeadline");
        if (h) h.innerHTML = sanitizeHtml(tInfo.bewerbeHeadline);
    }
    if (tInfo.bewerbeText) {
        const pt = document.getElementById("pubBewerbeText");
        if (pt) pt.innerHTML = sanitizeHtml(tInfo.bewerbeText);
    }

    const factsGrid = document.getElementById("pubFactsGrid");
    if (factsGrid && tInfo.fact1Title) {
        factsGrid.innerHTML = [1, 2, 3, 4].map(n => `
            <div class="fact"><div class="k mono">${esc(tInfo[`fact${n}Title`])}</div><div class="v">${sanitizeHtml(tInfo[`fact${n}Text`])}</div></div>
        `).join("");
    }
}

/** "ab 800 RC", "bis 1500 RC", "800–1500 RC" oder "" */
function rcRange(b) {
    const min = parseInt(b.min_rc, 10) || 0;
    const max = parseInt(b.max_rc, 10) || 0;
    if (min && max) return `${min}–${max} RC`;
    if (min) return `ab ${min} RC`;
    if (max) return `bis ${max} RC`;
    return '';
}

/** Anmeldung offen? Berücksichtigt den automatischen Anmeldeschluss aus dem Admin. */
function registrationState(t) {
    const info = parseTurnierInfo(t);
    const deadline = info.registrationDeadline ? new Date(info.registrationDeadline) : null;
    const valid = deadline && !isNaN(deadline);
    const expired = valid && Date.now() > deadline.getTime();
    return { open: !!t.is_open && !expired, deadline: valid ? deadline : null, expired };
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
                <div class="t">Start ${esc(b.time)} &nbsp;|&nbsp; Max. ${cap} Plätze${rcRange(b) ? ` &nbsp;|&nbsp; ${rcRange(b)}` : ''}</div>
                ${b.prize && b.prize.trim() !== '' ? `<div class="p mono">Preisgeld ${esc(b.prize)}</div>` : ""}
            </div>
        `;
    }).join("");

    const feeNormal = t.fee_normal ?? DEFAULT_FEE_NORMAL;
    const feeNfs = t.fee_nfs ?? DEFAULT_FEE_NFS;
    const noteEl = document.getElementById("bewerbeNote");
    if (noteEl) {
        noteEl.textContent = `Nenngeld pro Bewerb ${feeNormal} €, für NFS-Mitglieder ${feeNfs} €. Barzahlung vor Ort. Die Teilnehmerzahl pro Bewerb ist begrenzt.`;
    }
}

function renderForm(t) {
    const eyebrow = document.getElementById("anmeldeEyebrow");
    if (eyebrow) eyebrow.textContent = "Nennung " + (t.name || "");

    const reg = registrationState(t);
    const open = reg.open;
    const leadEl = document.getElementById("anmeldeLead");
    if (leadEl) {
        const fmt = d => d.toLocaleString("de-AT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
        leadEl.textContent = open
            ? (reg.deadline ? `Anmeldeschluss: ${fmt(reg.deadline)} Uhr. ` : "") + "Die Nennung kann auch per E-Mail oder Telefon erfolgen."
            : reg.expired && t.is_open
                ? `Der Anmeldeschluss (${fmt(reg.deadline)} Uhr) ist vorbei. Nachnennungen bitte per E-Mail oder Telefon.`
                : "Für dieses Turnier ist die Anmeldung aktuell geschlossen.";
        leadEl.classList.toggle("closed", !open);
    }

    const capNote = document.getElementById("capNote");
    if (capNote) {
        capNote.textContent = `Die Bewerbe sind in der Teilnehmerzahl begrenzt. Weitere Nennungen werden auf eine Warteliste gesetzt und rücken bei Absagen nach.`;
    }

    const feeNEl = document.getElementById("feeNormalDisplay");
    if (feeNEl) feeNEl.textContent = `${t.fee_normal ?? DEFAULT_FEE_NORMAL} €`;
    const feeNfsEl = document.getElementById("feeNfsDisplay");
    if (feeNfsEl) feeNfsEl.textContent = `${t.fee_nfs ?? DEFAULT_FEE_NFS} €`;

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
                badge = `<span style="font-size:11px; padding:2px 6px; border-radius:4px; background:rgba(212, 160, 23, 0.2); color:#7a5600; font-weight:600; text-transform:uppercase; margin-left:8px; vertical-align:middle; display:inline-block;">WL Pos. ${waitingCount + 1}</span>`;
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

        // erneut prüfen – der Anmeldeschluss kann erreicht sein, während die Seite offen ist
        if (!registrationState(t).open) {
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

        // Honeypot: Bots füllen das versteckte Feld aus → Erfolg vortäuschen, nichts speichern
        if (v("website")) {
            form.reset();
            showSuccessMessage(t, selected, [], form);
            return;
        }

        btn.disabled = true;
        btn.textContent = "Sende...";

        try {
            // Frischen Nennstand holen, damit die Wartelisten-Berechnung aktuell ist
            try { cachedRegs = await loadRegs(t.id); } catch { /* alter Stand reicht notfalls */ }

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
                const maxRc = parseInt(bewerbObj?.max_rc, 10) || 0;
                if (maxRc > 0 && tatsaechlicherRc > maxRc) {
                    showToast(`Der Bewerb "${bewerbName}" ist nur bis ${maxRc} RC-Punkte offen – mit ${tatsaechlicherRc} RC bitte einen anderen Bewerb wählen.`, true);
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

            if (error) {
                // 23505 = unique_violation (diese Person ist für dieses Turnier bereits genannt)
                if (error.code === '23505') {
                    showToast(`${v("vorname")} ${v("nachname")} ist für dieses Turnier bereits genannt. Für Änderungen bitte bei der Turnierleitung melden.`, true);
                    return;
                }
                throw error;
            }

            form.reset();

            // Erfolgsmeldung mit Kalender-Button
            showSuccessMessage(t, selected, waitlistBewerbe, form);

            // Nennstand aktualisieren
            try { cachedRegs = await loadRegs(t.id); } catch { /* Anzeige bleibt beim alten Stand */ }
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

/**
 * Link aus der Einladungsmail (?p=<Schlüssel>): Name, E-Mail, Telefon und Verein eintragen.
 * RC-Punkte bewusst nicht – die müssen aktuell sein.
 */
async function prefillFromInvitation() {
    const params = new URLSearchParams(location.search);
    const token = params.get("p");
    if (!token) return;
    // Schlüssel aus der Adresszeile entfernen (z.B. falls jemand den Link weiterschickt)
    params.delete("p");
    history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "") + location.hash);
    if (!/^[0-9a-f-]{36}$/i.test(token)) return;
    try {
        const { data, error } = await supabase.rpc("player_prefill", { p_token: token });
        if (error || !data) return;
        const fields = { vorname: data.vorname, nachname: data.nachname, email: data.email, telefon: data.telefon, verein: data.verein };
        Object.entries(fields).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el && value && !el.value) el.value = value;
        });
        const lead = document.getElementById("anmeldeLead");
        if (lead && data.vorname) {
            const hint = document.createElement("p");
            hint.className = "prefill-hint";
            hint.textContent = `Hallo ${data.vorname}, deine Daten sind schon eingetragen – bitte noch deine aktuellen RC-Punkte und die Bewerbe ergänzen.`;
            lead.after(hint);
        }
        document.getElementById("anmelden")?.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
        console.error("Vorausfüllen fehlgeschlagen:", err);
    }
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

    // ICS-Kalender erstellen (RFC 5545: CRLF, UID + DTSTAMP Pflicht, Sonderzeichen escapen)
    const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
    const formatICS = (d) => {
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    };
    const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const icsLines = [];

    selected.forEach((bewerbName, idx) => {
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

        icsLines.push(
            'BEGIN:VEVENT',
            `UID:${t.id}-${idx}-${Date.now()}@nfs-trophy.com`,
            `DTSTAMP:${dtStamp}`,
            `SUMMARY:${icsEsc(eventTitle)}`,
            `DESCRIPTION:${icsEsc(`Tischtennisturnier - TTK Naturfreunde Stadlau.\nBewerb: ${bewerbName}`)}`,
            `LOCATION:${icsEsc('Erzherzog-Karl-Straße 108, 1220 Wien')}`,
            `DTSTART:${formatICS(dStart)}`,
            `DTEND:${formatICS(dEnd)}`,
            'END:VEVENT'
        );
    });

    const icsData = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//NFS Trophy//DE',
        ...icsLines,
        'END:VCALENDAR'
    ].join('\r\n') + '\r\n';

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

/** Statt „Noch keine Nennungen“ ehrlich sagen, dass der Nennstand gerade nicht geladen werden konnte */
function showNennstandError() {
    const grid = document.getElementById("standGrid");
    if (grid) grid.innerHTML = `<div class="loading" style="grid-column:1/-1;">Der Nennstand kann gerade nicht geladen werden. Bitte lade die Seite in ein paar Minuten neu.</div>`;
    const meta = document.getElementById("standMeta");
    if (meta) meta.textContent = "";
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

        // Am Handy eingeklappt (sonst wird die Seite sehr lang), am Desktop offen
        const listOpen = !window.matchMedia(PHONE_QUERY).matches;
        const summary = `Teilnehmer anzeigen <span>${active.length}${waiting.length ? ` + ${waiting.length} Warteliste` : ""}</span>`;
        const body = active.length || waiting.length
            ? `<details class="stand-list" ${listOpen ? "open" : ""}>
                   <summary>${summary}</summary>
                   ${active.length ? `<ol>${liActive}</ol>` : `<div class="stand-empty">Noch keine Startplätze vergeben</div>`}${liWait}
               </details>`
            : `<div class="stand-empty">Noch keine Nennungen</div>`;

        const cap = b.capacity ? parseInt(b.capacity, 10) : 20;
        const isFull = active.length >= cap;
        const percentage = Math.min((active.length / cap) * 100, 100);

        return `
            <div class="stand-card">
                <h3>Bewerb ${i + 1}</h3>
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
    const oettvUrl = safeUrl(t.oettv_url);
    if (live && oettvUrl) {
        live.href = oettvUrl;
        live.classList.remove("disabled");
        live.textContent = "Zum ÖTTV-Ergebnissystem";
    }

    // TTOP Button (nur wenn im Admin aktiviert UND eine gültige URL vorhanden ist)
    const ttopBtn = document.getElementById("ergTtop");
    if (ttopBtn) {
        const ttopUrl = safeUrl(t.ttop_url);
        if (t.show_ttop_button && ttopUrl) {
            ttopBtn.style.display = 'inline-block';
            ttopBtn.href = ttopUrl;
            ttopBtn.target = "_blank";
            ttopBtn.rel = "noreferrer";
            ttopBtn.classList.remove("disabled");
            ttopBtn.textContent = "TTOP Bewerbe";
        } else {
            ttopBtn.style.display = 'none';
        }
    }
}

// ==========================================
// ARCHIV
// ==========================================
/** Turnierbericht im Fenster (reiner Text, Leerzeile = neuer Absatz) */
function openReport(t, opener) {
    const dlg = document.getElementById("reportDialog");
    if (!dlg || !t) return;
    document.getElementById("reportTitle").textContent = t.name || "";
    document.getElementById("reportDate").textContent = t.date_text || "";
    document.getElementById("reportBody").innerHTML = String(t.report || "").trim()
        .split(/\n\s*\n/).map(p => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
    if (!dlg.dataset.ready) {
        dlg.dataset.ready = "1";
        // Aufräumen sofort beim Schließen – das close-Ereignis kommt asynchron (bleibt für die Escape-Taste)
        const restore = () => {
            document.body.style.overflow = "";
            dlg._opener?.focus?.();
        };
        const close = () => { dlg.close(); restore(); };
        document.getElementById("reportClose").addEventListener("click", close);
        // Klick neben das Fenster schließt
        dlg.addEventListener("click", e => { if (e.target === dlg) close(); });
        dlg.addEventListener("close", restore);
    }
    dlg._opener = opener;
    if (!dlg.open) dlg.showModal();
    document.body.style.overflow = "hidden";
    dlg.querySelector(".rd-body").scrollTop = 0;
}

async function renderArchive(tournaments, ergebnisse) {
    const ergFor = (tid) => ergebnisse.filter(e => e.tournament_id === tid);
    const container = document.getElementById("archiveList");
    if (!container) return;

    if (tournaments.length === 0) {
        container.innerHTML = '<div class="loading">Noch keine vergangenen Turniere im Archiv</div>';
        return;
    }

    const fotosByTournament = {};
    await Promise.all(tournaments.map(async (t) => {
        if (!t.fotos_prefix) return;
        const prefix = String(t.fotos_prefix).replace(/^\/+|\/+$/g, "");
        try {
            const { data: files, error } = await supabase.storage.from("fotos").list(prefix, {
                limit: 1000,
                sortBy: { column: "name", order: "asc" },
            });
            if (error || !files) return;

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
        // Turnierbericht: eigener Knopf, Text öffnet sich im Fenster (sonst wird das Archiv zu lang)
        if (String(t.report || "").trim()) chips.push(`<button type="button" class="chip chip-report" data-report="${esc(String(t.id))}">Turnierbericht lesen</button>`);
        if (t.ausschreibung_path) chips.push(`<a class="chip" href="${publicPdfUrl(t.ausschreibung_path)}" target="_blank">Ausschreibung</a>`);
        const archivOettvUrl = safeUrl(t.oettv_url);
        if (archivOettvUrl) chips.push(`<a class="chip" href="${esc(archivOettvUrl)}" target="_blank" rel="noreferrer">Ergebnisse ÖTTV</a>`);
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
                        <h3 style="margin-bottom:16px; color:var(--accent); font-family:'Archivo'; font-size:18px; letter-spacing:0.5px;">${esc(b.name)}</h3>
                        <ul style="list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; font-size:15px;">
                            ${list}
                        </ul>
                        ${trostStr}
                    </div>
                `;
            }).filter(h => h !== "").join("");

            if (bCards !== "") {
                hofHtml = `
                    <div class="hof-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); gap:20px; margin-top:20px; margin-bottom:10px;">
                        ${bCards}
                    </div>
                `;
            }
        }

        const hasBody = hofHtml !== "" || hasGallery;

        if (chips.length === 0 && !hasBody) {
            chips.push(`<span class="chip off">Keine Materialien</span>`);
        }

        // Am Handy alle eingeklappt (sonst sehr lange Seite), am Desktop das neueste offen
        const isOpen = idx === 0 && !window.matchMedia(PHONE_QUERY).matches;
        const displayStyle = isOpen ? "block" : "none";
        const toggleIcon = isOpen ? "▼" : "▶";
        const borderStyle = isOpen && hasBody ? "1px solid var(--border)" : "none";
        const paddingStyle = isOpen && hasBody ? "20px" : "0";

        return `
            <div class="arow archive-item" id="turnier-${esc(String(t.id))}" style="display:block; padding: 24px; background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 24px;">
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
                <div class="archive-content" style="display: ${displayStyle}; margin-top: ${isOpen && hasBody ? "20px" : "0"};">
                    ${hofHtml}
                    ${galleryHtml}
                </div>
            </div>
        `;
    }).join("");

    // Accordion Toggle
    container.querySelectorAll('.archive-header').forEach(header => {
        makeToggle(header, () => {
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
            return content.style.display !== 'none';
        }, header.nextElementSibling.style.display !== 'none');
    });

    // Turnierbericht-Knöpfe
    const byId = new Map(tournaments.map(t => [String(t.id), t]));
    container.querySelectorAll("[data-report]").forEach(btn => {
        btn.addEventListener("click", () => openReport(byId.get(btn.dataset.report), btn));
    });

    // Link aus der Danke-Mail (#turnier-<id>): Turnier aufklappen, hinscrollen, Bericht zeigen
    const target = location.hash.startsWith("#turnier-") ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (target?.classList.contains("archive-item")) {
        const header = target.querySelector(".archive-header");
        if (header.nextElementSibling.style.display === "none") header.click();
        target.scrollIntoView({ block: "start" });
        const reportBtn = target.querySelector("[data-report]");
        if (reportBtn) openReport(byId.get(reportBtn.dataset.report), reportBtn);
    }

    // Gallery Click Events
    container.querySelectorAll("[data-gallery]").forEach(el => {
        const open = () => openLightbox(el.getAttribute("data-gallery"), parseInt(el.getAttribute("data-index"), 10));
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        el.addEventListener("click", open);
        el.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        });
    });
}

// ==========================================
// REKORDE / EWIGE BESTENLISTE
// ==========================================
function renderRekorde(tournaments) {
    const container = document.getElementById("rekordeGrid");
    if (!container) return;

    const stats = {};
    let tournamentsWithResults = 0;

    // 1. Alle Turniere durchgehen und Erfolge je Spieler sammeln
    tournaments.forEach(t => {
        if (!t.hall_of_fame || !Object.keys(t.hall_of_fame).length) return;
        tournamentsWithResults++;
        const tName = t.name || "NFS Trophy";

        parseBewerbe(t).forEach((b, i) => {
            const bewerb = t.hall_of_fame[b.name];
            if (!bewerb) return;

            // Gewichtung für Gleichstände: offene Klasse > hohe RC-Grenze > niedrige (Doppel/Team halbiert)
            let weight = 0;
            const lowerName = b.name.toLowerCase();
            if (lowerName.includes('offen')) {
                weight = 10000;
            } else if (lowerName.includes('bis')) {
                const match = lowerName.match(/bis\s*(\d+)/);
                if (match) {
                    weight = parseInt(match[1], 10);
                    if (lowerName.includes('doppel') || lowerName.includes('team')) weight = Math.floor(weight / 2);
                }
            } else {
                const match = lowerName.match(/\d+/);
                weight = match ? parseInt(match[0], 10) : (i + 1);
            }

            const add = (rawName, place) => {
                if (!rawName || !rawName.trim()) return;
                // Klubkürzel weg, Doppel/Team („A / B“) einzeln zählen
                rawName.replace(/\([^)]*\)/g, '').split('/').map(s => s.trim()).filter(Boolean).forEach(n => {
                    const p = stats[n] ||= { name: n, wins: 0, podiums: 0, trost: 0, weight: 0, items: [] };
                    if (place === 1) p.wins++;
                    if (place >= 1 && place <= 3) p.podiums++;
                    if (place === 'T') p.trost++;
                    p.weight += place === 1 ? weight * 3 : place === 'T' ? 0 : weight;
                    p.items.push({ tournament: tName, bewerb: b.name, place });
                });
            };
            add(bewerb.p1, 1);
            add(bewerb.p2, 2);
            add(bewerb.p3_1 || bewerb.p3, 3);   // p3 ist das alte Feld – nur eines zählen
            add(bewerb.p3_2, 3);
            add(bewerb.trost, 'T');
        });
    });

    const players = Object.values(stats);
    if (!players.length) {
        container.innerHTML = '<div class="loading">Noch keine Ergebnisse hinterlegt.</div>';
        return;
    }

    // 2. Rangliste: Titel, dann Podestplätze, dann Trostbewerb-Siege; gleiche Bilanz = gleicher Rang
    const sorted = players.sort((a, b) =>
        b.wins - a.wins || b.podiums - a.podiums || b.trost - a.trost || b.weight - a.weight || a.name.localeCompare(b.name, 'de'));
    let rank = 0;
    sorted.forEach((p, i) => {
        const prev = sorted[i - 1];
        if (!prev || prev.wins !== p.wins || prev.podiums !== p.podiums || prev.trost !== p.trost) rank = i + 1;
        p.rank = rank;
    });

    // 3. Kennzahlen
    const leaders = (key) => {
        const max = Math.max(...players.map(p => p[key]));
        return { max, names: players.filter(p => p[key] === max).map(p => p.name) };
    };
    const namesText = (names) => names.length <= 2 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
    const topWins = leaders('wins');
    const topPodiums = leaders('podiums');
    const winners = players.filter(p => p.wins > 0).length;

    const tile = (label, value, foot) => `
        <div class="hof-stat">
            <div class="k mono">${label}</div>
            <div class="v">${esc(value)}</div>
            <div class="n">${esc(foot)}</div>
        </div>`;

    const placeLabel = { 1: '1. Platz', 2: '2. Platz', 3: '3. Platz', T: 'Sieg Trostbewerb' };
    const VISIBLE = 10;
    const row = (p, i) => `
        <details class="hof-entry${i >= VISIBLE ? ' hof-extra' : ''}"${i >= VISIBLE ? ' hidden' : ''}>
            <summary class="hof-row">
                <span class="hof-rank${p.rank <= 3 ? ` r${p.rank}` : ''}">${p.rank}</span>
                <span class="hof-name">${esc(p.name)}</span>
                <span class="hof-num">${p.wins || '–'}</span>
                <span class="hof-num">${p.podiums || '–'}</span>
                <span class="hof-num">${p.trost || '–'}</span>
            </summary>
            <ul class="hof-detail">
                ${p.items.map(it => `<li><span class="place p${it.place}">${placeLabel[it.place]}</span>${esc(it.bewerb)} <span class="muted">· ${esc(it.tournament)}</span></li>`).join('')}
            </ul>
        </details>`;

    // Siegerpodest: die drei Erstplatzierten der ewigen Bestenliste
    const podium = sorted.slice(0, 3).map(p => `
        <div class="hof-podium-item r${p.rank}">
            <span class="hof-rank r${p.rank}">${p.rank}</span>
            <div class="hof-podium-name">${esc(p.name)}</div>
            <div class="hof-podium-meta"><b>${p.wins}</b> Titel · <b>${p.podiums}</b>× Podest</div>
        </div>`).join('');

    container.innerHTML = `
        <div class="hof-podium">${podium}</div>
        <details class="hof-all">
            <summary class="btn hof-toggle"><span class="when-closed">Alle ${sorted.length} Spieler anzeigen</span><span class="when-open">Bestenliste einklappen</span></summary>
        <div class="hof-stats">
            ${tile('Rekordsieger', namesText(topWins.names), `${topWins.max} ${topWins.max === 1 ? 'Turniersieg' : 'Turniersiege'}`)}
            ${tile('Meiste Podestplätze', namesText(topPodiums.names), `${topPodiums.max}× unter den besten drei`)}
            ${tile('Verschiedene Sieger', String(winners), `aus ${tournamentsWithResults} ${tournamentsWithResults === 1 ? 'Turnier' : 'Turnieren'}`)}
        </div>
        <div class="hof-table">
            <div class="hof-row hof-head" aria-hidden="true">
                <span>Rang</span><span>Spieler</span><span class="hof-num">Titel</span><span class="hof-num">Podest</span><span class="hof-num">Trost</span>
            </div>
            ${sorted.map(row).join('')}
        </div>
        ${sorted.length > VISIBLE ? `<button type="button" class="btn hof-more" id="hofMore">Alle ${sorted.length} Spieler anzeigen</button>` : ''}
        <p class="hof-note">Titel = Turniersiege · Podest = Plätze 1 bis 3 · Trost = Siege im Trostbewerb. Antippen zeigt die einzelnen Erfolge.</p>
        </details>`;

    document.getElementById('hofMore')?.addEventListener('click', e => {
        container.querySelectorAll('.hof-extra').forEach(el => { el.hidden = false; });
        e.currentTarget.remove();
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
            // Turniere dauern höchstens zwei Tage → bis dahin „läuft“, danach „beendet“
            cap.textContent = isNaN(target) ? "Termin folgt" : diff > -2 * 864e5 ? "Das Turnier läuft" : "Turnier beendet";
            ["cdD", "cdH", "cdM", "cdS"].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = "00";
            });
            if (diff <= -2 * 864e5 || isNaN(target)) clearInterval(cdTimer);
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
document.getElementById("exportBtn")?.addEventListener("click", async () => {
    if (!activeTournament) return;
    try {
        const XLSX = await import("xlsx");   // ← NEU: lazy
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
const menuBtn = document.getElementById("menuBtn");
menuBtn?.addEventListener("click", () => {
    const open = document.getElementById("navList").classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", String(open));
});

const closeMenu = () => {
    document.getElementById("navList").classList.remove("open");
    menuBtn?.setAttribute("aria-expanded", "false");
};
document.querySelectorAll("#navList a").forEach(a => a.addEventListener("click", closeMenu));
// Tippen neben das Menü oder Escape schließt es
document.addEventListener("click", e => {
    if (!e.target.closest("nav")) closeMenu();
});
document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeMenu();
});

// Jahr im Footer
document.getElementById("year").textContent = new Date().getFullYear();

// ==========================================
// SCROLL SPY (Navigation)
// ==========================================
function initScrollSpy() {
    const sections = document.querySelectorAll('section.block, header.hero');
    const navLinks = document.querySelectorAll('#navList a');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const id = entry.target.getAttribute('id');
                navLinks.forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${id}`) {
                        link.classList.add('active');
                    }
                });
            }
        });
    }, { threshold: 0.3, rootMargin: "-100px 0px -100px 0px" });

    sections.forEach(sec => observer.observe(sec));
}

// Start
init();