$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Bundled tools ──
$SdkRoot = Join-Path $ScriptDir 'sdk'
$Sdb = Join-Path $SdkRoot 'tools\sdb.exe'
$Tizen = Join-Path $SdkRoot 'tools\ide\bin\tizen.bat'
$DataPath = Join-Path $ScriptDir 'sdk-data'

foreach ($tool in @($Sdb, $Tizen)) {
    if (-not (Test-Path $tool)) {
        Write-Host "ERROR: Missing $tool" -ForegroundColor Red
        exit 1
    }
}

# Generate sdk.info
if (-not (Test-Path $DataPath)) { New-Item -ItemType Directory -Path $DataPath | Out-Null }
"TIZEN_SDK_INSTALLED_PATH=$SdkRoot`nTIZEN_SDK_DATA_PATH=$DataPath" |
    Set-Content -Path (Join-Path $SdkRoot 'sdk.info') -Encoding ASCII

# ══════════════════════════════════════════
# Step 1: Find TVs
# ══════════════════════════════════════════
Write-Host "`nScanning network for Tizen TVs..." -ForegroundColor Yellow

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

$tasks = @{}
1..254 | ForEach-Object {
    $ip = "$subnet.$_"
    $c = [System.Net.Sockets.TcpClient]::new()
    $tasks[$ip] = @{ Client = $c; Task = $c.ConnectAsync($ip, 26101) }
}
Start-Sleep -Seconds 2

$tvIps = @()
foreach ($ip in $tasks.Keys) {
    $t = $tasks[$ip]
    try {
        if ($t.Task.IsCompleted -and -not $t.Task.IsFaulted) {
            $tvIps += $ip
        }
    } catch {}
    $t.Client.Dispose()
}

if (-not $tvIps -or @($tvIps).Count -eq 0) {
    Write-Host "`nNo Tizen TVs found on the network." -ForegroundColor Red
    Write-Host ""
    Write-Host "TV must be in Developer Mode. See:" -ForegroundColor Yellow
    Write-Host "  $ScriptDir\README.md" -ForegroundColor White
    Write-Host ""
    Write-Host "When enabling Developer Mode on your TV, enter one of these IPs" -ForegroundColor Yellow
    Write-Host "(most likely first):" -ForegroundColor Yellow
    Write-Host ""
    $allIps = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
        $_.PrefixOrigin -ne 'WellKnown'
    } | ForEach-Object {
        $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
        if ($adapter) {
            $isVirtual = $adapter.InterfaceDescription -match 'Loopback|WSL|Docker' -or
                ($adapter.Name -match 'vEthernet' -and $adapter.Name -match 'Default|WSL|Docker')
            [PSCustomObject]@{
                IP = $_.IPAddress
                Name = $adapter.Name
                Virtual = $isVirtual
            }
        }
    } | Sort-Object Virtual, Name
    foreach ($item in $allIps) {
        $label = if ($item.Virtual) { " (virtual)" } else { " <-- most likely" }
        $color = if ($item.Virtual) { 'DarkGray' } else { 'Cyan' }
        Write-Host "  $($item.IP)  ($($item.Name))$label" -ForegroundColor $color
    }
    Write-Host ""
    Write-Host "After configuring, reboot the TV and re-run this script." -ForegroundColor White
    exit 1
}

# ── Connect and list devices ──
$Devices = @()
foreach ($ip in $tvIps) {
    $result = & $Sdb connect "${ip}:26101" 2>&1 | Out-String
    if ($result -match 'failed') {
        Write-Host "  Failed to connect to ${ip}" -ForegroundColor DarkGray
    }
}
Start-Sleep -Seconds 1

$deviceLines = & $Sdb devices 2>&1 | Where-Object { $_ -match '^\S+\s+(device|offline)' }
foreach ($line in $deviceLines) {
    if ($line -match '^(\S+)\s+(device|offline)\s*(.*)$') {
        $Devices += [PSCustomObject]@{
            Id     = $Matches[1]
            Status = $Matches[2]
            Name   = $Matches[3].Trim()
        }
    }
}

