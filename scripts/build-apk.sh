#!/usr/bin/env bash
set -e

echo "=== [1/6] Installing OpenJDK 21 & tools (low-memory mode) ==="
if ! command -v java &> /dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends openjdk-21-jdk-headless unzip wget ca-certificates
  apt-get clean
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
fi
java -version
free -m

echo "=== [2/6] Setting up Android SDK (platforms;android-36 & build-tools;35.0.0) ==="
export ANDROID_HOME="/opt/android-sdk"
mkdir -p "$ANDROID_HOME"

if [ ! -d "$ANDROID_HOME/platforms/android-36" ]; then
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmdline-tools.zip
  unzip -q /tmp/cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"
  rm -f /tmp/cmdline-tools.zip
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"

  yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses > /dev/null 2>&1 || true
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" "platforms;android-36" "build-tools;35.0.0"

  # Remove cmdline-tools and temp archives after SDK installation to free ~200MB RAM
  rm -rf "$ANDROID_HOME/cmdline-tools" "$ANDROID_HOME/.temp"
fi
free -m

echo "=== [3/6] Building Web App & Syncing Capacitor ==="
cd /app/applet
rm -f /app/applet/public/tot-stock.apk /app/applet/dist/tot-stock.apk
echo "sdk.dir=$ANDROID_HOME" > /app/applet/android/local.properties
npm run build
npx cap sync android
free -m

echo "=== [4/6] Verifying Release Keystore & Building Release APK ==="
if [ -z "$ANDROID_KEYSTORE_PATH" ] || [ -z "$ANDROID_KEYSTORE_PASSWORD" ] || [ -z "$ANDROID_KEY_ALIAS" ] || [ -z "$ANDROID_KEY_PASSWORD" ]; then
  echo "ERREUR : Les variables d'environnement ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS et ANDROID_KEY_PASSWORD sont obligatoires pour compiler l'APK Release."
  exit 1
fi

if [ ! -f "$ANDROID_KEYSTORE_PATH" ]; then
  echo "ERREUR : Le fichier keystore spécifié par ANDROID_KEYSTORE_PATH ($ANDROID_KEYSTORE_PATH) est introuvable."
  exit 1
fi

chmod +x /app/applet/android/gradlew
export ANDROID_HOME="/opt/android-sdk"
export GRADLE_OPTS="-Xmx64m -Dorg.gradle.daemon=false"
/app/applet/android/gradlew -p /app/applet/android :app:assembleRelease --no-daemon --max-workers=1 --console=plain

echo "=== [5/6] Copying Signed Release APK to public & dist ==="
APK_SOURCE="/app/applet/android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK_SOURCE" ]; then
  mkdir -p /app/applet/public /app/applet/dist
  cp "$APK_SOURCE" /app/applet/public/tot-stock.apk
  cp "$APK_SOURCE" /app/applet/dist/tot-stock.apk
  cp "$APK_SOURCE" /app/applet/tot-stock.apk
  echo "SUCCESS! Signed Release APK built and copied to /app/applet/public/tot-stock.apk"
  ls -lh /app/applet/public/tot-stock.apk
else
  echo "ERROR: Release APK file not found at $APK_SOURCE"
  exit 1
fi

echo "=== [6/6] Cleaning temporary build caches to free container RAM ==="
rm -rf /root/.gradle /opt/android-sdk /app/applet/android/app/build /app/applet/android/.gradle
free -m
echo "=== DONE ==="
