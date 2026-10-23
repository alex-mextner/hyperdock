# Releases

Record of official releases for Dash2Dock Animated, aligned by GNOME Shell major version.

---

| Release | GNOME Target | Branch | Git Tag | Release Files | Date | Highlights |
|---|---|---|---|---|---|---|
| **v50.0** | GNOME 50 | `g50` | `v50.0` | [`dash2dock-lite-v50.0.zip`](dash2dock-lite-v50.0.zip)<br>`dash2dock-lite@icedman.github.com.zip` | 2026-10-07 | Major Milestone: Extensive updates -- hardened by AI. GNOME 50 baseline support, performance fixes, menu overhaul. |

---

## Release Details

### [v50.0] — 2026-10-07
* **Target GNOME:** 50
* **Branch:** `g50`
* **Tag:** `v50.0`
* **Artifacts:**
  - `dash2dock-lite-v50.0.zip` (GitHub Release asset)
  - `dash2dock-lite@icedman.github.com.zip` (EGO upload asset)

#### Milestone Note
> **Extensive updates — hardened by AI.** Comprehensive stabilization, leak elimination, lifecycle audit, and GNOME 50 compatibility.

#### Features
* First-class support for GNOME Shell 50.
* Dock item context menu upgrade & polish.
* Custom icons drag/click alignment fixes.

#### Bug Fixes & Stability
* Strict idle CPU budget enforcement (0% wakeups and clean pacing when idle).
* Animator lifecycle teardown cleanup & zero-leak probe compliance.
* Proper cleanup across enable/disable cycles.

#### Changes & Internal
* Cleaned packaging pipeline and automated release orchestration.
* Shipped release helper toolset (`tools/release.sh`, `tools/publish.sh`).

---

## Hyperdock releases (fork, `mac-tahoe`)

Releases of the fork are cut from the `mac-tahoe` branch by pushing a tag; the
`release` workflow (`.github/workflows/release.yml`) does the rest.

### Cutting a release

1. Bump `version` in `package.json` (`MAJOR.MINOR.PATCH`) and `version` in `metadata.json`
   (the integer GNOME uses to tell builds apart; increase it by 1) in a PR to `mac-tahoe`.
2. After the merge, tag that commit and push the tag to the **fork** (`origin` is upstream):
   `git tag -a vX.Y.Z -m "vX.Y.Z" && git push fork vX.Y.Z`.
3. The workflow runs the full CI, checks that the tag equals `package.json`'s version and sits
   on `mac-tahoe`/`main`, builds the zips, and publishes the GitHub Release.

### Assets

| Asset | Meaning |
| --- | --- |
| `<uuid>.zip` | the extension zip (`gnome-extensions install --force <uuid>.zip`); the name is always the `uuid` from `metadata.json` |
| `<name>-vX.Y.Z.zip` | the same bytes under a versioned name (as `tools/publish.sh X.Y.Z` writes it) |
| `SHA256SUMS` | `sha256sum -c` file for the zips |
| `release.json` | machine-readable description of the release (below) |

`release.json` is attached to every release, so
`https://github.com/alex-mextner/hyperdock/releases/latest/download/release.json` always
describes the newest one:

```json
{
  "schema": 1,
  "name": "...",
  "tag": "vX.Y.Z",
  "version": "X.Y.Z",
  "uuid": "...",
  "shell-version": ["50"],
  "zip": "<uuid>.zip",
  "sha256": "...",
  "size": 123456,
  "commit": "<sha of the tagged commit>",
  "released": "2026-10-23T00:00:00Z"
}
```

### Following releases (update channels)

An updater such as ubuntu-tweaks picks one of:

- **release** (default for seamless updates): compare `version` in
  `releases/latest/download/release.json` with the installed one; to update, download
  `releases/download/<tag>/<zip>`, verify `sha256`, install and re-enable. For a git checkout
  (the `gnome-extensions/hyperdock` submodule): `git fetch --tags` and check out the highest
  `v*` tag (`git tag --list 'v*' --sort=-v:refname | head -n1`).
- **edge**: follow the `mac-tahoe` branch (what the submodule tracks today).
- **pin**: a fixed tag.

Tags are `vMAJOR.MINOR.PATCH` only (no pre-release suffix), so version ordering is plain
`sort -V`. The upstream-style `vNN.N` / `gNN` GNOME-major tags in the table above belong to
the original project and are not used by the fork.
