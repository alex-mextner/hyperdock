#!/bin/sh
# Headless nested-shell check that a dock popover does not swallow the global keys:
# with the Downloads dropdown, an app icon's menu and the dock's own menu open, a virtual
# keyboard sends Super+Space (the input-source shortcut) and a tap of Super, and the
# check fails unless the input source switched and the tap closed the popover and opened
# the overview (inputGrabScenarios.js, scenario `inputgrab`). Escape, typing and a click
# outside are checked too.
#
# Usage: tools/input-grab-shell.sh
# Env: D2DA_STACKS_OUT  where the log and PNGs go (default ./stacks-out)
# Everything else (the private D-Bus session, in-memory GSettings, fixtures) is
# tools/stacks-shell.sh's, which this runs with the other scenario.
#
# Exit codes: as tools/stacks-shell.sh.

REPO=$(cd "$(dirname "$0")/.." && pwd)
D2DA_STACKS_SCENARIO=inputgrab exec "$REPO/tools/stacks-shell.sh" "$@"
