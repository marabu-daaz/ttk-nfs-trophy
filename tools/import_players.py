"""
Alte Excel-Nennlisten (2018–2025) → SQL für die Spielerdatenbank.

Aufruf:
    python tools/import_players.py "C:/Users/.../NFS Turniere" [ausgabe.sql]

Die erzeugte SQL-Datei enthält Namen und Kontaktdaten und darf deshalb NICHT
ins Repository. Standardmäßig landet sie im Excel-Ordner (spieler-import.sql).
Danach im Supabase-SQL-Editor ausführen (vorher supabase/players.sql).

Pro Liste wird die Kopfzeile mit „Verein“ gesucht: links davon Nachname und
Vorname, rechts die RC-Punkte, danach die Bewerbs-Spalten (z.B. „1250“, „offen“,
„D2300“), die über die Bewerbsnamen des Turniers zugeordnet werden.

Nennlisten enthalten auch Personen, die nicht gespielt haben (Warteliste, Absage).
Liegt im Excel-Ordner eine Datei import-korrekturen.txt, werden diese ausgelassen
bzw. Schreibweisen korrigiert. Format je Zeile:
    Turnier | Nachname | Vorname | nicht gespielt
    Turnier | Nachname | Vorname | -> Nachname, Vorname
"""

import json
import re
import sys
import urllib.request
import warnings
from pathlib import Path

import openpyxl

warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent

# Datei (relativ zum Excel-Ordner) → Turniername in Supabase
FILES = [
    ("2018/NFS-Trophy-Nennliste 2018.xlsx", "1. NFS Trophy"),
    ("2019/NFS-Trophy-Nennliste 2019.xlsx", "2. NFS Trophy"),
    ("2022/NFS-Trophy-Nennliste 2022.xlsx", "3. NFS Trophy"),
    ("2023/NFS-Trophy-Nennliste 2023.xlsx", "4. NFS Trophy"),
    ("2024/Team/Nennliste Team 2024.xlsx", "1. NFS Team Trophy"),
    ("2024/5_Trophy/NFS-Trophy-Nennliste 2024.xlsx", "5. NFS Trophy"),
    ("2024/6_Trophy/6NFS-Trophy-Nennliste 2024.xlsx", "6. NFS Trophy"),
    ("2025/Nennliste.xlsx", "7. NFS Trophy"),
]


def load_tournaments():
    """Turniere (öffentlich lesbar) mit ihren Bewerbsnamen aus Supabase holen."""
    cfg = (ROOT / "config.js").read_text(encoding="utf-8")
    url = re.search(r'SUPABASE_URL = "([^"]+)"', cfg).group(1)
    key = re.search(r'SUPABASE_ANON_KEY = "([^"]+)"', cfg).group(1)
    req = urllib.request.Request(
        f"{url}/rest/v1/tournaments?select=id,name,bewerbe",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req) as res:
        rows = json.load(res)
    out = {}
    for t in rows:
        bw = t["bewerbe"]
        if isinstance(bw, str):
            bw = json.loads(bw or "[]")
        out[t["name"]] = {"id": str(t["id"]), "bewerbe": [b["name"] if isinstance(b, dict) else b for b in bw or []]}
    return out


def text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def clean_vorname(v):
    """„Rudolf, jun.“ → „Rudolf jun.“ (einheitlich, damit es eine Person bleibt)"""
    return re.sub(r",\s*(jun|sen)\.?$", r" \1.", v.strip())


def load_corrections(path):
    """import-korrekturen.txt → {(turnier, nachname, vorname): None (auslassen) | (nachname, vorname)}"""
    out = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = [p.strip() for p in line.split("|")]
        if line.lstrip().startswith("#") or len(parts) != 4:
            continue
        turnier, nach, vor, action = parts
        key = (turnier, nach.lower(), clean_vorname(vor).lower())
        if action.startswith("->"):
            new_nach, new_vor = [s.strip() for s in action[2:].split(",", 1)]
            out[key] = (new_nach, new_vor)
        else:
            out[key] = None
    return out


def map_bewerb(header, bewerbe):
    """Spaltenkopf („1250“, „offen“, „D2300“, „E offen“) → Bewerbsname des Turniers."""
    h = header.lower().replace(" ", "")
    if not h or h in ("nenngeld", "partner", "doppelrc", "rc", "rc-punkte", "sd", "x"):
        return None
    doppel = h.startswith("d") and not h.startswith("dop")
    digits = re.sub(r"\D", "", h)
    offen = "offen" in h
    if not digits and not offen:
        return None
    for name in bewerbe:
        n = name.lower()
        if ("doppel" in n) != doppel:
            continue
        if digits and re.search(rf"\b{digits}\b", n) and not ("offen" in n and "bis" not in n):
            return name
        if offen and not digits and "offen" in n:
            return name
    return None


