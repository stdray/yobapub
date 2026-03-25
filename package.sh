#!/bin/bash
set -e

echo "=== YobaPub .wgt Package ==="

if [ ! -d dist/release ]; then
    echo "ERROR: dist/release not found. Run build.sh first."
    exit 1
fi

rm -f dist/YobaPub.wgt

cd dist/release
zip -r ../YobaPub.wgt ./*
cd ../..

echo ""
echo "=== Package complete ==="
echo "  Widget: dist/YobaPub.wgt"
echo ""
echo "To install on Tizen TV:"
echo "  1. Open Tizen Studio"
echo "  2. File > Import > Tizen > Tizen Web Project from wgt"
echo "  3. Select dist/YobaPub.wgt"
echo "  4. Right-click project > Run As > Tizen Web Application"
echo ""
echo "Or install via CLI:"
echo "  tizen install -n dist/YobaPub.wgt -t <device-name>"