if ($Devices.Count -eq 0) {
    Write-Host "`nERROR: Found TVs but could not connect." -ForegroundColor Red
    Write-Host ""
    Write-Host "Your TV's Developer Mode must have THIS computer's IP:" -ForegroundColor Yellow
    Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
        $_.PrefixOrigin -ne 'WellKnown'
    } | ForEach-Object {
        $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
        if ($adapter) {
            $isVirtual = $adapter.InterfaceDescription -match 'Loopback|WSL|Docker' -or
                ($adapter.Name -match 'vEthernet' -and $adapter.Name -match 'Default|WSL|Docker')
            if (-not $isVirtual) {
                Write-Host "  $($_.IPAddress)  ($($adapter.Name))" -ForegroundColor Cyan
            }
        }
    }
    Write-Host ""
    Write-Host "On TV: Apps > press 1-2-3-4-5 > set IP above > reboot TV" -ForegroundColor White
    exit 1
}

# ── Select device ──
Write-Host "`nAvailable devices:" -ForegroundColor Green
for ($i = 0; $i -lt $Devices.Count; $i++) {
    $d = $Devices[$i]
    $status = if ($d.Status -eq 'offline') { ' [OFFLINE]' } else { '' }
    Write-Host "  [$($i + 1)] $($d.Name)  ($($d.Id))$status"
}

if ($Devices.Count -eq 1) {
    $Selected = $Devices[0]
    Write-Host "`nUsing: $($Selected.Name) ($($Selected.Id))" -ForegroundColor Cyan
} else {
    $choice = Read-Host "`nSelect device (1-$($Devices.Count))"
    $idx = [int]$choice - 1
    if ($idx -lt 0 -or $idx -ge $Devices.Count) {
        Write-Host "Invalid selection." -ForegroundColor Red
        exit 1
    }
    $Selected = $Devices[$idx]
}

if ($Selected.Status -eq 'offline') {
    Write-Host "ERROR: Device is offline." -ForegroundColor Red
    exit 1
}

# ══════════════════════════════════════════
# Step 2: Find or download .wgt
# ══════════════════════════════════════════
$wgtFiles = @(Get-ChildItem "$ScriptDir\*.wgt" -ErrorAction SilentlyContinue)

if ($wgtFiles.Count -gt 1) {
    Write-Host "`nERROR: Found $($wgtFiles.Count) .wgt files. Keep only one:" -ForegroundColor Red
    $wgtFiles | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Yellow }
    exit 1
}

function Download-LatestWgt {
    Write-Host "`nFetching latest release from GitHub..." -ForegroundColor Yellow
    try {
        $release = Invoke-RestMethod 'https://api.github.com/repos/stdray/yobapub/releases/latest'
        $asset = $release.assets | Where-Object { $_.name -like '*.wgt' } | Select-Object -First 1
        if (-not $asset) {
            Write-Host "ERROR: No .wgt in latest release." -ForegroundColor Red
            exit 1
        }
        $outPath = Join-Path $ScriptDir $asset.name
        Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size/1KB)) KB)..." -ForegroundColor DarkGray
        Invoke-WebRequest $asset.browser_download_url -OutFile $outPath
        Write-Host "Downloaded: $($asset.name)" -ForegroundColor Green
        return Get-Item $outPath
    } catch {
        Write-Host "ERROR: Failed to download: $_" -ForegroundColor Red
        exit 1
    }
}

if ($wgtFiles.Count -eq 0) {
    Write-Host "`nNo .wgt file found in folder." -ForegroundColor Yellow
    $choice = Read-Host "Download latest version from GitHub? (Y/n)"
    if ($choice -eq 'n') {
        Write-Host "Place a .wgt file in this folder and re-run." -ForegroundColor Yellow
        exit 0
    }
    $Wgt = Download-LatestWgt
} else {
    $Wgt = $wgtFiles[0]
    Write-Host "`nFound: $($Wgt.Name)" -ForegroundColor Cyan
    $choice = Read-Host "Install this version or download latest? ([L]ocal / [D]ownload)"
    if ($choice -eq 'D' -or $choice -eq 'd') {
        $Wgt = Download-LatestWgt
    }
}

