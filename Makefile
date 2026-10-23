all: build install lint

.PHONY: build install publish check-devkit check-install-dir test-shell test-shell2 check smoke lint check-settings test ci ci-fast hooks

RUNTIME_DIR ?= $(or $(XDG_RUNTIME_DIR),/run/user/$(shell id -u))
# gnome-shell writes this at startup as a crash marker; if it is left behind
# (e.g. nested shell killed early) the next run starts with all extensions off.
DISABLE_EXT_FLAG = $(RUNTIME_DIR)/gnome-shell-disable-extensions
MUTTER_DEVKIT ?= /usr/libexec/mutter-devkit
SHELL_LIBDIR = /usr/lib/gnome-shell
MUTTER_LIBDIR = $(firstword $(wildcard /usr/lib/*/mutter-*))
EXT_DIR = $(HOME)/.local/share/gnome-shell/extensions/hyperdock@alex-mextner.github.com

# GNOME 49+: `gnome-shell --devkit` runs headless and spawns mutter-devkit as
# the viewer window. Without it the shell runs but no window ever appears.
check-devkit:
	@test -x $(MUTTER_DEVKIT) || { \
		echo "error: $(MUTTER_DEVKIT) not found - nested shell would run with no window."; \
		echo "       install it: sudo dnf install mutter-devkit"; \
		exit 1; }

# A symlinked EXT_DIR is a live checkout (e.g. the ubuntu-tweaks submodule):
# `rm -rf $(EXT_DIR)/` follows the link and empties that checkout. The
# install targets stop here instead; remove the link to install a copy.
check-install-dir:
	@if [ -L "$(EXT_DIR)" ]; then \
		echo "error: $(EXT_DIR) is a symlink to $$(readlink -f "$(EXT_DIR)")"; \
		echo "       refusing to install over it; rm the link (not the target) first"; \
		exit 1; fi

build:
	glib-compile-schemas --strict --targetdir=schemas/ schemas

install: build check-install-dir
	echo "installing..."
	rm -rf "$(EXT_DIR)/"
	mkdir -p "$(EXT_DIR)/"
	cp -R ./* "$(EXT_DIR)/"
	rm -rf "$(EXT_DIR)/build"
	rm -rf "$(EXT_DIR)/Makefile"
	rm -rf "$(EXT_DIR)/tests"
	rm -rf "$(EXT_DIR)/tools"
	rm -rf "$(EXT_DIR)/screenshots"
	rm -rf "$(EXT_DIR)/node_modules"
	rm -rf "$(EXT_DIR)/agents"
	rm -rf "$(EXT_DIR)/eslint.config.js"
	rm -rf "$(EXT_DIR)/package.json"
	rm -rf "$(EXT_DIR)/package-lock.json"
	rm -rf "$(EXT_DIR)/ci"
	rm -rf "$(EXT_DIR)/rig.yaml"

clean:
	rm -rf ./build

publish:
	./tools/publish.sh $(VERSION)

install-zip: check-install-dir
	echo "installing zip..."
	rm -rf "$(EXT_DIR)"
	mkdir -p "$(EXT_DIR)/"
	unzip -q hyperdock@alex-mextner.github.com.zip -d "$(EXT_DIR)/"

test-prefs:
	gnome-extensions prefs hyperdock@alex-mextner.github.com

test-shell: check-devkit install
	rm -f $(DISABLE_EXT_FLAG)
	-env GNOME_SHELL_SLOWDOWN_FACTOR=1 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=1200x800 \
	 	MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1 \
		dbus-run-session -- gnome-shell --devkit --wayland
	rm -f $(DISABLE_EXT_FLAG)

test-shell2: check-devkit install
	rm -f $(DISABLE_EXT_FLAG)
	-env GNOME_SHELL_SLOWDOWN_FACTOR=2 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=1200x800 \
	 	MUTTER_DEBUG_DUMMY_MONITOR_SCALES=2 \
		dbus-run-session -- gnome-shell --devkit --wayland
	rm -f $(DISABLE_EXT_FLAG)

lint:
	npx eslint .
	npx oxlint .

# Fast parse-only syntax check of all shipped JS (ESLint: `make lint`). `.js` is ESM
# because package.json says "type": "module".
check:
	find . -path ./node_modules -prune -o -path ./build -prune -o -path ./tests -prune \
		-o -path ./tools -prune -o -path ./ci -prune -o -name '*.js' -print \
		| xargs -n1 node --check
	node tests/dock_layout_check.js
	gjs -m tests/icon_geometry_check.js
	@if [ -d $(SHELL_LIBDIR) ]; then \
		GI_TYPELIB_PATH=$(SHELL_LIBDIR):$(MUTTER_LIBDIR) LD_LIBRARY_PATH=$(SHELL_LIBDIR):$(MUTTER_LIBDIR) \
			gjs -m tests/dot_band_check.js; \
	else echo "check: skipping tests/dot_band_check.js (no $(SHELL_LIBDIR))"; fi
	@echo "check: OK"

# schema <-> preferences/keys.js <-> ui/*.ui <-> runtime refs. Exits 1 on
# error-class issues (shared adjustment, duplicate case, missing schema key).
check-settings:
	python3 tools/check-settings.py

# Headless nested shell: extension ACTIVE, N enable/disable cycles, no new
# error signatures vs agents/smoke-baseline.txt. See tools/smoke-shell.sh.
smoke: install
	tools/smoke-shell.sh 5

# Unit checks (tests/*_check.js under gjs, no GNOME Shell needed).
test:
	tools/run-tests.sh

# Everything CI runs; see tools/ci.sh for the stage list and docs/CI.md for the mapping.
# `ci-fast` is the same minus the nested-shell smoke and the network-bound gates.
ci:
	tools/ci.sh all

ci-fast:
	tools/ci.sh fast

# Wire the tracked git hooks into this clone (idempotent). See docs/CI.md.
hooks:
	tools/install-hooks.sh

xml-lint:
	cd ui ; \
	find . -name "*.ui" -type f -exec xmllint --output '{}' --format '{}' \;

pretty: xml-lint
	rm -rf ./build/*
	prettier --single-quote --write "**/*.js"

todo:
	python ./tools/todo.py > ./TODO.md
