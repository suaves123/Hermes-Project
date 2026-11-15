@echo off
setlocal
title Hermes - Crew Health Monitoring
cd /d "%~dp0"
REM Change this path if PHP is installed elsewhere.
if not defined PHP_EXE set "PHP_EXE=C:\php\php.exe"
if not exist "%PHP_EXE%" (
    where php.exe >nul 2>nul
    if errorlevel 1 goto no_php
    set "PHP_EXE=php.exe"
)
set "HERMES_DATA_SOURCE=local"
echo Hermes - Built-in simulation
echo Open http://localhost:8090
echo All measurements are saved in the storage folder.
echo Keep this window open. Press Ctrl+C to stop.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8090"
"%PHP_EXE%" -S 0.0.0.0:8090 -t "%~dp0web"
echo The web server stopped. Check any error above.
pause
exit /b
:no_php
echo PHP was not found. Set PHP_EXE in START.bat to your php.exe path.
pause
exit /b 1
