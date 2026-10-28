// src/admin/preview.js
// Live-Vorschau im Turnier-Setup: die echte Startseite im Seitenfenster (?vorschau=1),
// bekommt die ungespeicherten Eingaben per postMessage und springt zum bearbeiteten Abschnitt.

const $ = id => document.getElementById(id);
const FRAME_SRC = '/public/index.html?vorschau=1';
const WIDTH = { desktop: 1280, phone: 390 };

let getDraft = () => null;
let mode = 'desktop';
let ready = false;
let timer = null;

/** Welches Feld gehört zu welchem Abschnitt der Startseite? (erster Treffer gewinnt) */
const SECTIONS = [
    ['#setupFact1Title, #setupFact1Text, #setupFact2Title, #setupFact2Text, #setupFact3Title, #setupFact3Text, #setupFact4Title, #setupFact4Text', 'pubFactsGrid'],
    ['#setupBewerbeHeadline, #setupBewerbeText, #bewerbeContainer, #setupFeeNormal, #setupFeeNfs', 'bewerbe'],
    ['#setupIsOpen, #setupDeadline, #setupDeadlineClear', 'anmelden'],
    ['#scheduleContainer, #setupShowSchedule, #addScheduleBtn', 'zeitplan'],
    ['#sponsorsContainer, #setupShowSponsors, #addSponsorBtn', 'partner'],
    ['#setupOettvUrl, #setupTtopUrl, #setupShowTtop, #setupPdf', 'ergebnisse'],
    ['#view-setup', 'top'],
];

function sectionFor(el) {
    for (const [sel, target] of SECTIONS) {
        if (el.closest(sel)) return target;
    }
    return null;
}

const frame = () => $('previewFrame');
const isOpen = () => !$('previewPanel').hidden;

function post(msg) {
    if (!ready) return;
    frame().contentWindow?.postMessage(msg, location.origin);
}

function sendDraft() {
    const t = getDraft();
    if (t) post({ type: 'nfs-preview', tournament: t });
}

/** Seite in voller Breite (Computer 1280 px, Handy 390 px) rendern und ins Fenster einpassen */
function layout() {
    const stage = $('previewStage');
    const f = frame();
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const fw = WIDTH[mode];
    const pad = mode === 'phone' ? 16 : 0;
    const scale = Math.min(1, (w - 2 * pad) / fw);
    f.style.width = fw + 'px';
    f.style.height = (h - 2 * pad) / scale + 'px';
    f.style.transform = `scale(${scale})`;
    f.style.left = Math.max(pad, (w - fw * scale) / 2) + 'px';
    f.style.top = pad + 'px';
    stage.classList.toggle('phone', mode === 'phone');
}

function setOpen(open) {
    $('previewPanel').hidden = !open;
    document.body.classList.toggle('preview-open', open);
    $('previewBtn').setAttribute('aria-expanded', String(open));
    if (open) {
        if (!frame().src) frame().src = FRAME_SRC;   // erst beim ersten Öffnen laden
        layout();
        sendDraft();
    }
}

export function initPreview({ draft }) {
    getDraft = draft;
    $('previewBtn').addEventListener('click', () => setOpen(!isOpen()));
    $('previewClose').addEventListener('click', () => setOpen(false));
    $('previewMode').addEventListener('click', e => {
        const b = e.target.closest('button[data-mode]');
        if (!b) return;
        mode = b.dataset.mode;
        document.querySelectorAll('#previewMode button').forEach(x => x.classList.toggle('on', x === b));
        layout();
    });
    new ResizeObserver(layout).observe($('previewStage'));

    // Startseite meldet sich, sobald sie geladen ist → aktuellen Stand schicken
    window.addEventListener('message', e => {
        if (e.origin !== location.origin || e.source !== frame().contentWindow) return;
        if (e.data?.type === 'nfs-preview-ready') {
            ready = true;
            sendDraft();
        }
    });

    // Jede Eingabe sofort zeigen (kurz gesammelt, damit schnelles Tippen flüssig bleibt)
    const view = $('view-setup');
    const update = () => {
        if (!isOpen()) return;
        clearTimeout(timer);
        timer = setTimeout(sendDraft, 120);
    };
    view.addEventListener('input', update);
    view.addEventListener('change', update);
    view.addEventListener('click', e => { if (e.target.closest('button')) update(); });

    // Zum passenden Abschnitt springen, wenn ein Feld angeklickt wird
    view.addEventListener('focusin', e => {
        if (!isOpen() || e.target.closest('#previewPanel')) return;
        const target = sectionFor(e.target);
        if (target) post({ type: 'nfs-preview-scroll', target });
    });

    // Vorschau gehört zum Setup – beim Wechsel in einen anderen Bereich schließen
    window.addEventListener('hashchange', () => {
        if (!location.hash.startsWith('#/setup')) setOpen(false);
    });
}

/** Nach dem Speichern / Neuladen des Formulars den neuen Stand zeigen */
export function refreshPreview() {
    if (isOpen()) sendDraft();
}
