@echo off
chcp 65001 >nul
rem UI2HTML web launcher

cd /d "%~dp0ui-editor"
if not exist "public\psd" mkdir "public\psd"
copy /y "..\psd\*.psd" "public\psd\" >nul 2>&1
powershell -NoProfile -Command "Get-ChildItem 'public\psd\*.psd' -Name | Set-Content -Encoding utf8 'public\psd\list.txt'"

npm run web
