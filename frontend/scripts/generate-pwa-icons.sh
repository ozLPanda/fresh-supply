#!/bin/sh
# Regenerate packaged icons from the GastroFlow master on macOS (sips).
set -eu
public_dir="$(CDPATH= cd -- "$(dirname -- "$0")/../public" && pwd)"
icon="$public_dir/brand/gastroflow-icon.png"
for spec in '192 pwa-192x192.png' '512 pwa-512x512.png' '512 pwa-maskable-512x512.png' '180 apple-touch-icon.png' '64 brand/gastroflow-favicon.png'; do
  set -- $spec
  sips -z "$1" "$1" "$icon" --out "$public_dir/$2" >/dev/null
done
# Embed the pixels so legacy SVG URLs stay self-contained.
{
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>GastroFlow</title><image width="64" height="64" href="data:image/png;base64,'
  base64 < "$public_dir/brand/gastroflow-favicon.png" | tr -d '\n'
  printf '"/></svg>\n'
} > "$public_dir/favicon.svg"
{
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 140 1600 520"><title>GastroFlow</title><image width="1600" height="800" href="data:image/png;base64,'
  base64 < "$public_dir/brand/gastroflow-logo.png" | tr -d '\n'
  printf '"/></svg>\n'
} > "$public_dir/logo-sidebar.svg"
