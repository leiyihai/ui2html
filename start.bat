@echo off
chcp 65001 >nul
rem ===== UI 编辑器启动入口 =====
rem 1. 同步 psd 文件夹到 dev 静态目录（public/psd）
rem 2. 打开浏览器
rem 3. 启动 Vite dev server

cd /d %~dp0ui-editor
if not exist "public\psd" mkdir "public\psd"
copy /y "..\psd\*.psd" "public\psd\" >nul 2>&1
dir /b "public\psd\*.psd" > "public\psd\list.txt"

start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:5173"
npm run dev
