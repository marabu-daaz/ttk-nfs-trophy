// src/shared/utils.js

/**
 * Escapes HTML to prevent XSS attacks
 * VERWENDEN: Überall wo Nutzerdaten in innerHTML eingefügt werden!
 */
export function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, (c) => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return map[c] || c;
    });
}

/**
 * Gibt die URL nur zurück, wenn sie http(s) oder mailto/tel ist – sonst ''.
 * Verhindert javascript:-Links aus Admin-Eingaben.
 */
export function safeUrl(url) {
    if (!url) return '';
    const s = String(url).trim();
    try {
        const u = new URL(s, window.location.origin);
        return ['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol) ? s : '';
    } catch (e) {
        return '';
    }
}

/**
 * Bereinigt Admin-HTML (Fakten, Bewerbe-Text): erlaubt einfache Formatierung,
 * entfernt Scripts, Event-Handler (onclick=...) und javascript:-Links.
 */
const ALLOWED_TAGS = new Set(['DIV', 'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'SPAN', 'A', 'SMALL', 'UL', 'OL', 'LI']);

export function sanitizeHtml(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstChild;

    const clean = (node) => {
        for (const child of Array.from(node.children)) {
            if (!ALLOWED_TAGS.has(child.tagName)) {
                // Unbekannte Tags durch ihren Text ersetzen
                child.replaceWith(doc.createTextNode(child.textContent));
                continue;
            }
            for (const attr of Array.from(child.attributes)) {
                const keep = child.tagName === 'A' && ['href', 'target', 'rel'].includes(attr.name);
                if (!keep) child.removeAttribute(attr.name);
            }
            if (child.tagName === 'A') {
                const href = safeUrl(child.getAttribute('href'));
                if (href) child.setAttribute('href', href);
                else child.removeAttribute('href');
                child.setAttribute('rel', 'noreferrer');
            }
            clean(child);
        }
    };
    clean(root);
    return root.innerHTML;
}

/**
 * Macht einen Dateinamen Storage-tauglich (keine Umlaute, Leerzeichen etc.)
 */
export function safeFileName(name) {
    return String(name)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/g, 'ss')
        .replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

/**
 * Supabase wirft bei Fehlern nicht, sondern liefert { error } zurück.
 * Diese Hilfsfunktion macht daraus eine Exception, damit try/catch greift.
 */
export function throwIfError(result) {
    if (result?.error) throw result.error;
    return result;
}

/**
 * Extrahiert RC-Punkte aus String (nur Zahlen)
 */
export function rcNum(s) {
    const n = parseInt(String(s || "").replace(/\D/g, ""), 10);
    return isNaN(n) ? -1 : n;
}

/**
 * Prüft ob ein Spieler für einen Bewerb auf der Warteliste steht
 */
export function istWartelisteFuer(reg, bewerbName) {
    if (Array.isArray(reg.waitlist_bewerbe) && reg.waitlist_bewerbe.length) {
        return reg.waitlist_bewerbe.includes(bewerbName);
    }
    return reg.waitlist === true;
}

/**
 * Toast-Benachrichtigung (funktioniert in Frontend UND Admin)
 */
export function showToast(msg, isError = false) {
    // Prüfen ob wir im Admin oder Frontend sind
    const isAdmin = window.location.pathname.includes('admin.html');

    // Container finden oder erstellen
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    // Admin bekommt eigene Klasse
    if (isAdmin) {
        toast.className = `toast admin-toast ${isError ? 'error' : ''}`;
    } else {
        toast.className = `toast ${isError ? 'error' : ''}`;
    }
    toast.textContent = msg;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

/**
 * Formatiert ISO-Datum für datetime-local Input
 */
export function formatForDateTimeLocal(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * Parst Bewerbe aus Turnier-Objekt (sicher)
 */
export function parseBewerbe(tournament) {
    if (!tournament) return [];
    try {
        return typeof tournament.bewerbe === 'string'
            ? JSON.parse(tournament.bewerbe)
            : (tournament.bewerbe || []);
    } catch (e) {
        return [];
    }
}

/**
 * Parst turnier_info aus Turnier-Objekt (sicher)
 */
export function parseTurnierInfo(tournament) {
    if (!tournament || !tournament.turnier_info) return {};
    try {
        return typeof tournament.turnier_info === 'string'
            ? JSON.parse(tournament.turnier_info)
            : tournament.turnier_info;
    } catch (e) {
        return {};
    }
}
