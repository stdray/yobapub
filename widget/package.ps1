$ErrorActionPreference = 'Stop'

Write-Host '=== YobaPub Widget Package ==='

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $ScriptDir
try {
    $SrcDir = 'src'
    $BuildDir = 'build'
    $OutWgt = 'yobapub.wgt'

    if (-not (Test-Path $SrcDir)) {
        Write-Host "ERROR: $SrcDir not found."
        exit 1
    }

    Write-Host '[1/3] Preparing build directory...'
    if (Test-Path $BuildDir) { Remove-Item $BuildDir -Recurse -Force }
    Copy-Item $SrcDir $BuildDir -Recurse

    Write-Host '[2/3] Signing and packaging...'
    tizen package -t wgt -s yobapub -- $BuildDir
    if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: tizen package'; exit 1 }

    Write-Host '[3/3] Moving .wgt...'
    $wgt = Get-ChildItem "$BuildDir/*.wgt" | Select-Object -First 1
    if (-not $wgt) { Write-Host 'ERROR: .wgt not found after packaging'; exit 1 }
    if (Test-Path $OutWgt) { Remove-Item $OutWgt }
    Move-Item $wgt.FullName $OutWgt
    Remove-Item $BuildDir -Recurse -Force

    Write-Host ''
    Write-Host '=== Package complete ==='
    Write-Host "  Widget: widget/$OutWgt"
    Write-Host ''
    Write-Host 'To install on Tizen TV:'
    Write-Host "  tizen install -n widget/$OutWgt -t <device-name>"
} finally {
    Pop-Location
}
