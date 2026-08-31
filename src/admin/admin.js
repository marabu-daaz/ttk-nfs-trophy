// src/admin/admin.js
import { supabase } from '../shared/supabase.js';
import {
    esc,
    showToast,
    rcNum,
    istWartelisteFuer,
    parseBewerbe,
    formatForDateTimeLocal  // ← NEU
} from '../shared/utils.js';
import { DEFAULT_FEE_NORMAL, DEFAULT_FEE_NFS } from '../shared/constants.js';
import {
    loadBookkeeping, setFinanceTournamentId, addBuchEntry,
    getExpenses, getIncomes
} from './finance.js';
import {
    setSetupTournamentId, setSetupTournaments, renderSetupBewerbe,
    generateQRCodes, initSetupEvents, getSetupBewerbeList,
    setSetupBewerbeList, getBewerbeFromDOM, saveSetup
} from './setup.js';
// src/admin/admin.js - Import-Teil (ca. Zeile 15-20)
import {
    setArchiveTournamentId,
    setArchiveTournaments,
    populateArchivDropdown,
    initArchiveEvents,
    initFotoUpload,
    openBewerbeEditor
} from './archive.js';

import * as XLSX from "xlsx";

// ==========================================
// THEME TOGGLE
// ==========================================
function initTheme() {
    const toggle = document.getElementById('themeToggle');
    console.log('Theme Toggle gefunden:', toggle); // ← DEBUG

    const saved = localStorage.getItem('admin-theme');
    console.log('Gespeichertes Theme:', saved); // ← DEBUG

    if (saved === 'light') {
        document.body.setAttribute('data-theme', 'light');
        if (toggle) toggle.textContent = '☀️';
    }

    if (toggle) {
        toggle.addEventListener('click', () => {
            console.log('Theme Toggle geklickt!'); // ← DEBUG
            const isLight = document.body.getAttribute('data-theme') === 'light';
            if (isLight) {
                document.body.removeAttribute('data-theme');
                localStorage.setItem('admin-theme', 'dark');
                toggle.textContent = '🌙';
            } else {
                document.body.setAttribute('data-theme', 'light');
                localStorage.setItem('admin-theme', 'light');
                toggle.textContent = '☀️';
            }
        });
    }
}


let registrations = [];
let filteredData = [];
let wlPositions = {};
let allTournaments = [];
let activeTournamentId = null;
let currentTournamentConfig = { fee_normal: 12, fee_nfs: 8 };

// ==========================================
// 1. AUTHENTIFIZIERUNG
// ==========================================
async function checkSession() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) showApp();
        else showLogin();
    } catch (err) {
        console.error('Session-Check fehlgeschlagen:', err);
        showLogin();
    }
}

function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appContent').style.display = 'none';
}

function showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContent').style.display = 'block';
    loadTournamentSetup();
}

// ==========================================
// 2. TOURNAMENT SETUP
// ==========================================
async function loadTournamentSetup() {
    try {
        const { data, error } = await supabase
            .from('tournaments')
            .select('*')
            .order('date_iso', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            showToast('Kein Turnier gefunden. Bitte erstelle eines.', true);
            return;
        }

        document.getElementById('setupIsOpen')?.addEventListener('change', (e) => {
            updateSetupIsOpenLabel(e.target.checked);
        });

        allTournaments = data;
        activeTournamentId = data[0].id;

        const t = data[0];
        currentTournamentConfig.fee_normal = t.fee_normal || DEFAULT_FEE_NORMAL;
        currentTournamentConfig.fee_nfs = t.fee_nfs || DEFAULT_FEE_NFS;

        // Setup-Felder befüllen
        fillSetupFields(t);

        // In loadTournamentSetup(), nach fillSetupFields(t):
        console.log('show_ttop_button:', t.show_ttop_button);
        console.log('ttop_url:', t.ttop_url);

        // Bewerbe laden
        const bewerbe = parseBewerbe(t);
        setSetupBewerbeList(bewerbe);
        renderSetupBewerbe();

        // QR-Codes generieren
        generateQRCodes(t.oettv_url);

        // Daten für andere Module setzen
        setFinanceTournamentId(activeTournamentId);
        setSetupTournamentId(activeTournamentId);
        setSetupTournaments(allTournaments);
        setArchiveTournamentId(activeTournamentId);
        setArchiveTournaments(allTournaments);

        // Daten laden
        await loadData();
        await loadBookkeeping();
        populateArchivDropdown();

        // Events initialisieren
        initSetupEvents();
        initArchiveEvents();
        initFotoUpload();

    } catch (err) {
        console.error('Fehler beim Laden des Turnier-Setups:', err);
        showToast('Fehler beim Laden des Turnier-Setups.', true);
    }
}

