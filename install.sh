#!/usr/bin/env bash
# Rokket GSD — Installer for VS Code / code-server
# Usage:
#   curl -sL https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.sh | bash
#
# For private repo access, set GITHUB_TOKEN first:
#   export GITHUB_TOKEN=ghp_your_token_here
#   curl -sH "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.sh | bash
set -e

echo "🚀 Installing Rokket GSD..."
echo ""

# ---- Pre-flight checks ----
if ! command -v git &>/dev/null; then
  echo "❌ git is not installed. Please install git first."
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "❌ npm is not installed. Please install Node.js 18+ from https://nodejs.org"
  exit 1
fi

# Detect VS Code CLI: prefer 'code', fall back to 'code-server'
VSCODE_CLI=""
if command -v code &>/dev/null; then
  VSCODE_CLI="code"
elif command -v code-server &>/dev/null; then
  VSCODE_CLI="code-server"
else
  echo "❌ Neither 'code' (VS Code) nor 'code-server' found in PATH."
  echo "   VS Code:       Open VS Code → Cmd+Shift+P → 'Shell Command: Install code command in PATH'"
  echo "   code-server:   https://github.com/coder/code-server"
  exit 1
fi
echo "   Using CLI: $VSCODE_CLI"

# ---- Clone ----
TMPDIR="${TMPDIR:-/tmp}"
INSTALL_DIR="$TMPDIR/rokket-gsd-install-$$"

echo "📥 Cloning repository..."
CLONE_URL="https://github.com/Kile-Thomson/Rokket-GSD.git"

# If GITHUB_TOKEN is set, use it for private repo access
if [ -n "$GITHUB_TOKEN" ]; then
  CLONE_URL="https://${GITHUB_TOKEN}@github.com/Kile-Thomson/Rokket-GSD.git"
fi

if ! git clone --depth 1 "$CLONE_URL" "$INSTALL_DIR" 2>&1; then
  echo ""
  echo "❌ Failed to clone the repository."
  echo "   If the repo is private, set your GitHub token:"
  echo "   export GITHUB_TOKEN=ghp_your_token_here"
  echo "   Then re-run this script."
  exit 1
fi
cd "$INSTALL_DIR"

# ---- Build ----
echo "📦 Installing dependencies..."
if ! npm install --no-audit --no-fund 2>&1; then
  echo "❌ npm install failed. Check the output above."
  rm -rf "$INSTALL_DIR"
  exit 1
fi

echo "🔨 Building..."
if ! npm run build 2>&1; then
  echo "❌ Build failed. Check the output above."
  rm -rf "$INSTALL_DIR"
  exit 1
fi

echo "📋 Packaging extension..."
if ! npx @vscode/vsce package --no-dependencies 2>&1; then
  echo "❌ VSIX packaging failed. Check the output above."
  rm -rf "$INSTALL_DIR"
  exit 1
fi

# ---- Install ----
VSIX=$(ls -1 *.vsix 2>/dev/null | head -1)
if [ -z "$VSIX" ]; then
  echo "❌ No .vsix file produced."
  rm -rf "$INSTALL_DIR"
  exit 1
fi

echo "⚡ Installing $VSIX via $VSCODE_CLI..."
if ! "$VSCODE_CLI" --install-extension "$VSIX" --force 2>&1; then
  echo "❌ Extension install failed."
  rm -rf "$INSTALL_DIR"
  exit 1
fi

# ---- Cleanup ----
cd /
rm -rf "$INSTALL_DIR"

echo ""
echo "✅ Rokket GSD installed!"
echo ""

# ---- Check GSD dependency ----
if ! command -v gsd &>/dev/null; then
  echo "⚠️  GSD CLI (gsd-pi) is not installed."
  echo "   Install it with: npm install -g gsd-pi"
  echo "   Then run 'gsd' once in a terminal to set up authentication."
  echo ""
fi

echo "   Reload VS Code / code-server to activate the extension."
echo "   Press Ctrl+Shift+P → 'Rokket GSD: Open' to start."
