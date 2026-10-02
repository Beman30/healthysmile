@echo off
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 (
  echo Python non trovato. Serve Python 3 per eseguire la prova.
  pause
  exit /b 1
)
py -3 prova_locale.py
echo.
pause
