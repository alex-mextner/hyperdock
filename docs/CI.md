# Checks, hooks, CI and releases

`make ci` runs everything CI runs. `make ci-fast` is the same without the network-bound
gates and the nested-shell smoke. Both are thin wrappers over `tools/ci.sh`, which
`.github/workflows/ci.yml` also calls, so a local green is a CI green.

## Stages

| Stage | What | Where it runs in CI |
| --- | --- | --- |
| `syntax` | `node --check` of every shipped `.js` (`make check`) | `ci.yml` job `check` |
| `lint` | ESLint (correctness) + oxlint (`.oxlintrc.json`, `correctness` category) (`make lint`) | `check` |
| `settings` | schema ↔ `preferences/keys.js` ↔ `ui/*.ui` ↔ runtime refs (`make check-settings`) | `check` |
| `schema` | `glib-compile-schemas --strict --dry-run` | `check` |
| `tests` | every `tests/*_check.js` under `gjs -m`, then `tests/*_test.py` under unittest (`make test`) | `check` (gjs 1.80) and `smoke` (gjs 1.88) |
| `json` | `package.json`, `metadata.json` parse | `check` |
| `ui` | `xmllint` of `ui/*.ui` and the schema XML | `check` |
| `shell` | shellcheck (warnings and up) of every tracked shell script, including `.githooks/*` | `check` |
| `actionlint` | `.github/workflows/*.yml` | `check` |
| `package` | build the extension zip with `tools/publish.sh` and verify it (`tools/check-package.py`): required files, no dev-only files, every relative import resolves inside the zip, metadata matches | `check` |
| `gates` | gitleaks secret scan + semgrep SAST from the rig-managed `ci/` scripts | `secret-scan.yml`, `sast.yml` |
| `smoke` | `tools/smoke-docker.sh`: in an `ubuntu:26.04` container (GNOME Shell 50, gjs 1.88) the unit checks, then `make smoke` (headless nested shell, extension enabled/disabled 5×, no new error signatures vs `agents/smoke-baseline.txt`), then the visual regression | `ci.yml` job `smoke` |

`tools/ci.sh <stage>...` runs single stages. Stages are independent: one failure does not
stop the rest, the exit code is 1 if any failed. A missing tool fails its stage instead of
skipping it; shellcheck, actionlint and semgrep are fetched through `uv tool run` when they
are not on `PATH`.

## Unit checks

`tools/run-tests.sh` runs each `tests/*_check.js` with `gjs -m` and fails on a non-zero exit
or a check that never reports success. A check prints `ok  ...` / `FAIL ...` lines and calls
`createChecker().finish()` (`tests/harness.js`).

The shipped modules import Shell-only namespaces (`gi://Shell`, `resource:///org/gnome/shell/...`)
that plain gjs cannot load. `importWithStubs(path, { stubs, real })` loads one module with
every import except GLib/Gio/GObject replaced by an inert stub (or the ES module source you
pass), so a check exercises the real function without a running Shell:

```js
const { module } = await importWithStubs('launcherEntry.js', {
  stubs: { 'gi://Shell': 'export default { AppSystem: { get_default: () => ({ lookup_app: () => ({}) }) } };' },
});
```

| Check | Covers |
| --- | --- |
| `launcher_entry_check.js` | Unity LauncherEntry parsing: id normalisation, count/progress clamping, partial updates, unknown apps, sender cleanup |
| `recents_check.js` | folder-stack/recents file list: sort orders, hidden files, counts, missing folder, fan size |
| `desktop_escape_check.js` | `.desktop` value/Exec escaping, round-tripped through the real keyfile and shell parsers for hostile paths |
| `geometry_check.js` | `isInRect` / `isOverlapRect` / distance helpers behind hit-testing and intellihide |
| `timer_check.js`, `window_tracker_check.js`, `compat_baseline_check.js` | timer hardening, window tracking lifecycle, Shell compatibility layer |

