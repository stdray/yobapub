@echo off
echo === YobaPub .wgt Package ===

if not exist dist\release (
    echo ERROR: dist\release not found. Run build.cmd first.
    exit /b 1
)

if exist dist\YobaPub.wgt del dist\YobaPub.wgt

cd dist\release
powershell -Command "Compress-Archive -Path * -DestinationPath ..\YobaPub.zip -Force"
cd ..\..
ren dist\YobaPub.zip YobaPub.wgt

echo.
echo === Package complete ===
echo   Widget: dist\YobaPub.wgt
echo.
echo To install on Tizen TV:
echo   1. Open Tizen Studio
echo   2. File ^> Import ^> Tizen ^> Tizen Web Project from wgt
echo   3. Select dist\YobaPub.wgt
echo   4. Right-click project ^> Run As ^> Tizen Web Application
echo.
echo Or install via CLI:
echo   tizen install -n dist\YobaPub.wgt -t ^<device-name^>
