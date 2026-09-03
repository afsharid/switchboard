#!/usr/bin/env bash
# Opens a URL in a Chrome build with WebMCP enabled, using a throwaway profile
# so the chrome://flags toggle does not have to be set by hand.
#
#   ./scripts/open-in-chrome.sh [url]
set -euo pipefail

URL="${1:-https://switchboard-100.pages.dev/}"
PROFILE="${PROFILE:-$HOME/.switchboard-webmcp-profile}"
CHROME="${CHROME:-/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary}"

if [ ! -x "$CHROME" ]; then
  echo "No Chrome with WebMCP found at:"
  echo "  $CHROME"
  echo
  echo "WebMCP needs Chrome 153+. Install Canary:"
  echo "  brew install --cask google-chrome@canary"
  echo "Or point CHROME at your own build."
  exit 1
fi

mkdir -p "$PROFILE"
# same key chrome://flags writes, so the flag is on from first launch
if [ ! -f "$PROFILE/Local State" ]; then
  printf '{"browser":{"enabled_labs_experiments":["enable-webmcp-testing@1"]}}' > "$PROFILE/Local State"
fi

echo "Chrome:  $("$CHROME" --version)"
echo "Profile: $PROFILE"
echo "URL:     $URL"
echo
echo "Once it opens, confirm the tool surface in DevTools console:"
echo "  await document.modelContext.getTools()"
echo
exec "$CHROME" --user-data-dir="$PROFILE" "$URL"
