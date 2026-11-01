#!/bin/sh
# The unit checks, `make smoke` and the visual regression against GNOME Shell 50 in an
# ubuntu:26.04 container: the way CI runs them, and a way to run them on a machine without
# GNOME 50.
#
#   tools/smoke-docker.sh                  everything; logs and screenshots land in ./smoke-out
#   tools/smoke-docker.sh visual           only the visual regression
#   tools/smoke-docker.sh visual --update  re-render the golden image (written to
#                                          tests/visual/golden/, review it before committing)
#   SMOKE_IMAGE=ubuntu:26.04 SMOKE_OUT_DIR=/tmp/out tools/smoke-docker.sh
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=${SMOKE_IMAGE:-ubuntu:26.04}
OUT_DIR=${SMOKE_OUT_DIR:-$REPO/smoke-out}
mkdir -p "$OUT_DIR"

docker run --rm \
	-v "$REPO:/src:ro" \
	-v "$OUT_DIR:/out" \
	"$IMAGE" /src/tools/smoke-container.sh "$@" || status=$?

if [ "${1:-}" = "visual" ] && [ "${2:-}" = "--update" ] && [ -d "$OUT_DIR/golden" ]; then
	mkdir -p "$REPO/tests/visual/golden"
	cp "$OUT_DIR"/golden/*.png "$REPO/tests/visual/golden/"
	echo "smoke-docker: golden image(s) copied to tests/visual/golden/"
fi
exit "${status:-0}"
