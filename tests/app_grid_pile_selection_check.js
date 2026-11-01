// gjs -m tests/app_grid_pile_selection_check.js - which apps the app-grid pile
// shows (pure logic, no GNOME Shell): counts, exclusions, order, stability.
// Exits 1 on failure.
import { assert, createSuite } from './mini_test.js';
import { dockKeys } from '../appGridPileDock.js';
import {
  interleave,
  isHelperId,
  newestFirst,
  selectPileApps,
} from '../appGridPileSelection.js';

const { test, run } = createSuite();

const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}.desktop`);
// installed apps, newest first: n1 is the newest
const installedApps = (n) =>
  ids('n', n).map((id, i) => ({ id, time: 1000 - i }));

// dock: the ids of every app the dock shows (pinned, running, in Recents)
function select({ dock = [], ...overrides } = {}) {
  return selectPileApps({
    mostUsed: ids('f', 12),
    installed: installedApps(10),
    dockKeys: dockKeys(dock.map((id) => ({ id }))),
    usable: () => true,
    frequentCount: 6,
    recentCount: 3,
    ...overrides,
  });
}

test('picks 6 most used and 3 newest installed by default', () => {
  const { frequent, recent, order } = select();
  assert.deepEqual(frequent, ids('f', 6));
  assert.deepEqual(recent, ids('n', 3));
  assert.equal(order.length, 9, 'apps in the pile');
});

test('most used keep the Shell order, newest installed come newest first', () => {
  const { frequent, recent } = select({
    mostUsed: ['z.desktop', 'a.desktop', 'm.desktop'],
    installed: [
      { id: 'old.desktop', time: 10 },
      { id: 'new.desktop', time: 30 },
      { id: 'mid.desktop', time: 20 },
    ],
    frequentCount: 3,
  });
  assert.deepEqual(frequent, ['z.desktop', 'a.desktop', 'm.desktop']);
  assert.deepEqual(recent, ['new.desktop', 'mid.desktop', 'old.desktop']);
});

test('recent installs skip every app in the dock', () => {
  const { recent } = select({ dock: ['n1.desktop', 'n2.desktop'] });
  assert.deepEqual(recent, ['n3.desktop', 'n4.desktop', 'n5.desktop']);
});

test('most used apps in the dock leave the pile, the next most used fill in', () => {
  const { frequent } = select({ dock: ['f1.desktop', 'f3.desktop'] });
  assert.deepEqual(frequent, ['f2.desktop', 'f4.desktop', 'f5.desktop', 'f6.desktop', 'f7.desktop', 'f8.desktop']);
  assert.equal(frequent.length, 6, 'still six');
});

test('exact counts 3 + 6 when the dock takes apps from both lists', () => {
  const dock = ['f1.desktop', 'f2.desktop', 'n1.desktop', 'n2.desktop', 'n3.desktop'];
  const { frequent, recent, order } = select({ dock });
  assert.equal(frequent.length, 6);
  assert.equal(recent.length, 3);
  assert.equal(order.length, 9);
  assert.ok(order.every((id) => !dock.includes(id)), 'a dock app leaked');
});

test('a dock app under another id of the same app leaves the pile', () => {
  const { frequent, recent } = select({
    mostUsed: ['firefox.desktop', 'f1.desktop', 'telegram-desktop_telegram-desktop.desktop', 'f2.desktop'],
    installed: [
      { id: 'org.mozilla.firefox.desktop', time: 9000 },
      { id: 'telegram-desktop_telegram-desktop.desktop', time: 8000 },
      ...installedApps(3),
    ],
    dock: ['org.mozilla.firefox.desktop', 'telegram-desktop.desktop'],
    frequentCount: 4,
  });
  assert.deepEqual(frequent, ['f1.desktop', 'f2.desktop']);
  assert.deepEqual(recent, ids('n', 3));
});

test('keysOf lets a launcher declare a window class that matches the dock', () => {
  const wm = { 'a.desktop': 'Shared', 'b.desktop': 'shared' };
  const { frequent } = select({
    mostUsed: ['a.desktop', 'f1.desktop'],
    dockKeys: dockKeys([{ id: 'b.desktop', wmClass: 'shared' }]),
    keysOf: (id) => [id.toLowerCase(), (wm[id] ?? '').toLowerCase()].filter(Boolean).map((key) => `w:${key}`),
    frequentCount: 2,
  });
  assert.deepEqual(frequent, ['f1.desktop']);
});

test('a short alias and a same-named other app in both groups', () => {
  const { frequent, recent } = select({
    mostUsed: ['vlc_vlc.desktop', 'org.example.Calculator.desktop', 'f1.desktop'],
    installed: [
      { id: 'vlc.desktop', time: 9000 },
      { id: 'org.example.Calculator.desktop', time: 8000 },
      ...installedApps(3),
    ],
    dock: ['org.videolan.VLC.desktop', 'org.gnome.Calculator.desktop'],
    frequentCount: 3,
  });
  assert.deepEqual(frequent, ['org.example.Calculator.desktop', 'f1.desktop']);
  assert.ok(!recent.includes('vlc.desktop'), 'vlc in the dock under another id');
});

test('two ids of one app in the lists count once', () => {
  const { frequent } = select({
    mostUsed: ['firefox.desktop', 'org.mozilla.firefox.desktop', 'f1.desktop'],
    frequentCount: 2,
  });
  assert.deepEqual(frequent, ['firefox.desktop', 'f1.desktop']);
});

test('recent installs never repeat a most used app', () => {
  const { recent, order } = select({
    installed: [
      { id: 'f2.desktop', time: 2000 },
      ...installedApps(5),
    ],
  });
  assert.deepEqual(recent, ['n1.desktop', 'n2.desktop', 'n3.desktop']);
  assert.equal(new Set(order).size, order.length, 'repeats in the order');
});

test("the dock's own launcher entries never show", () => {
  const { frequent, recent } = select({
    mostUsed: ['trash-hyperdock.desktop', 'f1.desktop', 'recents-hyperdock.desktop'],
    installed: [
      { id: 'mount-usb-hyperdock.desktop', time: 5000 },
      ...installedApps(3),
    ],
    frequentCount: 3,
  });
  assert.deepEqual(frequent, ['f1.desktop']);
  assert.deepEqual(recent, ids('n', 3));
  assert.ok(isHelperId('app-grid-hyperdock.desktop'), 'helper suffix');
  assert.ok(!isHelperId('org.gnome.Hyperdock.desktop'), 'only the suffix counts');
});

test('apps that are not usable are skipped and the next ones fill in', () => {
  const hidden = new Set(['f1.desktop', 'n1.desktop']);
  const { frequent, recent } = select({ usable: (id) => !hidden.has(id) });
  assert.deepEqual(frequent, ids('f', 7).slice(1));
  assert.deepEqual(recent, ids('n', 4).slice(1));
});

test('fewer apps than asked: no placeholders', () => {
  const { frequent, recent, order } = select({
    mostUsed: ids('f', 2),
    installed: installedApps(1),
  });
  assert.deepEqual(frequent, ids('f', 2));
  assert.deepEqual(recent, ids('n', 1));
  assert.equal(order.length, 3, 'apps in the pile');
});

test('nothing installed or used: an empty pile', () => {
  const picked = select({ mostUsed: [], installed: [] });
  assert.deepEqual(picked.order, []);
});

test('counts are honoured, 0 switches a group off', () => {
  assert.deepEqual(select({ recentCount: 0 }).recent, []);
  assert.deepEqual(select({ frequentCount: 0 }).frequent, []);
  assert.equal(select({ frequentCount: 2, recentCount: 1 }).order.length, 3, '2 + 1');
  assert.deepEqual(select({ frequentCount: -1, recentCount: NaN }).order, []);
});

test('equal install times fall back to the id: same input, same pile', () => {
  const tied = [
    { id: 'b.desktop', time: 5 },
    { id: 'c.desktop', time: 5 },
    { id: 'a.desktop', time: 5 },
  ];
  assert.deepEqual(newestFirst(tied), ['a.desktop', 'b.desktop', 'c.desktop']);
  assert.deepEqual(newestFirst([...tied].reverse()), ['a.desktop', 'b.desktop', 'c.desktop']);
});

test('selecting twice gives the same pile; the input is left alone', () => {
  const installed = installedApps(10);
  const before = JSON.stringify(installed);
  const a = select({ installed });
  const b = select({ installed });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(installed), before, 'installed list was reordered');
});

test('the pile mixes new and frequent apps, best first: F R F F R F F R F', () => {
  const { order } = select();
  assert.deepEqual(order, [
    'f1.desktop',
    'n1.desktop',
    'f2.desktop',
    'f3.desktop',
    'n2.desktop',
    'f4.desktop',
    'f5.desktop',
    'n3.desktop',
    'f6.desktop',
  ]);
});

test('interleave keeps each list in its own order and handles empty lists', () => {
  assert.deepEqual(interleave([], ['r1']), ['r1']);
  assert.deepEqual(interleave(['f1'], []), ['f1']);
  assert.deepEqual(interleave([], []), []);
  assert.deepEqual(interleave(['f1'], ['r1']), ['f1', 'r1'], 'on a tie the most used goes first');
  const mixed = interleave(ids('f', 4), ids('n', 2));
  assert.deepEqual(mixed.filter((id) => id.startsWith('f')), ids('f', 4));
  assert.deepEqual(mixed.filter((id) => id.startsWith('n')), ids('n', 2));
});

run();
