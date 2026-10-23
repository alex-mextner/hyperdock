// gjs -m tests/recent_apps_check.js - recent-apps section rules (pure logic, no
// GNOME Shell): the MRU list, what it shows, where its separator goes.
// Exits 1 on failure.
import { createChecker } from './harness.js';

import {
  forgetRecent,
  isLaunchable,
  pickRecents,
  recentSeparatorIndex,
  rememberRecent,
} from '../recentApps.js';

const GOA_DAEMON = 'org.gnome.goa-daemon.desktop';
const OA_PANEL = 'gnome-online-accounts-panel.desktop';

const { check, finish } = createChecker();
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

// the few node:assert calls the cases use, for gjs (no node modules there)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assert = {
  equal(actual, expected, msg = '') {
    if (actual !== expected) {
      throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  deepEqual(actual, expected) {
    if (!same(actual, expected)) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  ok(value, msg = 'not ok') {
    if (!value) throw new Error(msg);
  },
};

// resolve() as extension.js would give it: only known ids exist
const resolver = (known, seen = []) => (id) => {
  seen.push(id);
  return known.includes(id) ? { id } : null;
};
const ids = (apps) => apps.map((a) => a.id);

test('remember: newest first, no duplicate, capped', () => {
  assert.deepEqual(rememberRecent(['a', 'b', 'c'], 'b', 3), ['b', 'a', 'c']);
  assert.deepEqual(rememberRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
  assert.deepEqual(rememberRecent([], 'a', 3), ['a']);
});

test('remember: the Online Accounts daemon is stored as the panel', () => {
  assert.deepEqual(rememberRecent(['a'], GOA_DAEMON, 5), [OA_PANEL, 'a']);
});

test('remember: panel and daemon spellings replace each other', () => {
  assert.deepEqual(rememberRecent(['a', GOA_DAEMON], OA_PANEL, 5), [
    OA_PANEL,
    'a',
  ]);
  assert.deepEqual(rememberRecent(['a', OA_PANEL], GOA_DAEMON, 5), [
    OA_PANEL,
    'a',
  ]);
});

test('forget: drops only that id, order kept', () => {
  assert.deepEqual(forgetRecent(['a', 'b', 'c'], 'b'), ['a', 'c']);
});

test('forget: unknown id changes nothing', () => {
  assert.deepEqual(forgetRecent(['a', 'b'], 'zzz'), ['a', 'b']);
});

test('forget: removes both spellings of Online Accounts', () => {
  assert.deepEqual(forgetRecent(['a', GOA_DAEMON, 'b', OA_PANEL], OA_PANEL), [
    'a',
    'b',
  ]);
  assert.deepEqual(forgetRecent(['a', GOA_DAEMON, 'b'], GOA_DAEMON), [
    'a',
    'b',
  ]);
});

test('pick: skips pinned and unresolvable ids, keeps order', () => {
  const apps = pickRecents(['a', 'gone', 'pinned', 'b', 'c'], {
    count: 5,
    isFavorite: (id) => id === 'pinned',
    resolve: resolver(['a', 'pinned', 'b', 'c']),
  });
  assert.deepEqual(ids(apps), ['a', 'b', 'c']);
});

test('pick: never more than the count', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];
  const opts = (count) => ({
    count,
    isFavorite: () => false,
    resolve: resolver(list),
  });
  assert.deepEqual(ids(pickRecents(list, opts(3))), ['a', 'b', 'c']);
  assert.deepEqual(ids(pickRecents(list, opts(1))), ['a']);
});

test('pick: count 0 shows nothing and looks nothing up', () => {
  const seen = [];
  const apps = pickRecents(['a', 'b'], {
    count: 0,
    isFavorite: () => false,
    resolve: resolver(['a', 'b'], seen),
  });
  assert.deepEqual(apps, []);
  assert.deepEqual(seen, []);
});

test('pick: ids that do not exist do not use up the count', () => {
  const apps = pickRecents(['x', 'y', 'a', 'b'], {
    count: 2,
    isFavorite: () => false,
    resolve: resolver(['a', 'b']),
  });
  assert.deepEqual(ids(apps), ['a', 'b']);
});

test('pick: a stored goa-daemon id resolves to the Online Accounts panel', () => {
  const seen = [];
  const apps = pickRecents(['a', GOA_DAEMON], {
    count: 5,
    isFavorite: () => false,
    resolve: resolver(['a', OA_PANEL, GOA_DAEMON], seen),
  });
  assert.deepEqual(ids(apps), ['a', OA_PANEL]);
  assert.ok(!seen.includes(GOA_DAEMON), 'the daemon launcher must not resolve');
});

test('pick: daemon and panel entries show one icon', () => {
  const apps = pickRecents([GOA_DAEMON, 'a', OA_PANEL], {
    count: 5,
    isFavorite: () => false,
    resolve: resolver(['a', OA_PANEL]),
  });
  assert.deepEqual(ids(apps), [OA_PANEL, 'a']);
});

test('pick: a pinned Online Accounts panel hides the stored daemon id', () => {
  const apps = pickRecents([GOA_DAEMON, 'a'], {
    count: 5,
    isFavorite: (id) => id === OA_PANEL,
    resolve: resolver(['a', OA_PANEL]),
  });
  assert.deepEqual(ids(apps), ['a']);
});

test('launchable: NoDisplay apps are hidden, Settings panels are not', () => {
  assert.equal(isLaunchable({ noDisplay: false, categories: 'GNOME;GTK;' }), true);
  assert.equal(isLaunchable({ noDisplay: true, categories: null }), false);
  assert.equal(isLaunchable({ noDisplay: true, categories: 'GNOME;' }), false);
  assert.equal(
    isLaunchable({
      noDisplay: true,
      categories: 'GNOME;GTK;Settings;DesktopSettings;X-GNOME-Settings-Panel;',
    }),
    true
  );
});

test('separator: none without a recents section', () => {
  assert.equal(recentSeparatorIndex([]), -1);
  assert.equal(recentSeparatorIndex(['favorite', 'running']), -1);
  assert.equal(recentSeparatorIndex(['favorite', 'favorite']), -1);
});

test('separator: sits between the running and the recent apps', () => {
  assert.equal(recentSeparatorIndex(['running', 'recent']), 1);
  assert.equal(
    recentSeparatorIndex(['favorite', 'favorite', 'running', 'running', 'recent', 'recent']),
    4
  );
});

test('separator: the Shell separator already splits pinned from recents', () => {
  assert.equal(recentSeparatorIndex(['favorite', 'recent']), -1);
  assert.equal(recentSeparatorIndex(['favorite', 'favorite', 'recent', 'recent']), -1);
});

test('separator: nothing before the recents means no separator', () => {
  assert.equal(recentSeparatorIndex(['recent', 'recent']), -1);
});

test('separator: a running app past the recents (mid-redisplay) adds none', () => {
  assert.equal(recentSeparatorIndex(['favorite', 'running', 'recent', 'running']), -1);
});

for (const [name, fn] of cases) {
  try {
    fn();
    check(true, name);
  } catch (err) {
    check(false, `${name}: ${err.message}`);
  }
}
finish();
