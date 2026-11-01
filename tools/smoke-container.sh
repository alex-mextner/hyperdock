#!/bin/sh
# Runs inside an ubuntu:26.04 container (GNOME Shell 50): installs the nested-shell
# dependencies and runs the unit checks, `make smoke` and the visual regression on a copy
# of the repo mounted read-only at /src. Driven by tools/smoke-docker.sh (locally and in
# CI); not meant to be run on a desktop.
#
# Usage: smoke-container.sh [all | visual [--update]]
#   all               make test, make smoke, tools/visual-shell.sh (default)
#   visual [--update] only the visual regression; --update rewrites the golden into /out/golden
#
# Artifacts (shell logs, screenshots, the diff image) are copied to $SMOKE_OUT (default /out).
set -eu

SRC=${SMOKE_SRC:-/src}
OUT=${SMOKE_OUT:-/out}
USER_NAME=smoke
MODE=${1:-all}

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# gnome-shell brings mutter/gjs; the rest is what a headless nested shell needs to
# render (llvmpipe), find schemas/icons and run the repo's make targets. A shell talks to
# systemd-logind on the system bus: there is no systemd here, so dbusmock plays logind.
apt-get install -y -qq --no-install-recommends \
	gnome-shell gsettings-desktop-schemas adwaita-icon-theme \
	dbus-daemon dbus-bin libglib2.0-bin python3-dbusmock \
	libgl1-mesa-dri libegl-mesa0 mesa-libgallium \
	make zip python3 ca-certificates >/dev/null

id "$USER_NAME" >/dev/null 2>&1 || useradd --create-home "$USER_NAME"
rm -rf /work
mkdir -p /work "$OUT"
(cd "$SRC" && tar --exclude=.git --exclude=node_modules --exclude=.worktrees --exclude=smoke-out --exclude=visual-out -cf - .) | tar -xf - -C /work
chown -R "$USER_NAME" /work "$OUT"

mkdir -p /run/dbus
dbus-daemon --system --fork 2>/dev/null
python3 -m dbusmock --system --template logind >/tmp/dbusmock.log 2>&1 </dev/null &
sleep 2
# the template's GetUser concatenates str and uint32 and raises; return a plain path instead
gdbus call --system --dest org.freedesktop.login1 --object-path /org/freedesktop/login1 \
	--method org.freedesktop.DBus.Mock.AddMethod org.freedesktop.login1.Manager GetUser u o \
	'ret = "/org/freedesktop/login1/user/_%d" % args[0]' >/dev/null
# the extension's folder stacks look at these
su "$USER_NAME" -c 'mkdir -p ~/Downloads ~/Documents'

XDG=/tmp/xdg-smoke
rm -rf "$XDG"
mkdir -p "$XDG"
chown "$USER_NAME" "$XDG"
chmod 700 "$XDG"

as_user() {
	su "$USER_NAME" -c "cd /work && XDG_RUNTIME_DIR=$XDG D2DA_SMOKE_LOG=$OUT/smoke.log D2DA_VISUAL_OUT=$OUT/visual $1"
}

echo "smoke-container: $(gnome-shell --version), gjs $(gjs --version)"
status=0
case "$MODE" in
all)
	as_user "make test" || status=$?
	as_user "make smoke" || status=$?
	as_user "tools/visual-shell.sh" || status=$?
	;;
visual)
	shift
	as_user "tools/visual-shell.sh $*" || status=$?
	if [ "${1:-}" = "--update" ]; then
		mkdir -p "$OUT/golden"
		cp /work/tests/visual/golden/*.png "$OUT/golden/"
	fi
	;;
*)
	echo "smoke-container: unknown mode '$MODE'" >&2
	status=2
	;;
esac
exit "$status"
