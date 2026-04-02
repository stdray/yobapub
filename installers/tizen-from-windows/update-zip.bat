@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-zip.ps1" %*
pause
