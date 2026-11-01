'use strict';

// Which apps the app-grid icon's pile shows, as pure functions (no gi://
// imports) so tests/app_grid_pile_selection_check.js runs them under plain
// gjs. appGridPile.js gathers the Shell's data and calls selectPileApps().
//
// The user's wish: "вместо точечек слева 3 недавно установленных приложения
// которых нет в доке и 6 наиболее часто используемых", and again: nothing the
// dock already shows, in either group. Read as:
//   * frequent - the Shell's most used apps, in its order, skipping every app
//                in the dock, so the next most used fills the place;
//   * recent   - the newest installed apps, skipping the dock and the frequent
//                ones, so the two groups never share an app;
// at most the asked counts of each, fewer when the system has fewer. "In the
// dock" is everything the dock shows as an app (pinned, running, the apps in the
// Recents stack), compared by appGridPileDock.js keys, not by exact id.

import { appKeys, meets } from './appGridPileDock.js';

// the dock's own launcher entries (Trash, Downloads, Recents, mounts, ...)
const HELPER_SUFFIX = '-hyperdock.desktop';

export function isHelperId(id) {
  return id.endsWith(HELPER_SUFFIX);
}

// The first `count` ids of `ids`, skipping helpers, anything whose keys meet
// `skip` (a Set of keys, grown with every pick so repeats under another id are
// skipped too) and whatever `usable(id)` rejects (no visible entry, no icon
// file).
function take(ids, count, skip, usable, keysOf) {
  const picked = [];
  if (!(count > 0)) return picked;
  for (const id of ids) {
    if (picked.length >= count) break;
    if (!id || isHelperId(id)) continue;
    const keys = keysOf(id);
    if (meets(keys, skip)) continue;
    if (!usable(id)) continue;
    picked.push(id);
    for (const key of keys) skip.add(key);
  }
  return picked;
}

// installed: [{id, time}], newest first; equal times fall back to the id so
// the order never depends on the directory listing
export function newestFirst(installed) {
  return [...installed]
    .sort((a, b) => b.time - a.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entry) => entry.id);
}

// The pile from best (top) to worst (bottom): the two lists merged in
// proportion, so the newest installs are never all buried under the frequent
// apps. With 6 frequent and 3 recent: F R F F R F F R F.
export function interleave(frequent, recent) {
  const keyed = [
    ...frequent.map((id, i) => ({ id, key: (i + 0.5) / frequent.length, tie: 0 })),
    ...recent.map((id, i) => ({ id, key: (i + 0.5) / recent.length, tie: 1 })),
  ];
  keyed.sort((a, b) => a.key - b.key || a.tie - b.tie);
  return keyed.map((entry) => entry.id);
}

// mostUsed:   app ids, most used first (Shell.AppUsage)
// installed:  [{id, time}] of every app with a visible launcher, time = when
//             it was first seen installed (appFirstSeen.js)
// dockKeys:   Set of appGridPileDock.js keys of everything the dock shows
// usable(id): true when the app can be drawn (visible entry, icon file)
// keysOf(id): the keys of an app, appKeys() plus what the launcher declares
// -> { frequent, recent, order }; order is what the pile shows, top first
export function selectPileApps({
  mostUsed,
  installed,
  dockKeys,
  usable,
  frequentCount,
  recentCount,
  keysOf = appKeys,
}) {
  const skip = new Set(dockKeys);
  const frequent = take(mostUsed, frequentCount, skip, usable, keysOf);
  // `skip` now holds the frequent apps too: no app in both groups
  const recent = take(newestFirst(installed), recentCount, skip, usable, keysOf);
  return { frequent, recent, order: interleave(frequent, recent) };
}
