#!/bin/sh
# The repo's CI, runnable locally as-is: `make ci` (everything) / `make ci-fast`.
# .github/workflows/ci.yml calls the same stages, so a local green means a CI green.
#
# Usage: tools/ci.sh <stage|group> ...
#   groups: fast = syntax lint settings schema tests json ui shell actionlint package
#           all  = fast + gates + smoke
#   stages: syntax    node --check of every shipped .js          (make check)
#           lint      eslint + oxlint                            (make lint)
#           settings  schema <-> keys.js <-> ui consistency      (make check-settings)
#           schema    glib-compile-schemas --strict --dry-run
#           tests     tests/*_check.js under gjs                 (make test)
#           json      package.json / metadata.json parse
#           ui        xmllint --noout of ui/*.ui and the schema XML
#           shell     shellcheck of every tracked shell script (warnings and up)
#           actionlint  .github/workflows/*.yml
#           package   build the extension zip and verify its contents
#           gates     secret-scan (gitleaks) + sast (semgrep) from ci/ (rig-managed)
#           smoke     tools/smoke-docker.sh: in an ubuntu:26.04 container (GNOME Shell 50) the unit
#                     checks, `make smoke` and the visual regression (tools/visual-shell.sh)
#
# Stages run independently: one failure does not stop the rest, and the exit code is 1
# if any failed. Tools that are not installed (shellcheck, actionlint, semgrep) run
# through `uv tool run`; a stage whose tool cannot be found at all FAILS, it is never
# skipped silently.
set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO" || exit 2

FAST="syntax lint settings schema tests json ui shell actionlint package"
ALL="$FAST gates smoke"

[ $# -gt 0 ] || { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

# run_tool <binary> <uv package> [args...]: PATH binary first, else `uv tool run`.
run_tool() {
	bin=$1
	pkg=$2
	shift 2
	if command -v "$bin" >/dev/null 2>&1; then
		"$bin" "$@"
	elif command -v uv >/dev/null 2>&1; then
		uv tool run --from "$pkg" "$bin" "$@"
	else
		echo "ci: $bin not found and uv is unavailable to fetch it ($pkg)" >&2
		return 127
	fi
}

need_node_modules() {
	[ -d node_modules ] || npm ci --no-audit --no-fund
}

# Tracked shell scripts: *.sh plus extensionless files with a sh/bash shebang
# (the .githooks). ci/ is rig-vendored and checked upstream.
shell_files() {
	git ls-files | while IFS= read -r f; do
		case "$f" in
		ci/*) continue ;;
		*.sh) echo "$f" ;;
		*) case "${f##*/}" in
			*.*) ;;
			*) [ -f "$f" ] && head -n1 "$f" | grep -q -E '^#!.*(sh|bash)( |$)' && echo "$f" ;;
			esac ;;
		esac
	done
}

stage_syntax() { make --no-print-directory check; }
stage_lint() { need_node_modules && make --no-print-directory lint; }
stage_settings() { make --no-print-directory check-settings; }
stage_schema() { glib-compile-schemas --strict --dry-run schemas; }
stage_tests() { make --no-print-directory test; }

stage_json() {
	for f in package.json metadata.json; do
		python3 -m json.tool "$f" >/dev/null || return 1
	done
}

stage_ui() {
	command -v xmllint >/dev/null 2>&1 || {
		echo "ci: xmllint not found (apt install libxml2-utils)" >&2
		return 127
	}
	xmllint --noout ui/*.ui schemas/*.gschema.xml
}

stage_shell() {
	files=$(shell_files)
	[ -n "$files" ] || {
		echo "ci: no shell scripts found" >&2
		return 1
	}
	# shellcheck disable=SC2086  # one path per word by construction
	run_tool shellcheck shellcheck-py --severity=warning $files
}

stage_actionlint() {
	run_tool actionlint actionlint-py -color
}

stage_package() {
	python3 tools/check-package.py
}

stage_gates() {
	status=0
	sh ci/secret-scan/secret-scan.sh || status=1
	# ci/sast/sast.sh exits 0 on findings (it reads $? after an if), so call semgrep directly
	# with the flags the sast.yml workflow uses.
	run_tool semgrep semgrep scan --config auto --error --quiet . || status=1
	return $status
}

stage_smoke() { tools/smoke-docker.sh; }

stages=""
for arg in "$@"; do
	case "$arg" in
	fast) stages="$stages $FAST" ;;
	all) stages="$stages $ALL" ;;
	*) stages="$stages $arg" ;;
	esac
done

failed=""
for stage in $stages; do
	if ! command -v "stage_$stage" >/dev/null 2>&1; then
		echo "ci: unknown stage '$stage'" >&2
		exit 2
	fi
	[ -n "${GITHUB_ACTIONS:-}" ] && echo "::group::ci $stage"
	echo "== ci: $stage"
	start=$(date +%s)
	if "stage_$stage"; then
		result=ok
	else
		result=FAILED
		failed="$failed $stage"
	fi
	echo "== ci: $stage $result ($(($(date +%s) - start))s)"
	[ -n "${GITHUB_ACTIONS:-}" ] && echo "::endgroup::"
done

if [ -n "$failed" ]; then
	echo "ci: FAILED:$failed" >&2
	exit 1
fi
echo "ci: all stages passed:$stages"