function fillSetupFields(t) {
    const s = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };

    // ============================================
    // ANMELDUNG OFFEN / GESCHLOSSEN
    // ============================================
    const checkbox = document.getElementById('setupIsOpen');
    if (checkbox) {
        checkbox.checked = t.is_open || false;
        updateSetupIsOpenLabel(checkbox.checked);
    }

    // ============================================
    // TTOP CHECKBOX - KORRIGIERT!
    // ============================================
    const ttopCheckbox = document.getElementById('setupShowTtop');
    if (ttopCheckbox) {
        // Wichtig: t.show_ttop_button könnte undefined sein → false als Fallback
        const isChecked = t.show_ttop_button === true;
        ttopCheckbox.checked = isChecked;
        console.log('🔍 TTOP Checkbox gesetzt auf:', isChecked, '(aus t.show_ttop_button:', t.show_ttop_button, ')');
    }

    // ============================================
    // TTOP URL - KORRIGIERT!
    // ============================================
    s('setupTtopUrl', t.ttop_url || '');

    // ============================================
    // ANDERE FELDER
    // ============================================
    s('setupName', t.name);
    s('setupDateText', t.date_text);
    s('setupSubtitle', t.subtitle);
    s('setupOettvUrl', t.oettv_url);
    s('setupFeeNormal', t.fee_normal || DEFAULT_FEE_NORMAL);
    s('setupFeeNfs', t.fee_nfs || DEFAULT_FEE_NFS);
    s('setupDateIso', formatForDateTimeLocal(t.date_iso));

    // Turnier-Info
    let tInfo = {};
    try {
        tInfo = typeof t.turnier_info === 'string' ? JSON.parse(t.turnier_info) : (t.turnier_info || {});
    } catch (e) { }

    s('setupBewerbeHeadline', tInfo.bewerbeHeadline);
    s('setupBewerbeText', tInfo.bewerbeText);
    s('setupFact1Title', tInfo.fact1Title);
    s('setupFact1Text', tInfo.fact1Text);
    s('setupFact2Title', tInfo.fact2Title);
    s('setupFact2Text', tInfo.fact2Text);
    s('setupFact3Title', tInfo.fact3Title);
    s('setupFact3Text', tInfo.fact3Text);
    s('setupFact4Title', tInfo.fact4Title);
    s('setupFact4Text', tInfo.fact4Text);
}

function updateSetupIsOpenLabel(isOpen) {
    const label = document.getElementById('setupIsOpenLabel');
    const hint = document.getElementById('setupIsOpenHint');

    if (label) {
        if (isOpen) {
            label.innerHTML = 'Anmeldung auf der Website ist <span style="color: var(--success);">GEÖFFNET</span>';
        } else {
            label.innerHTML = 'Anmeldung auf der Website ist <span style="color: var(--error);">GESCHLOSSEN</span>';
        }
    }

    if (hint) {
        if (isOpen) {
            hint.textContent = 'Spieler können sich anmelden';
            hint.style.color = 'var(--text-muted)';
        } else {
            hint.textContent = 'Die Anmeldung ist aktuell deaktiviert';
            hint.style.color = 'var(--error)';
        }
    }
}

