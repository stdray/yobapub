#!/bin/bash
set -e

echo "=== YobaPub Build ==="

echo "[1/3] Installing dependencies..."
npm install

echo "[2/3] Type checking..."
npx tsc --noEmit

echo "[3/3] Building dev + release..."
npx webpack --mode development
npx webpack --mode production

echo ""
echo "=== Build complete ==="
echo "  Dev:     dist/dev/"
echo "  Release: dist/release/"
