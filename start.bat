@echo off
chcp 65001 >nul
title Dasturxon POS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js o'rnatilmagan. https://nodejs.org dan "LTS" versiyasini (22.18 yoki yangi) o'rnating.
  echo.
  pause
  exit /b
)
if not exist node_modules (
  echo  Birinchi ishga tushirish: kutubxonalar o'rnatilmoqda...
  call npm install --omit=dev
)
start "" http://localhost:8080
node src\server.ts
pause
