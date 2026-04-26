#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BUNDLES="${LOGSCOPE_MACOS_BUNDLES:-app,dmg}"
TARGET="${LOGSCOPE_MACOS_TARGET:-}"
SIGN="${LOGSCOPE_SIGN:-0}"

usage() {
  cat <<'USAGE'
Usage: scripts/package-macos.sh [--bundles app,dmg] [--target universal-apple-darwin] [--sign]

Environment:
  LOGSCOPE_MACOS_BUNDLES  Bundle list passed to Tauri. Default: app,dmg
  LOGSCOPE_MACOS_TARGET   Optional Rust target triple, e.g. universal-apple-darwin
  LOGSCOPE_SIGN           Set to 1 to allow Tauri signing/notarization configuration.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundles)
      BUNDLES="${2:?missing value for --bundles}"
      shift 2
      ;;
    --target)
      TARGET="${2:?missing value for --target}"
      shift 2
      ;;
    --universal)
      TARGET="universal-apple-darwin"
      shift
      ;;
    --sign)
      SIGN="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS packaging must run on macOS. Current platform: $(uname -s)" >&2
  exit 1
fi

for command_name in yarn cargo rustc; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

for icon_path in src-tauri/icons/icon.icns src-tauri/icons/128x128.png src-tauri/icons/32x32.png; do
  if [[ ! -f "$icon_path" ]]; then
    echo "Missing icon asset: $icon_path" >&2
    echo "Regenerate icons with: yarn tauri icon src-tauri/icons/icon.png --output src-tauri/icons" >&2
    exit 1
  fi
done

build_args=(tauri build --ci --bundles "$BUNDLES")
if [[ -n "$TARGET" ]]; then
  build_args+=(--target "$TARGET")
fi
if [[ "$SIGN" != "1" ]]; then
  build_args+=(--no-sign)
fi

echo "Building LogScope for macOS"
echo "Bundles: $BUNDLES"
if [[ -n "$TARGET" ]]; then
  echo "Target: $TARGET"
fi
if [[ "$SIGN" != "1" ]]; then
  echo "Signing: disabled for local test packaging"
fi

yarn "${build_args[@]}"

echo
echo "Generated bundle artifacts:"
find src-tauri/target -maxdepth 6 -path '*/release/bundle/*' \( -name '*.app' -o -name '*.dmg' \) -print | sort
