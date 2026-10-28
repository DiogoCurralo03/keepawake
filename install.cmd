@echo off
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer: https://nodejs.org/
  exit /b 1
)
node.exe "%~dp0scripts\install.js" %*
