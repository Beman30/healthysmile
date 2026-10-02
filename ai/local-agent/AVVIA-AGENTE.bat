@echo off
cd /d "%~dp0"
py -3 server.py
if errorlevel 1 echo Python 3 non trovato o porta 8765 occupata.
pause
