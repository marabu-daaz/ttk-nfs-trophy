// src/admin/ui.js
// UI-Bausteine für den Admin: Icons, Dialoge, Formatierung

import { esc } from '../shared/utils.js';

// Icons (Lucide, MIT-Lizenz) als SVG-Pfade
const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    chevronsUp: '<path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/>',
    hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
    userMinus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" x2="16" y1="11" y2="11"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    euro: '<path d="M4 10h12"/><path d="M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
    sheet: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>',
    note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
};

export function icon(name, cls = '') {
    const body = ICONS[name] || ICONS.alert;
    return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

/** Ersetzt <i data-icon="name"></i> durch das SVG */
export function hydrateIcons(root = document) {
    root.querySelectorAll('i[data-icon]').forEach(el => {
        el.outerHTML = icon(el.getAttribute('data-icon'), el.className);
    });
}

// ---------- Formatierung ----------
export function euro(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('de-AT', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }) + ' €';
}

export function initials(vorname, nachname) {
    return ((vorname || '').trim()[0] || '') + ((nachname || '').trim()[0] || '') || '?';
}

export function fmtDate(iso, withTime = false) {
    if (!iso) return '';
    const d = new Date(iso);
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('de-AT', opts);
}

export function relTime(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'gerade eben';
    if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
    if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
    const days = Math.floor(diff / 86400);
    if (days === 1) return 'gestern';
    if (days < 30) return `vor ${days} Tagen`;
    return fmtDate(iso);
}

export function debounce(fn, ms = 200) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

/**
 * Mail schreiben: Dialog mit „In Gmail schreiben“, „Mailprogramm öffnen“ und „Adressen kopieren“.
 * Ein reiner mailto:-Link tut nichts, wenn am Rechner kein Mailprogramm eingerichtet ist,
 * und bricht bei vielen Adressen an der Längengrenze. Mehrere Empfänger landen in BCC (Datenschutz).
 */
export function openMail({ to = [], bcc = [], subject = '', body = '', note = '' }) {
    const mailtoParams = [
        bcc.length ? 'bcc=' + encodeURIComponent(bcc.join(',')) : '',
        subject ? 'subject=' + encodeURIComponent(subject) : '',
        body ? 'body=' + encodeURIComponent(body) : '',
    ].filter(Boolean);
    const mailto = `mailto:${to.map(encodeURIComponent).join(',')}${mailtoParams.length ? '?' + mailtoParams.join('&') : ''}`;
    const gmailParams = { view: 'cm', fs: '1', to: to.join(','), bcc: bcc.join(','), su: subject, body };
    const gmail = 'https://mail.google.com/mail/?' + Object.entries(gmailParams)
        .filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    // Grenzen: mailto ~2000 Zeichen (Windows), Gmail ~8000
    const tooLongMailto = mailto.length > 2000;
    const tooLongGmail = gmail.length > 7500;
    const all = [...to, ...bcc];
    const addresses = all.join(', ');

    return new Promise(resolve => {
        const { dlg, finish } = buildDialog('', resolve, null);
        dlg.innerHTML = `
            <div class="modal-head"><h2>${all.length === 1 ? `Mail an ${esc(all[0])}` : `Mail an ${all.length} Adressen`}</h2></div>
            <div class="modal-body">
                ${note ? `<p class="help" style="margin-bottom:12px;">${esc(note)}</p>` : ''}
                ${bcc.length ? '<p class="help">Die Adressen stehen im BCC – die Empfänger sehen einander nicht.</p>' : ''}
                ${tooLongGmail ? `<div class="banner warn" style="margin-top:10px;">Zu viele Adressen für einen direkten Link.
                    Bitte „Adressen kopieren“ und im neuen Mail ins Feld <b>BCC</b> einfügen.</div>` : ''}
                <textarea class="input" rows="${Math.min(6, Math.max(2, Math.ceil(addresses.length / 70)))}" readonly style="margin-top:12px;font-size:12px;">${esc(addresses)}</textarea>
            </div>
            <div class="modal-foot">
                <button type="button" class="btn" data-cancel>Schließen</button>
                <span class="spacer"></span>
                <button type="button" class="btn" data-copy>${icon('copy')}Adressen kopieren</button>
                ${tooLongMailto ? '' : `<a class="btn" href="${esc(mailto)}" data-go>Mailprogramm</a>`}
                <a class="btn primary" href="${esc(tooLongGmail ? 'https://mail.google.com/mail/?view=cm&fs=1' + (subject ? '&su=' + encodeURIComponent(subject) : '') : gmail)}" target="_blank" rel="noopener" data-go>In Gmail schreiben</a>
            </div>`;
        dlg.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
        dlg.querySelector('[data-copy]').addEventListener('click', async e => {
            try {
                await navigator.clipboard.writeText(addresses);
            } catch {
                dlg.querySelector('textarea').select();
                document.execCommand('copy');
            }
            e.currentTarget.textContent = 'Kopiert ✓';
        });
        dlg.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', () => setTimeout(() => finish(true), 50)));
        dlg.showModal();
    });
}

