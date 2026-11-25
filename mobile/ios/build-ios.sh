#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
IOS_DIR="$ROOT_DIR/mobile/ios"
WEB_DIR="$ROOT_DIR/mobile/web"
VENDOR_DIR="$IOS_DIR/Vendor"
BUILD_DIR="$IOS_DIR/build"
eval "$(bash "$ROOT_DIR/mobile/scripts/version.sh" --bump)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT_IPA="$BUILD_DIR/MyGoMusic-v${APP_VERSION}-iPadOS17-arm64.ipa"

echo "==> Version: v${APP_VERSION} (MARKETING_VERSION=${BASE_VERSION}, CFBundleVersion=${VERSION_CODE}, buildTime=${BUILD_TIME})"
echo "==> 1/4 Building mobile/web UI"
(cd "$WEB_DIR" && bun install --frozen-lockfile 2>/dev/null || bun install)
(cd "$WEB_DIR" && bun run build)

echo "==> 2/4 Building Go core (ios/arm64 c-archive)"
mkdir -p "$VENDOR_DIR" "$BUILD_DIR"
SDKROOT="$(xcrun --sdk iphoneos --show-sdk-path)"
CC="$(xcrun --sdk iphoneos --find clang)"

CGO_ENABLED=1 \
GOOS=ios \
GOARCH=arm64 \
CC="$CC" \
CGO_CFLAGS="-isysroot $SDKROOT -arch arm64 -mios-version-min=17.0" \
CGO_LDFLAGS="-isysroot $SDKROOT -arch arm64 -mios-version-min=17.0" \
go build -C "$ROOT_DIR" -buildmode=c-archive -ldflags="-s -w -X mygo-music/internal/mobilecore.AppVersion=${APP_VERSION} -X mygo-music/internal/mobilecore.AppBuildTime=${BUILD_TIME}" \
  -o "$VENDOR_DIR/libmygocore.a" ./mobile/bridge

echo "==> 3/4 Generating Xcode project and compiling .app"
cd "$IOS_DIR"
xcodegen generate

xcodebuild \
  -project MyGoMusic.xcodeproj \
  -scheme MyGoMusic \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  MARKETING_VERSION="$BASE_VERSION" \
  CURRENT_PROJECT_VERSION="$VERSION_CODE" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

APP_PATH="$BUILD_DIR/DerivedData/Build/Products/Release-iphoneos/MyGoMusic.app"
if [ ! -d "$APP_PATH" ]; then
  echo "Built .app not found at $APP_PATH" >&2
  exit 1
fi

echo "==> 4/4 Packaging unsigned/iloader-ready .ipa"
STAGE_DIR="$BUILD_DIR/ipa-stage"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/Payload"
cp -R "$APP_PATH" "$STAGE_DIR/Payload/MyGoMusic.app"

# Apply ad-hoc signature when ldid is available so both iloader re-signing and
# jailbroken TrollStore Lite / AppSync installations work seamlessly.
if command -v ldid >/dev/null 2>&1; then
  ldid -S "$STAGE_DIR/Payload/MyGoMusic.app/MyGoMusic" || true
fi

(cd "$STAGE_DIR" && zip -qry "$OUT_IPA" Payload)
echo "==> Done: $OUT_IPA"
ls -lh "$OUT_IPA"
