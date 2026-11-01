#!/bin/sh
# Headless nested-shell check of the stack dropdowns (Downloads, Screenshots, Recents):
# clicks the stack items and the files in their popovers with a virtual pointer and
# fails if a click does not reach the file (stackScenarios.js, scenario `stacks`).
# Also saves screenshots of the open dropdowns.
#
# Usage: tools/stacks-shell.sh
# Env:
#   D2DA_STACKS_OUT   where the log and PNGs go (default ./stacks-out)
#   D2DA_STACKS_ONLY  comma list of steps (views, batches, group, recents); default all
#   D2DA_STACKS_SCENARIO  scenario list (default stacks)
#   D2DA_STACKS_BIG   1: fill Downloads and Screenshots with a few hundred files, long
#                     names and real full-size PNGs instead of the small fixture
#                     (tools/stacks-fixture.py); D2DA_STACKS_DOWNLOADS / _SCREENSHOTS
#                     set the counts
#   D2DA_STACKS_POSITION  dock-location: 0 bottom (default), 1 left, 2 right, 3 top
#   D2DA_STACKS_TIMEOUT   seconds to wait for the scenario (default 240)
#   D2DA_STACKS_MONITOR   virtual monitor WxH (default 1200x800)
#   D2DA_STACKS_SORT      sort of the Screenshots stack: date-added (default) or date-modified
# Isolation as in tools/visual-shell.sh: private D-Bus session, in-memory GSettings,
# a scratch XDG_DATA_HOME and fixture folders; the user's dconf is never written.
# A stub `xdg-open` first in PATH records what the dock opens.
#
# Exit codes: 0 all checks ok, 1 a check failed or the scenario did not finish, 2 the
# shell failed to start.

REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT=${D2DA_STACKS_OUT:-$REPO/stacks-out}

if [ -z "$D2DA_STACKS_INNER" ]; then
	mkdir -p "$OUT"
	# the nested session must never reach the real desktop (file-drops talks to Nautilus)
	unset WAYLAND_DISPLAY DISPLAY XAUTHORITY SSH_AUTH_SOCK
	D2DA_STACKS_INNER=1 exec dbus-run-session -- "$0" "$@" 2>"$OUT/bus.log"
fi

UUID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['uuid'])" "$REPO/metadata.json")
WORK=$(mktemp -d)
DATA=$WORK/data
LOG=$OUT/shell.log
mkdir -p "$DATA/gnome-shell/extensions" "$WORK/config" "$WORK/cache" "$WORK/home" "$DATA/applications" "$DATA/icons-fixture" \
	"$WORK/bin" "$WORK/Downloads" "$WORK/Pictures/Screenshots" "$OUT/shots"
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
for desktop in "$REPO"/tests/visual/apps/*.desktop; do
	sed "s#@ICONDIR@#$DATA/icons-fixture#" "$desktop" >"$DATA/applications/$(basename "$desktop")"
done

# the stub that records what a click opened, and three apps for the Recents stack
# whose launchers record that they ran
OPENED=$WORK/opened.txt
printf '#!/bin/sh\necho "$@" >>"%s"\n' "$OPENED" >"$WORK/bin/xdg-open"
chmod +x "$WORK/bin/xdg-open"
for app in calc editor settings; do
	cat >"$DATA/applications/d2da-stack-recent-$app.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Recent $app
Exec=sh -c 'echo launched-$app >>"$OPENED"'
Icon=$DATA/icons-fixture/$app.svg
Terminal=false
EOF
done

# fixtures: 42 downloads over several weeks, and 12 screenshots over two days
[ -n "$D2DA_STACKS_BIG" ] && python3 "$REPO/tools/stacks-fixture.py" "$WORK" \
	--downloads "${D2DA_STACKS_DOWNLOADS:-1200}" --screenshots "${D2DA_STACKS_SCREENSHOTS:-700}"
[ -z "$D2DA_STACKS_BIG" ] && python3 - "$WORK" <<'EOF'
import os, sys, time
work = sys.argv[1]
now = time.time()
day = 86400
def make(path, age_days, size=64):
    with open(path, 'wb') as f:
        f.write(b'\0' * size)
    t = now - age_days * day
    os.utime(path, (t, t))
names = [('report-%02d.pdf', 0.1), ('invoice-%02d.pdf', 0.5), ('photo-%02d.jpg', 1.2), ('notes-%02d.txt', 2.5),
         ('archive-%02d.zip', 9), ('setup-%02d.deb', 20), ('old-%02d.tar.gz', 60)]
for i in range(6):
    for pattern, age in names:
        make(os.path.join(work, 'Downloads', pattern % i), age + i * 0.01)
for i in range(12):
    make(os.path.join(work, 'Pictures', 'Screenshots', 'Screenshot from 2026-10-%02d 10-%02d-00.png' % (30 - i // 6, i)), i / 20)
EOF

HOME=$WORK/home XDG_DATA_HOME=$DATA XDG_CACHE_HOME=$WORK/cache XDG_CONFIG_HOME=$WORK/config PATH="$WORK/bin:$PATH" \
	D2DA_STACKS_OPENED=$OPENED D2DA_STACKS_VIEWS=${D2DA_STACKS_VIEWS:-} \
	D2DA_STACKS_FAVORITES=d2da-visual-terminal.desktop,d2da-visual-files.desktop \
	D2DA_STACKS_RECENTS=d2da-stack-recent-calc.desktop,d2da-stack-recent-editor.desktop,d2da-stack-recent-settings.desktop \
	D2DA_STACKS_ONLY=${D2DA_STACKS_ONLY:-} \
	D2DA_PROBE=1 D2DA_PROBE_SCENARIO=${D2DA_STACKS_SCENARIO:-stacks} D2DA_PROBE_SHOTS=$OUT/shots \
	GSETTINGS_BACKEND=memory \
	D2DA_SMOKE_SETTINGS="dock-location=${D2DA_STACKS_POSITION:-0} downloads-icon=true downloads-path='$WORK/Downloads' trash-icon=true file-drops=false max-recent-items=0 recent-apps-count=20 folder-stacks='[{\"path\":\"$WORK/Pictures/Screenshots\",\"icon\":\"folder-pictures\",\"view\":\"grid\",\"sort\":\"${D2DA_STACKS_SORT:-date-added}\"}]'" \
	prlimit --core=0 -- gnome-shell --headless --no-x11 --virtual-monitor ${D2DA_STACKS_MONITOR:-1200x800} >>"$LOG" 2>&1 &
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

want=$(echo "${D2DA_STACKS_SCENARIO:-stacks}" | tr ',' '\n' | grep -c .)
i=0
while [ "$(grep -c 'd2da-probe-scenario .*"done":true' "$LOG")" -lt "$want" ]; do
	i=$((i + 1))
	if [ $i -gt "${D2DA_STACKS_TIMEOUT:-240}" ] || ! kill -0 "$SHELL_PID" 2>/dev/null; then
		echo "FAIL: scenario did not finish (see $LOG)"
		exit 1
	fi
	sleep 1
done

grep 'd2da-probe-scenario' "$LOG" | sed 's/^.*d2da-probe-scenario //' >"$OUT/results.jsonl"
cat "$OUT/results.jsonl"
if grep -q '"ok":false' "$OUT/results.jsonl"; then
	echo "STACKS: FAIL (log: $LOG)"
	exit 1
fi
echo "STACKS: PASS (shots: $OUT/shots)"
