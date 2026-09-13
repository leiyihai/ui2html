@echo off
chcp 65001 >nul
rem ===== UI2HTML 免安装版启动入口 =====

set "ROOT_DIR=%~dp0"
set "RELEASE_DIR=%ROOT_DIR%ui-editor\release"
set "PORTABLE_EXE="

for /f "delims=" %%F in ('dir /b /a-d /o-d "%RELEASE_DIR%\UI2HTML-*-portable.exe" 2^>nul') do if not defined PORTABLE_EXE set "PORTABLE_EXE=%%F"

if not defined PORTABLE_EXE (
  echo 未找到免安装版 EXE。
  echo 请先运行 package.bat 完成打包。
  pause
  exit /b 1
)

start "UI2HTML" "%RELEASE_DIR%\%PORTABLE_EXE%"
