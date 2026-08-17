$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=================================================="
Write-Host "EduSearch AI - Full Backend Local Start"
Write-Host "=================================================="

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22.13 or newer is required."
}

$nodeVersion = node -p "process.versions.node"
Write-Host "Node: $nodeVersion"
if ([version]$nodeVersion -lt [version]"22.13.0") {
  throw "Node.js 22.13 or newer is required. Installed: $nodeVersion"
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install --legacy-peer-deps --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
}

npm run setup
if ($LASTEXITCODE -ne 0) { throw "Setup failed." }

npm run dev
if ($LASTEXITCODE -ne 0) { throw "EduSearch AI stopped with an error." }
