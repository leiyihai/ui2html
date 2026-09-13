@echo off
chcp 65001 >nul
rem ===== UI 编辑器开发版启动入口 =====
rem 1. 同步 psd 文件夹到 dev 静态目录（public/psd）
rem 2. 启动 Electron 独立软件窗口(窗口内加载 Vite 本地服务)

cd /d %~dp0ui-editor
if not exist "public\psd" mkdir "public\psd"
copy /y "..\psd\*.psd" "public\psd\" >nul 2>&1
powershell -NoProfile -Command "Get-ChildItem 'public\psd\*.psd' -Name | Set-Content -Encoding utf8 'public\psd\list.txt'"

npm run desktop
