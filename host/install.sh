#!/usr/bin/env bash
# zpwrchrome native messaging host installer
#
# Writes the NM manifest for Google Chrome / Chromium / Brave / Edge so the
# zpwrchrome extension can connect to the local Rust host.
#
# usage: ./install.sh <chrome-extension-id> [chrome-extension-id ...]
#
# Find the extension ID at chrome://extensions with Developer mode enabled.

set -euo pipefail

HOST_NAME=com.menketechnologies.zpwrchrome
BIN_NAME=zpwr-chrome-host
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -lt 1 ]]; then
    echo "usage: $0 <chrome-extension-id> [chrome-extension-id ...]" >&2
    echo "find IDs at chrome://extensions (Developer mode enabled)" >&2
    exit 1
fi

origins=""
for id in "$@"; do
    if [[ ! "$id" =~ ^[a-p]{32}$ ]]; then
        echo "warn: '$id' does not look like a Chrome extension ID (32 chars a-p)" >&2
    fi
    origins+="    \"chrome-extension://${id}/\""
    if [[ "$id" != "${!#}" ]]; then
        origins+=$',\n'
    fi
done

# Build the host (debug — release builds are opt-in via `cargo build --release`).
(cd "$SCRIPT_DIR" && cargo build)

BIN_SRC="$SCRIPT_DIR/target/debug/$BIN_NAME"
BIN_DST="${HOME}/.local/bin/$BIN_NAME"
mkdir -p "${HOME}/.local/bin"
ln -sf "$BIN_SRC" "$BIN_DST"
echo "binary: $BIN_DST -> $BIN_SRC"

case "$(uname -s)" in
    Darwin)
        nm_dirs=(
            "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
            "${HOME}/Library/Application Support/Chromium/NativeMessagingHosts"
            "${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
            "${HOME}/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
        )
        ;;
    Linux)
        nm_dirs=(
            "${HOME}/.config/google-chrome/NativeMessagingHosts"
            "${HOME}/.config/chromium/NativeMessagingHosts"
            "${HOME}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
            "${HOME}/.config/microsoft-edge/NativeMessagingHosts"
        )
        ;;
    *)
        echo "unsupported os: $(uname -s)" >&2
        exit 1
        ;;
esac

manifest=$(cat <<EOF
{
  "name": "${HOST_NAME}",
  "description": "zpwrchrome native host: pass + downloads",
  "path": "${BIN_DST}",
  "type": "stdio",
  "allowed_origins": [
${origins}
  ]
}
EOF
)

installed=0
for dir in "${nm_dirs[@]}"; do
    parent="$(dirname "$dir")"
    if [[ ! -d "$parent" ]]; then
        continue
    fi
    mkdir -p "$dir"
    printf '%s\n' "$manifest" > "$dir/${HOST_NAME}.json"
    echo "installed: $dir/${HOST_NAME}.json"
    installed=$((installed + 1))
done

if [[ "$installed" -eq 0 ]]; then
    echo "warn: no Chromium-family browser config dirs found — nothing installed" >&2
    exit 2
fi

echo "done. restart the browser if zpwrchrome is already loaded."
