$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ZipPath = Join-Path (Split-Path $ScriptDir) 'tizen-from-windows.zip'

if (-not (Test-Path $ZipPath)) {
    Write-Host "ERROR: $ZipPath not found" -ForegroundColor Red
    exit 1
}

$filesToCheck = @('install.bat', 'install.ps1', 'README.md')
$updated = 0

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, 'Update')

try {
    foreach ($fileName in $filesToCheck) {
        $localPath = Join-Path $ScriptDir $fileName
        if (-not (Test-Path $localPath)) {
            Write-Host "SKIP: $fileName not found locally" -ForegroundColor Yellow
            continue
        }

        $localBytes = [System.IO.File]::ReadAllBytes($localPath)
        $entry = $zip.GetEntry($fileName)

        $needsUpdate = $false
        if (-not $entry) {
            $needsUpdate = $true
            Write-Host "  ADD: $fileName (new in zip)" -ForegroundColor Green
        } else {
            $stream = $entry.Open()
            $ms = [System.IO.MemoryStream]::new()
            $stream.CopyTo($ms)
            $stream.Close()
            $zipBytes = $ms.ToArray()
            $ms.Close()

            if ($localBytes.Length -ne $zipBytes.Length) {
                $needsUpdate = $true
            } else {
                for ($i = 0; $i -lt $localBytes.Length; $i++) {
                    if ($localBytes[$i] -ne $zipBytes[$i]) {
                        $needsUpdate = $true
                        break
                    }
                }
            }

            if ($needsUpdate) {
                Write-Host "  UPD: $fileName" -ForegroundColor Cyan
                $entry.Delete()
            } else {
                Write-Host "  OK:  $fileName (unchanged)" -ForegroundColor DarkGray
            }
        }

        if ($needsUpdate) {
            $newEntry = $zip.CreateEntry($fileName, [System.IO.Compression.CompressionLevel]::Optimal)
            $stream = $newEntry.Open()
            $stream.Write($localBytes, 0, $localBytes.Length)
            $stream.Close()
            $updated++
        }
    }
} finally {
    $zip.Dispose()
}

if ($updated -gt 0) {
    Write-Host "`nUpdated $updated file(s) in zip." -ForegroundColor Green
} else {
    Write-Host "`nZip is up to date." -ForegroundColor DarkGray
}
