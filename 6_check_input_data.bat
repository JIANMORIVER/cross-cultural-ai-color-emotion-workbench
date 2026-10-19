@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Please run 1_install_windows.bat first.
  pause
  exit /b 1
)
set "MPLCONFIGDIR=%CD%\.cache\matplotlib"
set "XDG_CACHE_HOME=%CD%\.cache"
echo Checking Task 2 input workbooks only. No statistical analysis will run.
echo Required parser: task2-offline-human-casefold-v2-20260825
.venv\Scripts\python.exe scripts\offline_task2_heterogeneity.py --check-input --preset quick
echo.
echo Check the parser version and recognized associations above.
echo CN, BW, UK and US must all be greater than zero.
pause
