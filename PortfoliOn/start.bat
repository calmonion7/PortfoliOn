@echo off
title PortfoliOn - Starting Servers

echo Starting PortfoliOn servers...
echo.

REM Start Backend (FastAPI + uvicorn)
if exist "%~dp0backend\venv\Scripts\activate.bat" (
    start "PortfoliOn Backend [8000]" cmd /k "cd /d "%~dp0backend" && call venv\Scripts\activate && uvicorn main:app --reload --port 8000"
) else (
    start "PortfoliOn Backend [8000]" cmd /k "cd /d "%~dp0backend" && uvicorn main:app --reload --port 8000"
)

REM Start Frontend (Vite)
start "PortfoliOn Frontend [5173]" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo Backend : http://localhost:8000
echo Frontend: http://localhost:5173
echo.
