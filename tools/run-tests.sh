#!/bin/sh
# Runs every tests/*_check.js under `gjs -m` and fails if any exits non-zero.
#
# A check prints `ok  ...`/`FAIL ...` lines and exits 1 on failure (see
# tests/harness.js createChecker). Checks need no GNOME Shell: modules that import
# Shell-only namespaces are loaded through tests/harness.js importWithStubs().
#
# tests/*_test.py (python unittest, stdlib only) run after them when no check is named.
#
# Usage: tools/run-tests.sh [check ...]   (default: all tests/*_check.js + tests/*_test.py)
set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO" || exit 2

if ! command -v gjs >/dev/null 2>&1; then
	echo "test: gjs not found (apt install gjs)" >&2
	exit 2
fi

python_tests=0
if [ $# -eq 0 ]; then
	set -- tests/*_check.js
	python_tests=1
fi
if [ ! -e "$1" ]; then
	echo "test: no tests/*_check.js found" >&2
	exit 2
fi

failed=""
count=0
for check in "$@"; do
	count=$((count + 1))
	echo "== $check"
	# A check that exits 0 without printing its `all passed` line is flagged below.
	out=$(gjs -m "$check" 2>&1)
	status=$?
	echo "$out"
	if [ $status -ne 0 ]; then
		failed="$failed $check"
	elif ! echo "$out" | grep -q -E '^all (baseline checks )?passed'; then
		echo "test: $check exited 0 but never reported success" >&2
		failed="$failed $check"
	fi
done

if [ "$python_tests" = 1 ] && ls tests/*_test.py >/dev/null 2>&1; then
	echo "== tests/*_test.py"
	python3 -B -m unittest discover -s tests -p '*_test.py' || failed="$failed tests/*_test.py"
fi

if [ -n "$failed" ]; then
	echo "test: FAILED:$failed" >&2
	exit 1
fi
echo "test: $count check file(s) OK"
