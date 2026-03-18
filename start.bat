@echo off
title Kontolotse
echo.
echo  ==============================
echo   Kontolotse - Version 1.0
echo  ==============================
echo.

REM In das Verzeichnis der start.bat wechseln
cd /d "%~dp0"
echo  Verzeichnis: %cd%
echo.

REM Pruefen ob Python installiert ist
python --version >nul 2>&1
if errorlevel 1 (
    echo  FEHLER: Python ist nicht installiert oder nicht im PATH.
    echo  Bitte Python 3.10+ von https://python.org installieren.
    pause
    exit /b 1
)

REM Pruefen ob FastAPI verfuegbar ist, sonst installieren
python -c "import fastapi" >nul 2>&1
if errorlevel 1 (
    echo  Installiere Abhaengigkeiten einmalig...
    pip install -r requirements.txt
    echo.
)

echo.
echo  Starte Server auf http://localhost:8000
echo  Zum Beenden: Strg+C oder dieses Fenster schliessen.
echo.

REM Bytecode-Cache loeschen (verhindert veraltete Versionen)
if exist __pycache__ rmdir /s /q __pycache__ >nul 2>&1

REM Browser oeffnen nach kurzer Verzoegerung
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000"

REM Server starten
python main.py
