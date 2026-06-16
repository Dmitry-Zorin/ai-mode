#!/usr/bin/env bash
# Собираем иконки приложения для macOS из build/icon.png — и только их.
# `tauri icon` всегда плодит ещё Android/iOS/Windows, которые мы не поставляем,
# поэтому .icns строим сами через системные sips + iconutil.
#
# build/icon.png — это 1024x1024 PNG, уже в форме скруглённого macOS-сквиркла с
# прозрачными полями (рантайм не накладывает маску, форма должна быть в исходнике).
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="build/icon.png"
OUT="src-tauri/icons"
TMP="$(mktemp -d)"
ICONSET="${TMP}/icon.iconset"
mkdir -p "$ICONSET"
trap 'rm -rf "$TMP"' EXIT

echo "▶ Generating macOS icons from ${SRC}…"

# Слои .icns: размер -> имя в iconset.
for spec in \
  "16:icon_16x16.png"    "32:icon_16x16@2x.png" \
  "32:icon_32x32.png"    "64:icon_32x32@2x.png" \
  "128:icon_128x128.png" "256:icon_128x128@2x.png" \
  "256:icon_256x256.png" "512:icon_256x256@2x.png" \
  "512:icon_512x512.png" "1024:icon_512x512@2x.png"; do
  size="${spec%%:*}"; name="${spec##*:}"
  sips -z "$size" "$size" "$SRC" --out "$ICONSET/$name" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"

# Отдельные PNG из tauri.conf.json (default_window_icon + иконка в доке для dev).
sips -z 32 32   "$SRC" --out "$OUT/32x32.png"      >/dev/null
sips -z 128 128 "$SRC" --out "$OUT/128x128.png"    >/dev/null
sips -z 256 256 "$SRC" --out "$OUT/128x128@2x.png" >/dev/null
sips -z 512 512 "$SRC" --out "$OUT/icon.png"       >/dev/null

echo "✔ Wrote icon.icns + PNGs to ${OUT}/ (macOS only)."
