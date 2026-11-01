// gjs -m tests/app_first_seen_check.js - when an installed app was first seen
// (pure logic, no GNOME Shell): an upgrade never makes an old app new, a new
// app is as old as its launcher, a short absence is not a reinstall, a long one
// is. Exits 1 on failure.
import { assert, createSuite } from './mini_test.js';
import {
  GRACE,
  mergeFirstSeen,
  parseFirstSeen,
  serializeFirstSeen,
} from '../appFirstSeen.js';

const { test, run } = createSuite();
const NOW = 10_000_000;
const NOTHING = { firstSeen: {}, goneSince: {} };
const known = (firstSeen, goneSince = {}) => ({ firstSeen, goneSince });

test('a first run records every app with its launcher time', () => {
  const { state, changed } = mergeFirstSeen(
    NOTHING,
    [
      { id: 'a.desktop', time: 100 },
      { id: 'b.desktop', time: 200 },
    ],
    NOW
  );
  assert.deepEqual(state.firstSeen, { 'a.desktop': 100, 'b.desktop': 200 });
  assert.ok(changed, 'new ids are a change to store');
});

test('an upgrade rewrites the launcher but the app keeps its first time', () => {
  const { state, changed } = mergeFirstSeen(
    known({ 'firefox.desktop': 100 }),
    [{ id: 'firefox.desktop', time: NOW - 5 }],
    NOW
  );
  assert.deepEqual(state.firstSeen, { 'firefox.desktop': 100 });
  assert.ok(!changed, 'nothing to store');
});

test('a new app is as old as its launcher, never newer than now', () => {
  const { state } = mergeFirstSeen(
    known({ 'old.desktop': 1 }),
    [
      { id: 'old.desktop', time: 5 },
      { id: 'fresh.desktop', time: NOW - 10 },
      { id: 'skewed.desktop', time: NOW + 500 },
    ],
    NOW
  );
  assert.equal(state.firstSeen['fresh.desktop'], NOW - 10, 'installed while the extension was off');
  assert.equal(state.firstSeen['skewed.desktop'], NOW, 'a launcher dated in the future');
});

test('an unreadable launcher time: the oldest on a first run, new afterwards', () => {
  const first = mergeFirstSeen(NOTHING, [{ id: 'x.desktop', time: NaN }], NOW);
  assert.equal(first.state.firstSeen['x.desktop'], 0);
  const later = mergeFirstSeen(known({ 'a.desktop': 5 }), [{ id: 'a.desktop', time: 5 }, { id: 'y.desktop', time: 0 }], NOW);
  assert.equal(later.state.firstSeen['y.desktop'], NOW);
});

test('an app that is away for a while and comes back keeps its first time', () => {
  // a snap refresh: the launcher is gone for one scan, then rewritten
  const away = mergeFirstSeen(known({ 'snap.desktop': 50 }), [], NOW);
  assert.deepEqual(away.state.firstSeen, { 'snap.desktop': 50 });
  assert.deepEqual(away.state.goneSince, { 'snap.desktop': NOW });
  assert.ok(away.changed, 'the absence is noted');
  const back = mergeFirstSeen(away.state, [{ id: 'snap.desktop', time: NOW + 60 }], NOW + 120);
  assert.deepEqual(back.state.firstSeen, { 'snap.desktop': 50 });
  assert.deepEqual(back.state.goneSince, {}, 'back: no longer gone');
  assert.ok(back.changed, 'the return is stored');
});

test('an app that stays away longer than the grace period is forgotten, and new when it returns', () => {
  const away = mergeFirstSeen(known({ 'gone.desktop': 50, 'kept.desktop': 60 }), [{ id: 'kept.desktop', time: 60 }], NOW);
  const later = mergeFirstSeen(away.state, [{ id: 'kept.desktop', time: 60 }], NOW + GRACE + 1);
  assert.deepEqual(later.state.firstSeen, { 'kept.desktop': 60 });
  assert.deepEqual(later.state.goneSince, {});
  assert.ok(later.changed, 'the drop is stored');
  const back = mergeFirstSeen(later.state, [
    { id: 'kept.desktop', time: 60 },
    { id: 'gone.desktop', time: NOW + GRACE },
  ], NOW + GRACE + 2);
  assert.equal(back.state.firstSeen['gone.desktop'], NOW + GRACE);
});

test('just inside the grace period the record is still kept', () => {
  const away = mergeFirstSeen(known({ 'a.desktop': 7 }), [], NOW);
  const later = mergeFirstSeen(away.state, [], NOW + GRACE);
  assert.deepEqual(later.state.firstSeen, { 'a.desktop': 7 });
  assert.ok(!later.changed, 'nothing new to store');
});

test('merging is idempotent and leaves its input alone', () => {
  const start = known({ 'a.desktop': 1 });
  const before = JSON.stringify(start);
  const installed = [{ id: 'a.desktop', time: 7 }, { id: 'b.desktop', time: 8 }];
  const first = mergeFirstSeen(start, installed, NOW);
  const second = mergeFirstSeen(first.state, installed, NOW);
  assert.deepEqual(second.state, first.state);
  assert.ok(!second.changed, 'second pass changes nothing');
  assert.equal(JSON.stringify(start), before, 'input was modified');
});

test('an id that is also an Object.prototype name is an ordinary id', () => {
  const { state } = mergeFirstSeen(NOTHING, [{ id: 'constructor', time: 3 }, { id: 'toString', time: 4 }], NOW);
  assert.deepEqual(state.firstSeen, { constructor: 3, toString: 4 });
  const again = mergeFirstSeen(state, [{ id: 'constructor', time: 99 }, { id: 'toString', time: 99 }], NOW);
  assert.deepEqual(again.state.firstSeen, { constructor: 3, toString: 4 });
});

test('the stored state survives a round trip, and garbage reads as nothing known', () => {
  const state = known({ 'a.desktop': 1, 'b.desktop': 2.5 }, { 'b.desktop': 9 });
  assert.deepEqual(parseFirstSeen(serializeFirstSeen(state)), state);
  assert.deepEqual(parseFirstSeen(''), NOTHING);
  assert.deepEqual(parseFirstSeen('{not json'), NOTHING);
  assert.deepEqual(parseFirstSeen('null'), NOTHING);
  assert.deepEqual(parseFirstSeen('{"firstSeen": [1, 2]}'), NOTHING);
  assert.deepEqual(
    parseFirstSeen('{"firstSeen": {"a.desktop": 3, "b.desktop": "soon", "c.desktop": null}}'),
    known({ 'a.desktop': 3 })
  );
});

run();
