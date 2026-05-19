@echo off

netstat -aon | findstr /R ":8000 " >nul 2>&1
if errorlevel 1 (
    echo Backend not running.
) else (
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R ":8000 "') do taskkill /F /PID %%a >nul 2>&1
    echo Backend stopped.
)

netstat -aon | findstr /R ":5173 " >nul 2>&1
if errorlevel 1 (
    echo Frontend not running.
) else (
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R ":5173 "') do taskkill /F /PID %%a >nul 2>&1
    echo Frontend stopped.
)
