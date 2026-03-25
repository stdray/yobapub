@echo off
echo === YobaPub Build ===

echo [1/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 (echo FAILED: npm install & exit /b 1)

echo [2/3] Type checking...
call npx tsc --noEmit
if %errorlevel% neq 0 (echo FAILED: typecheck & exit /b 1)

echo [3/3] Building dev + release...
call npx webpack --mode development
if %errorlevel% neq 0 (echo FAILED: dev build & exit /b 1)

call npx webpack --mode production
if %errorlevel% neq 0 (echo FAILED: release build & exit /b 1)

echo.
echo === Build complete ===
echo   Dev:     dist\dev\
echo   Release: dist\release\
