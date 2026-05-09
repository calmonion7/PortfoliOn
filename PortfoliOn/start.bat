@echo off
title PortfoliOn - Starting Servers

echo Starting PortfoliOn servers...
echo.

REM Start Backend (FastAPI + uvicorn) - hidden background
if exist "%~dp0backend\venv\Scripts\python.exe" (
    start "" powershell -WindowStyle Hidden -Command "Set-Location '%~dp0backend'; .\venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000"
) else (
    start "" powershell -WindowStyle Hidden -Command "Set-Location '%~dp0backend'; python -m uvicorn main:app --reload --port 8000"
)

REM Start Frontend (Vite) - hidden background
start "" powershell -WindowStyle Hidden -Command "Set-Location '%~dp0frontend'; npm run dev"

echo Backend : http://localhost:8000
echo Frontend: http://localhost:5173