// ---------- Datei-Ablage ----------
/**
 * Macht aus einem Datei-Feld eine Ablagefläche: Dateien hineinziehen oder klicken zum Auswählen.
 * Das Feld bleibt die Quelle (input.files). Wer es leert, löst danach 'change' aus, dann stimmt die Anzeige.
 */
export function makeDropzone(input, { text = 'Datei hierher ziehen', compact = false } = {}) {
    if (!input || input.closest('.dropzone')) return;
    const zone = document.createElement('div');
    zone.className = 'dropzone' + (compact ? ' compact' : '');
    zone.tabIndex = 0;
    zone.setAttribute('role', 'button');
    zone.innerHTML = `${icon('upload')}<div class="dz-text"><strong></strong><div class="small muted">oder klicken, um auszuwählen</div></div>`;
    input.before(zone);
    zone.appendChild(input);
    input.hidden = true;
    const label = zone.querySelector('strong');

    const show = (msg = '') => {
        const names = [...input.files].map(f => f.name);
        label.textContent = msg || (names.length ? names.join(', ') : text);
        zone.classList.toggle('has-file', names.length > 0);
        zone.classList.toggle('bad', !!msg);
    };
    // accept="application/pdf" / "image/*" / ".pdf"
    const tokens = (input.accept || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const accepts = f => !tokens.length || tokens.some(t =>
        t.startsWith('.') ? f.name.toLowerCase().endsWith(t)
            : t.endsWith('/*') ? f.type.startsWith(t.slice(0, -1))
                : f.type === t);

    zone.addEventListener('click', e => { if (e.target !== input) input.click(); });
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag'); });
    zone.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag');
        let files = [...e.dataTransfer.files];
        if (!files.length) return;
        const ok = files.filter(accepts);
        if (!ok.length) return show(input.accept.includes('pdf') ? 'Bitte eine PDF-Datei verwenden' : 'Bitte eine Bilddatei verwenden');
        files = input.multiple ? ok : ok.slice(0, 1);
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    input.addEventListener('change', () => show());
    show();
}

// Datei daneben fallen gelassen → Browser soll sie nicht öffnen (Admin würde verlassen)
['dragover', 'drop'].forEach(type => document.addEventListener(type, e => {
    if (e.dataTransfer?.types?.includes('Files') && !e.target.closest?.('.dropzone')) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    }
}));

// ---------- Dialoge ----------
/**
 * Baut einen Dialog, der genau einmal ein Ergebnis liefert.
 * Das Ergebnis wird direkt beim Klick übergeben – nicht erst im 'close'-Event,
 * auf das man sich nicht in jedem Browser verlassen kann.
 */
export function buildDialog(cls, resolve, fallback) {
    const dlg = document.createElement('dialog');
    dlg.className = `modal ${cls}`;
    document.body.appendChild(dlg);
    let done = false;
    const finish = value => {
        if (done) return;
        done = true;
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(value);
    };
    // Escape / Schließen von außen → Standardwert
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(fallback); });
    dlg.addEventListener('close', () => finish(fallback));
    return { dlg, finish };
}