// ==========================================
// 3. DATEN LADEN (NENNUNGEN)
// ==========================================
async function loadData() {
    try {
        const { data, error } = await supabase
            .from('registrations')
            .select('*')
            .eq('tournament_id', activeTournamentId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        const bewerbeSet = new Set();
        wlPositions = {};

        registrations = data.map(reg => {
            let currentTag = reg.player_tag || 'normal';
            if (!reg.player_tag && reg.verein) {
                const v = reg.verein.toLowerCase();
                if (v.includes('nfs') || v.includes('naturfreunde stadlau') || v.includes('naturfreunde')) {
                    currentTag = 'nfs';
                }
            }

            let bewerbeArray = [];
            try {
                if (typeof reg.bewerbe_list === 'string') bewerbeArray = JSON.parse(reg.bewerbe_list);
                else if (Array.isArray(reg.bewerbe_list)) bewerbeArray = reg.bewerbe_list;
                else if (reg.bewerb) bewerbeArray = [reg.bewerb];
            } catch (e) { }

            bewerbeArray.forEach(b => bewerbeSet.add(b));

            let wlBewerbe = [];
            try {
                if (typeof reg.waitlist_bewerbe === 'string') wlBewerbe = JSON.parse(reg.waitlist_bewerbe);
                else if (Array.isArray(reg.waitlist_bewerbe)) wlBewerbe = reg.waitlist_bewerbe;
            } catch (e) { }

            if (wlBewerbe.length === 0 && reg.waitlist === true) wlBewerbe = [...bewerbeArray];

            return {
                ...reg,
                player_tag: currentTag,
                bewerbeArray: bewerbeArray,
                wlBewerbe: wlBewerbe,
                fee_expected: calculateFee(currentTag, bewerbeArray.length)
            };
        });

        // Wartelisten-Positionen berechnen
        const allBewerbe = Array.from(bewerbeSet);
        allBewerbe.forEach(bName => {
            const waitingForB = registrations.filter(r => r.wlBewerbe.includes(bName));
            waitingForB.forEach((r, index) => {
                if (!wlPositions[r.id]) wlPositions[r.id] = {};
                wlPositions[r.id][bName] = index + 1;
            });
        });

        populateBewerbeFilter(allBewerbe);
        applyFilters();

    } catch (err) {
        console.error('Fehler beim Laden der Nennungen:', err);
        showToast('Fehler beim Laden der Nennungen.', true);
    }
}

function calculateFee(playerTag, bewerbeCount) {
    if (playerTag === 'vip') return 0;
    if (playerTag === 'nfs') return bewerbeCount * currentTournamentConfig.fee_nfs;
    return bewerbeCount * currentTournamentConfig.fee_normal;
}

function populateBewerbeFilter(bewerbe) {
    const select = document.getElementById('filterBewerb');
    if (!select) return;
    select.innerHTML = '<option value="all">Alle Bewerbe</option>';
    bewerbe.sort().forEach(b => {
        const option = document.createElement('option');
        option.value = b;
        option.textContent = b;
        select.appendChild(option);
    });
}

function applyFilters() {
    const searchEl = document.getElementById('searchInput');
    const filterEl = document.getElementById('filterBewerb');
    const sortEl = document.getElementById('sortOrder');

    const searchTerm = searchEl ? searchEl.value.toLowerCase() : '';
    const selectedBewerb = filterEl ? filterEl.value : 'all';
    const sortVal = sortEl ? sortEl.value : 'time_desc';

    filteredData = registrations.filter(reg => {
        const matchesSearch = `${reg.vorname} ${reg.nachname} ${reg.verein}`.toLowerCase().includes(searchTerm);
        const matchesBewerb = selectedBewerb === 'all' || reg.bewerbeArray.includes(selectedBewerb);
        return matchesSearch && matchesBewerb;
    });

    filteredData.sort((a, b) => {
        if (sortVal === 'name_asc') return a.nachname.localeCompare(b.nachname);
        if (sortVal === 'rc_desc') return (b.rc || 0) - (a.rc || 0);
        return new Date(b.created_at) - new Date(a.created_at);
    });

    renderTable(filteredData);
    updateStats(filteredData);
}

// ==========================================
// 4. TABELLE RENDERN
// ==========================================
function renderTable(data) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">Keine Nennungen gefunden.</td></tr>';
        return;
    }

    data.forEach(reg => {
        const bewerbeHtml = reg.bewerbeArray.map(bName => {
            const isWl = reg.wlBewerbe.includes(bName);
            if (isWl) {
                const pos = wlPositions[reg.id]?.[bName] || '-';
                return `<div style="margin-bottom: 6px;"><span class="badge waitlist">WL Pos. ${pos}</span> ${esc(bName)}</div>`;
            } else {
                return `<div style="margin-bottom: 6px;"><span class="badge active">Aktiv</span> ${esc(bName)}</div>`;
            }
        }).join('');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${esc(reg.nachname)} ${esc(reg.vorname)} ${reg.needs_receipt ? '<span title="Benötigt Zahlungsbestätigung" style="cursor:help;">🧾</span>' : ''}</strong>
                <div style="font-size: 13px; color: var(--text-muted);">${esc(reg.email)}</div>
            </td>
            <td>
                ${esc(reg.verein || 'Kein Verein')}<br>
                <span style="color: var(--accent); font-size: 13px;">RC: ${esc(reg.rc || '?')}</span>
            </td>
            <td style="font-size: 13px; color: var(--text-main);">
                ${bewerbeHtml}
            </td>
            <td>
                <select class="select-field tag-select" data-id="${reg.id}">
                    <option value="normal" ${reg.player_tag === 'normal' ? 'selected' : ''}>Normal</option>
                    <option value="nfs" ${reg.player_tag === 'nfs' ? 'selected' : ''}>NFS (-4€)</option>
                    <option value="vip" ${reg.player_tag === 'vip' ? 'selected' : ''}>VIP (Gratis)</option>
                </select>
            </td>
            <td style="font-weight: bold; font-family: 'Archivo';">
                ${reg.fee_expected} €
            </td>
            <td>
                <input type="checkbox" class="paid-checkbox" data-id="${reg.id}" ${reg.has_paid ? 'checked' : ''}>
            </td>
            <td class="actions-cell">
                <button class="btn-outline btn-small btn-fixed edit-reg-btn" data-id="${reg.id}">✏️ Bearbeiten</button>
                <button class="btn-outline btn-small btn-fixed receipt-btn" data-id="${reg.id}" style="${reg.needs_receipt ? 'background: rgba(92,184,116,0.2); border-color: var(--accent); color: var(--accent);' : ''}">📄 Beleg PDF</button>
                <button class="btn-outline btn-small btn-fixed delete-reg-btn" data-id="${reg.id}" style="color: var(--error); border-color: var(--error);">🗑️ Löschen</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    attachTableEvents();
}

// ==========================================
// 5. TABELLE EVENTS
// ==========================================
function attachTableEvents() {
    document.querySelectorAll('.tag-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            try {
                await supabase
                    .from('registrations')
                    .update({ player_tag: e.currentTarget.value })
                    .eq('id', e.currentTarget.getAttribute('data-id'));
                await loadData();
                showToast('Status aktualisiert!');
            } catch (err) {
                console.error('Fehler:', err);
                showToast('Fehler beim Aktualisieren.', true);
            }
        });
    });

    document.querySelectorAll('.paid-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', async (e) => {
            try {
                await supabase
                    .from('registrations')
                    .update({ has_paid: e.currentTarget.checked })
                    .eq('id', e.currentTarget.getAttribute('data-id'));
                await loadData();
            } catch (err) {
                console.error('Fehler:', err);
                showToast('Fehler beim Aktualisieren.', true);
                e.currentTarget.checked = !e.currentTarget.checked;
            }
        });
    });

    document.querySelectorAll('.delete-reg-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (!confirm("Nennung wirklich endgültig löschen?")) return;
            try {
                await supabase
                    .from('registrations')
                    .delete()
                    .eq('id', e.currentTarget.getAttribute('data-id'));
                await loadData();
                showToast('Nennung gelöscht!');
            } catch (err) {
                console.error('Fehler:', err);
                showToast('Fehler beim Löschen.', true);
            }
        });
    });

    document.querySelectorAll('.edit-reg-btn').forEach(btn => {
        btn.addEventListener('click', (e) => openEditModal(e.currentTarget.getAttribute('data-id')));
    });

    document.querySelectorAll('.receipt-btn').forEach(btn => {
        btn.addEventListener('click', (e) => downloadReceipt(e.currentTarget.getAttribute('data-id')));
    });
}

