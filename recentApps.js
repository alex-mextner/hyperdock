'use strict';

// Rules of the dock's "recent apps" section, free of gi:// imports so
// tests/recent_apps_check.js can run them under plain node. extension.js owns
// the dconf list and the Shell lookups and passes them in as callbacks.

// Ids the Shell reports for something that is not what the user would open
// again: the goa-daemon launcher (NoDisplay, Exec=/usr/libexec/goa-daemon)
// owns the Online Accounts sign-in windows; its icon must open the Settings
// panel instead of starting the background daemon.
const OPENS_INSTEAD = {
  'org.gnome.goa-daemon.desktop': 'gnome-online-accounts-panel.desktop',
};

const SETTINGS_PANEL_CATEGORY = 'X-GNOME-Settings-Panel';

// The id a recent app is stored and shown under
function canonicalId(id) {
  return OPENS_INSTEAD[id] ?? id;
}

// MRU list after `id` closed: newest first, no duplicates, at most `kept`
export function rememberRecent(ids, id, kept) {
  let canonical = canonicalId(id);
  let next = ids.filter((i) => canonicalId(i) !== canonical);
  next.unshift(canonical);
  return next.slice(0, kept);
}

// The list without `id` (and without the spelling that shows as the same icon)
export function forgetRecent(ids, id) {
  let canonical = canonicalId(id);
  return ids.filter((i) => canonicalId(i) !== canonical);
}

// Daemons and helpers (NoDisplay) never belong in the dock, except Settings
// panels: those are NoDisplay too, but they are what a Settings window means.
// categories is the desktop file's Categories= string, or null.
export function isLaunchable({ noDisplay, categories }) {
  if (!noDisplay) return true;
  return (categories ?? '').split(';').includes(SETTINGS_PANEL_CATEGORY);
}

// The apps to show, in list order: not pinned, at most `count`, one per icon.
// resolve(id) returns the Shell app to show for an id, or null for ids that
// must not show (unknown, running, not launchable, ...).
export function pickRecents(ids, { count, isFavorite, resolve }) {
  let apps = [];
  if (!(count > 0)) return apps;
  let seen = new Set();
  for (let stored of ids) {
    let id = canonicalId(stored);
    if (seen.has(id)) continue;
    seen.add(id);
    if (isFavorite(id)) continue;
    let app = resolve(id);
    if (!app) continue;
    apps.push(app);
    if (apps.length >= count) break;
  }
  return apps;
}

// Where the recents' own separator goes, given what the Dash box holds in
// order, as 'favorite' | 'running' | 'recent' per app item: the index of the
// first of the trailing recents, or -1 when no separator is needed. The Shell
// puts its own separator after the favorites, so one is only missing between
// running apps and recents.
export function recentSeparatorIndex(kinds) {
  let first = kinds.length;
  while (first > 0 && kinds[first - 1] === 'recent') first--;
  if (first === kinds.length || first === 0) return -1;
  return kinds[first - 1] === 'running' ? first : -1;
}
