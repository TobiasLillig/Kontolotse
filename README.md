# 🧭 Kontolotse

**Kontolotse — Personal Finance Planner** — A self-hosted web app for managing contracts, fixed costs and virtual savings pots with a 24-month simulation.

**Kontolotse — Persönlicher Finanzplaner** — Eine lokale Web-App zur Verwaltung von Verträgen, Fixkosten und virtuellen Spartöpfen mit 24-Monats-Simulation.

![Python](https://img.shields.io/badge/Python-3.10+-blue) ![FastAPI](https://img.shields.io/badge/FastAPI-Latest-green) ![License](https://img.shields.io/badge/License-GPLv3-blue)

---

## 🇬🇧 English

### ✨ Features
* **Contracts & Fixed Costs** — Manage all recurring expenses (monthly to biannually)
* **Savings Pots** — Envelope system for reserves (pots don't change the actual balance)
* **24-Month Simulation** — Day-by-day forecast of your account balance with safety buffer
* **Dashboard** — Configurable tiles with warning banners and action recommendations
* **Contract Alerts** — Automatic reminders for cancellation deadlines and contract reviews
* **Calendar** — Heatmap view of all transactions per month
* **Standing Order Recommendation** — Calculates if your standing order covers all expenses
* **Light/Dark Mode** — Automatic by time of day or manual toggle
* **Multi-language** — German and English (experimental)
* **100% Local** — No cloud, no registration, your data stays on your device

### 🚀 Installation

**Requirements:** Python 3.10+ ([Download](https://python.org))

1. Download ZIP from [Releases](https://github.com/TobiasLillig/Kontolotse/releases)
2. Extract and double-click `start.bat` (Windows)

Or manually:
```bash
cd kontolotse
pip install -r requirements.txt
python main.py
```

Browser opens automatically at `http://localhost:8000`

### 💾 Data

All data is stored in a single SQLite file at `%APPDATA%/Kontolotse/kontolotse.db`. Back it up regularly via Settings → System.

---

## 🇩🇪 Deutsch

### ✨ Features
* **Verträge & Fixkosten** — Alle wiederkehrenden Ausgaben verwalten (monatlich bis zweijährlich)
* **Virtuelle Töpfe** — Umschlagsystem für Rücklagen (Töpfe verändern den Kontostand nicht)
* **24-Monats-Simulation** — Tagesgenaue Prognose des Kontoverlaufs mit Sicherheitspuffer
* **Dashboard** — Konfigurierbare Kacheln mit Warnbannern und Handlungsempfehlungen
* **Vertragsalarm** — Automatische Erinnerung an Kündigungsfristen und Vertragsprüfungen
* **Kalender** — Heatmap-Ansicht aller Buchungen pro Monat
* **Dauerauftrags-Empfehlung** — Berechnet ob dein Dauerauftrag zur Deckung ausreicht
* **Hell/Dunkel-Modus** — Automatisch nach Uhrzeit oder manuell umschaltbar
* **Mehrsprachig** — Deutsch und Englisch (experimentell)
* **100% lokal** — Keine Cloud, keine Registrierung, deine Daten bleiben auf deinem Gerät

### 🚀 Installation

**Voraussetzungen:** Python 3.10+ ([Download](https://python.org))

1. ZIP von [Releases](https://github.com/TobiasLillig/Kontolotse/releases) herunterladen
2. Entpacken und `start.bat` doppelklicken (Windows)

Oder manuell:
```bash
cd kontolotse
pip install -r requirements.txt
python main.py
```

Browser öffnet automatisch `http://localhost:8000`

### 💾 Daten

Alle Daten liegen in einer SQLite-Datei unter `%APPDATA%/Kontolotse/kontolotse.db`. Regelmäßig sichern über Einstellungen → System.

---

## 📁 Project Structure

```
kontolotse/
├── main.py              # Backend (FastAPI + SQLite)
├── requirements.txt     # Python dependencies
├── start.bat            # Windows start script
├── templates/
│   └── index.html       # Main template (Single Page App)
└── static/
    ├── css/style.css    # Stylesheet
    ├── js/app.js        # Frontend logic
    └── i18n.json        # Translations (DE/EN)
```

## 🔧 Technology
* **Backend:** Python, FastAPI, SQLite, Uvicorn
* **Frontend:** Vanilla HTML/CSS/JavaScript, Chart.js
* **No** external frameworks (React, Vue etc.) — intentionally lightweight

## 📜 License
GNU General Public License v3.0 — see [LICENSE](LICENSE)

## ☕ Support
If you like Kontolotse: [Buy Tobias a Coffee](https://ko-fi.com/tobi_mit_1000_ideen)

## 💬 Feedback
* [GitHub Issues](https://github.com/TobiasLillig/Kontolotse/issues)
* [Telegram Group](https://t.me/+FZA-idHFN8Q3MDcy)

---
*Vibecodet with ❤️ by tobi_mit_1000_ideen*
