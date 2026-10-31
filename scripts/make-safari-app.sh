#!/usr/bin/env bash
#
# Wrap this extension in a real macOS app so Safari installs it permanently,
# instead of loading it every session via Develop > Add Temporary Extension.
#
# Requires full Xcode (not just Command Line Tools), because it uses Apple's
# converter for Safari web extensions.
#
#   ./scripts/make-safari-app.sh
#
# Apple's converter bundles *every* file it finds in the folder it is pointed
# at. Pointing it at the repo root would ship node_modules, test/, docs/ and the
# npm manifests inside the extension, so this stages just the files the
# extension actually needs into a temp directory first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$(cd "${REPO_ROOT}/.." && pwd)/autokosten-berekenaar-safari"
APP_NAME="Autokosten Berekenaar"
BUNDLE_ID="nl.jortdejong.autokosten-berekenaar"

# Everything the extension needs at runtime. Keep in sync with manifest.json.
EXTENSION_FILES=(
  manifest.json
  background.js
  content
  utils
  popup
  icons
)

# --- Find the converter (Apple renamed it in newer Xcode) -------------------

CONVERTER=""
for candidate in safari-web-extension-converter safari-web-extension-packager; do
  if xcrun --find "${candidate}" >/dev/null 2>&1; then
    CONVERTER="${candidate}"
    break
  fi
done

if [[ -z "${CONVERTER}" ]]; then
  if ! xcode-select -p 2>/dev/null | grep -q "Xcode.app"; then
    echo "error: full Xcode is required, but the active developer directory is:" >&2
    echo >&2
    echo "    $(xcode-select -p 2>/dev/null || echo '(onbekend)')" >&2
    echo >&2
    # Quoted heredoc: keeps the backticks literal rather than running them.
    cat >&2 <<'MSG'
The Safari web extension converter ships with Xcode and is not part of the
Command Line Tools.

  1. Install Xcode from the App Store (or developer.apple.com/download).
  2. Point the toolchain at it:

       sudo xcode-select -s /Applications/Xcode.app
       sudo xcodebuild -runFirstLaunch

  3. Re-run this script.
MSG
  else
    cat >&2 <<MSG
error: Xcode is active, but neither the converter nor the packager was found.

Tried: safari-web-extension-converter, safari-web-extension-packager

Finish the Xcode first-launch setup, then re-run:

    sudo xcodebuild -runFirstLaunch
MSG
  fi
  exit 1
fi

if [[ -e "${OUT_DIR}" ]]; then
  cat >&2 <<MSG
error: ${OUT_DIR} already exists.

Remove it first if you want to regenerate:

    rm -rf "${OUT_DIR}"
MSG
  exit 1
fi

# --- Stage the extension ----------------------------------------------------

STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/autokosten-ext.XXXXXX")"
# Clean up the staging directory however we exit.
trap 'rm -rf "${STAGE_DIR}"' EXIT

for item in "${EXTENSION_FILES[@]}"; do
  if [[ ! -e "${REPO_ROOT}/${item}" ]]; then
    echo "error: ${item} is missing from the repo but listed in EXTENSION_FILES" >&2
    exit 1
  fi
  cp -R "${REPO_ROOT}/${item}" "${STAGE_DIR}/"
done

echo "Staged extension files:"
( cd "${STAGE_DIR}" && find . -maxdepth 1 -mindepth 1 | sed 's|^\./|  |' | sort )
echo "  (total: $(du -sh "${STAGE_DIR}" | cut -f1))"
echo

# --- Convert ----------------------------------------------------------------

echo "Converting into an Xcode project…"
echo "  converter: ${CONVERTER}"
echo "  output:    ${OUT_DIR}"
echo

# --copy-resources copies the staged files into the project, rather than
# referencing the temp directory that is about to be deleted.
xcrun "${CONVERTER}" "${STAGE_DIR}" \
  --project-location "${OUT_DIR}" \
  --app-name "${APP_NAME}" \
  --bundle-identifier "${BUNDLE_ID}" \
  --swift \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt

cat <<MSG

Done. Next:

  1. Open the project:

       open "${OUT_DIR}/${APP_NAME}/${APP_NAME}.xcodeproj"

  2. In Xcode: select the project, open Signing & Capabilities, and choose your
     team under Signing. A free Apple ID works for personal use.

  3. Press Run (⌘R). The app launches once and installs the extension.

  4. In Safari: Settings > Extensions, then enable "Autokosten Berekenaar".

The extension now survives quitting Safari, and you can turn
"Allow unsigned extensions" back off.

Note: the extension files were COPIED into the project. After changing the
extension's JS/CSS/manifest, re-run this script (deleting ${OUT_DIR} first)
or edit the copies inside the Xcode project.

To share the app with others you need a paid Apple Developer account
(\$99/year) to sign and notarise it.
MSG
