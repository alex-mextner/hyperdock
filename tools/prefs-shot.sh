#!/usr/bin/env bash
# tools/prefs-shot.sh <out.png> [--no-apps] <widget-id>...
# Screenshot of the preferences groups holding the given widget ids, rendered offscreen through a private
# GTK Broadway server: nothing appears on (or touches) the live desktop.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
DISPLAY_NUM=:${BROADWAY_PORT:-7}
gtk4-broadwayd "$DISPLAY_NUM" >/dev/null 2>&1 &
BWD=$!
trap 'kill $BWD 2>/dev/null' EXIT
sleep 1
GDK_BACKEND=broadway BROADWAY_DISPLAY=$DISPLAY_NUM \
	gjs -m "$REPO/tools/prefs-shot.js" "$@"
