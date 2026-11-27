#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ ${1:-} == --legacy ]]; then shift; exec bash "$SOURCE_DIR/tools/install-legacy.sh" "$@"; fi
if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  echo 'Usage: bash install.sh [--root PATH] [--port PORT] [--ray NAME] [--agent claude-code|codex|claude-desktop] | --uninstall [--purge] | --legacy ...'; exit 0
fi
managed="$HOME/.arpe"
if [[ ${1:-} == --uninstall && ! -f "$managed/settings.json" ]]; then
  # A failed bootstrap may have created just the managed Bun directory.
  if [[ -f "$managed/.bootstrap-owned" ]]; then rm -rf -- "$managed"; fi
  echo 'No installed board'; exit 0
fi
if [[ -e "$managed" && ! -f "$managed/settings.json" && ! -f "$managed/.bootstrap-owned" ]]; then
  echo "Existing unmanaged installation directory: $managed" >&2; exit 1
fi
if [[ ${RAY_RUNTIME:-bun} == node ]]; then
  command -v node >/dev/null || { echo 'Node 22.13+ required for explicit fallback' >&2; exit 1; }
  exec node --experimental-strip-types --disable-warning=ExperimentalWarning "$SOURCE_DIR/board/src/install.ts" "$@"
fi
if command -v bun >/dev/null; then runtime=$(command -v bun)
elif [[ -x "$managed/bun/bin/bun" ]]; then runtime="$managed/bun/bin/bun"
elif [[ -x "$HOME/.bun/bin/bun" ]]; then runtime="$HOME/.bun/bin/bun"
else
  if [[ ${1:-} == --uninstall ]]; then echo 'Bun missing; use RAY_RUNTIME=node if Node 22 is installed' >&2; exit 1; fi
  if [[ ! -e "$managed" ]]; then mkdir -p "$managed"; touch "$managed/.bootstrap-owned"; fi
  temp=$(mktemp -d); trap 'rm -rf -- "$temp"' EXIT
  echo 'Installing Bun into the managed installation directory...'
  # Download the official archive directly: the upstream shell installer edits
  # shell profiles, whereas we need a fully reversible, isolated install.
  case "$(uname -s):$(uname -m)" in
    Linux:x86_64) target=linux-x64; [[ ! -f /etc/alpine-release ]] || target+=-musl; target+=-baseline ;;
    Linux:aarch64|Linux:arm64) target=linux-aarch64; [[ ! -f /etc/alpine-release ]] || target+=-musl ;;
    Darwin:x86_64) target=darwin-x64-baseline ;;
    Darwin:arm64) target=darwin-aarch64 ;;
    *) echo 'Unsupported platform; install Bun manually and rerun.' >&2; exit 1 ;;
  esac
  command -v unzip >/dev/null || { echo 'unzip is required to install Bun' >&2; exit 1; }
  curl --fail --silent --show-error --location --connect-timeout 15 --max-time 180 \
    "https://github.com/oven-sh/bun/releases/latest/download/bun-$target.zip" -o "$temp/bun.zip"
  unzip -q "$temp/bun.zip" -d "$temp"
  mkdir -p "$managed/bun/bin"
  runtime="$managed/bun/bin/bun"
  cp "$temp/bun-$target/bun" "$runtime"
  chmod 755 "$runtime"
fi
"$runtime" "$SOURCE_DIR/board/src/install.ts" "$@"
