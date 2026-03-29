$ErrorActionPreference = 'Stop'

Write-Host '=== YobaPub Build ==='

Write-Host '[1/3] Installing dependencies...'
npm install
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: npm install'; exit 1 }

Write-Host '[2/3] Type checking...'
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: typecheck'; exit 1 }

Write-Host '[3/3] Building dev + release...'
npx webpack --mode development
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: dev build'; exit 1 }

npx webpack --mode production
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: release build'; exit 1 }

Write-Host ''
Write-Host '=== Build complete ==='
Write-Host '  Dev:     dist/dev/'
Write-Host '  Release: dist/release/'
