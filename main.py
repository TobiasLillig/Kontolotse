"""
Kontolotse — Persönlicher Finanzplaner — Version 1.0
Schritte 1–3 + Vertragsprüfung
"""

import io
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from dateutil.relativedelta import relativedelta

from fastapi import FastAPI, Request, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BASE_DIR = Path(__file__).resolve().parent
# Abwärtskompatibilität: alte haushaltsbuch.db automatisch erkennen
_old_db = BASE_DIR / "haushaltsbuch.db"
_new_db = BASE_DIR / "kontolotse.db"
if _old_db.exists() and not _new_db.exists():
    _old_db.rename(_new_db)
DB_PATH = _new_db

KATEGORIEN = [
    "Altersvorsorge", "Auto", "Freizeit und Hobbys", "Grundversorgung",
    "Kinderbetreuung", "Kredite", "Lebensmittel", "Reparaturen und Wartung",
    "Rücklage", "Sonstige", "Steuern", "Unterhaltung und Medien",
    "Versicherungen", "Verträge",
]

RHYTHMUS_MAP = {
    "monatlich": "monatlich", "quartalsweise": "quartalsweise",
    "halbjährlich": "halbjaehrlich", "halbjaehrlich": "halbjaehrlich",
    "jährlich": "jaehrlich", "jaehrlich": "jaehrlich",
    "zweijährlich": "zweijaehrlich", "zweijaehrlich": "zweijaehrlich",
}

app = FastAPI(title="Kontolotse", version="1.0")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