/** Bestätigungsdialog. Liefert true/false. */
export function confirmDialog({ title, message, confirmText = 'Bestätigen', cancelText = 'Abbrechen', danger = false }) {
    return new Promise(resolve => {
        const { dlg, finish } = buildDialog('sm', resolve, false);
        dlg.innerHTML = `
            <div class="modal-head"><h2>${esc(title)}</h2></div>
            <div class="modal-body"><p class="confirm-text">${esc(message)}</p></div>
            <div class="modal-foot">
                <button type="button" class="btn" data-v="0">${esc(cancelText)}</button>
                <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(confirmText)}</button>
            </div>`;
        dlg.addEventListener('click', e => {
            const b = e.target.closest('[data-v]');
            if (b) finish(b.dataset.v === '1');
        });
        dlg.showModal();
        dlg.querySelector('[data-v="1"]').focus();
    });
}

/** Eingabedialog. Liefert den Text oder null. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmText = 'OK', help = '' }) {
    return new Promise(resolve => {
        const { dlg, finish } = buildDialog('sm', resolve, null);
        dlg.innerHTML = `
            <form>
                <div class="modal-head"><h2>${esc(title)}</h2></div>
                <div class="modal-body">
                    <div class="field">
                        <label for="promptInput">${esc(label)}</label>
                        <input id="promptInput" class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" required>
                        ${help ? `<div class="help">${esc(help)}</div>` : ''}
                    </div>
                </div>
                <div class="modal-foot">
                    <button type="button" class="btn" data-cancel>Abbrechen</button>
                    <button type="submit" class="btn primary">${esc(confirmText)}</button>
                </div>
            </form>`;
        const input = dlg.querySelector('input');
        dlg.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
        dlg.querySelector('form').addEventListener('submit', e => {
            e.preventDefault();
            finish(input.value.trim() || null);
        });
        dlg.showModal();
        input.select();
    });
}

/**
 * Formular-Dialog. fields: [{ id, label, type = 'text'|'checkbox'|'datetime-local'|..., value, checked, help, required }]
 * Liefert ein Objekt { id: wert } oder null bei Abbruch.
 */
export function formDialog({ title, intro = '', fields, confirmText = 'OK' }) {
    return new Promise(resolve => {
        const { dlg, finish } = buildDialog('', resolve, null);
        dlg.innerHTML = `
            <form>
                <div class="modal-head"><h2>${esc(title)}</h2></div>
                <div class="modal-body">
                    ${intro ? `<p class="confirm-text" style="margin-bottom:14px;">${esc(intro)}</p>` : ''}
                    <div class="form-grid">
                        ${fields.map(f => f.type === 'checkbox' ? `
                            <label class="switch full"><input type="checkbox" data-f="${esc(f.id)}" ${f.checked ? 'checked' : ''}><span class="track"></span>
                                <span>${esc(f.label)}${f.help ? `<br><span class="small muted">${esc(f.help)}</span>` : ''}</span></label>` : `
                            <div class="field ${f.half ? '' : 'full'}">
                                <label>${esc(f.label)}</label>
                                <input class="input" type="${esc(f.type || 'text')}" data-f="${esc(f.id)}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}>
                                ${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}
                            </div>`).join('')}
                    </div>
                </div>
                <div class="modal-foot">
                    <button type="button" class="btn" data-cancel>Abbrechen</button>
                    <button type="submit" class="btn primary">${esc(confirmText)}</button>
                </div>
            </form>`;
        dlg.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
        dlg.querySelector('form').addEventListener('submit', e => {
            e.preventDefault();
            const out = {};
            dlg.querySelectorAll('[data-f]').forEach(el => { out[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
            finish(out);
        });
        dlg.showModal();
        dlg.querySelector('input:not([type="checkbox"])')?.focus();
    });
}

/** Setzt einen Button in einen Lade-Zustand, solange fn läuft */
export async function withBusy(btn, fn, busyText = 'Speichere…') {
    if (!btn) return fn();
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = busyText;
    try {
        return await fn();
    } finally {
        btn.disabled = false;
        btn.innerHTML = prev;
    }
}
