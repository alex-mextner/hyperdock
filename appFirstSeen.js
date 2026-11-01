'use strict';

// When each installed app was first seen on this machine, as pure functions
// (no gi:// imports) so tests/app_first_seen_check.js runs them under plain
// gjs. appGridPile.js keeps the state in a small file.
//
// Why not just the launcher file's time: a package manager rewrites the
// launcher on every upgrade (dpkg renames a new file over the old one, snap and
// flatpak redeploy), so its change time says "last updated", and after an
// `apt upgrade` the apps that were merely updated would crowd the genuinely new
// installs out of "recently installed". An app's first appearance is recorded
// once and kept.
//
// Limits: with nothing recorded yet (first run, or the file lost) the launcher
// times are all there is, so an app upgraded in the last days looks as new as a
// real install until real installs push it down. An app that is gone is only
// forgotten after GRACE seconds: a snap refresh removes the launcher for a while,
// and an app can be hidden and shown again; neither is a new install.

export const GRACE = 30 * 24 * 3600;

const has = (object, key) => Object.hasOwn(object, key);

// The launcher time of a new id. An unreadable one (0, NaN) counts as the oldest
// on the first run, where it would otherwise flood the pile with "new" apps; once
// something is recorded, a new id with no readable time is new now.
function launched(time, state, now) {
  if (Number.isFinite(time) && time > 0) return time;
  return Object.keys(state.firstSeen).length ? now : 0;
}

// state: { firstSeen: {id: seconds}, goneSince: {id: seconds} }
// installed: [{id, time}], time = the launcher file's own time
// -> { state, changed }; `changed` says whether the state must be stored again
//
// An id seen for the first time gets its launcher's time (a new install's file
// is as old as the install, also when it arrived while the extension was off),
// never later than `now`. An id seen before keeps what was recorded. A known id
// that is missing starts a grace period; when it is back within it the record is
// kept, when it stays away longer it is forgotten and counts as new next time.
export function mergeFirstSeen(state, installed, now) {
  const firstSeen = {};
  const goneSince = {};
  let changed = false;
  const present = new Set();
  for (const { id, time } of installed) {
    present.add(id);
    if (has(state.firstSeen, id)) {
      firstSeen[id] = state.firstSeen[id];
      changed ||= has(state.goneSince, id);
    } else {
      firstSeen[id] = Math.min(launched(time, state, now), now);
      changed = true;
    }
  }
  for (const id of Object.keys(state.firstSeen)) {
    if (present.has(id)) continue;
    const since = has(state.goneSince, id) ? state.goneSince[id] : now;
    changed ||= !has(state.goneSince, id);
    if (now - since > GRACE) {
      changed = true;
      continue;
    }
    firstSeen[id] = state.firstSeen[id];
    goneSince[id] = since;
  }
  return { state: { firstSeen, goneSince }, changed };
}

const numbers = (object) =>
  object && typeof object === 'object' && !Array.isArray(object)
    ? Object.fromEntries(Object.entries(object).filter(([, time]) => Number.isFinite(time)))
    : {};

// The stored state from its file's text; anything unreadable is "nothing known".
export function parseFirstSeen(text) {
  try {
    const doc = JSON.parse(text);
    return { firstSeen: numbers(doc?.firstSeen), goneSince: numbers(doc?.goneSince) };
  } catch {
    return { firstSeen: {}, goneSince: {} };
  }
}

export function serializeFirstSeen(state) {
  return JSON.stringify(state);
}
