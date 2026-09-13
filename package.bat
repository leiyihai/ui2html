@echo off
chcp 65001 >nul
rem ===== UI2HTML 免安装版打包入口 =====
rem 输出目录：ui-editor\release
cd /d %~dp0ui-editor
call npm run package
if errorlevel 1 (
  echo.
  echo 打包失败，请查看上面的错误信息。
  pause
  exit /b 1
)
echo.
echo 打包完成，免安装版位于：%~dp0ui-editor\release
pause
