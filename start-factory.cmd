@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [factory] Node.js 24+ was not found.
  echo [factory] Install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)
node scripts\start-factory.cjs %*
pause
