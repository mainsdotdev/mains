#!/usr/bin/env bash
set -euo pipefail

# The upstream release explicitly supports Xcode/iOS 27. Nothing is copied into
# Mains.app: the Debug simulator loads the bundle from this local Mac app.
version='5.2.1RC5'
sha256='37eae7b0b5d47d908232b9e6691e20a5e3fbc346953df3dc180b8531aa2b4e9c'
destination='/Applications/InjectionIII.app'

if [[ -d "$destination" ]]; then
  echo "InjectionIII is already installed at $destination."
  exit 0
fi

download_dir="$(mktemp -d "${TMPDIR:-/tmp}/mains-hot-reload.XXXXXX")"
trap 'rm -rf "$download_dir"' EXIT
archive="$download_dir/InjectionIII.app.zip"

curl --fail --location --show-error --retry 2 --connect-timeout 15 --max-time 180 \
  "https://github.com/johnno1962/InjectionIII/releases/download/$version/InjectionIII.app.zip" \
  --output "$archive"
printf '%s  %s\n' "$sha256" "$archive" | shasum -a 256 -c -
ditto -x -k "$archive" "$download_dir/unpacked"
codesign --verify --deep --strict "$download_dir/unpacked/InjectionIII.app"
ditto "$download_dir/unpacked/InjectionIII.app" "$destination"

echo "Installed InjectionIII $version. Run Mains in Xcode with Debug and an iPhone simulator."
echo 'The injection bundle starts its own file watcher; the helper app does not need to be opened.'
