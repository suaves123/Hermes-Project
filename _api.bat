@echo off
title Hermes - Telemetry API
cd /d "%~dp0server"
echo API documentation: http://localhost:8000/docs
%PY_CMD% -m uvicorn api:app --host 0.0.0.0 --port 8000
echo The API stopped. Check any error above.
pause
