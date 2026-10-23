# Releases

Record of official releases for Hyperdock, aligned by GNOME Shell major version.

---

| Release | GNOME Target | Branch | Git Tag | Release Files | Date | Highlights |
|---|---|---|---|---|---|---|
| **v50.0** | GNOME 50 | `g50` | `v50.0` | [`hyperdock-v50.0.zip`](hyperdock-v50.0.zip)<br>`hyperdock@alex-mextner.github.com.zip` | 2026-10-07 | Major Milestone: Extensive updates -- hardened by AI. GNOME 50 baseline support, performance fixes, menu overhaul. |

---

## Release Details

### [v50.0] — 2026-10-07
* **Target GNOME:** 50
* **Branch:** `g50`
* **Tag:** `v50.0`
* **Artifacts:**
  - `hyperdock-v50.0.zip` (GitHub Release asset)
  - `hyperdock@alex-mextner.github.com.zip` (EGO upload asset)

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
