'use strict';

// When two launcher ids name the same app, as pure functions (no gi:// imports)
// so tests/app_grid_pile_dock_check.js runs them under plain gjs. The pile must
// not show an app the dock already shows, but the dock and the Shell's usage
// list do not agree on the id: the Shell's most used list has `firefox.desktop`
// where a user launcher says `org.mozilla.firefox.desktop` or a snap says
// `firefox_firefox.desktop`. appGridPile.js passes in the ids; the comparison is
// by the keys below, so any shared key means "the same app".

// the last part of a reverse-DNS id says nothing about the app in these
const GENERIC_LAST = new Set([
  'app',
  'client',
  'desktop',
  'device',
  'gtk',
  'gui',
  'main',
  'stable',
]);
const REVERSE_DNS = /^(?:org|com|io|net|de|fr|app|dev|me|ch|eu|im)\./;
const MIN_LAST = 3;

// `firefox_firefox` -> `firefox`: a snap or flatpak id names package and app, and
// is the same app as the plain id when both are one name. Any other underscore
// (`first-pkg_app`, `photo_editor`) is no such pair: it only means itself.
function snapApp(base) {
  const [pkg, app, ...rest] = base.split('_');
  return app !== undefined && !rest.length && pkg === app ? app : base;
}

// The keys an app answers to, all lower case, two kinds:
//   `i:` an identity from the id: the id without `.desktop`, the app of a snap
//        `app_app` id;
//   `w:` the window class the launcher declares;
//   `a:` only on a reverse-DNS id: its program name (`org.videolan.VLC` -> vlc).
// A program name is weaker evidence than an identity: `org.gnome.Calculator`
// and `org.example.Calculator` are two apps. So it only joins a reverse-DNS id
// to an id that is not one (see meets()), never to another program name or a
// window class.
// -> string[], never empty for a non-empty id
export function appKeys(id, wmClass = '') {
  const base = String(id ?? '')
    .replace(/\.desktop$/, '')
    .toLowerCase();
  if (!base) return [];
  const keys = new Set([`i:${base}`]);
  const app = snapApp(base);
  keys.add(`i:${app}`);
  if (REVERSE_DNS.test(app) && app.split('.').length >= 3) {
    const last = app.slice(app.lastIndexOf('.') + 1);
    if (last.length >= MIN_LAST && !GENERIC_LAST.has(last)) keys.add(`a:${last}`);
  }
  const wm = String(wmClass ?? '').toLowerCase();
  if (wm) keys.add(`w:${wm}`);
  return [...keys];
}

// Is an app with these keys the same as one of the apps whose keys are in `taken`?
export function meets(keys, taken) {
  return keys.some((key) => {
    const name = key.slice(2);
    if (key.startsWith('a:')) return taken.has(`i:${name}`);
    if (taken.has(key) || taken.has(`${key.startsWith('i:') ? 'w' : 'i'}:${name}`)) return true;
    // an id against a program name
    return key.startsWith('i:') && taken.has(`a:${name}`);
  });
}

// The keys of the apps the dock shows. entries: [{id, wmClass?}]
export function dockKeys(entries) {
  const keys = new Set();
  for (const { id, wmClass } of entries) {
    for (const key of appKeys(id, wmClass)) keys.add(key);
  }
  return keys;
}
