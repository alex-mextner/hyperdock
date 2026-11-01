# The apps icon as a pile of apps

## What the user asked for

2026-11-01, quoted verbatim:

«и давай вместо точечек слева 3 недавно установленных приложения которых нет в доке и 6 наиболее часто используемых, пусть иконки красиво будут накиданы кучкой в полупрозрачный квадратик со скругленными углами»

The "dots" are the Shell's Show Apps item (nine dots). It becomes a heap of nine app icons lying on a translucent rounded square. A click opens the app grid exactly as before; right-click keeps its menu.

## How it is done

| Requirement | Where |
|---|---|
| Which apps: the 6 most used (`Shell.AppUsage.get_most_used()`) and the 3 newest installed, **neither group containing an app that is already in the dock**: an app in the dock is skipped and the next one fills its place, so there are 6 + 3 whenever the system has enough apps; the two groups never share an app; fewer when the system has fewer, never a placeholder | `appGridPileSelection.js` (`selectPileApps`), pure and tested |
| "Newest installed": every launcher with a visible entry (`Gio.AppInfo.get_all()`, `should_show()`), by when the app was first seen installed. A new app is as old as its launcher file (change time, or modification time when later; never later than now); that first time is stored in `$XDG_DATA_HOME/hyperdock/app-first-seen.json` and kept, so a package upgrade, which rewrites the launcher, does not make an old app "new". An app whose launcher is missing (a snap refresh, a hidden entry) keeps its record for 30 days; only after that is it forgotten and counts as new when it comes back, so a reinstall within 30 days keeps the old time. Hidden launchers are recorded too. The dock's own `*-hyperdock.desktop` entries never count | `appFirstSeen.js` (pure), `appGridPile.js` (`_installedApps`), `appGridPileSelection.js` |
| "In the dock" is every app the dock shows as an item: pinned (favorites), running as the dock lists it (nothing with "Favorite Apps Only", only apps with a window on this workspace with "Isolate Workspaces"), and the stopped apps of the Recents stack (`recentDockApps()`: its icon and popover list them). The dock's own `*-hyperdock.desktop` entries are never shown. Apps are compared by keys, not exact ids, because the Shell's usage list, favorites and user launchers name one app differently: the id without `.desktop`, the app part of a snap/flatpak `package_app` id (`firefox_firefox` = `firefox`), the program name of a reverse-DNS id (`org.mozilla.firefox` = `firefox`) and the launcher's `StartupWMClass` | `appGridPileDock.js` (`appKeys`, pure and tested), `appGridPile.js` (`_dockApps`) |
| Order in the heap: best on top; the two lists are merged in proportion so new installs are not all buried (6 + 3: F R F F R F F R F) | `interleave` |
| The heap: top icon near the middle, the rest spread outwards by area (golden angle, radius with the square root of the rank), each tilted and nudged by a generator seeded by its app id, so an app lies the same way on every redraw; centred on the plate, every icon (rotation, offset and shadow included) inside it; icons shrink as the heap grows | `appGridPileLayout.js`, pure and tested |
| The plate: a frosted translucent rounded square (lighter at the top, bright hairline edge) drawn with the pile, so it scales with the icon and shows the dock through it | `apps/stack-pile.js` (`plate` in the request), the same renderer as the stack piles |
| Live: rebuilt (debounced 1.5 s) when favorites change, an app starts or quits (so the running and Recents apps leave or return), "Clear Recents" or the Recents count changes, the workspace changes with "Isolate Workspaces" (an app starting or quitting is also when usage moves), the installed apps change (`installed-changed`), focus moves between windows (`Shell.AppUsage` has no change signal; its scores follow focus), the icon theme changes, or a setting changes. A rebuild that picks the same apps and icons draws nothing | `appGridPile.js`, `extension.js` (`_onAppsChanged`, `app_grid_pile` reaction) |
| No per-frame work: a picture is drawn in a separate gjs process off the main loop (see `stackPile.js`); every frame only `applyTo()` compares two references | `appGridPile.js`, `services.js` (`updateIcon`) |

### Settings

| Key | Default | Meaning |
|---|---|---|
| `app-grid-pile` | on | the pile instead of the nine dots; off restores the stock icon (and the `view-app-grid-symbolic` entry of a custom `icons.json` applies again) |
| `app-grid-pile-recent` | 3 (0..6) | newest installed apps that are not in the dock (and not among the most used) |
| `app-grid-pile-frequent` | 6 (0..12) | most used apps that are not in the dock (the next most used fill in) |

Preferences: Others, next to "Apps Icon" and "Apps Icon at Front". The pile follows "Apps Icon" (hidden icon, no work).

### Choices where the wish was ambiguous

- The user first read "которых нет в доке" as belonging to the recent installs only, then said it applies to the most used ones too ("не показывать те что уже и так есть в доке"): both groups skip everything in the dock. Before this, the most used group ignored the dock entirely (a running terminal and browser sat in the pile) and the recent group compared exact ids and knew nothing of the Recents stack.
- There is no portable install log (dpkg, snap and flatpak each keep their own), so "installed" is "first seen by the extension", seeded from the launcher file's time. On the very first run that seed is all there is: an app upgraded in the last days looks as new as a real install until the next real install pushes it down.
- With no usable app at all (no usage yet, nothing installed) the stock nine dots stay.

## Testing

- Pure rules: `tests/app_grid_pile_selection_check.js` (counts, dock exclusion in both groups, aliases, `tests/app_grid_pile_dock_check.js` (id keys), duplicates, ordering, stability), `tests/app_first_seen_check.js` (an upgrade never makes an app new), `tests/app_grid_pile_layout_check.js` (deterministic, inside the plate for 1..21 icons, stable per app id), the plate drawing in `tests/stack_pile_check.js` (run by `make test`).
- Real shell: `tools/app-grid-pile-shell.sh` boots a nested headless shell on a scratch data dir with seeded usage, checks the pile on the Show Apps item, drops a fresh launcher, "upgrades" an old one (it must not jump ahead) and pins an app (the pile follows), flips the settings, and clicks the item with a virtual pointer on a bottom, a left and a right dock; screenshots go to `app-grid-pile-out/shots`.
