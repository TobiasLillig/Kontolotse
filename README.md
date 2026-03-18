# 🧭 Kontolotse

**Kontolotse — Persönlicher Finanzplaner** — Eine lokale Web-App zur Verwaltung von Verträgen, Fixkosten und virtuellen Spartöpfen mit 24-Monats-Simulation.

![Python](https://img.shields.io/badge/Python-3.10+-blue) ![FastAPI](https://img.shields.io/badge/FastAPI-Latest-green) ![License](https://img.shields.io/badge/License-GPLv3-blue)

## ✨ Features

- **Verträge & Fixkosten** — Alle wiederkehrenden Ausgaben verwalten (monatlich bis zweijährlich)
- **Virtuelle Töpfe** — Umschlagsystem für Rücklagen (Töpfe verändern den Kontostand nicht)
- **24-Monats-Simulation** — Tagesgenaue Prognose des Kontoverlaufs mit Sicherheitspuffer
- **Dashboard** — Konfigurierbare Kacheln mit Warnbannern und Handlungsempfehlungen
- **Vertragsalarm** — Automatische Erinnerung an Kündigungsfristen und Vertragsprüfungen
- **Kalender** — Heatmap-Ansicht aller Buchungen pro Monat
- **Dauerauftrags-Empfehlung** — Berechnet ob dein Dauerauftrag zur Deckung ausreicht
- **Hell/Dunkel-Modus** — Automatisch nach Uhrzeit oder manuell umschaltbar
- **100% lokal** — Keine Cloud, keine Registrierung, deine Daten bleiben auf deinem Gerät

## 🚀 Installation

### Voraussetzungen

- **Python 3.10+** ([Download](https://python.org))

### Starten

1. Repository klonen oder ZIP herunterladen
2. `start.bat` doppelklicken (Windows) oder manuell starten:

```bash
cd kontolotse
pip install -r requirements.txt
python main.py
```

3. Browser öffnet automatisch `http://localhost:8000`

## 📁 Projektstruktur

```
kontolotse/
├── main.py              # Backend (FastAPI + SQLite)
├── requirements.txt     # Python-Abhängigkeiten
├── start.bat            # Windows-Startskript
├── templates/
│   └── index.html       # Haupt-Template (Single Page App)
└── static/
    ├── css/style.css    # Stylesheet
    └── js/app.js        # Frontend-Logik
```

Die SQLite-Datenbank (`kontolotse.db`) wird beim ersten Start automatisch erstellt.

## 🔧 Technologie

- **Backend:** Python, FastAPI, SQLite, Uvicorn
- **Frontend:** Vanilla HTML/CSS/JavaScript, Chart.js
- **Keine** externen Frameworks (React, Vue etc.) — bewusst schlank gehalten

## 💾 Backup

Die gesamte Datenbank liegt in einer einzigen Datei: `kontolotse.db`. Kopiere diese Datei regelmäßig an einen sicheren Ort.

## 📜 Lizenz

GNU General Public License v3.0 — siehe [LICENSE](LICENSE)

## ☕ Unterstützen

Wenn dir Kontolotse gefällt: [Buy Tobias a Coffee](https://ko-fi.com/tobi_mit_1000_ideen)

---

*Vibecodet with ❤️ by tobi_mit_1000_ideen*