# ---------------------------------------------------------------------------
# Datenbank
# ---------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def db_session():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with db_session() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS konten (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            name               TEXT    NOT NULL UNIQUE,
            typ                TEXT    NOT NULL DEFAULT 'topf'
                               CHECK (typ IN ('hauptkonto', 'topf')),
            saldo              REAL    NOT NULL DEFAULT 0.0,
            monatlicher_betrag REAL    NOT NULL DEFAULT 0.0,
            erstellt_am        TEXT    NOT NULL DEFAULT (date('now'))
        );
        CREATE TABLE IF NOT EXISTS vertraege (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            name                  TEXT    NOT NULL,
            kategorie             TEXT    NOT NULL DEFAULT 'Sonstige',
            konto_id              INTEGER NOT NULL DEFAULT 1,
            betrag                REAL    NOT NULL,
            startdatum            TEXT    NOT NULL,
            rhythmus              TEXT    NOT NULL DEFAULT 'monatlich'
                                  CHECK (rhythmus IN (
                                      'monatlich','quartalsweise','halbjaehrlich',
                                      'jaehrlich','zweijaehrlich')),
            aktiv                 INTEGER NOT NULL DEFAULT 1,
            bemerkung             TEXT    DEFAULT '',
            pruef_intervall_monate INTEGER NOT NULL DEFAULT 12,
            letzte_pruefung       TEXT,
            erstellt_am           TEXT    NOT NULL DEFAULT (date('now')),
            FOREIGN KEY (konto_id) REFERENCES konten(id)
        );
        CREATE TABLE IF NOT EXISTS einzahlungen (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            bezeichnung     TEXT    NOT NULL,
            betrag          REAL    NOT NULL,
            tag_im_monat    INTEGER,
            typ             TEXT    NOT NULL DEFAULT 'fest'
                            CHECK (typ IN ('fest', 'manuell')),
            konto_id        INTEGER NOT NULL DEFAULT 1,
            datum           TEXT,
            erstellt_am     TEXT    NOT NULL DEFAULT (date('now')),
            FOREIGN KEY (konto_id) REFERENCES konten(id)
        );
        CREATE TABLE IF NOT EXISTS transaktionen (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            typ             TEXT    NOT NULL
                            CHECK (typ IN ('einzahlung','abbuchung','umbuchung','entnahme')),
            von_konto_id    INTEGER,
            nach_konto_id   INTEGER,
            betrag          REAL    NOT NULL,
            beschreibung    TEXT,
            datum           TEXT    NOT NULL DEFAULT (date('now')),
            erstellt_am     TEXT    NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (von_konto_id)  REFERENCES konten(id),
            FOREIGN KEY (nach_konto_id) REFERENCES konten(id)
        );
        CREATE TABLE IF NOT EXISTS parameter (
            schluessel TEXT PRIMARY KEY,
            wert       TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS preisaenderungen (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            vertrag_id  INTEGER NOT NULL,
            neuer_betrag REAL   NOT NULL,
            ab_datum    TEXT    NOT NULL,
            bemerkung   TEXT    DEFAULT '',
            erstellt_am TEXT    NOT NULL DEFAULT (date('now')),
            FOREIGN KEY (vertrag_id) REFERENCES vertraege(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS kategorien (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT    NOT NULL UNIQUE
        );
        """)

        # Hauptkonto anlegen
        if not conn.execute("SELECT id FROM konten WHERE typ='hauptkonto'").fetchone():
            conn.execute("INSERT INTO konten (name,typ,saldo) VALUES ('Fixkostenkonto','hauptkonto',0.0)")

        # Migrationen
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(vertraege)").fetchall()]
        if "bemerkung" not in cols:
            conn.execute("ALTER TABLE vertraege ADD COLUMN bemerkung TEXT DEFAULT ''")
        if "pruef_intervall_monate" not in cols:
            conn.execute("ALTER TABLE vertraege ADD COLUMN pruef_intervall_monate INTEGER NOT NULL DEFAULT 12")
        if "letzte_pruefung" not in cols:
            conn.execute("ALTER TABLE vertraege ADD COLUMN letzte_pruefung TEXT")
            conn.execute("UPDATE vertraege SET letzte_pruefung = erstellt_am WHERE letzte_pruefung IS NULL")
        if "enddatum" not in cols:
            conn.execute("ALTER TABLE vertraege ADD COLUMN enddatum TEXT")
        if "versicherungstyp" not in cols:
            conn.execute("ALTER TABLE vertraege ADD COLUMN versicherungstyp TEXT")
        if "vertragspartner" not in cols:
            conn.execute("ALTER TABLE vertraege ADD COLUMN vertragspartner TEXT DEFAULT ''")
        if "mindestlaufzeit_ende" not in cols:
            conn.execute("ALTER TABLE vertraege ADD COLUMN mindestlaufzeit_ende TEXT")
        if "kuendigungsfrist_monate" not in cols:
            conn.execute("ALTER TABLE vertraege ADD COLUMN kuendigungsfrist_monate INTEGER DEFAULT 2")
        if "abbuchungstag" not in cols:
            conn.execute("ALTER TABLE vertraege ADD COLUMN abbuchungstag INTEGER")

        # Konten-Migrationen
        konten_cols = [r["name"] for r in conn.execute("PRAGMA table_info(konten)").fetchall()]
        if "zuweisung_startdatum" not in konten_cols:
            conn.execute("ALTER TABLE konten ADD COLUMN zuweisung_startdatum TEXT")

        # Globaler Standard-Prüfintervall
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='pruef_intervall_standard'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('pruef_intervall_standard','12')")
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='sicherheitstage'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('sicherheitstage','2')")
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='sicherheitstage_vor'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('sicherheitstage_vor','1')")
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='kfz_pruefmonat'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('kfz_pruefmonat','11')")
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='moped_pruefmonat'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('moped_pruefmonat','1')")
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='pruef_reset_fragen'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('pruef_reset_fragen','1')")
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='kontostand_schaetzen'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('kontostand_schaetzen','1')")
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='sicherheitspuffer'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('sicherheitspuffer','100')")
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='kontoname'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('kontoname','Fixkostenkonto')")
        if not conn.execute("SELECT 1 FROM parameter WHERE schluessel='kontostand_aktualisiert'").fetchone():
            conn.execute("INSERT INTO parameter (schluessel,wert) VALUES ('kontostand_aktualisiert',?)", (date.today().isoformat(),))

        # Kategorien initial befüllen
        if not conn.execute("SELECT 1 FROM kategorien").fetchone():
            for k in KATEGORIEN:
                conn.execute("INSERT OR IGNORE INTO kategorien (name) VALUES (?)", (k,))


@app.on_event("startup")
def startup():
    init_db()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# ---------------------------------------------------------------------------
# API: Kategorien
# ---------------------------------------------------------------------------
@app.get("/api/kategorien")
def api_kategorien():
    with db_session() as conn:
        rows = conn.execute("SELECT name FROM kategorien ORDER BY name").fetchall()
        return [r["name"] for r in rows]

@app.post("/api/kategorien")
async def api_kategorie_erstellen(request: Request):
    data = await request.json()
    name = data.get("name", "").strip()
    if not name: return {"ok": False, "error": "Name darf nicht leer sein"}
    with db_session() as conn:
        try:
            conn.execute("INSERT INTO kategorien (name) VALUES (?)", (name,))
        except:
            return {"ok": False, "error": "Kategorie existiert bereits"}
    return {"ok": True}

@app.delete("/api/kategorien/{name}")
def api_kategorie_loeschen(name: str):
    with db_session() as conn:
        count = conn.execute("SELECT COUNT(*) as n FROM vertraege WHERE kategorie=?", (name,)).fetchone()["n"]
        conn.execute("DELETE FROM kategorien WHERE name=?", (name,))
    return {"ok": True, "vertraege_betroffen": count}


# ---------------------------------------------------------------------------
# API: Konten
# ---------------------------------------------------------------------------
@app.get("/api/konten")
def api_konten():
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM konten ORDER BY CASE WHEN typ='hauptkonto' THEN 0 ELSE 1 END, name").fetchall()
        return [dict(r) for r in rows]

@app.post("/api/konten")
async def api_konto_erstellen(request: Request):
    data = await request.json()
    with db_session() as conn:
        cur = conn.execute(
            "INSERT INTO konten (name,typ,saldo,monatlicher_betrag,zuweisung_startdatum) VALUES (?,?,?,?,?)",
            (data["name"], data.get("typ","topf"), data.get("saldo",0.0), data.get("monatlicher_betrag",0.0),
             data.get("zuweisung_startdatum") or date.today().replace(day=1).isoformat()))
        return {"ok": True, "id": cur.lastrowid}

@app.put("/api/konten/{konto_id}")
async def api_konto_bearbeiten(konto_id: int, request: Request):
    data = await request.json()
    with db_session() as conn:
        fields, values = [], []
        for key in ("name","saldo","monatlicher_betrag","zuweisung_startdatum"):
            if key in data:
                val = data[key]
                if key == "saldo" and isinstance(val, (int, float)):
                    val = round(val, 2)
                fields.append(f"{key}=?"); values.append(val)
        if fields:
            values.append(konto_id)
            conn.execute(f"UPDATE konten SET {','.join(fields)} WHERE id=?", values)
    return {"ok": True}

@app.delete("/api/konten/{konto_id}")
def api_konto_loeschen(konto_id: int):
    with db_session() as conn:
        konto = conn.execute("SELECT * FROM konten WHERE id=?", (konto_id,)).fetchone()
        if not konto: return {"ok": False, "error": "Konto nicht gefunden"}
        if konto["typ"] == "hauptkonto": return {"ok": False, "error": "Hauptkonto kann nicht gelöscht werden"}
        # Saldo wird NICHT aufs Hauptkonto gebucht (Töpfe sind virtuell)
        # Frontend fragt vorher ob Saldo in anderen Topf umgebucht werden soll
        conn.execute("UPDATE transaktionen SET von_konto_id=NULL WHERE von_konto_id=?", (konto_id,))
        conn.execute("UPDATE transaktionen SET nach_konto_id=NULL WHERE nach_konto_id=?", (konto_id,))
        conn.execute("DELETE FROM konten WHERE id=?", (konto_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# API: Topf-Buchungen
# ---------------------------------------------------------------------------
@app.post("/api/topf-buchung")
async def api_topf_buchung(request: Request):
    data = await request.json()
    konto_id, betrag, typ = data["konto_id"], data["betrag"], data["typ"]
    beschreibung = data.get("beschreibung","")
    datum = data.get("datum", date.today().isoformat())
    if betrag <= 0: return {"ok": False, "error": "Betrag muss positiv sein"}
    with db_session() as conn:
        # Töpfe sind virtuell — das Hauptkonto wird NICHT verändert
        if typ == "einzahlung":
            conn.execute("UPDATE konten SET saldo=saldo+? WHERE id=?", (betrag, konto_id))
            conn.execute("INSERT INTO transaktionen (typ,von_konto_id,nach_konto_id,betrag,beschreibung,datum) VALUES ('einzahlung',NULL,?,?,?,?)",
                (konto_id, betrag, beschreibung, datum))
        elif typ == "entnahme":
            conn.execute("UPDATE konten SET saldo=saldo-? WHERE id=?", (betrag, konto_id))
            conn.execute("INSERT INTO transaktionen (typ,von_konto_id,nach_konto_id,betrag,beschreibung,datum) VALUES ('entnahme',?,NULL,?,?,?)",
                (konto_id, betrag, beschreibung, datum))
    return {"ok": True}

@app.post("/api/umbuchung")
async def api_umbuchung(request: Request):
    data = await request.json()
    von_id, nach_id, betrag = data["von_konto_id"], data["nach_konto_id"], data["betrag"]
    beschreibung = data.get("beschreibung","")
    datum = data.get("datum", date.today().isoformat())
    if von_id == nach_id: return {"ok": False, "error": "Gleiches Konto"}
    if betrag <= 0: return {"ok": False, "error": "Betrag muss positiv sein"}
    with db_session() as conn:
        conn.execute("UPDATE konten SET saldo=saldo-? WHERE id=?", (betrag, von_id))
        conn.execute("UPDATE konten SET saldo=saldo+? WHERE id=?", (betrag, nach_id))
        conn.execute("INSERT INTO transaktionen (typ,von_konto_id,nach_konto_id,betrag,beschreibung,datum) VALUES ('umbuchung',?,?,?,?,?)",
            (von_id, nach_id, betrag, beschreibung, datum))
    return {"ok": True}


# ---------------------------------------------------------------------------
# API: Transaktionen
# ---------------------------------------------------------------------------
@app.get("/api/transaktionen")
def api_transaktionen(konto_id: int = 0):
    with db_session() as conn:
        if konto_id:
            rows = conn.execute(
                "SELECT t.*, kv.name as von_konto_name, kn.name as nach_konto_name FROM transaktionen t "
                "LEFT JOIN konten kv ON t.von_konto_id=kv.id LEFT JOIN konten kn ON t.nach_konto_id=kn.id "
                "WHERE t.von_konto_id=? OR t.nach_konto_id=? ORDER BY t.datum DESC, t.id DESC LIMIT 100",
                (konto_id, konto_id)).fetchall()
        else:
            rows = conn.execute(
                "SELECT t.*, kv.name as von_konto_name, kn.name as nach_konto_name FROM transaktionen t "
                "LEFT JOIN konten kv ON t.von_konto_id=kv.id LEFT JOIN konten kn ON t.nach_konto_id=kn.id "
                "ORDER BY t.datum DESC, t.id DESC LIMIT 100").fetchall()
        return [dict(r) for r in rows]


@app.delete("/api/transaktionen/{tx_id}")
def api_transaktion_loeschen(tx_id: int):
    """Löscht eine Transaktion und korrigiert die Kontosalden."""
    with db_session() as conn:
        tx = conn.execute("SELECT * FROM transaktionen WHERE id=?", (tx_id,)).fetchone()
        if not tx:
            return {"ok": False, "error": "Transaktion nicht gefunden"}
        typ = tx["typ"]
        betrag = tx["betrag"]
        # Topf-Buchungen: nur Topf-Saldo korrigieren (Hauptkonto bleibt unberührt)
        if typ == "einzahlung" and tx["nach_konto_id"]:
            conn.execute("UPDATE konten SET saldo=saldo-? WHERE id=?", (betrag, tx["nach_konto_id"]))
        elif typ == "entnahme" and tx["von_konto_id"]:
            conn.execute("UPDATE konten SET saldo=saldo+? WHERE id=?", (betrag, tx["von_konto_id"]))
        elif typ == "umbuchung":
            if tx["von_konto_id"]:
                conn.execute("UPDATE konten SET saldo=saldo+? WHERE id=?", (betrag, tx["von_konto_id"]))
            if tx["nach_konto_id"]:
                conn.execute("UPDATE konten SET saldo=saldo-? WHERE id=?", (betrag, tx["nach_konto_id"]))
        conn.execute("DELETE FROM transaktionen WHERE id=?", (tx_id,))
    return {"ok": True}

@app.put("/api/transaktionen/{tx_id}")
async def api_transaktion_bearbeiten(tx_id: int, request: Request):
    """Bearbeitet Betrag, Beschreibung und Datum einer Transaktion."""
    data = await request.json()
    with db_session() as conn:
        tx = conn.execute("SELECT * FROM transaktionen WHERE id=?", (tx_id,)).fetchone()
        if not tx:
            return {"ok": False, "error": "Transaktion nicht gefunden"}
        
        alter_betrag = tx["betrag"]
        neuer_betrag = data.get("betrag", alter_betrag)
        diff = neuer_betrag - alter_betrag
        
        # Saldo-Korrektur wenn Betrag geändert
        if diff != 0:
            typ = tx["typ"]
            if typ == "einzahlung" and tx["nach_konto_id"]:
                conn.execute("UPDATE konten SET saldo=saldo+? WHERE id=?", (diff, tx["nach_konto_id"]))
            elif typ == "entnahme" and tx["von_konto_id"]:
                conn.execute("UPDATE konten SET saldo=saldo-? WHERE id=?", (diff, tx["von_konto_id"]))
            elif typ == "umbuchung":
                if tx["von_konto_id"]:
                    conn.execute("UPDATE konten SET saldo=saldo-? WHERE id=?", (diff, tx["von_konto_id"]))
                if tx["nach_konto_id"]:
                    conn.execute("UPDATE konten SET saldo=saldo+? WHERE id=?", (diff, tx["nach_konto_id"]))
        
        conn.execute("UPDATE transaktionen SET betrag=?, beschreibung=?, datum=? WHERE id=?",
            (neuer_betrag, data.get("beschreibung", tx["beschreibung"]), data.get("datum", tx["datum"]), tx_id))
    return {"ok": True}


# ---------------------------------------------------------------------------
# API: Verträge
# ---------------------------------------------------------------------------
@app.get("/api/vertraege")
def api_vertraege():
    with db_session() as conn:
        # Auto-Deaktivierung abgelaufener Verträge
        heute = date.today()
        conn.execute("UPDATE vertraege SET aktiv=0 WHERE enddatum IS NOT NULL AND enddatum < ? AND aktiv=1",
            (heute.isoformat(),))

        rows = conn.execute(
            "SELECT v.*, k.name as konto_name FROM vertraege v "
            "LEFT JOIN konten k ON v.konto_id=k.id ORDER BY v.name").fetchall()

        # Preisänderungen für alle Verträge laden
        pa_rows = conn.execute("SELECT * FROM preisaenderungen ORDER BY ab_datum").fetchall()
        pa_map = {}
        for pa in pa_rows:
            pa_map.setdefault(pa["vertrag_id"], []).append(dict(pa))

        # Versicherungs-Prüfmonate laden
        kfz_pm = conn.execute("SELECT wert FROM parameter WHERE schluessel='kfz_pruefmonat'").fetchone()
        kfz_monat = int(kfz_pm["wert"]) if kfz_pm else 11
        moped_pm = conn.execute("SELECT wert FROM parameter WHERE schluessel='moped_pruefmonat'").fetchone()
        moped_monat = int(moped_pm["wert"]) if moped_pm else 1

        result = []
        for r in rows:
            d = dict(r)
            # Prüfstatus: reguläres Intervall
            intervall = d.get("pruef_intervall_monate") or 12
            lp = d.get("letzte_pruefung")
            if intervall > 0 and lp:
                try:
                    lp_date = datetime.strptime(lp, "%Y-%m-%d").date()
                    naechste = lp_date + relativedelta(months=intervall)
                    d["pruefung_faellig"] = heute >= naechste
                    d["naechste_pruefung"] = naechste.isoformat()
                except:
                    d["pruefung_faellig"] = False
                    d["naechste_pruefung"] = None
            else:
                d["pruefung_faellig"] = False
                d["naechste_pruefung"] = None

            # Saisonale Versicherungsprüfung (überschreibt reguläre wenn fällig)
            vtyp = d.get("versicherungstyp")
            if vtyp and d.get("aktiv"):
                check_monat = kfz_monat if vtyp == "kfz" else moped_monat if vtyp == "moped_escooter" else None
                if check_monat:
                    # Prüfung fällig wenn: aktueller Monat >= check_monat UND letzte Prüfung war vor diesem Stichtag
                    stichtag = date(heute.year, check_monat, 1)
                    if heute >= stichtag:
                        # War die letzte Prüfung dieses Jahr nach dem Stichtag?
                        if lp:
                            try:
                                lp_date = datetime.strptime(lp, "%Y-%m-%d").date()
                                if lp_date < stichtag:
                                    d["pruefung_faellig"] = True
                                    d["naechste_pruefung"] = stichtag.isoformat()
                                    d["pruef_grund"] = f"Jährliche {'KFZ' if vtyp=='kfz' else 'Moped/E-Scooter'}-Versicherungsprüfung"
                            except:
                                pass

            # Preisänderungen anhängen
            d["preisaenderungen"] = pa_map.get(d["id"], [])

            # Nächste anstehende Preisänderung
            zuk = [p for p in d["preisaenderungen"] if p["ab_datum"] > heute.isoformat()]
            d["naechste_preisaenderung"] = zuk[0] if zuk else None

            # Enddatum-Info
            d["abgelaufen"] = bool(d.get("enddatum") and d["enddatum"] < heute.isoformat())

            # Vertragsalarm: Mindestlaufzeit
            d["vertragsalarm"] = False
            d["vertragsalarm_text"] = None
            mle = d.get("mindestlaufzeit_ende")
            if mle and d.get("aktiv"):
                try:
                    mle_date = datetime.strptime(mle, "%Y-%m-%d").date()
                    kf = d.get("kuendigungsfrist_monate") or 2
                    alarm_date = mle_date - relativedelta(months=kf)
                    if heute >= alarm_date and heute <= mle_date:
                        d["vertragsalarm"] = True
                        tage_bis = (mle_date - heute).days
                        d["vertragsalarm_text"] = f"Mindestlaufzeit endet in {tage_bis} Tagen ({mle_date.strftime('%d.%m.%Y')}). Jetzt Anbieter vergleichen!"
                    elif heute > mle_date:
                        d["vertragsalarm"] = True
                        d["vertragsalarm_text"] = f"Mindestlaufzeit seit {mle_date.strftime('%d.%m.%Y')} abgelaufen — Anbieterwechsel jederzeit möglich."
                except:
                    pass

            result.append(d)
        return result

@app.post("/api/vertraege")
async def api_vertrag_erstellen(request: Request):
    data = await request.json()
    with db_session() as conn:
        # Globalen Standard holen
        std = conn.execute("SELECT wert FROM parameter WHERE schluessel='pruef_intervall_standard'").fetchone()
        intervall = int(std["wert"]) if std else 12
        cur = conn.execute(
            "INSERT INTO vertraege (name,kategorie,konto_id,betrag,startdatum,rhythmus,bemerkung,pruef_intervall_monate,letzte_pruefung,enddatum,versicherungstyp,vertragspartner,mindestlaufzeit_ende,kuendigungsfrist_monate,abbuchungstag) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (data["name"], data.get("kategorie","Sonstige"), data.get("konto_id",1),
             data["betrag"], data["startdatum"], data.get("rhythmus","monatlich"),
             data.get("bemerkung",""), data.get("pruef_intervall_monate", intervall),
             date.today().isoformat(), data.get("enddatum") or None, data.get("versicherungstyp") or None,
             data.get("vertragspartner",""), data.get("mindestlaufzeit_ende") or None,
             data.get("kuendigungsfrist_monate") or 2, int(data["abbuchungstag"]) if data.get("abbuchungstag") else None))
        return {"ok": True, "id": cur.lastrowid}

@app.put("/api/vertraege/{vertrag_id}")
async def api_vertrag_bearbeiten(vertrag_id: int, request: Request):
    data = await request.json()
    with db_session() as conn:
        conn.execute(
            "UPDATE vertraege SET name=?,kategorie=?,konto_id=?,betrag=?,startdatum=?,rhythmus=?,aktiv=?,bemerkung=?,pruef_intervall_monate=?,enddatum=?,versicherungstyp=?,vertragspartner=?,mindestlaufzeit_ende=?,kuendigungsfrist_monate=?,abbuchungstag=? WHERE id=?",
            (data["name"], data.get("kategorie","Sonstige"), data.get("konto_id",1),
             data["betrag"], data["startdatum"], data.get("rhythmus","monatlich"),
             data.get("aktiv",1), data.get("bemerkung",""),
             data.get("pruef_intervall_monate",12), data.get("enddatum") or None,
             data.get("versicherungstyp") or None, data.get("vertragspartner",""),
             data.get("mindestlaufzeit_ende") or None, data.get("kuendigungsfrist_monate") or 2,
             data.get("abbuchungstag") or None, vertrag_id))
    return {"ok": True}

@app.put("/api/vertraege/{vertrag_id}/geprueft")
def api_vertrag_geprueft(vertrag_id: int):
    with db_session() as conn:
        conn.execute("UPDATE vertraege SET letzte_pruefung=? WHERE id=?",
            (date.today().isoformat(), vertrag_id))
    return {"ok": True}

@app.put("/api/vertraege/{vertrag_id}/spaeter-vorlegen")
def api_vertrag_spaeter(vertrag_id: int):
    """Setzt letzte_pruefung so, dass der Vertrag in ~30 Tagen wieder fällig wird."""
    with db_session() as conn:
        v = conn.execute("SELECT pruef_intervall_monate FROM vertraege WHERE id=?", (vertrag_id,)).fetchone()
        intervall = (v["pruef_intervall_monate"] or 12) if v else 12
        # Setze letzte_pruefung = heute - (intervall - 1 Monat), sodass in ~30 Tagen fällig
        fake_date = date.today() - relativedelta(months=intervall) + relativedelta(days=30)
        conn.execute("UPDATE vertraege SET letzte_pruefung=? WHERE id=?",
            (fake_date.isoformat(), vertrag_id))
    return {"ok": True}

@app.put("/api/vertraege/{vertrag_id}/pruefung-markieren")
def api_vertrag_pruefung_markieren(vertrag_id: int):
    """Setzt letzte_pruefung weit zurück, sodass Vertrag sofort als fällig erscheint."""
    with db_session() as conn:
        conn.execute("UPDATE vertraege SET letzte_pruefung='2000-01-01' WHERE id=?", (vertrag_id,))
    return {"ok": True}

@app.put("/api/vertraege/{vertrag_id}/alarm-bestaetigen")
async def api_alarm_bestaetigen(vertrag_id: int, request: Request):
    """Setzt neue Mindestlaufzeit nach Alarm-Bestätigung."""
    data = await request.json()
    neue_laufzeit = data.get("neue_mindestlaufzeit_ende")
    with db_session() as conn:
        if neue_laufzeit:
            conn.execute("UPDATE vertraege SET mindestlaufzeit_ende=? WHERE id=?", (neue_laufzeit, vertrag_id))
        else:
            conn.execute("UPDATE vertraege SET mindestlaufzeit_ende=NULL WHERE id=?", (vertrag_id,))
    return {"ok": True}

@app.delete("/api/vertraege/{vertrag_id}")
def api_vertrag_loeschen(vertrag_id: int):
    with db_session() as conn:
        conn.execute("DELETE FROM preisaenderungen WHERE vertrag_id=?", (vertrag_id,))
        conn.execute("DELETE FROM vertraege WHERE id=?", (vertrag_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# API: Preisänderungen
# ---------------------------------------------------------------------------
@app.get("/api/preisaenderungen/{vertrag_id}")
def api_preisaenderungen(vertrag_id: int):
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM preisaenderungen WHERE vertrag_id=? ORDER BY ab_datum", (vertrag_id,)).fetchall()
        return [dict(r) for r in rows]

@app.post("/api/preisaenderungen")
async def api_preisaenderung_erstellen(request: Request):
    data = await request.json()
    with db_session() as conn:
        cur = conn.execute(
            "INSERT INTO preisaenderungen (vertrag_id,neuer_betrag,ab_datum,bemerkung) VALUES (?,?,?,?)",
            (data["vertrag_id"], data["neuer_betrag"], data["ab_datum"], data.get("bemerkung","")))
        return {"ok": True, "id": cur.lastrowid}

@app.delete("/api/preisaenderungen/{pa_id}")
def api_preisaenderung_loeschen(pa_id: int):
    with db_session() as conn:
        conn.execute("DELETE FROM preisaenderungen WHERE id=?", (pa_id,))
    return {"ok": True}

@app.get("/api/vertraege/{vertrag_id}/naechste-termine")
def api_naechste_termine(vertrag_id: int, anzahl: int = 12):
    """Liefert die nächsten N Fälligkeitstermine eines Vertrags."""
    from dateutil.relativedelta import relativedelta
    with db_session() as conn:
        v = conn.execute("SELECT * FROM vertraege WHERE id=?", (vertrag_id,)).fetchone()
        if not v: return []
    heute = date.today()
    bis = heute + relativedelta(months=24)
    if v["enddatum"]:
        try: bis = min(bis, datetime.strptime(v["enddatum"], "%Y-%m-%d").date())
        except: pass
    termine = berechne_faelligkeiten(v["startdatum"], v["rhythmus"], heute, bis, abbuchungstag=v.get("abbuchungstag"))
    return [t.isoformat() for t in termine[:anzahl]]


# ---------------------------------------------------------------------------
# API: Excel-Import
# ---------------------------------------------------------------------------
@app.post("/api/import/excel")
async def api_import_excel(file: UploadFile = File(...)):
    try:
        import pandas as pd
    except ImportError:
        return JSONResponse(content={"ok": False, "error": "pandas nicht installiert"})
    try:
        content = await file.read()
        if not content:
            return JSONResponse(content={"ok": False, "error": "Leere Datei"})
        xls = pd.ExcelFile(io.BytesIO(content))
        sheet_name = None
        for candidate in xls.sheet_names:
            if candidate.lower().replace("\u00e4","ae") in ("vertr\u00e4ge","vertraege"):
                sheet_name = candidate; break
        if not sheet_name:
            return JSONResponse(content={"ok": False, "error": "Kein Blatt 'Verträge' gefunden. Vorhanden: " + ", ".join(xls.sheet_names)})
        df = pd.read_excel(xls, sheet_name=sheet_name, header=0)
        vertrag_col = None
        for col in df.columns:
            if str(col).strip().lower() in ("vertrag","name"):
                vertrag_col = col; break
        if not vertrag_col:
            return JSONResponse(content={"ok": False, "error": "Spalte 'Vertrag' nicht gefunden."})
        df = df.dropna(subset=[vertrag_col])
        imported, skipped, errors = 0, 0, []
        with db_session() as conn:
            haupt_id = (conn.execute("SELECT id FROM konten WHERE typ='hauptkonto'").fetchone() or {"id":1})["id"]
            std = conn.execute("SELECT wert FROM parameter WHERE schluessel='pruef_intervall_standard'").fetchone()
            default_intervall = int(std["wert"]) if std else 12
            for idx, row in df.iterrows():
                try:
                    name = str(row.get(vertrag_col,"")).strip()
                    if not name: skipped += 1; continue
                    kategorie = "Sonstige"
                    for c in df.columns:
                        if "kategorie" in str(c).lower():
                            v = row.get(c)
                            if pd.notna(v): kategorie = str(v).strip()
                            break
                    betrag = 0.0
                    for c in df.columns:
                        cl = str(c).lower()
                        if "abbuchungsbetrag" in cl or ("betrag" in cl and "monat" not in cl and "jahr" not in cl):
                            v = row.get(c)
                            if pd.notna(v):
                                try: betrag = float(v)
                                except: pass
                            break
                    if betrag == 0.0: skipped += 1; continue
                    startdatum = date.today().isoformat()
                    for c in df.columns:
                        cl = str(c).lower()
                        if "erste abbuchung" in cl or "startdatum" in cl:
                            v = row.get(c)
                            if pd.notna(v):
                                startdatum = v.strftime("%Y-%m-%d") if hasattr(v,"strftime") else str(v)[:10]
                            break
                    rhythmus_raw = "monatlich"
                    for c in df.columns:
                        if "rhythmus" in str(c).lower():
                            v = row.get(c)
                            if pd.notna(v): rhythmus_raw = str(v).strip().lower()
                            break
                    bemerkung = ""
                    for c in df.columns:
                        if "bemerkung" in str(c).lower():
                            v = row.get(c)
                            if pd.notna(v): bemerkung = str(v).strip()
                            break
                    rhythmus = RHYTHMUS_MAP.get(rhythmus_raw, "monatlich")
                    if conn.execute("SELECT id FROM vertraege WHERE name=? AND betrag=?", (name,betrag)).fetchone():
                        skipped += 1; continue
                    conn.execute(
                        "INSERT INTO vertraege (name,kategorie,konto_id,betrag,startdatum,rhythmus,bemerkung,pruef_intervall_monate,letzte_pruefung) VALUES (?,?,?,?,?,?,?,?,?)",
                        (name, kategorie, haupt_id, betrag, startdatum, rhythmus, bemerkung, default_intervall, date.today().isoformat()))
                    imported += 1
                except Exception as e:
                    errors.append(f"Zeile {idx+2}: {e}"); skipped += 1
        result = {"ok": True, "imported": imported, "skipped": skipped}
        if errors: result["errors"] = errors[:5]
        return JSONResponse(content=result)
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(content={"ok": False, "error": str(e)})


# ---------------------------------------------------------------------------
# API: Einzahlungen
# ---------------------------------------------------------------------------
@app.get("/api/einzahlungen")
def api_einzahlungen():
    with db_session() as conn:
        rows = conn.execute(
            "SELECT e.*, k.name as konto_name FROM einzahlungen e "
            "LEFT JOIN konten k ON e.konto_id=k.id ORDER BY e.tag_im_monat, e.datum").fetchall()
        return [dict(r) for r in rows]

@app.post("/api/einzahlungen")
async def api_einzahlung_erstellen(request: Request):
    data = await request.json()
    with db_session() as conn:
        conn.execute("INSERT INTO einzahlungen (bezeichnung,betrag,tag_im_monat,typ,konto_id,datum) VALUES (?,?,?,?,?,?)",
            (data["bezeichnung"], data["betrag"], data.get("tag_im_monat"), data.get("typ","fest"), data.get("konto_id",1), data.get("datum")))
    return {"ok": True}

@app.put("/api/einzahlungen/{eid}")
async def api_einzahlung_bearbeiten(eid: int, request: Request):
    data = await request.json()
    with db_session() as conn:
        conn.execute("UPDATE einzahlungen SET bezeichnung=?,betrag=?,tag_im_monat=?,typ=?,konto_id=? WHERE id=?",
            (data["bezeichnung"], data["betrag"], data.get("tag_im_monat"), data.get("typ","fest"), data.get("konto_id",1), eid))
    return {"ok": True}

@app.delete("/api/einzahlungen/{eid}")
def api_einzahlung_loeschen(eid: int):
    with db_session() as conn:
        conn.execute("DELETE FROM einzahlungen WHERE id=?", (eid,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# API: Parameter
# ---------------------------------------------------------------------------
@app.get("/api/parameter")
def api_parameter():
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM parameter").fetchall()
        return {r["schluessel"]: r["wert"] for r in rows}

@app.put("/api/parameter")
async def api_parameter_setzen(request: Request):
    data = await request.json()
    with db_session() as conn:
        for key, val in data.items():
            conn.execute("INSERT OR REPLACE INTO parameter (schluessel,wert) VALUES (?,?)", (key, str(val)))
    return {"ok": True}


# ---------------------------------------------------------------------------
# API: Simulation
# ---------------------------------------------------------------------------
def berechne_ostersonntag(jahr):
    """Gauß'sche Osterformel — berechnet Ostersonntag für ein beliebiges Jahr."""
    a = jahr % 19
    b = jahr // 100
    c = jahr % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    monat = (h + l - 7 * m + 114) // 31
    tag = ((h + l - 7 * m + 114) % 31) + 1
    return date(jahr, monat, tag)

def feiertage_fuer_jahr(jahr):
    """Alle bundesweiten Feiertage + TARGET-Bankfeiertage für ein Jahr."""
    ostern = berechne_ostersonntag(jahr)
    tage = {
        # Feste Feiertage
        date(jahr, 1, 1),    # Neujahr
        date(jahr, 5, 1),    # Tag der Arbeit
        date(jahr, 10, 3),   # Tag der Deutschen Einheit
        date(jahr, 12, 25),  # 1. Weihnachtstag
        date(jahr, 12, 26),  # 2. Weihnachtstag
        # TARGET-Bankfeiertage
        date(jahr, 12, 24),  # Heiligabend
        date(jahr, 12, 31),  # Silvester
        # Bewegliche Feiertage (Ostern-basiert)
        ostern + timedelta(days=-2),   # Karfreitag
        ostern + timedelta(days=1),    # Ostermontag
        ostern + timedelta(days=39),   # Christi Himmelfahrt
        ostern + timedelta(days=50),   # Pfingstmontag
    }
    return tage

# Cache für Feiertage pro Jahr
_feiertag_cache = {}

def ist_bankfrei(d):
    """Prüft ob ein Datum ein Wochenende oder Feiertag ist."""
    if d.weekday() >= 5:  # Sa/So
        return True
    jahr = d.year
    if jahr not in _feiertag_cache:
        _feiertag_cache[jahr] = feiertage_fuer_jahr(jahr)
    return d in _feiertag_cache[jahr]

def naechster_werktag(d):
    """Verschiebt auf den nächsten Bankwerktag (kein Wochenende, kein Feiertag)."""
    while ist_bankfrei(d):
        d += timedelta(days=1)
    return d

def berechne_faelligkeiten(startdatum_str, rhythmus, von_datum, bis_datum, mit_wochenend_info=False, abbuchungstag=None):
    import calendar as cal_mod
    try:
        start = datetime.strptime(startdatum_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return []
    intervall = {"monatlich": relativedelta(months=1), "quartalsweise": relativedelta(months=3),
                 "halbjaehrlich": relativedelta(months=6), "jaehrlich": relativedelta(years=1),
                 "zweijaehrlich": relativedelta(years=2)}.get(rhythmus)
    if not intervall: return []
    # Wenn abbuchungstag gesetzt, Start auf diesen Tag korrigieren
    if abbuchungstag:
        max_tag = cal_mod.monthrange(start.year, start.month)[1]
        start = start.replace(day=min(abbuchungstag, max_tag))
    termine, termin = [], start
    while termin < von_datum: termin += intervall
    while termin <= bis_datum:
        # Bei abbuchungstag: Tag pro Monat korrigieren (Feb hat kein 31.)
        if abbuchungstag:
            max_tag = cal_mod.monthrange(termin.year, termin.month)[1]
            termin = termin.replace(day=min(abbuchungstag, max_tag))
        effektiv = naechster_werktag(termin)
        if mit_wochenend_info:
            termine.append({"original": termin, "effektiv": effektiv, "verschoben": termin != effektiv})
        else:
            termine.append(effektiv)
        termin += intervall
    return termine

@app.get("/api/simulation")
def api_simulation():
    from dateutil.relativedelta import relativedelta
    import calendar
    try:
        with db_session() as conn:
            haupt = conn.execute("SELECT * FROM konten WHERE typ='hauptkonto'").fetchone()
            if not haupt: return JSONResponse(content={"ok": False, "error": "Kein Hauptkonto"})
            startsaldo = haupt["saldo"]
            vertraege = [dict(r) for r in conn.execute("SELECT * FROM vertraege WHERE aktiv=1").fetchall()]
            einzahlungen = [dict(r) for r in conn.execute("SELECT * FROM einzahlungen WHERE typ='fest'").fetchall()]
            toepfe_konten = [dict(r) for r in conn.execute("SELECT * FROM konten WHERE typ='topf'").fetchall()]
            # Preisänderungen laden
            pa_rows = conn.execute("SELECT * FROM preisaenderungen ORDER BY ab_datum").fetchall()
            pa_map = {}
            for pa in pa_rows:
                pa_map.setdefault(pa["vertrag_id"], []).append(dict(pa))

        heute = date.today()
        # Simulation startet am 1. des nächsten Monats für saubere Monatsgrenzen
        sim_start = (heute.replace(day=1) + relativedelta(months=1))
        # Simulation endet am letzten Tag des 24. Monats nach sim_start
        sim_ende = sim_start + relativedelta(months=24) - timedelta(days=1)
        # Aber der Graph beginnt ab heute (mit Teilmonat)
        bis = sim_ende
        vertrag_termine = {}
        for v in vertraege:
            # Enddatum berücksichtigen
            v_bis = bis
            if v.get("enddatum"):
                try:
                    v_bis = min(bis, datetime.strptime(v["enddatum"], "%Y-%m-%d").date())
                except: pass
            for t in berechne_faelligkeiten(v["startdatum"], v["rhythmus"], heute, v_bis, abbuchungstag=v.get("abbuchungstag")):
                # Gültigen Betrag an diesem Tag ermitteln (Preisänderungen)
                betrag = v["betrag"]
                for pa in pa_map.get(v["id"], []):
                    if pa["ab_datum"] <= t.isoformat():
                        betrag = pa["neuer_betrag"]
                vertrag_termine.setdefault(t, []).append({"name": v["name"], "betrag": betrag})
        einzahlung_termine = {}
        for e in einzahlungen:
            tag = e.get("tag_im_monat")
            if not tag: continue
            monat = heute.replace(day=1)
            while monat <= bis:
                max_tag = calendar.monthrange(monat.year, monat.month)[1]
                termin = monat.replace(day=min(tag, max_tag))
                termin = naechster_werktag(termin)
                if heute <= termin <= bis:
                    einzahlung_termine.setdefault(termin, []).append({"bezeichnung": e["bezeichnung"], "betrag": e["betrag"]})
                monat += relativedelta(months=1)
        saldo, min_saldo, min_saldo_datum, tage = startsaldo, startsaldo, heute, []
        
        # Topf-Zuweisungen als zweiten Track berechnen
        topf_termine = {}
        print(f"[SIM DEBUG] toepfe_konten: {len(toepfe_konten)} Töpfe")
        for tk in toepfe_konten:
            mb = tk.get("monatlicher_betrag") or 0
            print(f"[SIM DEBUG] Topf {tk.get('id')}: mb={mb}, zuw={tk.get('zuweisung_startdatum')}")
            if mb <= 0: continue
            zuw_start = tk.get("zuweisung_startdatum")
            if not zuw_start: continue
            try:
                zs = datetime.strptime(zuw_start, "%Y-%m-%d").date()
            except: continue
            # Topf-Zuweisungen immer am 1. des Monats
            monat_t = zs.replace(day=1)
            while monat_t <= bis:
                termin = naechster_werktag(monat_t)
                if heute <= termin <= bis:
                    topf_termine.setdefault(termin, 0.0)
                    topf_termine[termin] += mb
                monat_t += relativedelta(months=1)
        
        print(f"[SIM DEBUG] topf_termine: {len(topf_termine)} Tage, total={sum(topf_termine.values()):.2f}")
        
        saldo_mit_toepfen = startsaldo
        tag = heute
        while tag <= bis:
            ein = sum(ez["betrag"] for ez in einzahlung_termine.get(tag, []))
            aus = sum(vt["betrag"] for vt in vertrag_termine.get(tag, []))
            topf_aus = topf_termine.get(tag, 0)
            saldo = saldo + ein - aus
            saldo_mit_toepfen = saldo_mit_toepfen + ein - aus - topf_aus
            if saldo < min_saldo: min_saldo, min_saldo_datum = saldo, tag
            tage.append({"datum": tag.isoformat(), "einnahmen": round(ein,2), "ausgaben": round(aus,2), "saldo": round(saldo,2),
                         "saldo_mit_toepfen": round(saldo_mit_toepfen,2),
                         "anzahl_buchungen": len(einzahlung_termine.get(tag,[])) + len(vertrag_termine.get(tag,[]))})
            tag += timedelta(days=1)
        print(f"[SIM DEBUG] tage[0] keys: {list(tage[0].keys()) if tage else 'empty'}")
        print(f"[SIM DEBUG] tage[-1]: saldo={tage[-1]['saldo']}, saldo_mit_toepfen={tage[-1].get('saldo_mit_toepfen','MISSING')}")
        monate, ls = {}, startsaldo
        for t in tage:
            mk = t["datum"][:7]
            if mk not in monate: monate[mk] = {"monat": mk, "startsaldo": round(ls,2), "einnahmen": 0.0, "ausgaben": 0.0}
            monate[mk]["einnahmen"] = round(monate[mk]["einnahmen"]+t["einnahmen"],2)
            monate[mk]["ausgaben"] = round(monate[mk]["ausgaben"]+t["ausgaben"],2)
            ls = t["saldo"]; monate[mk]["endsaldo"] = round(ls,2)
        ml = list(monate.values())
        for m in ml: m["netto"] = round(m["einnahmen"]-m["ausgaben"],2); m["status"] = "ok" if m["endsaldo"] >= 0 else "negativ"
        return JSONResponse(content={"ok": True, "startsaldo": round(startsaldo,2), "min_saldo": round(min_saldo,2),
            "min_saldo_datum": min_saldo_datum.isoformat(), "warnung_negativ": min_saldo < 0,
            "tage": tage, "monate": ml, "anzahl_vertraege": len(vertraege), "anzahl_einzahlungen": len(einzahlungen),
            "debug": {
                "heute": heute.isoformat(), "sim_start": sim_start.isoformat(), "bis": bis.isoformat(),
                "total_einnahmen": round(sum(t["einnahmen"] for t in tage), 2),
                "total_ausgaben": round(sum(t["ausgaben"] for t in tage), 2),
                "anzahl_tage": len(tage),
                "vertrag_termine_count": sum(len(v) for v in vertrag_termine.values()),
                "einzahlung_termine_count": sum(len(v) for v in einzahlung_termine.values()),
                "topf_konten_count": len(toepfe_konten),
                "topf_konten_mit_betrag": len([t for t in toepfe_konten if (t.get("monatlicher_betrag") or 0) > 0]),
                "topf_termine_count": len(topf_termine),
                "topf_summe_pro_monat": sum(topf_termine.values()) / max(1, len(topf_termine)),
                "tage_keys": list(tage[0].keys()) if tage else [],
                "erster_tag_smt": tage[0].get("saldo_mit_toepfen") if tage else None,
                "letzter_tag_smt": tage[-1].get("saldo_mit_toepfen") if tage else None,
                "letzter_tag_saldo": tage[-1].get("saldo") if tage else None,
            }})
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(content={"ok": False, "error": str(e)})

@app.get("/api/debug/sim-check")
def api_debug_sim_check():
    """Debug: Prüfe ob saldo_mit_toepfen in der Simulation berechnet wird."""
    try:
        sim = api_simulation()
        # sim is a JSONResponse, get the body
        import json
        body = json.loads(sim.body)
        if not body.get("ok"):
            return {"error": body.get("error", "Simulation failed")}
        tage = body.get("tage", [])
        # Show first 3 and last 3 entries
        sample = tage[:3] + tage[-3:] if len(tage) > 6 else tage
        has_field = any("saldo_mit_toepfen" in t for t in tage)
        differs = any(t.get("saldo_mit_toepfen") != t.get("saldo") for t in tage)
        return {
            "total_tage": len(tage),
            "has_saldo_mit_toepfen": has_field,
            "values_differ": differs,
            "sample": sample,
            "tage_keys": list(tage[0].keys()) if tage else [],
        }
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# API: Kalender/Heatmap
# ---------------------------------------------------------------------------
@app.get("/api/kalender")
def api_kalender(jahr: int = 0, monat: int = 0):
    """Alle Buchungen eines Monats für die Heatmap."""
    from dateutil.relativedelta import relativedelta
    import calendar as cal_mod
    try:
        heute = date.today()
        j = jahr or heute.year
        m = monat or heute.month
        erster = date(j, m, 1)
        max_tag = cal_mod.monthrange(j, m)[1]
        letzter = date(j, m, max_tag)

        with db_session() as conn:
            vertraege = [dict(r) for r in conn.execute("SELECT * FROM vertraege WHERE aktiv=1").fetchall()]
            einzahlungen = [dict(r) for r in conn.execute("SELECT * FROM einzahlungen WHERE typ='fest'").fetchall()]
            pa_rows = conn.execute("SELECT * FROM preisaenderungen ORDER BY ab_datum").fetchall()
            pa_map = {}
            for pa in pa_rows:
                pa_map.setdefault(pa["vertrag_id"], []).append(dict(pa))
            # Sicherheitstage laden
            param = conn.execute("SELECT wert FROM parameter WHERE schluessel='sicherheitstage'").fetchone()
            sicherheitstage_nach = int(param["wert"]) if param else 2
            param_vor = conn.execute("SELECT wert FROM parameter WHERE schluessel='sicherheitstage_vor'").fetchone()
            sicherheitstage_vor = int(param_vor["wert"]) if param_vor else 1

        # Buchungen pro Tag sammeln
        tage = {}
        for tag_nr in range(1, max_tag + 1):
            d = date(j, m, tag_nr)
            tage[d.isoformat()] = {"datum": d.isoformat(), "buchungen": [], "anzahl": 0, "summe_ausgaben": 0.0, "summe_einnahmen": 0.0, "ist_feiertag": ist_bankfrei(d) and d.weekday() < 5}

        # Wochenend-verschobene Buchungen sammeln
        wochenend_original = set()  # Originaltage die auf Sa/So fielen

        for v in vertraege:
            v_bis = letzter
            if v.get("enddatum"):
                try:
                    v_bis = min(letzter, datetime.strptime(v["enddatum"], "%Y-%m-%d").date())
                except: pass
            for ti in berechne_faelligkeiten(v["startdatum"], v["rhythmus"], erster, v_bis, mit_wochenend_info=True, abbuchungstag=v.get("abbuchungstag")):
                orig, eff, versch = ti["original"], ti["effektiv"], ti["verschoben"]
                key = eff.isoformat()
                if versch and erster <= orig <= letzter:
                    wochenend_original.add(orig.isoformat())
                if key in tage:
                    betrag = v["betrag"]
                    for pa in pa_map.get(v["id"], []):
                        if pa["ab_datum"] <= key:
                            betrag = pa["neuer_betrag"]
                    hinweis = f" (versch. von {orig.strftime('%d.%m.')})" if versch else ""
                    tage[key]["buchungen"].append({"name": v["name"] + hinweis, "betrag": betrag, "typ": "ausgabe", "kategorie": v.get("kategorie","")})
                    tage[key]["anzahl"] += 1
                    tage[key]["summe_ausgaben"] += betrag

        for e in einzahlungen:
            tag = e.get("tag_im_monat")
            if not tag: continue
            actual_tag = min(tag, max_tag)
            d = date(j, m, actual_tag)
            # Einzahlungen auch Wochenend-verschieben
            d = naechster_werktag(d)
            if d.month != m: continue  # Verschoben in nächsten Monat
            orig_d = date(j, m, actual_tag)
            if orig_d != d and erster <= orig_d <= letzter:
                wochenend_original.add(orig_d.isoformat())
            key = d.isoformat()
            if key in tage:
                hinweis = f" (versch. von {orig_d.strftime('%d.%m.')})" if orig_d != d else ""
                tage[key]["buchungen"].append({"name": e["bezeichnung"] + hinweis, "betrag": e["betrag"], "typ": "einnahme"})
                tage[key]["anzahl"] += 1
                tage[key]["summe_einnahmen"] += e["betrag"]

        # Heatmap-Level berechnen + Fälligkeits-Tage markieren
        alle_faellig = set()
        alle_unsicher = set()
        for v in vertraege:
            v_bis = letzter
            if v.get("enddatum"):
                try:
                    v_bis = min(letzter, datetime.strptime(v["enddatum"], "%Y-%m-%d").date())
                except: pass
            for ti in berechne_faelligkeiten(v["startdatum"], v["rhythmus"], erster, v_bis, mit_wochenend_info=True, abbuchungstag=v.get("abbuchungstag")):
                eff = ti["effektiv"]
                alle_faellig.add(eff.isoformat())
                for offset in range(-sicherheitstage_vor, sicherheitstage_nach + 1):
                    d_offset = eff + timedelta(days=offset)
                    if erster <= d_offset <= letzter and d_offset != eff:
                        alle_unsicher.add(d_offset.isoformat())

        for key in tage:
            n = tage[key]["anzahl"]
            if n == 0: tage[key]["level"] = 0
            elif n == 1: tage[key]["level"] = 1
            else: tage[key]["level"] = 2
            tage[key]["summe_ausgaben"] = round(tage[key]["summe_ausgaben"], 2)
            tage[key]["summe_einnahmen"] = round(tage[key]["summe_einnahmen"], 2)
            tage[key]["ist_faelligkeitstag"] = key in alle_faellig
            tage[key]["ist_unsicher"] = key in alle_unsicher and key not in alle_faellig
            tage[key]["ist_wochenend_original"] = key in wochenend_original

        # Wochentag des 1. (0=Mo, 6=So)
        wochentag_start = erster.weekday()

        return JSONResponse(content={
            "ok": True, "jahr": j, "monat": m, "max_tag": max_tag,
            "wochentag_start": wochentag_start,
            "tage": list(tage.values()),
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(content={"ok": False, "error": str(e)})


# ---------------------------------------------------------------------------
# API: Zuverlässigkeit
# ---------------------------------------------------------------------------
@app.get("/api/zuverlaessigkeit")
def api_zuverlaessigkeit():
    """Berechnet wie zuverlässig der heutige Kontostand ist."""
    import calendar
    try:
        with db_session() as conn:
            param = conn.execute("SELECT wert FROM parameter WHERE schluessel='sicherheitstage'").fetchone()
            sicherheitstage_nach = int(param["wert"]) if param else 2
            param_vor = conn.execute("SELECT wert FROM parameter WHERE schluessel='sicherheitstage_vor'").fetchone()
            sicherheitstage_vor = int(param_vor["wert"]) if param_vor else 1
            vertraege = [dict(r) for r in conn.execute("SELECT * FROM vertraege WHERE aktiv=1").fetchall()]
            einzahlungen = [dict(r) for r in conn.execute("SELECT * FROM einzahlungen WHERE typ='fest'").fetchall()]

        heute = date.today()
        fenster_start = heute - timedelta(days=sicherheitstage_vor)
        fenster_ende = heute + timedelta(days=sicherheitstage_nach)

        # Alle Fälligkeiten im Sicherheitsfenster prüfen
        offene_buchungen = []
        for v in vertraege:
            termine = berechne_faelligkeiten(v["startdatum"], v["rhythmus"], fenster_start, fenster_ende, abbuchungstag=v.get("abbuchungstag"))
            for t in termine:
                if t >= heute:
                    offene_buchungen.append({"name": v["name"], "datum": t.isoformat(), "betrag": v["betrag"], "typ": "ausgabe"})
        for e in einzahlungen:
            tag = e.get("tag_im_monat")
            if not tag: continue
            max_tag = calendar.monthrange(heute.year, heute.month)[1]
            termin = heute.replace(day=min(tag, max_tag))
            termin = naechster_werktag(termin)
            if heute <= termin <= fenster_ende:
                offene_buchungen.append({"name": e["bezeichnung"], "datum": termin.isoformat(), "betrag": e["betrag"], "typ": "einnahme"})

        ist_buchungstag = False
        ist_unsicher = False
        for v in vertraege:
            termine = berechne_faelligkeiten(v["startdatum"], v["rhythmus"], heute, heute, abbuchungstag=v.get("abbuchungstag"))
            if termine: ist_buchungstag = True
        if offene_buchungen:
            ist_unsicher = True

        if not offene_buchungen:
            zuverlaessigkeit = 100
            status = "sicher"
        else:
            zuverlaessigkeit = max(0, min(95, int(50 - len(offene_buchungen) * 15)))
            status = "unsicher" if zuverlaessigkeit < 50 else "teilweise"

        naechster_sicherer = heute
        alle_termine_nahe = []
        for v in vertraege:
            termine = berechne_faelligkeiten(v["startdatum"], v["rhythmus"], heute, heute + timedelta(days=62), abbuchungstag=v.get("abbuchungstag"))
            alle_termine_nahe.extend(termine)
        for e in einzahlungen:
            tag = e.get("tag_im_monat")
            if not tag: continue
            for offset in range(0, 62):
                check = heute + timedelta(days=offset)
                max_tag = calendar.monthrange(check.year, check.month)[1]
                if check.day == min(tag, max_tag):
                    alle_termine_nahe.append(naechster_werktag(check))

        if alle_termine_nahe:
            naechste_faelligkeit = min(t for t in alle_termine_nahe if t >= heute)
            naechster_sicherer = naechste_faelligkeit + timedelta(days=sicherheitstage_nach)
        else:
            naechster_sicherer = heute

        return JSONResponse(content={
            "ok": True,
            "zuverlaessigkeit": zuverlaessigkeit,
            "status": status,
            "offene_buchungen": len(offene_buchungen),
            "ist_buchungstag": ist_buchungstag,
            "ist_unsicher": ist_unsicher,
            "sicherheitstage_vor": sicherheitstage_vor,
            "sicherheitstage_nach": sicherheitstage_nach,
            "naechster_sicherer_tag": naechster_sicherer.isoformat(),
            "details": offene_buchungen[:10],
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(content={"ok": False, "error": str(e)})


# ---------------------------------------------------------------------------
# API: Debug
# ---------------------------------------------------------------------------
@app.post("/api/debug/pruefung-faellig")
def api_debug_pruefung_faellig():
    """Setzt einen zufälligen Vertrag auf prüffällig (letzte_pruefung 2 Jahre zurück)."""
    import random
    with db_session() as conn:
        rows = conn.execute("SELECT id, name FROM vertraege WHERE aktiv=1 AND pruef_intervall_monate > 0").fetchall()
        if not rows:
            return {"ok": False, "error": "Keine aktiven Verträge mit Prüfintervall"}
        v = random.choice(rows)
        conn.execute("UPDATE vertraege SET letzte_pruefung='2023-01-01' WHERE id=?", (v["id"],))
    return {"ok": True, "vertrag": v["name"]}

@app.post("/api/debug/alle-pruefung-faellig")
def api_debug_alle_pruefung_faellig():
    """Setzt ALLE Verträge auf prüffällig."""
    with db_session() as conn:
        n = conn.execute("UPDATE vertraege SET letzte_pruefung='2023-01-01' WHERE aktiv=1 AND pruef_intervall_monate > 0").rowcount
    return {"ok": True, "anzahl": n}

@app.get("/api/debug/export")
def api_debug_export():
    """Exportiert anonymisierte Vertragsdaten für Debugging."""
    with db_session() as conn:
        vertraege = [dict(r) for r in conn.execute("SELECT * FROM vertraege").fetchall()]
        einzahlungen = [dict(r) for r in conn.execute("SELECT * FROM einzahlungen").fetchall()]
        konten = [dict(r) for r in conn.execute("SELECT * FROM konten").fetchall()]
        params = {r["schluessel"]: r["wert"] for r in conn.execute("SELECT * FROM parameter").fetchall()}
    
    anon_vt = []
    for i, v in enumerate(vertraege):
        anon_vt.append({
            "id": v["id"],
            "anon_name": f"Vertrag_{i+1}",
            "kategorie": v.get("kategorie"),
            "betrag": v["betrag"],
            "startdatum": v["startdatum"],
            "rhythmus": v.get("rhythmus"),
            "aktiv": v.get("aktiv"),
            "enddatum": v.get("enddatum"),
            "abbuchungstag": v.get("abbuchungstag"),
            "versicherungstyp": v.get("versicherungstyp"),
            "mindestlaufzeit_ende": v.get("mindestlaufzeit_ende"),
            "kuendigungsfrist_monate": v.get("kuendigungsfrist_monate"),
        })
    
    anon_ez = []
    for i, e in enumerate(einzahlungen):
        anon_ez.append({
            "id": e["id"],
            "anon_name": f"Einzahlung_{i+1}",
            "betrag": e["betrag"],
            "tag_im_monat": e.get("tag_im_monat"),
            "typ": e.get("typ"),
            "konto_id": e.get("konto_id"),
        })
    
    anon_konten = []
    for k in konten:
        anon_konten.append({
            "id": k["id"],
            "typ": k["typ"],
            "saldo": k["saldo"],
            "monatlicher_betrag": k.get("monatlicher_betrag"),
            "zuweisung_startdatum": k.get("zuweisung_startdatum"),
        })
    
    return {
        "vertraege": anon_vt,
        "einzahlungen": anon_ez,
        "konten": anon_konten,
        "parameter": params,
        "heute": date.today().isoformat(),
    }


# ---------------------------------------------------------------------------
# API: Server beenden
# ---------------------------------------------------------------------------
@app.post("/api/server/beenden")
def api_server_beenden():
    """Fährt den Server sauber herunter."""
    import os, signal, threading
    def shutdown():
        os.kill(os.getpid(), signal.SIGTERM)
    threading.Timer(0.5, shutdown).start()
    return {"ok": True, "message": "Server wird beendet..."}


# ---------------------------------------------------------------------------
# API: Status
# ---------------------------------------------------------------------------
@app.get("/api/status")
def api_status():
    from dateutil.relativedelta import relativedelta
    import calendar as cal_mod
    with db_session() as conn:
        konten = conn.execute("SELECT * FROM konten").fetchall()
        haupt, toepfe_saldo = None, 0.0
        for k in konten:
            if k["typ"] == "hauptkonto": haupt = k
            else: toepfe_saldo += k["saldo"]
        n_v = conn.execute("SELECT COUNT(*) as n FROM vertraege WHERE aktiv=1").fetchone()["n"]
        n_e = conn.execute("SELECT COUNT(*) as n FROM einzahlungen").fetchone()["n"]
        vertraege = [dict(r) for r in conn.execute("SELECT * FROM vertraege WHERE aktiv=1").fetchall()]
    
    # Echte monatliche Kosten: Fälligkeiten über 24 volle Monate zählen
    heute = date.today()
    sim_start = heute.replace(day=1) + relativedelta(months=1)
    sim_ende = sim_start + relativedelta(months=24) - timedelta(days=1)
    total_aus_24 = 0.0
    for v in vertraege:
        v_bis = sim_ende
        if v.get("enddatum"):
            try: v_bis = min(sim_ende, datetime.strptime(v["enddatum"], "%Y-%m-%d").date())
            except: pass
        terme = berechne_faelligkeiten(v["startdatum"], v["rhythmus"], sim_start, v_bis, abbuchungstag=v.get("abbuchungstag"))
        total_aus_24 += len(terme) * v["betrag"]
    echte_monatl = round(total_aus_24 / 24, 2)
    
    fs = haupt["saldo"] if haupt else 0.0
    return {"status": "ok", "datum": date.today().isoformat(),
            "kontostand_fixkonto": fs, "kontostand_toepfe": toepfe_saldo,
            "kontostand_gesamt": fs, "aktive_vertraege": n_v,
            "einzahlungen": n_e, "db_pfad": str(DB_PATH),
            "echte_monatl_fixkosten": echte_monatl}

# ---------------------------------------------------------------------------
# API: Kontostand-Schätzung
# ---------------------------------------------------------------------------
@app.get("/api/kontostand-schaetzung")
def api_kontostand_schaetzung():
    """Schätzt den aktuellen Kontostand basierend auf letztem Stand + Buchungen seitdem."""
    import calendar as cal_mod
    with db_session() as conn:
        konten = conn.execute("SELECT * FROM konten").fetchall()
        haupt = None
        toepfe_saldo = 0.0
        for k in konten:
            if k["typ"] == "hauptkonto": haupt = k
            else: toepfe_saldo += k["saldo"]
        if not haupt:
            return {"schaetzung": 0, "letzter_stand": 0, "einnahmen": 0, "ausgaben": 0, "seit": None}

        # Letzte Saldo-Änderung: letzte Transaktion oder heutiges Datum
        letzte_tx = conn.execute(
            "SELECT datum FROM transaktionen WHERE von_konto_id=? OR nach_konto_id=? ORDER BY datum DESC, id DESC LIMIT 1",
            (haupt["id"], haupt["id"])).fetchone()
        # Wir nehmen den gespeicherten Saldo als Basis + rechnen ab heute die fälligen Buchungen
        basis_saldo = haupt["saldo"]
        heute = date.today()

        vertraege = [dict(r) for r in conn.execute("SELECT * FROM vertraege WHERE aktiv=1").fetchall()]
        einzahlungen = [dict(r) for r in conn.execute("SELECT * FROM einzahlungen").fetchall()]
        pa_rows = conn.execute("SELECT * FROM preisaenderungen ORDER BY ab_datum").fetchall()
        pa_map = {}
        for pa in pa_rows:
            pa_map.setdefault(pa["vertrag_id"], []).append(dict(pa))

    # Fällige Buchungen seit Monatsbeginn bis heute berechnen
    erster = heute.replace(day=1)
    summe_ein = 0.0
    summe_aus = 0.0

    for v in vertraege:
        v_bis = heute
        if v.get("enddatum"):
            try:
                v_bis = min(heute, datetime.strptime(v["enddatum"], "%Y-%m-%d").date())
            except: pass
        for t in berechne_faelligkeiten(v["startdatum"], v["rhythmus"], erster, v_bis, abbuchungstag=v.get("abbuchungstag")):
            if t <= heute:
                betrag = v["betrag"]
                for pa in pa_map.get(v["id"], []):
                    if pa["ab_datum"] <= t.isoformat():
                        betrag = pa["neuer_betrag"]
                summe_aus += betrag

    for e in einzahlungen:
        tag = e.get("tag_im_monat")
        if not tag: continue
        max_tag = cal_mod.monthrange(heute.year, heute.month)[1]
        d = date(heute.year, heute.month, min(tag, max_tag))
        d = naechster_werktag(d)
        if d <= heute:
            summe_ein += e["betrag"]

    return {
        "schaetzung": round(basis_saldo + summe_ein - summe_aus, 2),
        "letzter_stand": round(basis_saldo, 2),
        "einnahmen_monat": round(summe_ein, 2),
        "ausgaben_monat": round(summe_aus, 2),
        "seit": erster.isoformat()
    }


# ---------------------------------------------------------------------------
# API: Dauerauftrags-Empfehlung
# ---------------------------------------------------------------------------
@app.get("/api/dauerauftraege")
def api_dauerauftraege():
    """Berechnet empfohlene Daueraufträge basierend auf echten Simulationskosten + Topf-Zuweisungen vs Einzahlungen."""
    from dateutil.relativedelta import relativedelta
    import calendar as cal_mod
    with db_session() as conn:
        vertraege = [dict(r) for r in conn.execute("SELECT * FROM vertraege WHERE aktiv=1").fetchall()]
        konten = [dict(r) for r in conn.execute("SELECT * FROM konten").fetchall()]
        einzahlungen = [dict(r) for r in conn.execute("SELECT * FROM einzahlungen").fetchall()]

    # Echte monatliche Kosten über 24 Monate (mit Enddatum-Berücksichtigung)
    heute = date.today()
    sim_start = heute.replace(day=1) + relativedelta(months=1)
    sim_ende = sim_start + relativedelta(months=24) - timedelta(days=1)
    
    konto_kosten = {}
    for v in vertraege:
        kid = v.get("konto_id", 1)
        v_bis = sim_ende
        if v.get("enddatum"):
            try: v_bis = min(sim_ende, datetime.strptime(v["enddatum"], "%Y-%m-%d").date())
            except: pass
        terme = berechne_faelligkeiten(v["startdatum"], v["rhythmus"], sim_start, v_bis, abbuchungstag=v.get("abbuchungstag"))
        konto_kosten.setdefault(kid, 0.0)
        konto_kosten[kid] += len(terme) * v["betrag"] / 24  # echter Monatsdurchschnitt

    # Monatliche Topf-Zuweisungen
    haupt = next((k for k in konten if k["typ"] == "hauptkonto"), None)
    topf_zuweisungen = 0.0
    for k in konten:
        if k["typ"] == "topf" and k.get("monatlicher_betrag", 0) > 0:
            topf_zuweisungen += k["monatlicher_betrag"]
    if haupt:
        konto_kosten.setdefault(haupt["id"], 0.0)
        konto_kosten[haupt["id"]] += topf_zuweisungen

    # Monatliche Einnahmen pro Konto
    konto_einnahmen = {}
    for e in einzahlungen:
        kid = e.get("konto_id", 1)
        konto_einnahmen.setdefault(kid, 0.0)
        konto_einnahmen[kid] += e["betrag"]

    result = []
    for k in konten:
        if k["typ"] == "topf":
            continue
        kosten = round(konto_kosten.get(k["id"], 0), 2)
        einnahmen = round(konto_einnahmen.get(k["id"], 0), 2)
        diff = round(kosten - einnahmen, 2)
        result.append({
            "konto_id": k["id"],
            "konto_name": k["name"],
            "konto_typ": k["typ"],
            "monatliche_kosten": kosten,
            "monatliche_einnahmen": einnahmen,
            "topf_zuweisungen": round(topf_zuweisungen, 2) if k["typ"] == "hauptkonto" else 0,
            "differenz": diff,
            "empfehlung": f"Dauerauftrag um {round(diff, 2)} € erhöhen" if diff > 0 else f"Könnte um {round(abs(diff), 2)} € gesenkt werden" if diff < 0 else None
        })

    return result


# ---------------------------------------------------------------------------
# API: Backup
# ---------------------------------------------------------------------------
from starlette.responses import FileResponse

@app.get("/api/backup")
def api_backup():
    """Liefert die Datenbank als Download."""
    backup_name = f"kontolotse_backup_{date.today().strftime('%Y%m%d')}.db"
    return FileResponse(DB_PATH, filename=backup_name, media_type="application/octet-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
