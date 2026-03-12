# Rokket GSD — One-line installer for VS Code (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

Write-Host "🚀 Installing Rokket GSD for VS Code..." -ForegroundColor Cyan

$installDir = Join-Path $env:TEMP "rokket-gsd-install-$PID"

# Clone
git clone --depth 1 https://github.com/Kile-Thomson/Rokket-GSD.git $installDir 2>$null
Set-Location $installDir

# Install and build
Write-Host "📦 Installing dependencies..." -ForegroundColor Gray
npm install --no-audit --no-fund 2>$null | Out-Null

Write-Host "🔨 Building..." -ForegroundColor Gray
npm run build 2>$null | Out-Null

# Package
Write-Host "📋 Packaging extension..." -ForegroundColor Gray
npx vsce package --no-dependencies 2>$null | Out-Null

$vsix = Get-ChildItem *.vsix | Select-Object -First 1
if (-not $vsix) {
    Write-Host "❌ Build failed — no .vsix file produced" -ForegroundColor Red
    Remove-Item -Recurse -Force $installDir
    exit 1
}

# Install
Write-Host "⚡ Installing $($vsix.Name) into VS Code..." -ForegroundColor Yellow
code --install-extension $vsix.FullName --force 2>$null

# Cleanup
Set-Location $env:USERPROFILE
Remove-Item -Recurse -Force $installDir

Write-Host ""
Write-Host "✅ Rokket GSD installed! Reload VS Code to activate." -ForegroundColor Green
Write-Host "   Press Ctrl+Shift+P → 'Rokket GSD: Open' to start." -ForegroundColor Gray
