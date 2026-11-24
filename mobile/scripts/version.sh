#!/usr/bin/env bash
set -euo pipefail

# Resolves mobile app version and monotonically increasing dev build number.
# Usage:
#   eval "$(bash mobile/scripts/version.sh --bump)"     # local builds: increments mobile/BUILD_VERSION
#   eval "$(bash mobile/scripts/version.sh --current)"  # CI / read-only: reads committed mobile/BUILD_VERSION
#
# If APP_VERSION is already set in the environment (e.g. release tag v0.1.26),
# it is preserved verbatim without touching mobile/BUILD_VERSION.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_FILE="$ROOT_DIR/mobile/BUILD_VERSION"

MODE="current"
for arg in "$@"; do
  case "$arg" in
    --bump) MODE="bump" ;;
    --current) MODE="current" ;;
  esac
done

# Respect NO_BUMP=1 or CI=true so automated CI builds match the committed version.
if [ "${NO_BUMP:-0}" = "1" ] || [ "${CI:-false}" = "true" ]; then
  MODE="current"
fi

CONFIG_BASE="$(sed -n 's/.*version: "\([^"]*\)".*/\1/p' "$ROOT_DIR/mygo.config.ts" | head -n 1)"
CONFIG_BASE="${CONFIG_BASE:-0.1.25}"

parse_version_code() {
  local ver="$1"
  local base="${ver%%[-+]*}"
  base="${base#v}"
  local major=0 minor=0 patch=0 dev=0
  IFS='.' read -r major minor patch _ <<< "$base"
  major="${major//[^0-9]/}"; major="${major:-0}"
  minor="${minor//[^0-9]/}"; minor="${minor:-0}"
  patch="${patch//[^0-9]/}"; patch="${patch:-0}"
  if [[ "$ver" =~ -dev[.-]([0-9]+) ]]; then
    dev=$((10#${BASH_REMATCH[1]}))
  fi
  echo $(( major * 100000000 + minor * 1000000 + patch * 10000 + dev ))
}

if [ -n "${APP_VERSION:-}" ]; then
  FULL_VER="${APP_VERSION#v}"
  BASE_VER="${FULL_VER%%[-+]*}"
  BUILD_NUM=0
  if [[ "$FULL_VER" =~ -dev[.-]([0-9]+) ]]; then
    BUILD_NUM=$((10#${BASH_REMATCH[1]}))
  fi
else
  FILE_BASE=""
  FILE_BUILD=0
  if [ -f "$STATE_FILE" ]; then
    FILE_BASE="$(sed -n 's/^BASE=//p' "$STATE_FILE" | head -n 1 | tr -d '[:space:]')"
    FILE_BUILD="$(sed -n 's/^BUILD=//p' "$STATE_FILE" | head -n 1 | tr -d '[:space:]')"
    FILE_BUILD="${FILE_BUILD:-0}"
  fi

  BASE_VER="$CONFIG_BASE"
  if [ "$FILE_BASE" != "$BASE_VER" ]; then
    BUILD_NUM=0
  else
    BUILD_NUM=$((10#$FILE_BUILD))
  fi

  if [ "$MODE" = "bump" ]; then
    BUILD_NUM=$((BUILD_NUM + 1))
    printf 'BASE=%s\nBUILD=%d\n' "$BASE_VER" "$BUILD_NUM" > "$STATE_FILE"
  elif [ "$BUILD_NUM" -le 0 ]; then
    BUILD_NUM=1
  fi

  FULL_VER="$(printf '%s-dev-%04d' "$BASE_VER" "$BUILD_NUM")"
fi

VER_CODE="$(parse_version_code "$FULL_VER")"

printf 'APP_VERSION=%q\n' "$FULL_VER"
printf 'BASE_VERSION=%q\n' "$BASE_VER"
printf 'BUILD_NUMBER=%q\n' "$BUILD_NUM"
printf 'VERSION_CODE=%q\n' "$VER_CODE"
