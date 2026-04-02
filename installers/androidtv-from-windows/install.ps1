$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Tools ──
$Adb = Join-Path $ScriptDir 'adb.exe'
if (-not (Test-Path $Adb)) {
    Write-Host "ERROR: adb.exe not found in $ScriptDir" -ForegroundColor Red
    exit 1
}

# ══════════════════════════════════════════
# Step 1: Find Android TV devices
# ══════════════════════════════════════════
Write-Host "`nScanning network for Android TV devices..." -ForegroundColor Yellow

$localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
    $_.IPAddress -notlike '172.1?.*' -and $_.IPAddress -notlike '172.2?.*' -and
    $_.IPAddress -notlike '172.3?.*' -and $_.PrefixOrigin -ne 'WellKnown'
} | Sort-Object -Property InterfaceIndex | Select-Object -First 1).IPAddress

if (-not $localIp) {
    Write-Host "ERROR: Could not determine local IP." -ForegroundColor Red
    exit 1
}

$subnet = ($localIp -split '\.')[0..2] -join '.'
Write-Host "Subnet: $subnet.0/24 (from $localIp)" -ForegroundColor DarkGray

# Scan common ADB ports: 5555 (default) and 30000-50000 range (wireless debug)
$ports = @(5555)
Write-Host "Scanning port 5555..." -ForegroundColor DarkGray

$tasks = @{}
foreach ($port in $ports) {
    1..254 | ForEach-Object {
        $ip = "$subnet.$_"
        $key = "${ip}:${port}"
        $c = [System.Net.Sockets.TcpClient]::new()
        $tasks[$key] = @{ Client = $c; Task = $c.ConnectAsync($ip, $port) }
    }
}
Start-Sleep -Seconds 2

$foundEndpoints = @()
foreach ($key in $tasks.Keys) {
    $t = $tasks[$key]
    try {
        if ($t.Task.IsCompleted -and -not $t.Task.IsFaulted) {
            $foundEndpoints += $key
        }
    } catch {}
    $t.Client.Dispose()
}

# Also check already-connected devices
& $Adb start-server 2>&1 | Out-Null
$existingDevices = & $Adb devices 2>&1 | Where-Object { $_ -match '^\S+\s+device$' }
foreach ($line in $existingDevices) {
    if ($line -match '^(\S+)\s+device$') {
        $ep = $Matches[1]
        if ($foundEndpoints -notcontains $ep) {
            $foundEndpoints += $ep
        }
    }
}

if ($foundEndpoints.Count -eq 0) {
    Write-Host "`nNo Android TV devices found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Enable wireless debugging on your Android TV:" -ForegroundColor Yellow
    Write-Host "  1. Settings > Device Preferences > About > tap 'Build' 7 times" -ForegroundColor White
    Write-Host "  2. Settings > Device Preferences > Developer Options" -ForegroundColor White
    Write-Host "  3. Enable 'Network debugging' (or 'ADB debugging')" -ForegroundColor White
    Write-Host "  4. Note the IP address and port shown on screen" -ForegroundColor White
    Write-Host ""
    Write-Host "Or enter device address manually (IP:PORT): " -NoNewline
    $manual = Read-Host
    if (-not $manual) { exit 1 }
    $foundEndpoints = @($manual)
}

# ── Connect to found devices ──
$Devices = @()
foreach ($ep in $foundEndpoints) {
    $result = & $Adb connect $ep 2>&1 | Out-String
    if ($result -match 'connected|already') {
        Write-Host "  Connected: $ep" -ForegroundColor DarkGray
    }
}
Start-Sleep -Seconds 1

$deviceLines = & $Adb devices -l 2>&1 | Where-Object { $_ -match '^\S+\s+device\s' }
foreach ($line in $deviceLines) {
    if ($line -match '^(\S+)\s+device\s.*model:(\S+)') {
        $Devices += [PSCustomObject]@{
            Id    = $Matches[1]
            Model = $Matches[2] -replace '_', ' '
        }
    } elseif ($line -match '^(\S+)\s+device') {
        $Devices += [PSCustomObject]@{
            Id    = $Matches[1]
            Model = 'Unknown'
        }
    }
}

