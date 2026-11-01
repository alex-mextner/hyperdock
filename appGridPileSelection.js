'use strict';

// Which apps the app-grid icon's pile shows, as pure functions (no gi://
// imports) so tests/app_grid_pile_selection_check.js runs them under plain
// gjs. appGridPile.js gathers the Shell's data and calls selectPileApps().
//
// The user's wish: "вместо точечек слева 3 недавно установленных приложения
// которых нет в доке и 6 наиболее часто используемых". Read as:
//   * frequent - the Shell's most used apps, in its order;
//   * recent   - the newest installed apps that are not already in the dock
//                (not pinned, not running) and not among the frequent ones;
// at most the asked counts of each, fewer when the system has fewer.

// the dock's own launcher entries (Trash, Downloads, Recents, mounts, ...)
const HELPER_SUFFIX = '-hyperdock.desktop';

export function isHelperId(id) {
  return id.endsWith(HELPER_SUFFIX);
}

// The first `count` ids of `ids`, skipping helpers, repeats, anything in
// `skip` and whatever `usable(id)` rejects (no visible entry, no icon file).
function take(ids, count, skip, usable) {
  const picked = [];
  const seen = new Set(skip);
  if (!(count > 0)) return picked;
  for (const id of ids) {
    if (picked.length >= count) break;
    if (!id || seen.has(id) || isHelperId(id)) continue;
    seen.add(id);
    if (usable(id)) picked.push(id);
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
// favorites, running: ids already in the dock
// usable(id): true when the app can be drawn (visible entry, icon file)
// -> { frequent, recent, order }; order is what the pile shows, top first
export function selectPileApps({
  mostUsed,
  installed,
  favorites,
  running,
  usable,
  frequentCount,
  recentCount,
}) {
  const frequent = take(mostUsed, frequentCount, [], usable);
  // not in the dock, and not already shown as a most used app
  const taken = [...favorites, ...running, ...frequent];
  const recent = take(newestFirst(installed), recentCount, taken, usable);
  return { frequent, recent, order: interleave(frequent, recent) };
}
