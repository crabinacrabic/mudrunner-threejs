@echo off
rem Quick launcher: serves this folder over http and opens the game in the default browser.
rem GLB car models do not load from file://, so the game must be opened through a local server.
rem Looks for Python 3 (PATH, py launcher, standard install folders) and falls back to Node.js (tools\serve.mjs).
rem Both servers (tools\dev_server.py, tools\serve.mjs) also accept the road editor's save request (/api/save-roads).
setlocal
cd /d "%~dp0"
if not defined PORT set PORT=8765
set "MODE="
set "EXE="

rem --- 1) server already running? then just open the browser
rem      (an old "python -m http.server" answers 501 to the editor's save request: warn about it)
set "SAVECODE="
where curl >nul 2>nul && curl -s -o nul --max-time 1 http://127.0.0.1:%PORT%/index.html && (
  for /f %%c in ('curl -s -o nul -w "%%{http_code}" -X OPTIONS --max-time 1 http://127.0.0.1:%PORT%/api/save-roads') do set "SAVECODE=%%c"
  goto :running
)
goto :find
:running
if not "%SAVECODE%"=="200" (
  echo A server without map saving is already running on port %PORT%.
  echo The road editor cannot save there. Close that server window and start this file again.
  pause
)
start "" "http://localhost:%PORT%"
exit /b 0

:find

rem --- 2) Python 3: on PATH (the Microsoft Store stub does not count)
where python >nul 2>nul && python -c "import sys" >nul 2>nul && set "MODE=py"
if "%MODE%"=="py" set "EXE=python"
rem py launcher
if not defined MODE where py >nul 2>nul && py -3 -c "import sys" >nul 2>nul && set "MODE=py"
if "%MODE%"=="py" if not defined EXE set "EXE=py -3"
rem standard per-user and system install folders (python.org installer without "Add to PATH")
if not defined MODE for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%~D\python.exe" set "EXE=%%~D\python.exe"
if not defined MODE for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%~D\python.exe" set "EXE=%%~D\python.exe"
if not defined MODE if defined EXE set "MODE=pyexe"

rem --- 3) Node.js fallback
if not defined MODE where node >nul 2>nul && set "MODE=node"
if "%MODE%"=="node" set "EXE=node"
if not defined MODE if exist "%ProgramFiles%\nodejs\node.exe" set "EXE=%ProgramFiles%\nodejs\node.exe"
if not defined MODE if defined EXE set "MODE=nodeexe"

if not defined MODE (
  echo Neither Python 3 nor Node.js was found.
  echo Install Python from https://www.python.org/downloads/ or Node.js from https://nodejs.org/
  pause
  exit /b 1
)

echo Game: http://localhost:%PORT%
echo Server: %MODE%  %EXE%
echo Close this window to stop the server.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:%PORT%"
if "%MODE%"=="py" %EXE% "%~dp0tools\dev_server.py" %PORT%
if "%MODE%"=="pyexe" "%EXE%" "%~dp0tools\dev_server.py" %PORT%
if "%MODE%"=="node" node "%~dp0tools\serve.mjs" %PORT%
if "%MODE%"=="nodeexe" "%EXE%" "%~dp0tools\serve.mjs" %PORT%
pause
