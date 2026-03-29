@echo off
cd /d "%~dp0"
call gradle assembleDebug %*
echo.
echo APK: app\build\outputs\apk\debug\app-debug.apk
