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
echo Running continuous inference V3: diagnostic Bootstrap 1000, Assignment common-m repeats 100, block permutations 2000.
echo Browser is not required. Keep this terminal open and keep the computer awake.
.venv\Scripts\python.exe scripts\offline_formal_analysis.py --mode continuous --bootstrap 1000 --assignment-repeats 100 --permutations 2000
echo.
echo Finished. Check the offline_results folder.
pause