def parse_sheet(ws, bewerbe):
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    head_idx = next((i for i, r in enumerate(rows) if any(text(c).lower() == "verein" for c in r)), None)
    if head_idx is None:
        return []
    head = [text(c) for c in rows[head_idx]]
    # Manche Listen haben zwei Tabellen nebeneinander → jede „Verein“-Spalte ist ein Block
    blocks = []
    starts = [i for i, c in enumerate(head) if c.lower() == "verein"]
    for bi, v in enumerate(starts):
        end = starts[bi + 1] - 2 if bi + 1 < len(starts) else len(head)
        cols = {}
        partner = None
        for c in range(v + 2, end):
            if head[c].lower() == "nenngeld":
                break
            if head[c].lower() == "partner":
                partner = c
                continue
            b = map_bewerb(head[c], bewerbe)
            if b:
                cols[c] = b
        blocks.append((v, cols, partner, end))

    out = []
    for r in rows[head_idx + 1:]:
        cells = [text(c) for c in r] + [""] * len(head)
        for v, cols, partner, end in blocks:
            nach, vor, verein, rc = cells[v - 2], clean_vorname(cells[v - 1]), cells[v], cells[v + 1]
            if not nach or not vor or nach.lower() in ("name", "summe", "gesamt"):
                continue
            if re.fullmatch(r"[\d.,]+", nach) or re.fullmatch(r"[\d.,]+", vor):
                continue
            chosen = [b for c, b in cols.items() if cells[c] and cells[c] not in ("0",)]
            email = next((c for c in cells[v:end] if "@" in c and " " not in c), "")
            rc_val = int(rc) if re.fullmatch(r"\d{1,5}", rc) else None
            out.append({"nachname": nach, "vorname": vor, "verein": verein, "rc": rc_val, "email": email, "bewerbe": chosen})
            # Team-Bewerb: Partner (Nachname, Vorname) mitnehmen
            if partner is not None:
                pn, pv = cells[partner], cells[partner + 1]
                if pn and pv and not re.search(r"\d", pn + pv) and not pv.endswith("."):
                    out.append({"nachname": pn, "vorname": pv, "verein": "", "rc": None, "email": "", "bewerbe": chosen})
    return out


def sql_str(s):
    return "null" if s in (None, "") else "'" + str(s).replace("'", "''") + "'"


def sql_arr(items):
    return "array[" + ",".join(sql_str(i) for i in items) + "]::text[]" if items else "'{}'::text[]"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    base = Path(sys.argv[1])
    target = Path(sys.argv[2]) if len(sys.argv) > 2 else base / "spieler-import.sql"
    if ROOT in target.resolve().parents:
        sys.exit("Die Ausgabe enthält Personendaten und darf nicht im Repository liegen.")

    tournaments = load_tournaments()
    corrections = load_corrections(base / "import-korrekturen.txt")
    used = set()
    lines = [
        "-- Import alter Nennlisten in die Spielerdatenbank (erzeugt von tools/import_players.py)",
        "-- Enthält Personendaten – nicht weitergeben, nach dem Import löschen.",
        "begin;",
    ]
    total = 0
    for rel, tname in FILES:
        path = base / rel
        t = tournaments.get(tname)
        if not path.exists() or not t:
            print(f"!! übersprungen: {rel} ({'Datei fehlt' if not path.exists() else 'Turnier fehlt'})")
            continue
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        people = {}
        sheets = [ws for ws in wb.worksheets if ws.title.lower().startswith(("nennliste", "tabelle"))]
        per_sheet = {}
        for ws in sheets:
            rows = parse_sheet(ws, t["bewerbe"])
            per_sheet[ws.title] = {(p["nachname"].lower(), p["vorname"].lower()) for p in rows}
            for p in rows:
                k = (p["nachname"].lower(), p["vorname"].lower())
                cur = people.setdefault(k, {**p, "bewerbe": []})
                cur["bewerbe"] = sorted(set(cur["bewerbe"]) | set(p["bewerbe"]))
                for f in ("verein", "rc", "email"):
                    cur[f] = cur[f] or p[f]
        # Korrekturen anwenden (nicht gespielt → weg, Tippfehler → richtiger Name)
        skipped = 0
        for k in list(people):
            ck = (tname, k[0], k[1])
            if ck not in corrections:
                continue
            used.add(ck)
            if corrections[ck] is None:
                del people[k]
                skipped += 1
            else:
                people[k]["nachname"], people[k]["vorname"] = corrections[ck]
        no_bewerb = sum(1 for p in people.values() if not p["bewerbe"])
        print(f"{tname:20} {len(people):4} Personen  ({rel}; Blätter: {', '.join(f'{s}={len(v)}' for s, v in per_sheet.items())}; "
              f"ohne Bewerb: {no_bewerb}; nicht gespielt: {skipped})")
        if len(per_sheet) > 1:
            all_keys = set().union(*per_sheet.values())
            for s, keys in per_sheet.items():
                missing = sorted(all_keys - keys)
                if missing:
                    print(f"     fehlen in „{s}“: {', '.join(f'{v.title()} {n.title()}' for n, v in missing[:12])}{' …' if len(missing) > 12 else ''}")
        lines.append(f"\n-- {tname} ({rel})")
        for p in sorted(people.values(), key=lambda p: (p["nachname"].lower(), p["vorname"].lower())):
            lines.append(
                f"select public.nfs_import_entry({sql_str(t['id'])}, {sql_str(p['vorname'])}, {sql_str(p['nachname'])}, "
                f"{sql_str(p['verein'])}, {p['rc'] if p['rc'] is not None else 'null'}, {sql_str(p['email'])}, {sql_arr(p['bewerbe'])});"
            )
        total += len(people)
    for ck in sorted(set(corrections) - used):
        print(f"!! Korrektur ohne Treffer: {' | '.join(ck)}")
    lines += ["\ncommit;", "", "select count(*) as spieler, (select count(*) from public.player_entries) as teilnahmen from public.players;"]
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{total} Teilnahmen → {target}")


if __name__ == "__main__":
    main()
