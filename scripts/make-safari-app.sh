#!/usr/bin/env bash
#
# Wrap this extension in a real macOS app so Safari installs it permanently,
# instead of loading it every session via Develop > Add Temporary Extension.
#
# Requires full Xcode (not just Command Line Tools), because it uses
# `safari-web-extension-converter`.
#
#   ./scripts/make-safari-app.sh
#
# Output: safari/Autokosten Berekenaar/ — open the .xcodeproj in it and press Run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/safari"
APP_NAME="Autokosten Berekenaar"
BUNDLE_ID="nl.jortdejong.autokosten-berekenaar"

# --- Preconditions ----------------------------------------------------------

if ! xcode-select -p 2>/dev/null | grep -q "Xcode.app"; then
  echo "error: full Xcode is required, but the active developer directory is:" >&2
  echo >&2
  echo "    $(xcode-select -p 2>/dev/null || echo '(onbekend)')" >&2
  echo >&2
  # Quoted heredoc: keeps the backticks literal rather than running them.
  cat >&2 <<'MSG'
`safari-web-extension-converter` ships with Xcode and is not part of the
Command Line Tools.

  1. Install Xcode from the App Store (or developer.apple.com/download).
  2. Point the toolchain at it:

       sudo xcode-select -s /Applications/Xcode.app
       sudo xcodebuild -runFirstLaunch

  3. Re-run this script.
MSG
  exit 1
fi

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "error: safari-web-extension-converter not found in the active Xcode." >&2
  echo "       Try: sudo xcodebuild -runFirstLaunch" >&2
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

# --- Convert ----------------------------------------------------------------

echo "Converting the extension into an Xcode project…"
echo "  source: ${REPO_ROOT}"
echo "  output: ${OUT_DIR}"
echo

xcrun safari-web-extension-converter "${REPO_ROOT}" \
  --project-location "${OUT_DIR}" \
  --app-name "${APP_NAME}" \
  --bundle-identifier "${BUNDLE_ID}" \
  --swift \
  --macos-only \
  --no-open \
  --no-prompt

cat <<MSG

Done. Next:

  1. Open the project:

       open "${OUT_DIR}/${APP_NAME}/${APP_NAME}.xcodeproj"

  2. In Xcode, select the project > Signing & Capabilities, and pick your
     team (a free Apple ID works for personal use).

  3. Press Run (⌘R). The app launches once and installs the extension.

  4. In Safari: Settings > Extensions, then enable "Autokosten Berekenaar".

The extension now survives quitting Safari, and you can turn
"Allow unsigned extensions" back off.

To share it with others you need a paid Apple Developer account (\$99/year)
to sign and notarise the app.
MSG
