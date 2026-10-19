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
echo Running Task 2 individual heterogeneity FORMAL analysis.
echo 500 stability, 9999 permutation, 1000 bootstrap, 500 Hungarian repeats.
echo Browser is not required. Keep this terminal open and keep the computer awake.
.venv\Scripts\python.exe scripts\offline_task2_heterogeneity.py --preset formal
echo.
echo Finished. Check offline_results folder.
pause
