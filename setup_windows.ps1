$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/5] Checking Node.js..." -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org/ and run this script again."
}
node --version
npm --version
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required." }

Write-Host "[2/5] Locating Python 3.11..." -ForegroundColor Cyan
$python = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
  py -3.11 --version | Out-Host
  if ($LASTEXITCODE -eq 0) { $python = "py -3.11" }
}
if (-not $python -and (Get-Command python -ErrorAction SilentlyContinue)) {
  python --version
  $python = "python"
}
if (-not $python) {
  throw "Python is not installed. Install Python 3.11 (64-bit) from https://python.org/ and enable Add Python to PATH."
}

Write-Host "[3/5] Creating Python virtual environment..." -ForegroundColor Cyan
if (-not (Test-Path ".venv\Scripts\python.exe")) {
  if ($python -eq "py -3.11") { py -3.11 -m venv .venv } else { python -m venv .venv }
}
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements-windows.txt

Write-Host "[4/5] Installing website dependencies..." -ForegroundColor Cyan
npm ci

Write-Host "[5/5] Verifying environment..." -ForegroundColor Cyan
$env:MPLCONFIGDIR = "$PSScriptRoot\.cache\matplotlib"
$env:XDG_CACHE_HOME = "$PSScriptRoot\.cache"
$env:LOKY_MAX_CPU_COUNT = "8"
New-Item -ItemType Directory -Force $env:MPLCONFIGDIR | Out-Null
& .\.venv\Scripts\python.exe scripts\check_windows_env.py

Write-Host "Installation completed. Double-click 2_start_platform.bat next." -ForegroundColor Green
