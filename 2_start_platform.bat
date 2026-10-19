@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Please run 1_install_windows.bat first.
  pause
  exit /b 1
)
set "PYTHON=%CD%\.venv\Scripts\python.exe"
set "PORT=3006"
set "FIGURE_PORT=8773"
set "MPLCONFIGDIR=%CD%\.cache\matplotlib"
set "XDG_CACHE_HOME=%CD%\.cache"
set "LOKY_MAX_CPU_COUNT=8"
if not exist "%MPLCONFIGDIR%" mkdir "%MPLCONFIGDIR%"
start "" cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:3006/"
echo Chromalab 3006 is starting. Keep this window open.
echo Website: http://localhost:3006/
echo.
npm run dev
pause
