#!/bin/bash

# Local build script for Orsted Chess Overlay APK
# Run this on Linux/macOS or WSL

set -e

echo "=== Orsted Chess Overlay - Local Build ==="
echo ""

# Check for Java
echo "Checking Java installation..."
if ! command -v java &> /dev/null; then
    echo "ERROR: Java is not installed or not in PATH"
    echo "Please install Java 17 or later"
    exit 1
fi

JAVA_VERSION=$(java -version 2>&1 | head -1 | cut -d'"' -f2)
echo "Java version: $JAVA_VERSION"

# Check for gradle wrapper
echo ""
echo "Checking gradle wrapper..."
if [ ! -f ./gradlew ]; then
    echo "ERROR: gradlew not found"
    exit 1
fi

chmod +x ./gradlew

# Create assets directory
mkdir -p app/src/main/assets

# Download chess.min.js
echo ""
echo "Downloading chess.min.js..."
if command -v curl &> /dev/null; then
    curl -L -o app/src/main/assets/chess.min.js https://cdn.jsdelivr.net/npm/chess.js@0.13.0/dist/chess.min.js
elif command -v wget &> /dev/null; then
    wget -O app/src/main/assets/chess.min.js https://cdn.jsdelivr.net/npm/chess.js@0.13.0/dist/chess.min.js
else
    echo "ERROR: Neither curl nor wget found. Please install one of them."
    exit 1
fi

# Download stockfish.js
echo "Downloading stockfish.js..."
if command -v curl &> /dev/null; then
    curl -L -o app/src/main/assets/stockfish.js https://cdn.jsdelivr.net/npm/stockfish.js@11.0.2/dist/stockfish.min.js
else
    wget -O app/src/main/assets/stockfish.js https://cdn.jsdelivr.net/npm/stockfish.js@11.0.2/dist/stockfish.min.js
fi

# Check if userscript.js exists
if [ ! -f app/src/main/assets/userscript.js ]; then
    echo ""
    echo "WARNING: userscript.js not found in app/src/main/assets/"
    echo "Please add your userscript.js file before building"
    exit 1
fi

# Check if icon exists
if [ ! -f app/src/main/res/mipmap-xxxhdpi/ic_launcher.png ]; then
    echo ""
    echo "WARNING: ic_launcher.png not found in app/src/main/res/mipmap-xxxhdpi/"
    echo "Please add your icon file before building"
    exit 1
fi

echo ""
echo "Building APK..."
./gradlew assembleDebug

echo ""
echo "=== Build Complete ==="
echo "APK location: app/build/outputs/apk/debug/app-debug.apk"
