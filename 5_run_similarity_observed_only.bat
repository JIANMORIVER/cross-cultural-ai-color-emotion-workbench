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
echo Running observed multi-level similarity results without Bootstrap/Permutation.
.venv\Scripts\python.exe scripts\offline_formal_analysis.py --mode similarity --inference 0 --folds 5
echo.
echo Finished. Check the offline_results folder.
pause
