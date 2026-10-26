// src/live/stats.js
// Statistik-Berechnung – Logik unverändert aus dem bisherigen Live-Ticker übernommen

import { parseDurationToSeconds } from './format.js';

/**
 * @param {Array} playedMatches  beendete Spiele des Bewerbs (mit player1_name/player2_name)
 * @param {Object} state         { players } – alle Spieler (für Namen/RC)
 */
export function computeStats(playedMatches, state) {
    let totalSets = 0,
        totalBalls = 0;
    let count30 = 0,
        count31 = 0,
        count32 = 0;
    let countReverseSweeps = 0,
        countDonut = 0;
    let allDurations = [];
    let playerTimes = {};
    let playerMatchesCount = {};
    let upsetList = [];
    let playerWins = {};
    let playerDonuts = {};
    let playerSweeps = {};
    let playerFiveSets = {};
    let setScores = {};

    playedMatches.forEach(m => {
        const s1 = m.sets_p1 || 0;
        const s2 = m.sets_p2 || 0;
        totalSets += s1 + s2;
        totalBalls += (m.points_p1 || 0) + (m.points_p2 || 0);

        if (s1 + s2 === 3) count30++;
        else if (s1 + s2 === 4) count31++;
        else if (s1 + s2 >= 5) count32++;

        if ((s1 === 3 && s2 === 2) || (s2 === 3 && s1 === 2)) {
            if (m.set_details && m.set_details !== '-') {
                const sets = m.set_details.split(',');
                if (sets.length >= 5) {
                    const p1Sets = sets.map(s => parseInt(s.split(':')[0]) > parseInt(s.split(':')[1]) ? 1 :
                        0);
                    const p1FirstTwo = p1Sets[0] + p1Sets[1];
                    if (p1FirstTwo === 0 && s1 === 3) countReverseSweeps++;
                    else if (p1FirstTwo === 2 && s2 === 3) countReverseSweeps++;
                }
            }
        }

        if (m.set_details && m.set_details !== '-') {
            const sets = m.set_details.split(',');
            sets.forEach(s => {
                const trimmed = s.trim();
                if (trimmed === '11:0' || trimmed === '0:11') {
                    countDonut++;
                    const winnerId = trimmed === '11:0' ? m.player1_id : m.player2_id;
                    playerDonuts[winnerId] = (playerDonuts[winnerId] || 0) + 1;
                }
                setScores[trimmed] = (setScores[trimmed] || 0) + 1;
            });
        }

        const durSec = parseDurationToSeconds(m.duration_str);
        if (durSec > 0) {
            allDurations.push({ sec: durSec, p1: m.player1_name, p2: m.player2_name, score: `${s1}:${s2}` });
            playerTimes[m.player1_id] = (playerTimes[m.player1_id] || 0) + durSec;
            playerTimes[m.player2_id] = (playerTimes[m.player2_id] || 0) + durSec;
            playerMatchesCount[m.player1_id] = (playerMatchesCount[m.player1_id] || 0) + 1;
            playerMatchesCount[m.player2_id] = (playerMatchesCount[m.player2_id] || 0) + 1;
        }

        if (s1 > s2) {
            playerWins[m.player1_id] = (playerWins[m.player1_id] || 0) + 1;
        } else if (s2 > s1) {
            playerWins[m.player2_id] = (playerWins[m.player2_id] || 0) + 1;
        }

        if (s1 === 3 && s2 === 0) {
            playerSweeps[m.player1_id] = (playerSweeps[m.player1_id] || 0) + 1;
        } else if (s2 === 3 && s1 === 0) {
            playerSweeps[m.player2_id] = (playerSweeps[m.player2_id] || 0) + 1;
        }

        if (s1 + s2 >= 5) {
            playerFiveSets[m.player1_id] = (playerFiveSets[m.player1_id] || 0) + 1;
            playerFiveSets[m.player2_id] = (playerFiveSets[m.player2_id] || 0) + 1;
        }

        const p1 = state.players.find(p => p.id === m.player1_id);
        const p2 = state.players.find(p => p.id === m.player2_id);
        if (p1 && p2 && p1.rc_points > 0 && p2.rc_points > 0) {
            if (s1 > s2 && p1.rc_points < p2.rc_points) {
                upsetList.push({
                    winner: p1.name, loser: p2.name, wRc: p1.rc_points, lRc: p2.rc_points,
                    diff: p2.rc_points - p1.rc_points, score: `${s1}:${s2}`
                });
            } else if (s2 > s1 && p2.rc_points < p1.rc_points) {
                upsetList.push({
                    winner: p2.name, loser: p1.name, wRc: p2.rc_points, lRc: p1.rc_points,
                    diff: p1.rc_points - p2.rc_points, score: `${s2}:${s1}`
                });
            }
        }
    });

    const avgDuration = allDurations.length > 0 ? allDurations.reduce((sum, d) => sum + d.sec, 0) / allDurations
        .length : 0;

    const sortedDurations = [...allDurations].sort((a, b) => b.sec - a.sec);
    const longest5 = sortedDurations.slice(0, 5);
    const shortest5 = sortedDurations.slice(-5).reverse();

    const playerAvgTimes = Object.entries(playerTimes).map(([id, total]) => {
        const p = state.players.find(p => String(p.id) === String(id));
        const matches = playerMatchesCount[id] || 0;
        return {
            name: p ? p.name : 'Unbekannt',
            avg: matches > 0 ? total / matches : 0,
            matches: matches
        };
    }).filter(p => p.avg > 0 && p.matches > 0);

    const fastest = [...playerAvgTimes].sort((a, b) => a.avg - b.avg).slice(0, 5);
    const slowest = [...playerAvgTimes].sort((a, b) => b.avg - a.avg).slice(0, 5);

    const topWins = Object.entries(playerWins)
        .map(([id, wins]) => {
            const p = state.players.find(p => String(p.id) === String(id));
            return { name: p ? p.name : 'Unbekannt', wins };
        })
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 5);

    const topDonuts = Object.entries(playerDonuts)
        .map(([id, count]) => {
            const p = state.players.find(p => String(p.id) === String(id));
            return { name: p ? p.name : 'Unbekannt', count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const topSweeps = Object.entries(playerSweeps)
        .map(([id, count]) => {
            const p = state.players.find(p => String(p.id) === String(id));
            return { name: p ? p.name : 'Unbekannt', count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const topFiveSets = Object.entries(playerFiveSets)
        .map(([id, count]) => {
            const p = state.players.find(p => String(p.id) === String(id));
            return { name: p ? p.name : 'Unbekannt', count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const topSetScores = Object.entries(setScores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const biggestUpset = upsetList.length > 0 ? upsetList.reduce((a, b) => a.diff > b.diff ? a : b) : null;

    return {
        totalSets, totalBalls, count30, count31, count32, countReverseSweeps, countDonut,
        avgDuration, longest5, shortest5, fastest, slowest, topWins, topDonuts, topSweeps,
        topFiveSets, topSetScores, biggestUpset,
    };
}
