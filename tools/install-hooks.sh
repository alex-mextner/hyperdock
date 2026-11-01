#!/bin/sh
# Points this clone at the tracked hooks in .githooks (core.hooksPath). Idempotent: running it
# again changes nothing. `make hooks` calls it.
#
#   tools/install-hooks.sh              install
#   tools/install-hooks.sh --uninstall  drop the setting again
#
# core.hooksPath is shared by every worktree of the clone and shadows the machine-wide
# hooks, which is why each tracked hook ends by handing over to them (.githooks/chain-global).
# Run it from a checkout whose branch already contains .githooks.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
WANT=.githooks
CURRENT=$(git config --local --get core.hooksPath || true)

if [ "${1:-}" = "--uninstall" ]; then
	if [ "$CURRENT" = "$WANT" ]; then
		git config --local --unset core.hooksPath
		echo "hooks: uninstalled (core.hooksPath unset)"
	else
		echo "hooks: nothing to uninstall (core.hooksPath is '${CURRENT:-unset}')"
	fi
	exit 0
fi

if [ ! -x "$WANT/pre-commit" ] || [ ! -x "$WANT/commit-msg" ] || [ ! -x "$WANT/pre-push" ]; then
	echo "hooks: $WANT/{pre-commit,commit-msg,pre-push} missing or not executable in this checkout" >&2
	exit 1
fi

if [ -n "$CURRENT" ] && [ "$CURRENT" != "$WANT" ]; then
	echo "hooks: core.hooksPath is already '$CURRENT' (lefthook/husky?); not overriding it." >&2
	echo "hooks: remove it with 'git config --local --unset core.hooksPath' and rerun." >&2
	exit 1
fi

if [ "$CURRENT" = "$WANT" ]; then
	echo "hooks: already installed (core.hooksPath=$WANT)"
else
	git config --local core.hooksPath "$WANT"
	echo "hooks: installed (core.hooksPath=$WANT)"
fi
