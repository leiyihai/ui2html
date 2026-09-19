@echo off
chcp 65001 >nul
rem ===== UI2HTML desktop launcher =====
rem 1. Sync PSD files into the dev public directory.
rem 2. Start the Electron desktop window with the Vite dev server.

cd /d %~dp0ui-editor
if not exist "public\psd" mkdir "public\psd"
copy /y "..\psd\*.psd" "public\psd\" >nul 2>&1
powershell -NoProfile -Command "Get-ChildItem 'public\psd\*.psd' -Name | Set-Content -Encoding utf8 'public\psd\list.txt'"

rem Install dependencies automatically on a new machine or checkout.
rem Prefer the mirror for the Electron binary download.
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing UI2HTML dependencies...
  call npm install
  if errorlevel 1 goto :failed
)

call npm run desktop
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo UI2HTML failed to start. See the error above.
pause
exit /b 1
