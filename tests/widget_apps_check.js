// node tests/widget_apps_check.js - Calendar/Clock widget helpers: next-midnight
// computation, midnight ticker, app detection and the auto-pin decision (pure
// logic, no GNOME Shell). Exits 1 on failure.
process.env.TZ = 'America/New_York'; // DST-aware zone, set before any Date use

import assert from 'node:assert/strict';

import {
  nextMidnightDelayMs,
  MidnightTicker,
  pickWidgetApp,
  decidePin,
  describeWidgetApp,
} from '../widgetApps.js';

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}\n     ${e.message}`);
  }
}

const SEC = 1000;
const HOUR = 3600 * SEC;

test('delay to the next midnight counts down within a day', () => {
  assert.equal(nextMidnightDelayMs(new Date(2026, 9, 23, 23, 59, 30)), 30 * SEC);
  assert.equal(nextMidnightDelayMs(new Date(2026, 9, 23, 12, 0, 0)), 12 * HOUR);
});

test('exactly at midnight the next one is a full day away', () => {
  assert.equal(nextMidnightDelayMs(new Date(2026, 9, 23, 0, 0, 0, 0)), 24 * HOUR);
});

test('month and year boundaries roll over', () => {
  assert.equal(nextMidnightDelayMs(new Date(2026, 11, 31, 23, 0, 0)), HOUR);
  assert.equal(nextMidnightDelayMs(new Date(2028, 1, 28, 12, 0, 0)), 12 * HOUR); // leap year: Feb 29 follows
});

test('a DST day is 23 or 25 hours long, not 24', () => {
  // 2026-03-08 spring forward (23 h day), 2026-11-01 fall back (25 h day)
  assert.equal(nextMidnightDelayMs(new Date(2026, 2, 8, 0, 30, 0)), 22.5 * HOUR);
  assert.equal(nextMidnightDelayMs(new Date(2026, 10, 1, 0, 30, 0)), 24.5 * HOUR);
});

test('the delay is never below one second', () => {
  assert.ok(nextMidnightDelayMs(new Date(2026, 9, 23, 23, 59, 59, 999)) >= SEC);
});

function ticker(start) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  const log = { ticks: 0 };
  const t = new MidnightTicker({
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, due: now.getTime() + ms });
      return id;
    },
    cancel: (id) => assert.ok(timers.delete(id), 'cancel of unknown handle'),
    now: () => now,
    onMidnight: () => log.ticks++,
  });
  return {
    t,
    log,
    timers,
    setNow(d) {
      now = d;
    },
    advance(ms) {
      now = new Date(now.getTime() + ms);
      for (const [id, tm] of [...timers]) {
        if (tm.due <= now.getTime()) {
          timers.delete(id);
          tm.fn();
        }
      }
    },
  };
}

test('ticker fires after midnight and re-arms for the next one', () => {
  const h = ticker(new Date(2026, 9, 23, 23, 0, 0));
  h.t.start();
  assert.equal(h.timers.size, 1);
  h.advance(HOUR - 1);
  assert.equal(h.log.ticks, 0);
  h.advance(1);
  assert.equal(h.log.ticks, 1);
  assert.equal(h.timers.size, 1, 'next midnight armed');
  h.advance(24 * HOUR);
  assert.equal(h.log.ticks, 2);
});

test('rearm (resume / timezone change) redraws now and keeps one timer', () => {
  const h = ticker(new Date(2026, 9, 23, 23, 0, 0));
  h.t.start();
  h.setNow(new Date(2026, 9, 24, 8, 0, 0)); // slept through midnight
  h.t.rearm();
  assert.equal(h.log.ticks, 1);
  assert.equal(h.timers.size, 1);
  h.advance(16 * HOUR);
  assert.equal(h.log.ticks, 2);
});

test('stop drops the pending timer and is idempotent', () => {
  const h = ticker(new Date(2026, 9, 23, 12, 0, 0));
  h.t.start();
  h.t.stop();
  h.t.stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.log.ticks, 0);
});

test('start twice never stacks timers', () => {
  const h = ticker(new Date(2026, 9, 23, 12, 0, 0));
  h.t.start();
  h.t.start();
  assert.equal(h.timers.size, 1);
});

const CAL = ['org.gnome.Calendar.desktop'];

test('the known app wins, with source "app"', () => {
  const got = pickWidgetApp(CAL, (id) => id === CAL[0], 'thunderbird.desktop');
  assert.deepEqual(got, { id: CAL[0], source: 'app' });
});

test('falls back to the text/calendar handler, flagged as such', () => {
  const got = pickWidgetApp(CAL, () => false, 'thunderbird.desktop');
  assert.deepEqual(got, { id: 'thunderbird.desktop', source: 'handler' });
});

test('nothing installed and no handler -> null', () => {
  assert.equal(pickWidgetApp(CAL, () => false, null), null);
  assert.equal(pickWidgetApp(['org.gnome.clocks.desktop'], () => false, null), null);
});

const ID = 'org.gnome.Calendar.desktop';
const pin = (o) => decidePin({ enabled: true, wasEnabled: false, appId: ID, favorites: [], ...o });

test('pin when the switch turns on and the app is not a favorite', () => {
  assert.equal(pin({}), 'pin');
});

test('no pin when already a favorite, undetected, or switched off', () => {
  assert.equal(pin({ favorites: ['a.desktop', ID] }), 'none');
  assert.equal(pin({ appId: null }), 'none');
  assert.equal(pin({ enabled: false }), 'none');
});

test('an unrelated toggle never re-pins what the user removed', () => {
  // calendar stays on, user dragged it off the dock, then flips the clock:
  // the calendar switch did not transition, so it must not come back
  assert.equal(pin({ wasEnabled: true }), 'none');
});

test('disabling never unpins: no input yields anything but pin/none', () => {
  for (const enabled of [true, false])
    for (const wasEnabled of [true, false])
      for (const favorites of [[], [ID]])
        for (const appId of [ID, null])
          assert.ok(
            ['pin', 'none'].includes(decidePin({ enabled, wasEnabled, appId, favorites }))
          );
  assert.equal(pin({ enabled: false, wasEnabled: true, favorites: [ID] }), 'none');
});

test('a throwing redraw does not stop the midnight chain', () => {
  let now = new Date(2026, 9, 23, 23, 0, 0);
  const timers = new Map();
  let id = 0;
  let calls = 0;
  const origError = console.error;
  console.error = () => {};
  const t = new MidnightTicker({
    schedule: (fn, ms) => (timers.set(++id, { fn, due: now.getTime() + ms }), id),
    cancel: (h) => timers.delete(h),
    now: () => now,
    onMidnight: () => {
      calls++;
      throw new Error('boom');
    },
  });
  try {
    t.start();
    now = new Date(now.getTime() + HOUR);
    const [[h, tm]] = [...timers];
    timers.delete(h);
    tm.fn();
    assert.equal(calls, 1);
    assert.equal(timers.size, 1, 'next midnight armed despite the throw');
  } finally {
    console.error = origError;
  }
});

test('row names the detected app and stays sensitive', () => {
  const r = describeWidgetApp('calendar', {
    id: 'org.gnome.Calendar.desktop',
    name: 'Calendar',
    source: 'app',
  });
  assert.equal(r.sensitive, true);
  assert.match(r.subtitle, /Uses: Calendar\./);
  assert.doesNotMatch(r.subtitle, /an calendar/i);
});

test('handler fallback says the widget is drawn over its icon', () => {
  const r = describeWidgetApp('calendar', {
    id: 'thunderbird.desktop',
    name: 'Thunderbird',
    source: 'handler',
  });
  assert.match(r.subtitle, /Uses: Thunderbird\./);
  assert.match(r.subtitle, /default handler/);
  assert.match(r.subtitle, /[Pp]inned/);
});

test('missing app but switch already on: row stays sensitive to switch off', () => {
  const r = describeWidgetApp('calendar', null, undefined, true);
  assert.equal(r.sensitive, true);
  assert.match(r.subtitle, /not installed/);
});

test('missing app: row insensitive with an install hint', () => {
  const c = describeWidgetApp('calendar', null);
  assert.equal(c.sensitive, false);
  assert.match(c.subtitle, /GNOME Calendar/);
  const k = describeWidgetApp('clock', null);
  assert.equal(k.sensitive, false);
  assert.match(k.subtitle, /GNOME Clocks/);
});

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('widget apps: all passed');
