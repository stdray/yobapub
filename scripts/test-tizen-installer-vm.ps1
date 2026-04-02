#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$VmName = 'YobaPub-TizenTest'
$SwitchName = 'TizenTestBridge'
$VhdPath = "$env:TEMP\$VmName.vhdx"
$DownloadDir = 'D:\vm'

Write-Host "=== YobaPub Tizen Installer VM Test ===" -ForegroundColor Cyan

# ── Find or download WinDev VHD ──
Write-Host "`nSearching for Windows dev VHD..." -ForegroundColor Yellow

$vhdFiles = @()
$searchPaths = @("$DownloadDir\*.vhdx", "$env:USERPROFILE\Downloads\*.vhdx", "D:\*.vhdx", "$env:TEMP\*.vhdx")
foreach ($p in $searchPaths) {
    $vhdFiles += Get-ChildItem $p -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 10GB }
}

# Also check for WinDev zip
$zipFiles = @()
$zipPaths = @("$DownloadDir\WinDev*.zip", "$env:USERPROFILE\Downloads\WinDev*.zip", "D:\WinDev*.zip")
foreach ($p in $zipPaths) {
    $zipFiles += Get-ChildItem $p -ErrorAction SilentlyContinue
}

if ($vhdFiles.Count -gt 0) {
    Write-Host "Found VHDs:" -ForegroundColor Green
    for ($i = 0; $i -lt $vhdFiles.Count; $i++) {
        Write-Host "  [$($i+1)] $($vhdFiles[$i].FullName) ($([math]::Round($vhdFiles[$i].Length/1GB, 1)) GB)"
    }
    if ($vhdFiles.Count -eq 1) { $srcVhd = $vhdFiles[0].FullName }
    else {
        $choice = Read-Host "Select VHD (1-$($vhdFiles.Count))"
        $srcVhd = $vhdFiles[[int]$choice - 1].FullName
    }
} elseif ($zipFiles.Count -gt 0) {
    Write-Host "Found WinDev zip, extracting..." -ForegroundColor Yellow
    $zip = $zipFiles[0].FullName
    $extractDir = Join-Path $DownloadDir 'WinDev'
    Expand-Archive -Path $zip -DestinationPath $extractDir -Force
    $srcVhd = (Get-ChildItem "$extractDir\*.vhdx" -Recurse | Select-Object -First 1).FullName
    if (-not $srcVhd) {
        Write-Host "ERROR: No .vhdx found in zip" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "No VHD found. Downloading Windows Dev Environment (~20 GB)..." -ForegroundColor Yellow
    if (-not (Test-Path $DownloadDir)) { New-Item -ItemType Directory -Path $DownloadDir | Out-Null }
    $zipPath = Join-Path $DownloadDir 'WinDev_HyperV.zip'

    if (-not (Test-Path $zipPath)) {
        Write-Host "Downloading from aka.ms/windev_VM_hyperv ..." -ForegroundColor DarkGray
        Invoke-WebRequest 'https://aka.ms/windev_VM_hyperv' -OutFile $zipPath
    }

    Write-Host "Extracting..." -ForegroundColor Yellow
    $extractDir = Join-Path $DownloadDir 'WinDev'
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $srcVhd = (Get-ChildItem "$extractDir\*.vhdx" -Recurse | Select-Object -First 1).FullName
    if (-not $srcVhd) {
        Write-Host "ERROR: No .vhdx found in zip" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Using VHD: $srcVhd" -ForegroundColor Cyan

# ── Cleanup old VM ──
$existingVm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if ($existingVm) {
    Write-Host "`nRemoving existing VM '$VmName'..." -ForegroundColor Yellow
    if ($existingVm.State -ne 'Off') { Stop-VM -Name $VmName -Force -TurnOff }
    Remove-VM -Name $VmName -Force
    if (Test-Path $VhdPath) { Remove-Item $VhdPath -Force }
}

# ── Copy VHD (don't modify original) ──
Write-Host "`nCopying VHD to $VhdPath..." -ForegroundColor Yellow
Copy-Item $srcVhd $VhdPath -Force

# ── Create external switch (bridge) ──
$existingSwitch = Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue
if (-not $existingSwitch) {
    Write-Host "`nCreating bridged network switch..." -ForegroundColor Yellow
    $netAdapter = Get-NetAdapter | Where-Object {
        $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Hyper-V|Virtual|vEthernet|Loopback'
    } | Sort-Object -Property LinkSpeed -Descending | Select-Object -First 1

    if (-not $netAdapter) {
        Write-Host "ERROR: No physical network adapter found." -ForegroundColor Red
        exit 1
    }
    Write-Host "Bridging to: $($netAdapter.Name) ($($netAdapter.InterfaceDescription))" -ForegroundColor DarkGray
    New-VMSwitch -Name $SwitchName -NetAdapterName $netAdapter.Name -AllowManagementOS $true
} else {
    Write-Host "Using existing switch: $SwitchName" -ForegroundColor DarkGray
}

# ── Create VM (Gen 2 for WinDev) ──
Write-Host "`nCreating VM '$VmName'..." -ForegroundColor Yellow
New-VM -Name $VmName -MemoryStartupBytes 4GB -Generation 2 -VHDPath $VhdPath -SwitchName $SwitchName
Set-VM -Name $VmName -ProcessorCount 4 -AutomaticCheckpointsEnabled $false
Set-VMFirmware -VMName $VmName -EnableSecureBoot On -SecureBootTemplate 'MicrosoftWindows'
Set-VMKeyProtector -VMName $VmName -NewLocalKeyProtector
Enable-VMTPM -VMName $VmName

Write-Host "`nVM created:" -ForegroundColor Green
Write-Host "  Name: $VmName"
Write-Host "  RAM: 4 GB, CPU: 4 cores"
Write-Host "  VHD: $VhdPath"
Write-Host "  Network: Bridge ($SwitchName)"

# ── Start VM ──
Write-Host "`nStarting VM..." -ForegroundColor Yellow
Start-VM -Name $VmName

Write-Host "`n=== VM is running ===" -ForegroundColor Green
Write-Host ""
Write-Host "Connect: vmconnect localhost $VmName" -ForegroundColor Cyan
Write-Host ""
Write-Host "Once Windows boots, open PowerShell and run:" -ForegroundColor White
Write-Host ""
Write-Host '  Invoke-WebRequest "https://github.com/stdray/yobapub/raw/feature/tizen-installer/installers/tizen-from-windows.zip" -OutFile tizen.zip' -ForegroundColor Cyan
Write-Host '  Expand-Archive tizen.zip -DestinationPath tizen' -ForegroundColor Cyan
Write-Host '  Invoke-WebRequest "https://github.com/stdray/yobapub/releases/download/v2.0.0/yobapub-tizen-2.0.0.wgt" -OutFile tizen\yobapub-tizen-2.0.0.wgt' -ForegroundColor Cyan
Write-Host '  .\tizen\install.bat' -ForegroundColor Cyan
Write-Host ""
Write-Host "Cleanup:" -ForegroundColor DarkGray
Write-Host "  Stop-VM '$VmName' -Force -TurnOff" -ForegroundColor DarkGray
Write-Host "  Remove-VM '$VmName' -Force" -ForegroundColor DarkGray
Write-Host "  Remove-VMSwitch '$SwitchName' -Force  # warning: briefly drops host network" -ForegroundColor DarkGray
Write-Host "  Remove-Item '$VhdPath' -Force" -ForegroundColor DarkGray