Layout sizing and the separator invariant (#2) ship their checks with the change that
introduces them, as `tests/<name>_check.js`: the runner picks them up with no wiring.

## Visual regression

`tools/visual-shell.sh` boots the same headless nested shell with the extension plus a test-only
helper extension (`tests/visual/helper`, never shipped) that pins five fixture favorites
(`tests/visual/apps`, self-contained SVG icons), waits for the dock to settle and saves the
stage. `tools/visual_compare.py` crops the dock region and compares it with
`tests/visual/golden/dock-default.png`: a pixel differs beyond 12 per RGB channel, the run fails
beyond 0.2% differing pixels and writes `visual-out/diff.png` with the differences in red.

The golden is rendered by llvmpipe inside the `ubuntu:26.04` container, so regenerate it there,
review the image, and commit it with the change that moved the dock:

```sh
tools/smoke-docker.sh visual --update
```

To provoke a failure on purpose: `D2DA_SMOKE_SETTINGS='icon-size=0.6' tools/smoke-docker.sh visual`.

## Git hooks

```sh
make hooks            # tools/install-hooks.sh: sets core.hooksPath=.githooks, idempotent
tools/install-hooks.sh --uninstall
```

| Hook | Does |
| --- | --- |
| `pre-commit` | eslint + oxlint on staged `.js`, the unit checks, shellcheck on staged shell, actionlint on staged workflows. A failure blocks the commit. |
| `commit-msg` | Conventional Commits subject (`feat\|fix\|docs\|style\|refactor\|perf\|test\|build\|ci\|chore\|revert`, optional scope) |
| `pre-push` | `make ci-fast` |

A repo-level `core.hooksPath` shadows rig's machine-wide hooks (the secret-scan dispatcher,
the review gate), so each tracked hook ends by handing over to them (`.githooks/chain-global`);
on a machine without them that step is a no-op. `core.hooksPath` is stored in the clone's
shared config, so it applies to every worktree: run `make hooks` from a checkout whose branch
already contains `.githooks`.

## Rig

`rig.yaml` declares the gates: `secret-scan`, `sast`, `dependency-review`, `pr-title-lint`
(vendored by rig into `.github/workflows/` and `ci/`) and the oxlint config. Reconcile with
`rig apply commit --only ci,linters`; check drift with `rig status`. Do not run a bare
`rig apply commit` from a worktree: it also reconciles machine-wide state. The `github` area is
disabled in `rig.yaml` because `origin` of a clone is the upstream project, not the fork.

`make ci` runs semgrep directly (`semgrep scan --config auto --error`) instead of `ci/sast/sast.sh`,
which exits 0 on findings. Findings are fixed or justified inline with `# nosemgrep: <rule> (reason)`.

Not adopted, with the reason:

- **anti-slop** (oxlint plugin): its rules police TypeScript type assertions and `unknown`
  types; there is nothing for them to match in a plain-JS GJS extension. oxlint itself runs
  with its `correctness` rules instead.
- **license-policy**: the repo is GPLv3 and its only dependencies are dev tools that never ship.
- **leftover-grep**: it fails on any added `console.log`, which is the GJS logging idiom here
  (128 uses); `no-debugger` and conflict-marker detection come from oxlint/git.
- **codeql**, **trivy**: semgrep + gitleaks + npm audit cover the surface; add them when the
  dependency tree or the code grows.

## Workflows

| File | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | PR, push to `mac-tahoe`/`main`, called by `release.yml` | `check` (`make ci-fast`) and `smoke` |
| `secret-scan.yml`, `sast.yml` | PR | gitleaks, semgrep (rig-managed) |
| `dependency-review.yml`, `pr-title-lint.yml` | `pull_request_target` | npm audit of the lockfile, PR title lint (rig-managed; run from the base branch) |
| `release.yml` | tag `vMAJOR.MINOR.PATCH` | CI, then the GitHub Release |

Every third-party action is pinned to a commit SHA. The smoke job needs `docker`, which
`ubuntu-latest` has; `tools/smoke-docker.sh` does the same locally (logs in `./smoke-out`).

## Releases and the update channel

See `RELEASES.md` ("Hyperdock releases"): tag, asset and `release.json` naming, and how an
updater (ubuntu-tweaks) follows `releases/latest`.