// ==========================================
// 6. STATISTIKEN
// ==========================================
function updateStats(data) {
    const filterEl = document.getElementById('filterBewerb');
    const selectedBewerb = filterEl ? filterEl.value : 'all';

    let totalExpected = 0, totalPaid = 0, totalLoss = 0;
    let activePlayers = 0, waitlistPlayers = 0, presentPlayers = 0, totalStarts = 0;
    let validRcValues = [];
    let vereineCount = {};
    let highestRcPlayer = null;

    const expenses = getExpenses();
    const incomes = getIncomes();

    data.forEach(reg => {
        let relevantStarts = 0;
        let isWlInRelevant = false;

        if (selectedBewerb === 'all') {
            relevantStarts = reg.bewerbeArray.length;
            isWlInRelevant = reg.wlBewerbe.length === reg.bewerbeArray.length && reg.wlBewerbe.length > 0;
        } else {
            relevantStarts = 1;
            isWlInRelevant = reg.wlBewerbe.includes(selectedBewerb);
        }

        const feeShare = calculateFee(reg.player_tag, relevantStarts);
        const maxFeeShare = relevantStarts * currentTournamentConfig.fee_normal;

        if (!isWlInRelevant) {
            totalExpected += feeShare;
            totalLoss += (maxFeeShare - feeShare);
            activePlayers++;
            totalStarts += relevantStarts;

            if (reg.has_paid) {
                totalPaid += feeShare;
                presentPlayers++;
            }

            const rc = parseInt(reg.rc, 10);
            if (!isNaN(rc) && rc > 0) {
                validRcValues.push(rc);
                if (!highestRcPlayer || rc > highestRcPlayer.rc) {
                    highestRcPlayer = { name: `${reg.nachname} ${reg.vorname}`, rc: rc };
                }
            }
            if (reg.verein) {
                const v = reg.verein.trim();
                vereineCount[v] = (vereineCount[v] || 0) + 1;
            }
        } else {
            waitlistPlayers++;
        }
    });

    const totalIncomes = incomes.reduce((sum, i) => sum + i.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const saldo = (totalPaid + totalIncomes) - totalExpenses;

    const safeSetText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    safeSetText('statTotalExpected', `${totalExpected} €`);
    safeSetText('statPaid', `${totalPaid} €`);
    safeSetText('statOutstanding', `${totalExpected - totalPaid} €`);
    safeSetText('statLoss', `${totalLoss} €`);
    safeSetText('statPlayers', `${activePlayers} / ${waitlistPlayers} / ${presentPlayers}`);
    safeSetText('statStarts', totalStarts);

    const statSaldoEl = document.getElementById('statSaldo');
    if (statSaldoEl) {
        statSaldoEl.textContent = `${saldo} €`;
        statSaldoEl.style.color = saldo >= 0 ? '#4CAF50' : 'var(--error)';
    }

    const avgRc = validRcValues.length > 0 ? Math.round(validRcValues.reduce((a, b) => a + b, 0) / validRcValues.length) : 0;
    safeSetText('statAvgRc', avgRc);

    let topVerein = "-";
    let maxVereinCount = 0;
    for (const [verein, count] of Object.entries(vereineCount)) {
        if (count > maxVereinCount) {
            maxVereinCount = count;
            topVerein = `${verein} (${count}x)`;
        }
    }
    safeSetText('statTopVerein', topVerein);

    const statMaxRcEl = document.getElementById('statMaxRc');
    if (statMaxRcEl) {
        if (highestRcPlayer) {
            statMaxRcEl.innerHTML = `${highestRcPlayer.rc} <br><span style="font-size:12px; color:var(--text-muted); font-weight:normal;">${esc(highestRcPlayer.name)}</span>`;
        } else {
            statMaxRcEl.textContent = "-";
        }
    }
}

// ==========================================
// 7. MODAL (BEARBEITEN)
// ==========================================
function openEditModal(regId) {
    const reg = registrations.find(r => r.id === regId);
    if (!reg) {
        showToast('Spieler nicht gefunden.', true);
        return;
    }

    document.getElementById('editRegId').value = reg.id;
    document.getElementById('editRc').value = reg.rc || '';
    document.getElementById('editVerein').value = reg.verein || '';

    const listDiv = document.getElementById('modalBewerbeList');
    listDiv.innerHTML = reg.bewerbeArray.map(bName => {
        const isWl = reg.wlBewerbe.includes(bName);
        const pos = isWl && wlPositions[reg.id]?.[bName] ? wlPositions[reg.id][bName] : '-';
        return `
            <div class="bewerb-row">
                <div>
                    <strong>${esc(bName)}</strong><br>
                    <label style="font-size:13px; cursor:pointer;">
                        <input type="checkbox" class="modal-wl-checkbox" data-bewerb="${esc(bName)}" ${isWl ? 'checked' : ''}> Aktuell auf Warteliste
                    </label>
                </div>
                ${isWl ? `<button type="button" class="btn-outline btn-small change-wl-btn" data-id="${reg.id}" data-bewerb="${esc(bName)}">Pos. ${pos} ändern</button>` : ''}
            </div>
        `;
    }).join('');

    document.getElementById('editModal')?.showModal();

    document.querySelectorAll('.change-wl-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            changeWlPos(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-bewerb'));
        });
    });
}

