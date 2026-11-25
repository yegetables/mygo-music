#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT_DIR/mobile/android"
WEB_DIR="$ROOT_DIR/mobile/web"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

NDK_DIR="${ANDROID_NDK_HOME:-}"
if [ -z "$NDK_DIR" ]; then
  for v in 28.2.13676358 28.0.13004108 27.0.12077973; do
    if [ -d "$ANDROID_HOME/ndk/$v" ]; then
      NDK_DIR="$ANDROID_HOME/ndk/$v"
      break
    fi
  done
fi
if [ -z "$NDK_DIR" ]; then
  echo "Android NDK not found under $ANDROID_HOME/ndk" >&2
  exit 1
fi

eval "$(bash "$ROOT_DIR/mobile/scripts/version.sh" --bump)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "==> Version: v${APP_VERSION} (versionCode=${VERSION_CODE}, buildTime=${BUILD_TIME})"
echo "==> 1/3 Building mobile/web UI"
(cd "$WEB_DIR" && bun install --frozen-lockfile 2>/dev/null || bun install)
(cd "$WEB_DIR" && bun run build)

echo "==> 2/3 Building Go core (android/arm64 c-shared, v${APP_VERSION})"
OUT_DIR="$ANDROID_DIR/app/src/main/jniLibs/arm64-v8a"
mkdir -p "$OUT_DIR"
CC="$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android31-clang" \
CGO_ENABLED=1 GOOS=android GOARCH=arm64 \
go build -C "$ROOT_DIR" -buildmode=c-shared -ldflags="-s -w -X mygo-music/internal/mobilecore.AppVersion=${APP_VERSION} -X mygo-music/internal/mobilecore.AppBuildTime=${BUILD_TIME}" \
  -o "$OUT_DIR/libmygocore.so" ./mobile/bridge
# Remove generated header from jniLibs so APK packaging stays clean
if [ -f "$OUT_DIR/libmygocore.h" ]; then
  if command -v trash-put >/dev/null 2>&1; then
    trash-put "$OUT_DIR/libmygocore.h"
  else
    mv "$OUT_DIR/libmygocore.h" "/tmp/libmygocore.h.$$"
  fi
fi

echo "==> 3/3 Building Android 12+ APK (v${APP_VERSION})"
cd "$ANDROID_DIR"
if command -v mise >/dev/null 2>&1 && mise ls java 2>/dev/null | grep -q "17\."; then
  JAVA_VER="$(mise ls java | awk '{print $2; exit}')"
  mise x "java@$JAVA_VER" -- ./gradlew assembleRelease "-PappVersion=${APP_VERSION}" "-PappVersionCode=${VERSION_CODE}"
else
  ./gradlew assembleRelease "-PappVersion=${APP_VERSION}" "-PappVersionCode=${VERSION_CODE}"
fi

APK_DIR="$ANDROID_DIR/app/build/outputs/apk/release"
APK_PATH="$APK_DIR/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
  APK_PATH="$APK_DIR/app-release-unsigned.apk"
fi
VERSIONED_APK="$APK_DIR/MyGoMusic-v${APP_VERSION}-Android12-arm64.apk"
cp -f "$APK_PATH" "$VERSIONED_APK"
echo "==> Done: $VERSIONED_APK (also at $APK_PATH)"
