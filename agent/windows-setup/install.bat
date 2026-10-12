@echo off
REM =====================================================================
REM  Wallahis Agent - one-click Windows setup + build
REM  Run from an elevated cmd (right click -> Run as administrator).
REM =====================================================================
setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

echo.
echo === [1/3] Checking Python ===
where python >nul 2>nul
if errorlevel 1 (
  echo Python not found. Install Python 3.10+ from https://www.python.org/downloads/windows/
  echo Tick "Add python.exe to PATH" during install, then re-run this script.
  pause
  exit /b 1
)
python --version

echo.
echo === [2/3] Installing Python requirements ===
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo pip install failed.
  pause
  exit /b 1
)

echo.
echo === [3/3] Running build_agent.py (downloads Rust + MSVC build tools, then compiles the agent) ===
python build_agent.py %*
if errorlevel 1 (
  echo Build failed. Scroll up for the first red error line.
  pause
  exit /b 1
)

echo.
echo ====================================================================
echo  DONE. Your agent exe is in:  %~dp0dist\sentinel-agent.exe
echo  A copy was also placed on your Desktop.
echo ====================================================================
pause
endlocal
