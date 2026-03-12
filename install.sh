#!/usr/bin/env bash
# Rokket GSD — One-line installer for VS Code
# Usage: curl -sL https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.sh | bash
set -e

echo "🚀 Installing Rokket GSD for VS Code..."

# Determine temp directory
TMPDIR="${TMPDIR:-/tmp}"
INSTALL_DIR="$TMPDIR/rokket-gsd-install-$$"

# Clone
git clone --depth 1 https://github.com/Kile-Thomson/Rokket-GSD.git "$INSTALL_DIR" 2>/dev/null
cd "$INSTALL_DIR"

# Install dependencies and build
echo "📦 Installing dependencies..."
npm install --no-audit --no-fund 2>/dev/null

echo "🔨 Building..."
npm run build 2>/dev/null

# Package VSIX
echo "📋 Packaging extension..."
npx vsce package --no-dependencies 2>/dev/null

# Find the built VSIX
VSIX=$(ls -1 *.vsix 2>/dev/null | head -1)
if [ -z "$VSIX" ]; then
  echo "❌ Build failed — no .vsix file produced"
  rm -rf "$INSTALL_DIR"
  exit 1
fi

# Install into VS Code
echo "⚡ Installing $VSIX into VS Code..."
code --install-extension "$VSIX" --force 2>/dev/null

# Cleanup
cd /
rm -rf "$INSTALL_DIR"

echo ""
echo "✅ Rokket GSD installed! Reload VS Code to activate."
echo "   Press Ctrl+Shift+P → 'Rokket GSD: Open' to start."
