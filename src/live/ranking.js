// src/live/ranking.js
// Reihung der Tabelle – unverändert aus dem bisherigen Live-Ticker übernommen.
// Kriterien: Siege → Minitabelle (wenn alle direkt gegeneinander gespielt haben) → SV → BV → RC (niedriger zuerst)

export function calculateRanking(players, matches) {
    // Initialisiere Statistiken für alle Spieler
    const stats = {};
    players.forEach(p => {
        stats[p.id] = {
            id: p.id,
            name: p.name,
            verein: p.club_short || '',
            rc: p.rc_points || 0,
            matches: 0,
            wins: 0,
            sets_won: 0,
            sets_lost: 0,
            balls_won: 0,
            balls_lost: 0,
            opponents: [],
            opponentMatches: {},
            tie_symbol: '',
            stats: {
                matches: 0, wins: 0, sets_won: 0, sets_lost: 0, balls_won: 0, balls_lost: 0,
                tie_symbol: ''
            }
        };
    });

    // Spiele auswerten
    matches.forEach(m => {
        if (!m.is_played) return;
        const p1 = stats[m.player1_id];
        const p2 = stats[m.player2_id];
        if (!p1 || !p2) return;

        const s1 = m.sets_p1 || 0;
        const s2 = m.sets_p2 || 0;
        const b1 = m.points_p1 || 0;
        const b2 = m.points_p2 || 0;

        p1.matches += 1;
        p2.matches += 1;
        p1.stats.matches += 1;
        p2.stats.matches += 1;

        p1.sets_won += s1;
        p1.sets_lost += s2;
        p2.sets_won += s2;
        p2.sets_lost += s1;
        p1.stats.sets_won += s1;
        p1.stats.sets_lost += s2;
        p2.stats.sets_won += s2;
        p2.stats.sets_lost += s1;

        p1.balls_won += b1;
        p1.balls_lost += b2;
        p2.balls_won += b2;
        p2.balls_lost += b1;
        p1.stats.balls_won += b1;
        p1.stats.balls_lost += b2;
        p2.stats.balls_won += b2;
        p2.stats.balls_lost += b1;

        p1.opponents.push(m.player2_id);
        p2.opponents.push(m.player1_id);
        p1.opponentMatches[m.player2_id] = { sets_p1: s1, sets_p2: s2 };
        p2.opponentMatches[m.player1_id] = { sets_p1: s2, sets_p2: s1 };

        if (s1 > s2) {
            p1.wins += 1;
            p1.stats.wins += 1;
        } else {
            p2.wins += 1;
            p2.stats.wins += 1;
        }
    });

    // Hilfsfunktion: Prüft, ob alle in der Gruppe gegeneinander gespielt haben
    function allPlayedEachOther(group) {
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const hasMatch = group[i].opponentMatches[group[j].id] !== undefined ||
                    group[j].opponentMatches[group[i].id] !== undefined;
                if (!hasMatch) return false;
            }
        }
        return true;
    }

    // Minitabelle: Sortiert eine vollständig verbundene Gruppe anhand der direkten Duelle
    function sortByMiniTable(group) {
        const miniStats = {};
        group.forEach(p => {
            miniStats[p.id] = {
                ...p,
                miniWins: 0,
                miniSetsWon: 0,
                miniSetsLost: 0,
                miniBallsWon: 0,
                miniBallsLost: 0
            };
        });

        // Zähle die direkten Duelle innerhalb der Gruppe
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const p1 = group[i];
                const p2 = group[j];
                const match = p1.opponentMatches[p2.id];
                if (match) {
                    const s1 = match.sets_p1;
                    const s2 = match.sets_p2;
                    if (s1 > s2) {
                        miniStats[p1.id].miniWins += 1;
                    } else {
                        miniStats[p2.id].miniWins += 1;
                    }
                    miniStats[p1.id].miniSetsWon += s1;
                    miniStats[p1.id].miniSetsLost += s2;
                    miniStats[p2.id].miniSetsWon += s2;
                    miniStats[p2.id].miniSetsLost += s1;
                    // Bälle in der Minitabelle sind nicht notwendig, da die direkten Duelle
                    // bereits durch Siege und Sätze abgebildet werden.
                    // Falls doch Gleichstand, wird später RC herangezogen.
                }
            }
        }

        // Rekursive Sortierung der Minitabelle mit denselben Kriterien:
        // Mini-Siege, dann Mini-SV, dann Mini-BV, dann RC
        // Dazu nutzen wir die gleiche `sortGroup`-Funktion, aber mit den Mini-Werten.
        // Da die Gruppe vollständig verbunden ist, können wir die Minitabelle
        // einfach nach diesen Kriterien sortieren.
        const sorted = Object.values(miniStats).sort((a, b) => {
            if (a.miniWins !== b.miniWins) return b.miniWins - a.miniWins;
            const aSv = a.miniSetsWon / (a.miniSetsLost || 1);
            const bSv = b.miniSetsWon / (b.miniSetsLost || 1);
            if (aSv !== bSv) return bSv - aSv;
            const aBv = a.balls_won / (a.balls_lost || 1);
            const bBv = b.balls_won / (b.balls_lost || 1);
            if (aBv !== bBv) return bBv - aBv;
            return a.rc - b.rc;
        });

        // ⚔️-Symbol für alle setzen, da die Minitabelle angewendet wurde
        sorted.forEach(p => {
            p.tie_symbol = ' ⚔️';
            p.stats.tie_symbol = ' ⚔️';
        });

        return sorted;
    }

    // Rekursive Hauptsortierfunktion
    function sortGroup(group) {
        if (group.length <= 1) return group;

        // 1. Nach Siegen gruppieren
        const winsMap = {};
        group.forEach(p => {
            const w = p.wins;
            if (!winsMap[w]) winsMap[w] = [];
            winsMap[w].push(p);
        });

        let result = [];
        const sortedWins = Object.keys(winsMap).sort((a, b) => b - a);
        for (const w of sortedWins) {
            let subgroup = winsMap[w];
            if (subgroup.length === 1) {
                result.push(subgroup[0]);
                continue;
            }

            // Prüfen, ob alle in dieser Sieg-Gruppe gegeneinander gespielt haben
            if (allPlayedEachOther(subgroup)) {
                const sortedByMini = sortByMiniTable(subgroup);
                result = result.concat(sortedByMini);
                continue;
            }

            // Nach SV sortieren
            const sortedBySV = [...subgroup].sort((a, b) => {
                const aSv = a.sets_won / (a.sets_lost || 1);
                const bSv = b.sets_won / (b.sets_lost || 1);
                return bSv - aSv;
            });

            // Gruppen mit gleichem SV bilden
            let i = 0;
            let svGroups = [];
            while (i < sortedBySV.length) {
                let j = i + 1;
                const iSv = sortedBySV[i].sets_won / (sortedBySV[i].sets_lost || 1);
                while (j < sortedBySV.length) {
                    const jSv = sortedBySV[j].sets_won / (sortedBySV[j].sets_lost || 1);
                    if (jSv === iSv) j++;
                    else break;
                }
                svGroups.push(sortedBySV.slice(i, j));
                i = j;
            }

            for (const svGroup of svGroups) {
                if (svGroup.length === 1) {
                    result.push(svGroup[0]);
                    continue;
                }

                // Prüfen, ob diese SV-Gruppe gegeneinander gespielt hat
                if (allPlayedEachOther(svGroup)) {
                    const sortedByMini = sortByMiniTable(svGroup);
                    result = result.concat(sortedByMini);
                    continue;
                }

                // Nach BV sortieren
                const sortedByBV = [...svGroup].sort((a, b) => {
                    const aBv = a.balls_won / (a.balls_lost || 1);
                    const bBv = b.balls_won / (b.balls_lost || 1);
                    return bBv - aBv;
                });

                // Gruppen mit gleichem BV bilden
                let k = 0;
                let bvGroups = [];
                while (k < sortedByBV.length) {
                    let l = k + 1;
                    const kBv = sortedByBV[k].balls_won / (sortedByBV[k].balls_lost || 1);
                    while (l < sortedByBV.length) {
                        const lBv = sortedByBV[l].balls_won / (sortedByBV[l].balls_lost || 1);
                        if (lBv === kBv) l++;
                        else break;
                    }
                    bvGroups.push(sortedByBV.slice(k, l));
                    k = l;
                }

                for (const bvGroup of bvGroups) {
                    if (bvGroup.length === 1) {
                        result.push(bvGroup[0]);
                        continue;
                    }

                    // Prüfen, ob diese BV-Gruppe gegeneinander gespielt hat
                    if (allPlayedEachOther(bvGroup)) {
                        const sortedByMini = sortByMiniTable(bvGroup);
                        result = result.concat(sortedByMini);
                        continue;
                    }

                    // Nach RC sortieren (niedriger zuerst)
                    const sortedByRC = [...bvGroup].sort((a, b) => a.rc - b.rc);

                    // Gruppen mit gleichem RC bilden
                    let m = 0;
                    let rcGroups = [];
                    while (m < sortedByRC.length) {
                        let n = m + 1;
                        const mRc = sortedByRC[m].rc;
                        while (n < sortedByRC.length) {
                            if (sortedByRC[n].rc === mRc) n++;
                            else break;
                        }
                        rcGroups.push(sortedByRC.slice(m, n));
                        m = n;
                    }

                    for (const rcGroup of rcGroups) {
                        if (rcGroup.length === 1) {
                            result.push(rcGroup[0]);
                            continue;
                        }

                        // Prüfen, ob diese RC-Gruppe gegeneinander gespielt hat
                        if (allPlayedEachOther(rcGroup)) {
                            const sortedByMini = sortByMiniTable(rcGroup);
                            result = result.concat(sortedByMini);
                        } else {
                            // Alle Werte gleich – bleiben in der Reihenfolge
                            result = result.concat(rcGroup);
                        }
                    }
                }
            }
        }
        return result;
    }

    // Starte mit allen Spielern
    const allPlayers = Object.values(stats);
    const sorted = sortGroup(allPlayers);

    // Stats synchronisieren
    sorted.forEach(p => {
        p.stats.matches = p.matches;
        p.stats.wins = p.wins;
        p.stats.sets_won = p.sets_won;
        p.stats.sets_lost = p.sets_lost;
        p.stats.balls_won = p.balls_won;
        p.stats.balls_lost = p.balls_lost;
        p.stats.tie_symbol = p.tie_symbol || '';
    });

    return sorted;
}
