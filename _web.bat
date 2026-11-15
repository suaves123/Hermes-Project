@echo off
title Hermes - Web dashboard
cd /d "%~dp0"
echo Open http://localhost:8090
"%PHP_EXE%" -S 0.0.0.0:8090 -t "%~dp0web"
echo The web server stopped. Check any error above.
pause
