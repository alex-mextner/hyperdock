#!/bin/sh
# Visual regression of the dock: boots a headless nested gnome-shell with the extension
# and a test helper extension (tests/visual/helper) that pins five fixture favorites and
# saves a screenshot, then compares the dock region with tests/visual/golden/dock-default.png
# (tools/visual_compare.py). A changed dock render fails the run and leaves a diff image.
#
# Usage: tools/visual-shell.sh [--update]
#   --update  store this run's dock region as the new golden instead of comparing
# Env:
#   D2DA_VISUAL_OUT       where frame.png, the diff and the shell log go (default ./visual-out)
#   D2DA_VISUAL_CROP      X,Y,W,H of the compared region (default below)
#   D2DA_SMOKE_SETTINGS   'key=value ...' applied by probe.js, as for tools/smoke-shell.sh
#                         (the way to provoke a regression on purpose)
#
# The golden was rendered by llvmpipe in the ubuntu:26.04 smoke container
# (tools/smoke-docker.sh), the same place CI runs this. Regenerate it there:
#   tools/smoke-docker.sh visual --update
# Isolation as in smoke-shell.sh: private D-Bus session, in-memory GSettings, a scratch
# XDG_DATA_HOME, so neither the user's dconf nor ~/.local/share is touched.
#
# Exit codes: 0 match/updated, 1 regression or no screenshot, 2 shell failed to start.

REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT=${D2DA_VISUAL_OUT:-$REPO/visual-out}
CROP=${D2DA_VISUAL_CROP:-380,720,440,80}
GOLDEN=$REPO/tests/visual/golden/dock-default.png
HELPER_UUID=d2da-visual-helper@test.local
FAVORITES=d2da-visual-terminal.desktop,d2da-visual-files.desktop,d2da-visual-calc.desktop,d2da-visual-editor.desktop,d2da-visual-settings.desktop

if [ -z "$D2DA_VISUAL_INNER" ]; then
	mkdir -p "$OUT"
	D2DA_VISUAL_INNER=1 exec dbus-run-session -- "$0" "$@" 2>"$OUT/bus.log"
fi

UUID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['uuid'])" "$REPO/metadata.json")
WORK=$(mktemp -d)
DATA=$WORK/data
SHOTS=$WORK/shots
LOG=$OUT/shell.log
mkdir -p "$OUT" "$DATA/gnome-shell/extensions" "$DATA/applications" "$DATA/icons-fixture" "$SHOTS"
: >"$LOG"

cleanup() {
	[ -n "$SHELL_PID" ] && kill "$SHELL_PID" 2>/dev/null
	[ -n "$SHELL_PID" ] && wait "$SHELL_PID" 2>/dev/null
	rm -rf "$WORK"
}
SHELL_PID=
trap cleanup EXIT INT TERM

make -s -C "$REPO" install EXT_DIR="$DATA/gnome-shell/extensions/$UUID" >/dev/null || {
	echo "FAIL: make install into the scratch data dir failed"
	exit 2
}
cp -R "$REPO/tests/visual/helper" "$DATA/gnome-shell/extensions/$HELPER_UUID"
cp "$REPO"/tests/visual/apps/icons/*.svg "$DATA/icons-fixture/"
for desktop in "$REPO"/tests/visual/apps/*.desktop; do
	sed "s#@ICONDIR@#$DATA/icons-fixture#" "$desktop" >"$DATA/applications/$(basename "$desktop")"
done

XDG_DATA_HOME=$DATA D2DA_PROBE=1 GSETTINGS_BACKEND=memory \
	D2DA_SHOT_DIR=$SHOTS D2DA_SHOT_FAVORITES=$FAVORITES D2DA_SHOT_DELAY_MS=${D2DA_SHOT_DELAY_MS:-9000} \
	gnome-shell --headless --no-x11 --virtual-monitor 1200x800 >>"$LOG" 2>&1 &
SHELL_PID=$!

i=0
until gnome-extensions list >/dev/null 2>&1; do
	i=$((i + 1))
	if [ $i -gt 60 ] || ! kill -0 "$SHELL_PID" 2>/dev/null; then
		echo "FAIL: gnome-shell did not start (see $LOG)"
		exit 2
	fi
	sleep 0.5
done

# the dock first, then the helper whose timer takes the picture
gnome-extensions enable "$UUID"
sleep 1
gnome-extensions enable "$HELPER_UUID"

i=0
until grep -q 'd2da-shot: saved' "$LOG"; do
	i=$((i + 1))
	if [ $i -gt 120 ] || ! kill -0 "$SHELL_PID" 2>/dev/null; then
		echo "FAIL: no screenshot (see $LOG)"
		grep -E 'd2da-shot|JS ERROR' "$LOG" | head -5
		exit 1
	fi
	sleep 0.5
done
kill "$SHELL_PID" 2>/dev/null
wait "$SHELL_PID" 2>/dev/null
SHELL_PID=

cp "$SHOTS/frame.png" "$OUT/frame.png"
if [ "$1" = "--update" ]; then
	python3 "$REPO/tools/visual_compare.py" "$OUT/frame.png" "$GOLDEN" --crop "$CROP" --update
else
	python3 "$REPO/tools/visual_compare.py" "$OUT/frame.png" "$GOLDEN" --crop "$CROP" --diff-out "$OUT/diff.png"
fi
status=$?
[ $status -eq 0 ] && echo "VISUAL: PASS" || echo "VISUAL: FAIL (frame: $OUT/frame.png, diff: $OUT/diff.png)"
exit $status
