#!/usr/bin/env bash
# Build "AI Mode.app" and install it into /Applications, then launch it.
# Local "Path 1" convenience: no DMG, no dragging, no auto-updater.
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="AI Mode"
BUILT="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
DEST="/Applications/${APP_NAME}.app"

echo "▶ Building ${APP_NAME}.app (app bundle only — skipping the DMG)…"
CI=true bunx tauri build --bundles app

echo "▶ Quitting ${APP_NAME} if it is running…"
# Force-terminate the installed instance by its binary path. We deliberately do
# NOT use AppleScript `quit app`: it needs macOS Automation (TCC) permission and
# silently no-ops without it, after which `open` merely re-activates the stale
# instance instead of relaunching — i.e. "it didn't restart, still old version".
pkill -f "${DEST}/Contents/MacOS/" 2>/dev/null || true
# Wait until it's actually gone (up to ~3s) before swapping the bundle.
for _ in 1 2 3 4 5 6; do
  pgrep -f "${DEST}/Contents/MacOS/" >/dev/null 2>&1 || break
  sleep 0.5
done

echo "▶ Replacing ${DEST}…"
rm -rf "${DEST}"
ditto "${BUILT}" "${DEST}"

echo "▶ Launching ${DEST}…"
# `open` can transiently fail with LS error -600 right after a kill; retry briefly.
for _ in 1 2 3; do open "${DEST}" 2>/dev/null && break; sleep 1; done

echo "✔ Installed and launched ${DEST}"
