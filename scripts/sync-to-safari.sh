#!/usr/bin/env bash
#
# Copy extension changes from this repo into the Xcode project and rebuild, so
# a code change here actually reaches Safari.
#
# Why this is needed: make-safari-app.sh runs the converter with
# --copy-resources, so Xcode keeps its OWN copy of the extension files. Editing
# the repo does not touch it, and `xcodebuild` rebuilds from that stale copy —
# a build can succeed while shipping old code.
#
#   ./scripts/sync-to-safari.sh [--project DIR] [--no-build] [--launch]
#
# Then reload the extension in Safari (see the notes printed at the end).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "${REPO_ROOT}/.." && pwd)/autokosten-berekenaar-safari"
APP_NAME="Autokosten Berekenaar"
DO_BUILD=1
DO_LAUNCH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)  PROJECT_DIR="$2"; shift 2 ;;
    --no-build) DO_BUILD=0; shift ;;
    --launch)   DO_LAUNCH=1; shift ;;
    -h|--help)  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

# Everything the extension needs at runtime. Keep in sync with manifest.json.
EXTENSION_FILES=(manifest.json background.js content utils popup icons)

RESOURCES="${PROJECT_DIR}/${APP_NAME}/${APP_NAME} Extension/Resources"

if [[ ! -d "${RESOURCES}" ]]; then
  cat >&2 <<MSG
error: could not find the Xcode project's extension resources:

    ${RESOURCES}

Generate the project first:

    ./scripts/make-safari-app.sh
MSG
  exit 1
fi

# --- Copy ---------------------------------------------------------------

echo "Syncing extension files into the Xcode project…"
changed=0

for item in "${EXTENSION_FILES[@]}"; do
  src="${REPO_ROOT}/${item}"
  dst="${RESOURCES}/${item}"

  if [[ ! -e "${src}" ]]; then
    echo "error: ${item} is missing from the repo" >&2
    exit 1
  fi

  # Compare before copying so we can report what actually changed.
  if [[ -e "${dst}" ]] && diff -rq "${src}" "${dst}" >/dev/null 2>&1; then
    echo "  = ${item}"
    continue
  fi

  rm -rf "${dst}"
  cp -R "${src}" "${dst}"
  echo "  > ${item}  (updated)"
  changed=$((changed + 1))
done

echo
if [[ "${changed}" -eq 0 ]]; then
  echo "Nothing changed — the project already matches the repo."
else
  echo "${changed} item(s) updated."
fi

# --- Build --------------------------------------------------------------

if [[ "${DO_BUILD}" -eq 1 ]]; then
  echo
  echo "Building…"
  if ! xcodebuild build \
      -project "${PROJECT_DIR}/${APP_NAME}/${APP_NAME}.xcodeproj" \
      -scheme "${APP_NAME}" \
      -configuration Debug \
      -destination 'platform=macOS' \
      2>&1 | grep -E "error:|BUILD SUCCEEDED|BUILD FAILED" | head -20; then
    echo "error: xcodebuild failed" >&2
    exit 1
  fi
fi

if [[ "${DO_LAUNCH}" -eq 1 ]]; then
  APP_PATH="$(find "${HOME}/Library/Developer/Xcode/DerivedData" -maxdepth 5 \
    -path "*${APP_NAME}*/Build/Products/Debug/${APP_NAME}.app" 2>/dev/null | head -1)"
  if [[ -n "${APP_PATH}" ]]; then
    echo
    echo "Launching ${APP_PATH}"
    open "${APP_PATH}"
  fi
fi

cat <<'MSG'

Done. To make Safari actually use the new build:

  1. Quit Safari completely (⌘Q — closing the window is not enough).
  2. Reopen Safari.
  3. Check Safari > Settings > Extensions that the extension is still enabled.

If the old behaviour persists, Safari is holding the previous copy. Toggle the
extension off and back on in Settings > Extensions, then reload the page.

Note: content scripts do not inject into tabs that are already open, so reload
any open AutoScout24 listing after this.
MSG
