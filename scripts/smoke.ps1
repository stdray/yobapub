#!/usr/bin/env pwsh
#requires -Version 7
# Smoke tests for the YobaPub proxy. Run against a local instance during development
# or against prod right after a deploy:
#
#   ./smoke.ps1 -BaseUrl http://localhost:5038
#   ./smoke.ps1 -BaseUrl https://yobapub.3po.su
#
# With a PetBox API key (scope logs:query; key `yobapub-smoke`) the script also
# verifies END-TO-END that posted client events actually land in the PetBox
# `clients` log (relay -> CLEF batch -> PetBox). Without the key those steps are
# skipped:
#
#   ./smoke.ps1 -BaseUrl https://yobapub.3po.su -PetBoxApiKey $env:PETBOX_SMOKE_KEY
#
# Exit code: 0 = all passed, 1 = at least one failure (CI-friendly).
param(
    [string]$BaseUrl = 'http://localhost:5038',
    [string]$PetBoxApiKey = $env:PETBOX_SMOKE_KEY,
    [string]$PetBoxBaseUrl = 'https://petbox.3po.su',
    [string]$PetBoxProject = 'yobapub',
    [string]$ClientLog = 'clients'
)

$ErrorActionPreference = 'Stop'
$script:passed = 0
$script:failed = 0
$script:skipped = 0

function Step([string]$name, [scriptblock]$body) {
    try {
        & $body
        $script:passed++
        Write-Host "PASS  $name" -ForegroundColor Green
    }
    catch {
        $script:failed++
        Write-Host "FAIL  $name — $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Skip([string]$name, [string]$reason) {
    $script:skipped++
    Write-Host "SKIP  $name — $reason" -ForegroundColor Yellow
}

function Assert([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}

function GetJson([string]$path) {
    (Invoke-WebRequest "$BaseUrl$path" -TimeoutSec 10).Content | ConvertFrom-Json
}

function PostJson([string]$path, [hashtable]$body) {
    Invoke-WebRequest "$BaseUrl$path" -Method Post -ContentType 'application/json' `
        -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 10
}

# Unique markers so e2e queries find exactly this run's events.
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$deviceId = "smoke-$runId"
$logMarker = "smoke log $runId"
$errorDomain = "smoke-$runId.example.com"
$knownLevels = @('Verbose', 'Debug', 'Information', 'Warning', 'Error', 'Off', 'None')

Write-Host "Smoke run $runId against $BaseUrl" -ForegroundColor Cyan

Step 'GET /api/about returns version json' {
    $about = GetJson '/api/about'
    Assert ($null -ne $about.semVer -and "$($about.semVer)".Length -gt 0) "semVer missing: $($about | ConvertTo-Json -Compress)"
}

Step 'GET /api/proxy-config returns upstream' {
    $cfg = GetJson '/api/proxy-config'
    Assert ("$($cfg.upstream)".StartsWith('http')) "unexpected upstream: $($cfg.upstream)"
    Assert ($cfg.proxyAll -is [bool]) 'proxyAll is not a boolean'
}

Step 'GET / serves the SPA shell (or 404 on a dev run without bundled frontend)' {
    $r = Invoke-WebRequest "$BaseUrl/" -TimeoutSec 10 -SkipHttpErrorCheck
    Assert ($r.StatusCode -eq 200 -or $r.StatusCode -eq 404) "unexpected status $($r.StatusCode)"
    if ($r.StatusCode -eq 200) { Assert ($r.Content -match '<html') 'response is not HTML' }
}

Step 'GET /.well-known/assetlinks.json has the android package' {
    $links = GetJson '/.well-known/assetlinks.json'
    Assert ($links[0].target.package_name -eq 'su.p3o.yobapub') "unexpected package: $($links[0].target.package_name)"
}

Step 'GET /api/vip-check: unknown login is not vip' {
    $vip = GetJson "/api/vip-check?login=$deviceId"
    Assert ($vip.vip -is [bool]) 'vip is not a boolean'
    Assert (-not $vip.vip) "random login '$deviceId' reported as vip"
}

Step 'GET /api/log-config returns a known level' {
    $cfg = GetJson "/api/log-config?deviceId=$deviceId"
    Assert ($knownLevels -contains $cfg.level) "unknown level '$($cfg.level)'"
}

Step 'POST /api/log accepts a client event' {
    $r = PostJson '/api/log' @{
        level = 'Warning'; category = 'smoke'; message = $logMarker
        deviceId = $deviceId; clientTs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        traceId = $runId.Substring(0, 4); props = @{ category = 'smoke'; runId = $runId }
    }
    Assert ($r.StatusCode -eq 200) "status $($r.StatusCode)"
}

Step 'POST /api/playback-error accepts an error report' {
    $r = PostJson '/api/playback-error' @{
        url = "https://$errorDomain/seg1.ts"; deviceId = $deviceId
        userAgent = 'smoke-agent'; errorDetails = 'smoke synthetic error'
    }
    Assert ($r.StatusCode -eq 200) "status $($r.StatusCode)"
}

Step 'POST /api/log ignores malformed body' {
    $r = Invoke-WebRequest "$BaseUrl/api/log" -Method Post -ContentType 'application/json' `
        -Body 'not json at all' -TimeoutSec 10
    Assert ($r.StatusCode -eq 200) "status $($r.StatusCode)"
}

Step 'GET /hls/rewrite rejects an invalid url with 400' {
    $r = Invoke-WebRequest "$BaseUrl/hls/rewrite?url=notaurl&audio=0" -TimeoutSec 10 -SkipHttpErrorCheck
    Assert ($r.StatusCode -eq 400) "expected 400, got $($r.StatusCode)"
}

# --- End-to-end: events posted above must reach the PetBox `clients` log. ---

if ($PetBoxApiKey) {
    function WaitPetBoxEvent([string]$contains) {
        # Relay flushes every ~2s; PetBox ingest is async — poll up to 30s.
        $kql = [uri]::EscapeDataString("events | where Message contains `"$contains`" | take 1")
        $url = "$PetBoxBaseUrl/api/logs/$PetBoxProject/$ClientLog/query?q=$kql"
        foreach ($i in 1..15) {
            Start-Sleep -Seconds 2
            $res = (Invoke-WebRequest $url -Headers @{ 'X-Api-Key' = $PetBoxApiKey } -TimeoutSec 10).Content | ConvertFrom-Json
            if ($res.events.Count -ge 1) { return $res.events[0] }
        }
        throw "event containing '$contains' not found in $ClientLog after 30s"
    }

    Step 'e2e: client log event lands in the PetBox clients log' {
        $e = WaitPetBoxEvent $logMarker
        Assert ($e.level -eq 'Warning') "unexpected level $($e.level)"
        Assert ($e.serviceKey -eq 'yobapub-proxy') "unexpected serviceKey $($e.serviceKey)"
    }

    Step 'e2e: playback error lands in the PetBox clients log as Error' {
        $e = WaitPetBoxEvent $errorDomain
        Assert ($e.level -eq 'Error') "unexpected level $($e.level)"
    }
}
else {
    Skip 'e2e: PetBox clients log delivery' 'no -PetBoxApiKey / PETBOX_SMOKE_KEY (needs scope logs:query)'
}

Write-Host ''
Write-Host "passed=$passed failed=$failed skipped=$skipped" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })
exit $(if ($failed -gt 0) { 1 } else { 0 })
