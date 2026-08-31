// src/shared/utils.js

/**
 * Escapes HTML to prevent XSS attacks
 * VERWENDEN: Überall wo Nutzerdaten in innerHTML eingefügt werden!
 */
export function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"]/g, (c) => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
        return map[c] || c;
    });
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