# Rokket GSD — Installer for VS Code / code-server (Windows PowerShell)
# Usage:
#   irm https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.ps1 | iex
#
# For private repo access, set GITHUB_TOKEN first:
#   $env:GITHUB_TOKEN = "ghp_your_token_here"
#   irm "https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.ps1" | iex
$ErrorActionPreference = "Stop"

Write-Host "🚀 Installing Rokket GSD..." -ForegroundColor Cyan
Write-Host ""

# ---- Pre-flight checks ----
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ git is not installed. Please install git first." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "❌ npm is not installed. Please install Node.js 18+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Detect VS Code CLI: prefer 'code', fall back to 'code-server'
$vscodeCli = $null
if (Get-Command code -ErrorAction SilentlyContinue) {
    $vscodeCli = "code"
} elseif (Get-Command code-server -ErrorAction SilentlyContinue) {
    $vscodeCli = "code-server"
} else {
    Write-Host "❌ Neither 'code' (VS Code) nor 'code-server' found in PATH." -ForegroundColor Red
    Write-Host "   VS Code:       Open VS Code → Ctrl+Shift+P → 'Shell Command: Install code command in PATH'" -ForegroundColor Gray
    Write-Host "   code-server:   https://github.com/coder/code-server" -ForegroundColor Gray
    exit 1
}
Write-Host "   Using CLI: $vscodeCli" -ForegroundColor Gray

# ---- Clone ----
$installDir = Join-Path $env:TEMP "rokket-gsd-install-$PID"

Write-Host "📥 Cloning repository..." -ForegroundColor Gray

$cloneUrl = "https://github.com/Kile-Thomson/Rokket-GSD.git"
if ($env:GITHUB_TOKEN) {
    $cloneUrl = "https://$($env:GITHUB_TOKEN)@github.com/Kile-Thomson/Rokket-GSD.git"
}

try {
    $output = git clone --depth 1 $cloneUrl $installDir 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Clone failed" }
} catch {
    Write-Host ""
    Write-Host "❌ Failed to clone the repository." -ForegroundColor Red
    Write-Host "   If the repo is private, set your GitHub token:" -ForegroundColor Yellow
    Write-Host '   $env:GITHUB_TOKEN = "ghp_your_token_here"' -ForegroundColor Gray
    Write-Host "   Then re-run this script." -ForegroundColor Yellow
    exit 1
}

Set-Location $installDir

# ---- Build ----
Write-Host "📦 Installing dependencies..." -ForegroundColor Gray
$output = npm install --no-audit --no-fund 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ npm install failed:" -ForegroundColor Red
    Write-Host $output
    Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "🔨 Building..." -ForegroundColor Gray
$output = npm run build 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed:" -ForegroundColor Red
    Write-Host $output
    Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "📋 Packaging extension..." -ForegroundColor Gray
$output = npx @vscode/vsce package --no-dependencies 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ VSIX packaging failed:" -ForegroundColor Red
    Write-Host $output
    Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
    exit 1
}

# ---- Install ----
$vsix = Get-ChildItem *.vsix | Select-Object -First 1
if (-not $vsix) {
    Write-Host "❌ No .vsix file produced." -ForegroundColor Red
    Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "⚡ Installing $($vsix.Name) via $vscodeCli..." -ForegroundColor Yellow
$output = & $vscodeCli --install-extension $vsix.FullName --force 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Extension install failed:" -ForegroundColor Red
    Write-Host $output
    Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
    exit 1
}

# ---- Cleanup ----
Set-Location $env:USERPROFILE
Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "✅ Rokket GSD installed!" -ForegroundColor Green
Write-Host ""

# ---- Check GSD dependency ----
if (-not (Get-Command gsd -ErrorAction SilentlyContinue)) {
    Write-Host "⚠️  GSD CLI (gsd-pi) is not installed." -ForegroundColor Yellow
    Write-Host "   Install it with: npm install -g gsd-pi" -ForegroundColor Gray
    Write-Host "   Then run 'gsd' once in a terminal to set up authentication." -ForegroundColor Gray
    Write-Host ""
}

Write-Host "   Reload VS Code / code-server to activate the extension." -ForegroundColor Gray
Write-Host "   Press Ctrl+Shift+P → 'Rokket GSD: Open' to start." -ForegroundColor Gray
