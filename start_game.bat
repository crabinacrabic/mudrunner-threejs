@echo off
rem Quick launcher: serves this folder over http and opens the game in the default browser.
rem GLB car models do not load from file://, so the game must be opened through a server.
cd /d "%~dp0"
set PORT=8765
set PY=
where python >nul 2>nul && set PY=python
if not defined PY where py >nul 2>nul && set PY=py
if not defined PY (
  echo Python 3 not found. Install it from https://www.python.org/downloads/
  pause
  exit /b 1
)
echo Game: http://localhost:%PORT%
echo Close this window to stop the server.
start "" /min cmd /c "ping -n 2 127.0.0.1 >nul & start http://localhost:%PORT%"
%PY% -m http.server %PORT%
pause