if ($Devices.Count -eq 0) {
    Write-Host "`nERROR: Could not connect to any device." -ForegroundColor Red
    Write-Host ""
    Write-Host "Make sure:" -ForegroundColor Yellow
    Write-Host "  - 'Network debugging' is enabled on the TV" -ForegroundColor White
    Write-Host "  - TV and this computer are on the same network" -ForegroundColor White
    Write-Host "  - Accept the USB debugging prompt on the TV if shown" -ForegroundColor White
    exit 1
}

# ── Select device ──
Write-Host "`nAvailable devices:" -ForegroundColor Green
for ($i = 0; $i -lt $Devices.Count; $i++) {
    $d = $Devices[$i]
    Write-Host "  [$($i + 1)] $($d.Model)  ($($d.Id))"
}

if ($Devices.Count -eq 1) {
    $Selected = $Devices[0]
    Write-Host "`nUsing: $($Selected.Model) ($($Selected.Id))" -ForegroundColor Cyan
} else {
    $choice = Read-Host "`nSelect device (1-$($Devices.Count))"
    $idx = [int]$choice - 1
    if ($idx -lt 0 -or $idx -ge $Devices.Count) {
        Write-Host "Invalid selection." -ForegroundColor Red
        exit 1
    }
    $Selected = $Devices[$idx]
}

# ══════════════════════════════════════════
# Step 2: Find or download APK
# ══════════════════════════════════════════
$apkFiles = @(Get-ChildItem "$ScriptDir\*.apk" -ErrorAction SilentlyContinue)

if ($apkFiles.Count -gt 1) {
    Write-Host "`nERROR: Found $($apkFiles.Count) .apk files. Keep only one:" -ForegroundColor Red
    $apkFiles | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Yellow }
    exit 1
}

function Download-LatestApk {
    Write-Host "`nFetching latest release from GitHub..." -ForegroundColor Yellow
    try {
        $release = Invoke-RestMethod 'https://api.github.com/repos/stdray/yobapub/releases/latest'
        $asset = $release.assets | Where-Object { $_.name -like '*.apk' } | Select-Object -First 1
        if (-not $asset) {
            Write-Host "ERROR: No .apk in latest release." -ForegroundColor Red
            exit 1
        }
        $outPath = Join-Path $ScriptDir $asset.name
        Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size/1MB, 1)) MB)..." -ForegroundColor DarkGray
        Invoke-WebRequest $asset.browser_download_url -OutFile $outPath
        Write-Host "Downloaded: $($asset.name)" -ForegroundColor Green
        return Get-Item $outPath
    } catch {
        Write-Host "ERROR: Failed to download: $_" -ForegroundColor Red
        exit 1
    }
}

if ($apkFiles.Count -eq 0) {
    Write-Host "`nNo .apk file found in folder." -ForegroundColor Yellow
    $choice = Read-Host "Download latest version from GitHub? (Y/n)"
    if ($choice -eq 'n') {
        Write-Host "Place an .apk file in this folder and re-run." -ForegroundColor Yellow
        exit 0
    }
    $Apk = Download-LatestApk
} else {
    $Apk = $apkFiles[0]
    Write-Host "`nFound: $($Apk.Name)" -ForegroundColor Cyan
    $choice = Read-Host "Install this version or download latest? ([L]ocal / [D]ownload)"
    if ($choice -eq 'D' -or $choice -eq 'd') {
        $Apk = Download-LatestApk
    }
}

Write-Host "APK: $($Apk.Name)" -ForegroundColor Cyan

# ══════════════════════════════════════════
# Step 3: Install and launch
# ══════════════════════════════════════════
Write-Host "`nInstalling on $($Selected.Model)..." -ForegroundColor Yellow
$result = & $Adb -s $Selected.Id install -r $Apk.FullName 2>&1 | Out-String
if ($result -match 'Success') {
    Write-Host "Installed!" -ForegroundColor Green
} else {
    Write-Host "ERROR: Installation failed." -ForegroundColor Red
    Write-Host $result -ForegroundColor Yellow
    exit 1
}

Write-Host "`nLaunching app..." -ForegroundColor Yellow
& $Adb -s $Selected.Id shell monkey -p su.p3o.yobapub -c android.intent.category.LEANBACK_LAUNCHER 1 2>&1 | Out-Null

Write-Host "`nDone!" -ForegroundColor Green
