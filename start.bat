@echo off
chcp 65001 >nul
title Dasturxon POS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js o'rnatilmagan. https://nodejs.org dan "LTS" versiyasini (22 yoki yangi) o'rnating.
  echo.
  pause
  exit /b
)
start "" http://localhost:8080
node server.js
pause
