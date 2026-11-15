@echo off
setlocal
title Hermes - Public access (Cloudflare Tunnel)
cd /d "%~dp0"
where cloudflared >nul 2>nul
if errorlevel 1 (
    echo cloudflared was not found. Installing with winget...
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    echo.
    echo Installation finished. CLOSE this window and run START_PUBLIC.bat again.
    pause
    exit /b 0
)
start "Hermes Web" cmd /c "%~dp0START.bat"
timeout /t 3 /nobreak >nul
echo.
echo Look for the URL https://something.trycloudflare.com below and share it.
echo Keep both windows open. Press Ctrl+C here to stop the tunnel.
echo.
cloudflared tunnel --url http://localhost:8090
pause
