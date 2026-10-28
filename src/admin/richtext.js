// src/admin/richtext.js
// Website-Texte ohne HTML bearbeiten: *fett*, _kursiv_, Enter = neue Zeile.
// Gespeichert wird weiterhin HTML (<strong>, <em>, <br>) – die Website bleibt unverändert.

import { esc } from '../shared/utils.js';

/**
 * Gespeichertes HTML → Schreibweise fürs Eingabefeld.
 * block: <strong> steht auf der Website in einer eigenen Zeile (Fakten-Kacheln) –
 * dann wird nach dem fetten Teil ein Zeilenumbruch eingefügt.
 */
export function htmlToMarkup(html, { block = false } = {}) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const walk = node => [...node.childNodes].map(n => {
        if (n.nodeType === Node.TEXT_NODE) return n.textContent.replace(/\s*\n\s*/g, ' ');
        if (n.nodeType !== Node.ELEMENT_NODE) return '';
        const inner = walk(n);
        switch (n.tagName) {
            case 'BR': return '\n';
            case 'STRONG': case 'B': {
                const next = n.nextSibling;
                const lineBreak = block && next && !(next.nodeType === Node.ELEMENT_NODE && next.tagName === 'BR');
                return inner.trim() ? `*${inner.trim()}*${lineBreak ? '\n' : ''}` : '';
            }
            case 'EM': case 'I': return inner.trim() ? `_${inner.trim()}_` : '';
            case 'P': case 'DIV': case 'LI': return inner + '\n';
            default: return inner;
        }
    }).join('');
    return walk(doc.body.firstChild).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Schreibweise → HTML (wird von der Website mit sanitizeHtml angezeigt) */
export function markupToHtml(text, { block = false } = {}) {
    if (!text) return '';
    let html = esc(text.replace(/\r/g, '').trim())
        .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
        // _kursiv_ nur an Wortgrenzen (Anführungszeichen sind hier schon &quot; bzw. &#39;)
        .replace(/(^|[\s(„;])_([^_\n]+)_(?=$|[\s.,;:!?)“&])/gm, '$1<em>$2</em>')
        .replace(/\n/g, '<br>');
    // Fakten-Kacheln: <strong> ist dort ohnehin eine eigene Zeile
    if (block) html = html.replace(/<\/strong><br>/g, '</strong>');
    return html;
}

/** Markierten Text im Feld mit Zeichen umschließen (Knöpfe F / K) */
export function wrapSelection(field, mark) {
    const { selectionStart: s, selectionEnd: e, value } = field;
    const sel = value.slice(s, e);
    const word = sel || (mark === '*' ? 'fett' : 'kursiv');
    field.setRangeText(`${mark}${word}${mark}`, s, e, sel ? 'end' : 'select');
    if (!sel) field.setSelectionRange(s + 1, s + 1 + word.length);
    field.focus();
    field.dispatchEvent(new Event('input', { bubbles: true }));
}
