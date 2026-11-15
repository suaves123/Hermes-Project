@echo off
setlocal
title HERMES - Windows host setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0hermes_setup.ps1"
if errorlevel 1 (
    echo.
    pause
    exit /b 1
)
