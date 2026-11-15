@echo off
title Hermes - Telemetry generator
cd /d "%~dp0server"
echo Sending telemetry to %HERMES_API_URL%
%PY_CMD% generator.py
echo The generator stopped. Check any error above.
pause