document.getElementById('closeModalBtn')?.addEventListener('click', () => {
    document.getElementById('editModal')?.close();
});

document.getElementById('saveModalBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveModalBtn');
    btn.textContent = "Speichere...";
    btn.disabled = true;

    try {
        const id = document.getElementById('editRegId').value;
        const rc = document.getElementById('editRc').value;
        const verein = document.getElementById('editVerein').value;

        const wlCheckboxes = document.querySelectorAll('.modal-wl-checkbox:checked');
        const newWlBewerbe = Array.from(wlCheckboxes).map(cb => cb.getAttribute('data-bewerb'));
        const isGloballyWaitlisted = newWlBewerbe.length > 0;

        await supabase
            .from('registrations')
            .update({
                rc: rc,
                verein: verein,
                waitlist_bewerbe: newWlBewerbe,
                waitlist: isGloballyWaitlisted
            })
            .eq('id', id);

        document.getElementById('editModal')?.close();
        await loadData();
        showToast('Änderungen gespeichert!');

    } catch (err) {
        console.error('Fehler:', err);
        showToast('Fehler beim Speichern.', true);
    } finally {
        btn.textContent = "Änderungen speichern";
        btn.disabled = false;
    }
});

async function changeWlPos(regId, bewerbName) {
    const newPosStr = prompt(`Auf welchen Platz in der Warteliste soll der Spieler in "${bewerbName}" gereiht werden?\n(z.B. "1" für ganz oben)`);
    if (!newPosStr) return;

    const targetPos = parseInt(newPosStr, 10);
    if (isNaN(targetPos) || targetPos < 1) return;

    try {
        let waitingList = registrations
            .filter(r => r.wlBewerbe.includes(bewerbName))
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .filter(r => r.id !== regId);

        let newCreatedAt;
        if (waitingList.length === 0) {
            newCreatedAt = new Date().toISOString();
        } else if (targetPos === 1) {
            newCreatedAt = new Date(new Date(waitingList[0].created_at).getTime() - 1000).toISOString();
        } else if (targetPos > waitingList.length) {
            newCreatedAt = new Date(new Date(waitingList[waitingList.length - 1].created_at).getTime() + 1000).toISOString();
        } else {
            const prev = new Date(waitingList[targetPos - 2].created_at).getTime();
            const next = new Date(waitingList[targetPos - 1].created_at).getTime();
            newCreatedAt = new Date((prev + next) / 2).toISOString();
        }

        await supabase
            .from('registrations')
            .update({ created_at: newCreatedAt })
            .eq('id', regId);

        document.getElementById('editModal')?.close();
        await loadData();
        showToast('Wartelisten-Position aktualisiert!');

    } catch (err) {
        console.error('Fehler:', err);
        showToast('Fehler beim Ändern der Position.', true);
    }
}

