@echo off
title PortfoliOn - Starting Servers

REM Kill existing processes on ports 8000 and 5173
echo Stopping existing servers...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R ":8000 " 2^>nul') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R ":5173 " 2^>nul') do taskkill /F /PID %%a >nul 2>&1

REM Start backend
echo Starting backend...
if exist "%~dp0backend\venv\Scripts\python.exe" (
    start "" powershell -WindowStyle Hidden -Command "Set-Location '%~dp0backend'; .\venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000 *> \"$env:TEMP\portfolion-backend.log\""
) else (
    start "" powershell -WindowStyle Hidden -Command "Set-Location '%~dp0backend'; python -m uvicorn main:app --reload --port 8000 *> \"$env:TEMP\portfolion-backend.log\""
)

REM Start frontend
echo Starting frontend...
start "" powershell -WindowStyle Hidden -Command "Set-Location '%~dp0frontend'; npm run dev *> \"$env:TEMP\portfolion-frontend.log\""

REM Wait for servers to be ready
echo Waiting for servers...
:wait_backend
curl -s http://localhost:8000/health >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_backend
)
:wait_frontend
curl -s http://localhost:5173 >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_frontend
)

echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Logs: %TEMP%\portfolion-backend.log
echo       %TEMP%\portfolion-frontend.log
echo.

start http://localhost:5173
echo Browser opened.
