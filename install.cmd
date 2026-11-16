@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [install] Node.js 24+ was not found.
  echo [install] Install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)
node install.cjs %*
pause
