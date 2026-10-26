// src/live/format.js
// Zeit-Formatierung – unverändert aus dem bisherigen Live-Ticker übernommen

export function formatDuration(startIso) {
    if (!startIso) return '';
    const start = new Date(startIso);
    const now = new Date();
    const diff = Math.floor((now - start) / 1000);
    if (diff < 0) return '';
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDurationSeconds(sec) {
    if (!sec || sec <= 0) return '0:00';
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = Math.floor(sec % 60);
    if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function parseDurationToSeconds(durStr) {
    if (!durStr || durStr === '-' || durStr === '0m 0s') return 0;
    let secs = 0;
    try {
        if (durStr.includes('h ')) {
            const parts = durStr.split('h ');
            const h = parseInt(parts[0]);
            const rest = parts[1].replace('s', '').split('m ');
            const m = parseInt(rest[0]);
            const s = parseInt(rest[1] || 0);
            secs = h * 3600 + m * 60 + s;
        } else if (durStr.includes('m ')) {
            const parts = durStr.replace('s', '').split('m ');
            const m = parseInt(parts[0]);
            const s = parseInt(parts[1] || 0);
            secs = m * 60 + s;
        }
    } catch (e) { }
    return secs;
}
