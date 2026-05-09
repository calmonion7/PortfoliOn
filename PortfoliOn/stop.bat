@echo off
title PortfoliOn - Stopping Servers

echo Stopping PortfoliOn servers...
echo.

REM Kill backend process on port 8000
echo [Backend] Stopping port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R ":8000 "') do (
    taskkill /F /PID %%a > nul 2>&1
)

REM Kill frontend process on port 5173
echo [Frontend] Stopping port 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R ":5173 "') do (
    taskkill /F /PID %%a > nul 2>&1
)

echo.
echo All servers stopped.
