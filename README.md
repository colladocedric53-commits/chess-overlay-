# Orsted Chess Overlay - Android APK

A premium Android APK wrapper that runs userscript.js on chess.com and lichess.org with Stockfish engine integration.

## Features

- **Site Picker**: Choose between Chess.com and Lichess.org on first launch
- **Desktop Mode Toggle**: Switch between mobile and desktop WebView modes for better performance on low-end devices
- **Auto-Login**: Securely stores license key using EncryptedSharedPreferences
- **HWID Generation**: Native Android HWID generation using FNV-1a hash
- **Stockfish Integration**: Local Stockfish engine runs alongside chess.min.js
- **GM_ Shim**: Full Tampermonkey-style API support (GM_getValue, GM_setValue, GM_xmlhttpRequest)
- **Forced Updates**: Native handling of HTTP 426 responses with blocking dialog

## Setup

### 1. Add Required Assets

Create the following files in `app/src/main/assets/`:
- `userscript.js` - Your main userscript file
- `chess.min.js` - Chess library (auto-downloaded by GitHub Actions)
- `stockfish.js` - Stockfish engine (auto-downloaded by GitHub Actions)

### 2. Add App Icon

Replace the placeholder icon with your custom icon:
1. Create a 512x512 PNG file named `ic_launcher.png`
2. Place it in `app/src/main/res/mipmap-xxxhdpi/`
3. Android Studio will automatically generate other densities, or you can manually add:
   - `mipmap-mdpi/ic_launcher.png` (48x48)
   - `mipmap-hdpi/ic_launcher.png` (72x72)
   - `mipmap-xhdpi/ic_launcher.png` (96x96)
   - `mipmap-xxhdpi/ic_launcher.png` (144x144)
   - `mipmap-xxxhdpi/ic_launcher.png` (192x192 or 512x512)

### 3. Icon Design Specification

The app expects a green lightning-bolt integrated into a chess knight silhouette on a black background. Use the color `#2ecc71` for the green elements and `#000000` for the background.

## Build

### Local Build

```bash
# Clone the repository
git clone https://github.com/colladocedric53-commits/chess-overlay-.git
cd chess-overlay-

# Create assets directory and add files
mkdir -p app/src/main/assets
# Copy userscript.js, chess.min.js, stockfish.js to app/src/main/assets/

# Build debug APK
./gradlew assembleDebug

# APK will be at: app/build/outputs/apk/debug/app-debug.apk
```

### GitHub Actions Build

1. Push your code to the `main` or `build` branch
2. GitHub Actions will automatically:
   - Download chess.min.js and stockfish.js from jsDelivr
   - Build the debug APK
   - Upload it as an artifact
3. Download the APK from the Actions tab -> Artifacts

## Configuration

### License Key Storage

The app uses `EncryptedSharedPreferences` to securely store the license key. The key is automatically injected into the WebView on launch.

### HWID Format

The native HWID is generated using FNV-1a hash from:
- Android ID
- Build.MODEL
- Build.MANUFACTURER
- Build.PRODUCT
- Build.SERIAL

Format: `osd-{16 hex chars}`

### WebView Modes

- **Mobile Mode**: Default WebView settings, optimized for mobile sites
- **Desktop Mode**: Uses desktop Chrome user-agent, enables wide viewport and zoom controls (better for low-end devices like Oppo A5s)

The mode selection is saved in SharedPreferences and persists across app restarts.

## API Contract

The app communicates with your backend at `https://chess-engine-2-66am.onrender.com/api/validate`

### Request Parameters

- `key`: License key
- `hwid`: Device HWID (osd-{16 hex chars})
- `ver`: APK version (from build.gradle)
- `migrate`: Optional, set to 1 for migration requests

### Response Handling

- **HTTP 200**: Success - Parse `expires_at` from JSON body
- **HTTP 401**: Invalid or expired key
- **HTTP 403**: License locked to another device
- **HTTP 426**: Forced update required - Shows native AlertDialog with Telegram support link

## Device Compatibility

- **Minimum SDK**: 24 (Android 7.0)
- **Target SDK**: 34 (Android 14)
- **Tested on**: Oppo A5s (Helio P35, 3GB RAM, Android 8.1)
- **Memory**: Optimized for low-end devices with hardware acceleration enabled

## Project Structure

```
orsted/
├── app/
│   ├── build.gradle.kts
│   └── src/
│       └── main/
│           ├── AndroidManifest.xml
│           ├── java/com/orsted/overlay/
│           │   ├── MainActivity.kt
│           │   ├── SitePickerActivity.kt
│           │   ├── JsBridge.kt
│           │   └── HwidProvider.kt
│           └── res/
│               ├── layout/
│               │   ├── activity_main.xml
│               │   └── activity_picker.xml
│               ├── values/
│               │   ├── colors.xml
│               │   ├── strings.xml
│               │   └── themes.xml
│               └── mipmap-xxxhdpi/
│                   └── ic_launcher.png
│           └── assets/
│               ├── chess.min.js
│               ├── stockfish.js
│               └── userscript.js
├── build.gradle.kts
├── settings.gradle.kts
└── .github/
    └── workflows/
        └── build.yml
```

## Notes

- The userscript is the brain; the APK is just the shell
- Do not modify the userscript logic - it's already configured to work with both mobile and desktop DOM layouts
- The `allowUniversalAccessFromFileURLs` and `allowFileAccessFromFileURLs` settings are required for loading local assets
- Forced updates (HTTP 426) cannot be bypassed and will show a blocking dialog

## Support

Join the Telegram support channel: [https://t.me/orstedph](https://t.me/orstedph)
