#!/bin/sh
# Headless nested-shell check of the app-grid pile (appGridPile.js): the Show Apps
# item shows a pile of apps on a plate, follows favorites, installs and settings,
# and a left click with a virtual pointer still opens the app grid, on a bottom,
# a left and a right dock (appGridPileScenarios.js, scenario `appgrid`). Saves
# screenshots of each.
#
# Usage: tools/app-grid-pile-shell.sh
# Env:
#   D2DA_PILE_OUT        where the log and PNGs go (default ./app-grid-pile-out)
#   D2DA_PILE_FAVORITES  comma list of pinned .desktop ids (default: none)
#   D2DA_PILE_USAGE      comma list of .desktop ids that get usage scores, first = most
#                        used (default: the first apps listed in ~/.local/share/gnome-shell/
#                        application_state, read only; if there is none, none are used)
# The apps themselves are this machine's (the nested shell sees /usr/share/applications);
# which ones the pile picks therefore depends on it. Isolation as in tools/visual-shell.sh:
# private D-Bus session, in-memory GSettings, a scratch XDG_DATA_HOME (where the fresh
# install is dropped); the user's dconf and ~/.local/share are never written.
#
# Exit codes: 0 all checks ok, 1 a check failed or the scenario did not finish, 2 the
# shell failed to start.

REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT=${D2DA_PILE_OUT:-$REPO/app-grid-pile-out}

if [ -z "$D2DA_PILE_INNER" ]; then
	mkdir -p "$OUT"
	D2DA_PILE_INNER=1 exec dbus-run-session -- "$0" "$@" 2>"$OUT/bus.log"
fi

UUID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['uuid'])" "$REPO/metadata.json")
WORK=$(mktemp -d)
DATA=$WORK/data
LOG=$OUT/shell.log
mkdir -p "$DATA/gnome-shell/extensions" "$DATA/applications" "$DATA/icons-fixture" "$OUT/shots"
: >"$LOG"
rm -f "$OUT"/shots/*.png

SHELL_PID=
cleanup() {
	[ -n "$SHELL_PID" ] && kill "$SHELL_PID" 2>/dev/null
	[ -n "$SHELL_PID" ] && wait "$SHELL_PID" 2>/dev/null
	rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

make -s -C "$REPO" install EXT_DIR="$DATA/gnome-shell/extensions/$UUID" >/dev/null || {
	echo "FAIL: make install into the scratch data dir failed"
	exit 2
}
cp "$REPO"/tests/visual/apps/icons/*.svg "$DATA/icons-fixture/"
# an app installed before the shell starts: the scenario later "upgrades" it
printf '[Desktop Entry]\nType=Application\nName=Old Install\nExec=true\nIcon=%s\nTerminal=false\n' \
	"$DATA/icons-fixture/editor.svg" >"$DATA/applications/d2da-pile-oldapp.desktop"

# usage scores: the given ids, first = most used, scored so the Shell ranks them in that order
python3 - "$DATA/gnome-shell/application_state" "${D2DA_PILE_USAGE:-}" <<'PY'
import os, re, sys, time
target, given = sys.argv[1], [i for i in sys.argv[2].split(',') if i]
if not given:
    state = os.path.expanduser('~/.local/share/gnome-shell/application_state')
    try:
        apps = re.findall(r'<application id="([^"]+)" score="([^"]+)"', open(state).read())
        given = [i for i, _ in sorted(apps, key=lambda a: -float(a[1]))][:12]
    except OSError:
        given = []
now = int(time.time())
rows = ''.join(
    '    <application id="%s" score="%d" last-seen="%d"/>\n' % (app, 1000 * (len(given) - n), now)
    for n, app in enumerate(given)
)
open(target, 'w').write('<?xml version="1.0"?>\n<application-state>\n  <context id="">\n%s  </context>\n</application-state>\n' % rows)
PY

XDG_DATA_HOME=$DATA \
	D2DA_PILE_FAVORITES=${D2DA_PILE_FAVORITES:-} \
	D2DA_PILE_APPS_DIR=$DATA/applications D2DA_PILE_NEW_ICON=$DATA/icons-fixture/calc.svg \
	D2DA_PROBE=1 D2DA_PROBE_SCENARIO=appgrid D2DA_PROBE_SHOTS=$OUT/shots \
	GSETTINGS_BACKEND=memory \
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
gnome-extensions enable "$UUID"

i=0
while ! grep -q 'd2da-probe-scenario .*"done":true' "$LOG"; do
	i=$((i + 1))
	if [ $i -gt 300 ] || ! kill -0 "$SHELL_PID" 2>/dev/null; then
		echo "FAIL: scenario did not finish (see $LOG)"
		exit 1
	fi
	sleep 1
done

grep 'd2da-probe-scenario' "$LOG" | sed 's/^.*d2da-probe-scenario //' >"$OUT/results.jsonl"
cat "$OUT/results.jsonl"
if grep -q '"ok":false' "$OUT/results.jsonl"; then
	echo "APPGRID: FAIL (log: $LOG)"
	exit 1
fi
echo "APPGRID: PASS (shots: $OUT/shots)"
