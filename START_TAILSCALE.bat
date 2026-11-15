@echo off
setlocal
title Hermes - Public access (Tailscale Funnel)
cd /d "%~dp0"
set "TS=tailscale"
where tailscale >nul 2>nul
if errorlevel 1 (
    if exist "%ProgramFiles%\Tailscale\tailscale.exe" (
        set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
    ) else (
        echo Tailscale was not found. Installing with winget...
        winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
        echo.
        echo Installation finished. Open Tailscale, sign in, then run START_TAILSCALE.bat again.
        pause
        exit /b 0
    )
)
start "Hermes Web" cmd /d /c ""%~dp0START.bat""
timeout /t 3 /nobreak >nul
echo.
echo Starting Tailscale Funnel on port 8090.
echo If it asks you to enable Funnel or HTTPS, open the link it prints, approve, then run this file again.
echo Keep both windows open. Press Ctrl+C here to stop sharing.
echo.
"%TS%" funnel 8090
pause
