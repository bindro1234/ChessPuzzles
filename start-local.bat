@echo off
rem Runs the tool on this PC with the engine check working (needs Python).
rem Close this window to stop it.
cd /d "%~dp0"
start "" http://localhost:8080/
python -m http.server 8080 --bind 127.0.0.1
