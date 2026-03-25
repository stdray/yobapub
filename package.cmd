@echo off
echo === YobaPub .wgt Package ===

if not exist dist\release (
    echo ERROR: dist\release not found. Run build.cmd first.
    exit /b 1
)

if exist dist\yobapub.wgt del dist\yobapub.wgt

cd dist\release
powershell -ExecutionPolicy Bypass -Command "$src = Get-Location; $dst = \"$pwd\..\YobaPub.zip\"; if (Test-Path $dst) { Remove-Item $dst }; Add-Type -Assembly System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::Open($dst, 'Create'); Get-ChildItem -Recurse -File | ForEach-Object { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $_.FullName.Substring($src.Path.Length + 1)) | Out-Null }; $zip.Dispose()"
cd ..\..
ren dist\YobaPub.zip yobapub.wgt

echo.
echo === Package complete ===
echo   Widget: dist\yobapub.wgt
echo.
echo To install on Tizen TV:
echo   1. Open Tizen Studio
echo   2. File ^> Import ^> Tizen ^> Tizen Web Project from wgt
echo   3. Select dist\yobapub.wgt
echo   4. Right-click project ^> Run As ^> Tizen Web Application
echo.
echo Or install via CLI:
echo   tizen install -n dist\yobapub.wgt -t ^<device-name^>