Write-Host "Widget: $($Wgt.Name)" -ForegroundColor Cyan

# ══════════════════════════════════════════
# Step 3: Ensure signing certificate
# ══════════════════════════════════════════
$AuthorP12 = Join-Path $DataPath 'keystore\author\author.p12'
$ProfileDir = Join-Path $DataPath 'profile'
$ProfilesXml = Join-Path $ProfileDir 'profiles.xml'
$ProfileName = 'yobapub'
$DistP12 = Join-Path $SdkRoot 'tools\certificate-generator\certificates\distributor\tizen-distributor-signer.p12'
$DistCa = Join-Path $SdkRoot 'tools\certificate-generator\certificates\distributor\tizen-distributor-ca.cer'

if (-not (Test-Path $AuthorP12)) {
    Write-Host "`nCreating signing certificate (first run)..." -ForegroundColor Yellow
    & $Tizen certificate -a yobapub -p yobapub123 -f author
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $AuthorP12)) {
        Write-Host "ERROR: Failed to create certificate." -ForegroundColor Red
        exit 1
    }
    Write-Host "Certificate created" -ForegroundColor Green
} else {
    Write-Host "`nUsing existing certificate" -ForegroundColor DarkGray
}

# Write profiles.xml
if (-not (Test-Path $ProfileDir)) { New-Item -ItemType Directory -Path $ProfileDir | Out-Null }
@"
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<profiles active="$ProfileName" version="3.1">
<profile name="$ProfileName">
<profileitem ca="" distributor="0" key="$AuthorP12" password="yobapub123" rootca=""/>
<profileitem ca="$DistCa" distributor="1" key="$DistP12" password="tizenpkcs12passfordsigner" rootca=""/>
<profileitem ca="" distributor="2" key="" password="" rootca=""/>
</profile>
</profiles>
"@ | Set-Content -Path $ProfilesXml -Encoding UTF8
& $Tizen cli-config "`"default.profiles.path=$ProfilesXml`"" 2>&1 | Out-Null

# ══════════════════════════════════════════
# Step 4: Re-sign, install, launch
# ══════════════════════════════════════════
Write-Host "`nRe-signing widget..." -ForegroundColor Yellow

$BuildDir = Join-Path $ScriptDir '.build'
if (Test-Path $BuildDir) { Remove-Item $BuildDir -Recurse -Force }
New-Item -ItemType Directory -Path $BuildDir | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($Wgt.FullName, $BuildDir)

Get-ChildItem "$BuildDir\author-signature.xml", "$BuildDir\signature*.xml" -ErrorAction SilentlyContinue |
    Remove-Item -Force

& $Tizen package -t wgt -s $ProfileName -- $BuildDir
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Re-signing failed." -ForegroundColor Red
    Remove-Item $BuildDir -Recurse -Force
    exit 1
}

$SignedWgt = Get-ChildItem "$BuildDir\*.wgt" | Select-Object -First 1
if (-not $SignedWgt) {
    Write-Host "ERROR: Signed .wgt not found." -ForegroundColor Red
    Remove-Item $BuildDir -Recurse -Force
    exit 1
}

Write-Host "`nInstalling on $($Selected.Name)..." -ForegroundColor Yellow
& $Tizen install -n $SignedWgt.FullName -s $Selected.Id
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Installation failed." -ForegroundColor Red
    Write-Host ""
    Write-Host "If updating from a different certificate, uninstall the app from TV first" -ForegroundColor Yellow
    Write-Host "and re-run this script." -ForegroundColor Yellow
    Remove-Item $BuildDir -Recurse -Force
    exit 1
}

Write-Host "`nLaunching app..." -ForegroundColor Yellow
& $Sdb -s $Selected.Id shell 0 was_execute kBJ9Z4MzKK.yobapub 2>&1 | Out-Null

Remove-Item $BuildDir -Recurse -Force

Write-Host "`nDone!" -ForegroundColor Green
