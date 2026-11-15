@echo off
setlocal
title Hermes - API launcher
cd /d "%~dp0"
if not defined PHP_EXE set "PHP_EXE=C:\php\php.exe"
if not exist "%PHP_EXE%" (
    where php.exe >nul 2>nul
    if errorlevel 1 goto no_php
    set "PHP_EXE=php.exe"
)
set "PY_CMD="
if defined HERMES_PYTHON_EXE set PY_CMD="%HERMES_PYTHON_EXE%"
for %%V in (3.13 3.12 3.14 3.11 3.10) do (
    if not defined PY_CMD (
        py -%%V --version >nul 2>nul
        if not errorlevel 1 set "PY_CMD=py -%%V"
    )
)
if not defined PY_CMD (
    py -3 --version >nul 2>nul
    if not errorlevel 1 set "PY_CMD=py -3"
)
if not defined PY_CMD (
    python --version >nul 2>nul
    if not errorlevel 1 set "PY_CMD=python"
)
if not defined PY_CMD goto no_python
%PY_CMD% -c "import fastapi, uvicorn, requests" >nul 2>nul
if errorlevel 1 (
    echo Installing Python dependencies...
    %PY_CMD% -m pip install -r requirements.txt
    if errorlevel 1 goto pip_failed
)
REM All child windows inherit these settings; no config.php edit is needed.
set "HERMES_DATA_SOURCE=api"
set "HERMES_API_URL=http://127.0.0.1:8000"
if not defined HERMES_API_KEY set "HERMES_API_KEY=hermes-local-demo-key"
start "Hermes API" cmd /c ""%~dp0_api.bat""
timeout /t 3 /nobreak >nul
start "Hermes Generator" cmd /c ""%~dp0_generator.bat""
start "Hermes Web" cmd /c ""%~dp0_web.bat""
timeout /t 2 /nobreak >nul
start "" http://localhost:8090
echo Hermes is running. Close the API, generator, and web windows to stop.
exit /b 0
:no_php
echo PHP was not found. Set PHP_EXE in this file to your php.exe path.
pause
exit /b 1
:no_python
echo Python was not found. Install Python 3.10 or later and add it to PATH.
pause
exit /b 1
:pip_failed
echo Could not install Python dependencies. Check the pip error above.
pause
exit /b 1
