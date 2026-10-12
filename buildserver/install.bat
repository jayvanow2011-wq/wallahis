@echo off
REM =====================================================================
REM  Sentinel Build Server - zero-admin Windows installer / launcher
REM  Installs Python deps, Rust (gnu toolchain) and portable mingw-w64
REM  entirely under %LOCALAPPDATA% - no administrator rights needed.
REM =====================================================================
setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

set "SENTINEL_HOME=%LOCALAPPDATA%\Sentinel"
set "MINGW_DIR=%SENTINEL_HOME%\mingw64"
set "CARGO_HOME=%USERPROFILE%\.cargo"
set "RUSTUP_HOME=%USERPROFILE%\.rustup"
set "PATH=%CARGO_HOME%\bin;%MINGW_DIR%\bin;%PATH%"

if not exist "%SENTINEL_HOME%" mkdir "%SENTINEL_HOME%"

echo.
echo ============================================================
echo   SENTINEL BUILD SERVER - installer (no admin required)
echo ============================================================
echo.

REM --- Python check -----------------------------------------------------
where python >nul 2>&1
if errorlevel 1 (
  echo [X] Python is not installed or not in PATH.
  echo     Install Python 3.10+ from https://www.python.org/downloads/
  echo     During install, tick "Add Python to PATH" and "Install for just me".
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('python --version') do echo [OK] %%v

REM --- pip deps (user scope) --------------------------------------------
echo.
echo [*] Installing Python packages (user scope)...
python -m pip install --user --upgrade pip >nul 2>&1
python -m pip install --user -r requirements.txt
if errorlevel 1 (
  echo [X] pip install failed.
  pause
  exit /b 1
)

REM --- Rust (gnu toolchain, user scope) ---------------------------------
where rustc >nul 2>&1
set NEED_RUST=1
if not errorlevel 1 (
  for /f "tokens=*" %%h in ('rustc -vV ^| findstr /B /C:"host:"') do set "RUST_HOST=%%h"
  echo !RUST_HOST! | findstr /C:"gnu" >nul && set NEED_RUST=0
)
if "!NEED_RUST!"=="1" (
  echo.
  echo [*] Installing Rust ^(stable-x86_64-pc-windows-gnu^) under %USERPROFILE%\.rustup ...
  set "RUSTUP_EXE=%TEMP%\rustup-init.exe"
  powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest 'https://win.rustup.rs/x86_64' -OutFile '%RUSTUP_EXE%' } catch { exit 1 }"
  if errorlevel 1 ( echo [X] failed to download rustup-init.exe & pause & exit /b 1 )
  "%RUSTUP_EXE%" --default-host x86_64-pc-windows-gnu --default-toolchain stable --profile minimal -y --no-modify-path
  if errorlevel 1 ( echo [X] rustup install failed & pause & exit /b 1 )
) else (
  echo [OK] Rust present with gnu host
  rustup default stable-x86_64-pc-windows-gnu >nul 2>&1
)
rustup target add x86_64-pc-windows-gnu >nul 2>&1
for /f "tokens=*" %%v in ('rustc --version') do echo [OK] %%v

REM --- portable mingw-w64 (WinLibs, no admin) ---------------------------
where x86_64-w64-mingw32-gcc >nul 2>&1
if errorlevel 1 (
  if not exist "%MINGW_DIR%\bin\gcc.exe" (
    echo.
    echo [*] Downloading portable mingw-w64 ^(WinLibs^) to %MINGW_DIR% ...
    set "MINGW_ZIP=%TEMP%\winlibs-mingw.zip"
    set "MINGW_URL=https://github.com/brechtsanders/winlibs_mingw/releases/download/13.2.0-16.0.6-11.0.1-ucrt-r1/winlibs-x86_64-posix-seh-gcc-13.2.0-mingw-w64ucrt-11.0.1-r1.zip"
    powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest '!MINGW_URL!' -OutFile '!MINGW_ZIP!' -UseBasicParsing } catch { exit 1 }"
    if errorlevel 1 ( echo [X] mingw download failed & pause & exit /b 1 )
    echo [*] Extracting mingw-w64 ^(this takes a minute^) ...
    powershell -NoProfile -Command "Expand-Archive -Force '!MINGW_ZIP!' '%SENTINEL_HOME%\_mingw_tmp'"
    if exist "%SENTINEL_HOME%\_mingw_tmp\mingw64" (
      if exist "%MINGW_DIR%" rmdir /S /Q "%MINGW_DIR%"
      move "%SENTINEL_HOME%\_mingw_tmp\mingw64" "%MINGW_DIR%" >nul
      rmdir /S /Q "%SENTINEL_HOME%\_mingw_tmp"
    )
    del "!MINGW_ZIP!" >nul 2>&1
  )
  set "PATH=%MINGW_DIR%\bin;%PATH%"
)
where x86_64-w64-mingw32-gcc >nul 2>&1
if errorlevel 1 ( echo [X] mingw-w64 still not available & pause & exit /b 1 )
for /f "tokens=*" %%v in ('x86_64-w64-mingw32-gcc --version ^| findstr /R "."') do ( echo [OK] %%v & goto :gcc_done )
:gcc_done

REM --- persist PATH for future sessions (user scope, no admin) ----------
powershell -NoProfile -Command "$p=[Environment]::GetEnvironmentVariable('Path','User'); foreach($d in @('%CARGO_HOME%\bin','%MINGW_DIR%\bin')){ if($p -notlike \"*$d*\"){ $p=\"$d;$p\" } }; [Environment]::SetEnvironmentVariable('Path',$p,'User')" >nul 2>&1

echo.
echo ============================================================
echo   Starting build server...  (Ctrl+C to stop)
echo ============================================================
echo.
python build.py
pause
