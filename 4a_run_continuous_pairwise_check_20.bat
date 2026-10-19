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
echo Running inference V3 verification: diagnostic Bootstrap 10, Assignment common-m repeats 20, block permutations 200.
echo This is a workflow check, not the formal inferential result.
.venv\Scripts\python.exe scripts\offline_formal_analysis.py --mode continuous --bootstrap 10 --assignment-repeats 20 --permutations 200
echo.
echo Finished. Import the new continuous_result.json.gz into Mac 3006 and inspect Pairwise Significance.
pause