// ==========================================
// 8. RECEIPT PDF
// ==========================================
function downloadReceipt(regId) {
    const reg = registrations.find(r => r.id === regId);
    if (!reg) {
        showToast('Spieler nicht gefunden.', true);
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const tName = document.getElementById('setupName')?.value || 'NFS Trophy';

    doc.setFontSize(22);
    doc.text("Nenngeld-Bestätigung", 20, 30);
    doc.setFontSize(14);
    doc.text(`Turnier: ${tName}`, 20, 45);
    doc.text(`Ausgestellt am: ${new Date().toLocaleDateString('de-AT')}`, 20, 52);
    doc.line(20, 58, 190, 58);
    doc.setFontSize(12);
    doc.text(`Name: ${reg.vorname} ${reg.nachname}`, 20, 70);
    doc.text(`Verein: ${reg.verein || '-'}`, 20, 78);
    doc.text(`Gemeldete Bewerbe: ${reg.bewerbeArray.join(', ')}`, 20, 86);
    doc.line(20, 94, 190, 94);
    doc.setFontSize(16);
    doc.text(`Betrag dankend erhalten: ${reg.fee_expected} EUR`, 20, 110);
    doc.setFontSize(10);
    doc.text("Christian Ritter (Turnierleitung):", 20, 140);
    doc.line(20, 130, 80, 130);

    doc.save(`Beleg_${reg.nachname}_${reg.vorname}.pdf`);
}

// ==========================================
// 9. EXPORT FUNKTIONEN
// ==========================================
document.getElementById("exportAdminBtn")?.addEventListener("click", () => {
    try {
        const wb = XLSX.utils.book_new();
        const allBewerbe = Array.from(new Set(filteredData.flatMap(r => r.bewerbeArray))).sort();

        const header = ["Nachname", "Vorname", "Verein", "RC", ...allBewerbe, "Nenngeld", "Bezahlt", "Status Tag"];
        const rows = [header];

        filteredData.forEach(r => {
            const row = [r.nachname, r.vorname, r.verein || "", r.rc || ""];
            allBewerbe.forEach(bName => {
                if (r.wlBewerbe.includes(bName)) row.push("WL");
                else if (r.bewerbeArray.includes(bName)) row.push("x");
                else row.push("");
            });
            row.push(r.fee_expected, r.has_paid ? "Ja" : "Nein", r.player_tag);
            rows.push(row);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        const cols = [{ wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 6 }];
        allBewerbe.forEach(() => cols.push({ wch: 12 }));
        cols.push({ wch: 10 }, { wch: 10 }, { wch: 12 });
        ws["!cols"] = cols;

        XLSX.utils.book_append_sheet(wb, ws, "Admin_Overview");
        XLSX.writeFile(wb, `Turnier_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('Export erfolgreich!');
    } catch (err) {
        console.error('Export-Fehler:', err);
        showToast('Fehler beim Export.', true);
    }
});

document.getElementById("exportPdfBtn")?.addEventListener("click", () => {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('landscape');

        doc.setFontSize(18);
        doc.text("Kassen- und Nennliste NFS Trophy", 14, 20);
        doc.setFontSize(10);
        doc.text(`Stand: ${new Date().toLocaleString("de-AT")}`, 14, 28);

        const allBewerbe = Array.from(new Set(filteredData.flatMap(r => r.bewerbeArray))).sort();
        const head = [["Anw.", "Name", "Verein", "RC", ...allBewerbe, "Zu zahlen", "Bezahlt", "Status"]];

        const pdfData = [...filteredData].sort((a, b) => {
            const aIsWl = a.wlBewerbe.length === a.bewerbeArray.length && a.wlBewerbe.length > 0;
            const bIsWl = b.wlBewerbe.length === b.bewerbeArray.length && b.wlBewerbe.length > 0;
            if (aIsWl !== bIsWl) return aIsWl ? 1 : -1;
            return a.nachname.localeCompare(b.nachname);
        });

        const rows = pdfData.map(r => {
            const isWl = r.wlBewerbe.length === r.bewerbeArray.length && r.wlBewerbe.length > 0;
            const row = ["", `${r.nachname} ${r.vorname}`, r.verein || "-", r.rc || "-"];

            allBewerbe.forEach(bName => {
                if (r.wlBewerbe.includes(bName)) {
                    const pos = wlPositions[r.id]?.[bName] || 'WL';
                    row.push(`WL (${pos})`);
                } else if (r.bewerbeArray.includes(bName)) {
                    row.push("x");
                } else {
                    row.push("");
                }
            });

            row.push(`${r.fee_expected} €`, r.has_paid ? "Ja" : "Nein", isWl ? "Warteliste" : "Aktiv");
            return row;
        });

        doc.autoTable({
            startY: 35,
            head: head,
            body: rows,
            columnStyles: {
                0: { cellWidth: 15 },
                1: { cellWidth: 35 },
                2: { cellWidth: 30 },
                3: { cellWidth: 15 }
            },
            theme: 'grid',
            headStyles: { fillColor: [92, 184, 116] },
            styles: { fontSize: 8, cellPadding: 2, valign: 'middle', halign: 'center' },
            didParseCell: function (data) {
                if (data.column.index === 1 || data.column.index === 2) {
                    data.cell.styles.halign = 'left';
                }
            }
        });

        doc.save(`Nennliste_Print_${new Date().toISOString().slice(0, 10)}.pdf`);
        showToast('PDF erstellt!');
    } catch (err) {
        console.error('PDF-Fehler:', err);
        showToast('Fehler beim PDF-Export.', true);
    }
});

// ==========================================
// 10. TABS NAVIGATION
// ==========================================
function switchTab(e, sectionId, tabId) {
    e.preventDefault();
    ['dashboard', 'finances', 'setup', 'archiv'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    ['tabNennungen', 'tabFinanzen', 'tabSetup', 'tabArchiv'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });

    const sectionEl = document.getElementById(sectionId);
    if (sectionEl) sectionEl.classList.remove('hidden');
    const tabEl = document.getElementById(tabId);
    if (tabEl) tabEl.classList.add('active');
}

document.getElementById('tabNennungen')?.addEventListener('click', (e) => switchTab(e, 'dashboard', 'tabNennungen'));
document.getElementById('tabFinanzen')?.addEventListener('click', (e) => switchTab(e, 'finances', 'tabFinanzen'));
document.getElementById('tabSetup')?.addEventListener('click', (e) => switchTab(e, 'setup', 'tabSetup'));
document.getElementById('tabArchiv')?.addEventListener('click', (e) => switchTab(e, 'archiv', 'tabArchiv'));

// ==========================================
// 11. EVENT LISTENERS (Filter, Buchhaltung, Copy Emails)
// ==========================================
document.getElementById('searchInput')?.addEventListener('input', applyFilters);
document.getElementById('filterBewerb')?.addEventListener('change', applyFilters);
document.getElementById('sortOrder')?.addEventListener('change', applyFilters);

document.getElementById('addIncomeBtn')?.addEventListener('click', () => addBuchEntry('incomes'));
document.getElementById('addExpenseBtn')?.addEventListener('click', () => addBuchEntry('expenses'));

document.getElementById('copyEmailsBtn')?.addEventListener('click', async () => {
    const emails = [...new Set(filteredData.map(r => r.email).filter(e => e))];
    if (emails.length === 0) {
        showToast('Keine E-Mails gefunden.', true);
        return;
    }

    const emailString = emails.join("; ");
    try {
        await navigator.clipboard.writeText(emailString);
        showToast(`${emails.length} E-Mail-Adressen kopiert!`);
    } catch (err) {
        prompt("Kopieren fehlgeschlagen. Bitte kopiere den Text hier manuell:", emailString);
    }
});

// ==========================================
// 12. LOGIN EVENTS
// ==========================================
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    const errDiv = document.getElementById('loginError');

    btn.textContent = 'Prüfe...';
    btn.disabled = true;
    errDiv.textContent = '';

    try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            errDiv.textContent = 'Fehlerhafte Zugangsdaten.';
            btn.textContent = 'Einloggen';
            btn.disabled = false;
            return;
        }
        showApp();
    } catch (err) {
        errDiv.textContent = 'Ein Fehler ist aufgetreten.';
        console.error(err);
    } finally {
        btn.textContent = 'Einloggen';
        btn.disabled = false;
    }
});

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    showLogin();
});

// ==========================================
// 13. START
// ==========================================
checkSession();
// Rufe am Ende der Datei auf:
initTheme();