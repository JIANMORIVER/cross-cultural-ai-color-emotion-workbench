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
echo Running Task 2 individual heterogeneity QUICK validation.
echo 100 stability, 999 permutation, 200 bootstrap, 100 Hungarian repeats.
echo This result is for workflow checking, not the final paper result.
.venv\Scripts\python.exe scripts\offline_task2_heterogeneity.py --preset quick
echo.
echo Finished. Check offline_results folder.
pause
