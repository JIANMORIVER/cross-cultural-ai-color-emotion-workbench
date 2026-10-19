@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Please run 1_install_windows.bat first.
  pause
  exit /b 1
)
set "MPLCONFIGDIR=%CD%\.cache\matplotlib"
set "XDG_CACHE_HOME=%CD%\.cache"
set "LOKY_MAX_CPU_COUNT=8"
echo WARNING: 1000 Bootstrap plus 1000 permutation rounds may run for many hours.
echo Browser is not required. Keep this terminal open and keep the computer awake.
.venv\Scripts\python.exe scripts\offline_formal_analysis.py --mode similarity --inference 1000 --folds 5
echo.
echo Finished. Check the offline_results folder.
pause
