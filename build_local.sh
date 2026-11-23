#!/bin/bash

# Local build script for Orsted Chess Overlay APK
# Run this on Linux/macOS or WSL

set -e

echo "=== Orsted Chess Overlay - Local Build ==="
echo ""

echo "Checking Java installation..."
if ! command -v java &> /dev/null; then
    echo "ERROR: Java is not installed or not in PATH"
    echo "Please install Java 17 or later"
    exit 1
fi

JAVA_VERSION=$(java -version 2>&1 | head -1 | cut -d'"' -f2)
echo "Java version: $JAVA_VERSION"

echo ""
echo "Checking gradle wrapper..."
if [ ! -f ./gradlew ]; then
    echo "ERROR: gradlew not found"
    exit 1
fi

chmod +x ./gradlew
mkdir -p app/src/main/assets

echo ""
echo "Downloading chess.min.js..."
curl --fail --location --retry 3 -o app/src/main/assets/chess.min.js https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js

echo "Downloading stockfish.js..."
curl --fail --location --retry 3 -o app/src/main/assets/stockfish.js https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js

if [ ! -f app/src/main/assets/userscript.js ]; then
    echo ""
    echo "ERROR: userscript.js not found in app/src/main/assets/"
    exit 1
fi

if [ ! -f app/src/main/res/mipmap-xxxhdpi/ic_launcher.png ]; then
    echo ""
    echo "ERROR: ic_launcher.png not found in app/src/main/res/mipmap-xxxhdpi/"
    exit 1
fi

echo ""
echo "Building APK..."
./gradlew assembleDebug

echo ""
echo "=== Build Complete ==="
echo "APK location: app/build/outputs/apk/debug/app-debug.apk"
