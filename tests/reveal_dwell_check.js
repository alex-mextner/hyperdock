// gjs -m tests/reveal_dwell_check.js - edge-dwell state machine checks (pure
// logic, fake clock, no GNOME Shell). Exits 1 on failure.

import { RevealDwell } from '../revealDwell.js';
import { assert, createSuite } from './mini_test.js';

// manual clock: schedule() arms, advance(ms) fires what is due; `pressure`
// is the live pressure-sense switch (h.state.pressure)
function harness(pressure = false) {
  const state = { pressure };
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const log = { reveals: 0, cancels: 0 };
  const dwell = new RevealDwell({
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, due: now + ms });
      return id;
    },
    cancel: (id) => {
      log.cancels++;
      assert.ok(timers.delete(id), 'cancel() of an unknown/expired handle');
    },
    onReveal: () => log.reveals++,
    pressureRequired: () => state.pressure,
  });
  return {
    dwell,
    log,
    state,
    timers,
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.due <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

const { test, run } = createSuite();

test('on the edge for the full delay reveals', () => {
  const h = harness();
  h.dwell.enter(300);
  h.advance(299);
  assert.equal(h.log.reveals, 0, 'revealed before 300 ms');
  h.advance(1);
  assert.equal(h.log.reveals, 1);
  assert.equal(h.timers.size, 0);
});

test('leaving before the delay cancels, nothing reveals later', () => {
  const h = harness();
  h.dwell.enter(300);
  h.advance(200);
  h.dwell.cancel();
  assert.equal(h.timers.size, 0, 'timer leaked after leave');
  h.advance(5000);
  assert.equal(h.log.reveals, 0);
});

test('re-entering restarts the full delay', () => {
  const h = harness();
  h.dwell.enter(300);
  h.advance(250);
  h.dwell.cancel();
  h.dwell.enter(300);
  h.advance(250);
  assert.equal(h.log.reveals, 0, 'the first visit must not count');
  h.advance(50);
  assert.equal(h.log.reveals, 1);
});

test('delay 0 reveals immediately (old behaviour) with no timer', () => {
  const h = harness();
  h.dwell.enter(0);
  assert.equal(h.log.reveals, 1);
  assert.equal(h.timers.size, 0);
});

test('a non-finite delay degrades to immediate, never to "never"', () => {
  const h = harness();
  h.dwell.enter(NaN);
  assert.equal(h.log.reveals, 1);
});

test('reveals once per visit', () => {
  const h = harness();
  h.dwell.enter(300);
  h.advance(300);
  h.dwell.pressure();
  h.dwell.touch(300);
  h.advance(5000);
  assert.equal(h.log.reveals, 1);
});

test('pressure sense: pressure before the dwell still waits for it', () => {
  const h = harness(true);
  h.dwell.enter(300);
  h.dwell.pressure();
  assert.equal(h.log.reveals, 0, 'pressure alone revealed');
  h.advance(299);
  assert.equal(h.log.reveals, 0);
  h.advance(1);
  assert.equal(h.log.reveals, 1);
});

test('pressure sense: dwell before the pressure still waits for it', () => {
  const h = harness(true);
  h.dwell.enter(300);
  h.advance(1000);
  assert.equal(h.log.reveals, 0, 'dwell alone revealed under pressure sense');
  h.dwell.pressure();
  assert.equal(h.log.reveals, 1);
});

test('pressure sense: pressure with delay 0 reveals on pressure', () => {
  const h = harness(true);
  h.dwell.enter(0);
  assert.equal(h.log.reveals, 0);
  h.dwell.pressure();
  assert.equal(h.log.reveals, 1);
});

test('pressure ignored off the edge', () => {
  const h = harness(true);
  h.dwell.pressure();
  assert.equal(h.log.reveals, 0);
  h.dwell.enter(300);
  h.dwell.cancel();
  h.dwell.pressure();
  h.advance(1000);
  assert.equal(h.log.reveals, 0);
});

test('touch starts a dwell only when none is running', () => {
  const h = harness(true);
  h.dwell.touch(300);
  assert.equal(h.dwell.pending, true);
  h.advance(200);
  h.dwell.touch(300);
  h.advance(100);
  h.dwell.pressure();
  assert.equal(h.log.reveals, 1, 'touch restarted the running dwell');
});

test('enter restarts a running dwell and leaks no timer', () => {
  const h = harness();
  h.dwell.enter(300);
  h.advance(200);
  h.dwell.enter(300);
  assert.equal(h.timers.size, 1);
  assert.equal(h.log.cancels, 1, 'the superseded timer was not cancelled');
  h.advance(299);
  assert.equal(h.log.reveals, 0);
  h.advance(1);
  assert.equal(h.log.reveals, 1);
});

test('cancel (disable / show elsewhere) drops the timer; idempotent', () => {
  const h = harness();
  h.dwell.enter(300);
  h.dwell.cancel();
  h.dwell.cancel();
  assert.equal(h.timers.size, 0);
  assert.equal(h.dwell.pending, false);
  assert.equal(h.dwell.onEdge, false);
  h.advance(5000);
  assert.equal(h.log.reveals, 0);
});

test('a negative delay degrades to immediate', () => {
  const h = harness();
  h.dwell.enter(-50);
  assert.equal(h.log.reveals, 1);
});

test('touch after the dwell elapsed (pressure pending) does not re-arm', () => {
  const h = harness(true);
  h.dwell.enter(300);
  h.advance(300);
  h.dwell.touch(300);
  assert.equal(h.dwell.pending, false, 'touch started a fresh dwell');
  h.dwell.pressure();
  assert.equal(h.log.reveals, 1);
});

test('pressure sense switched off mid-dwell releases the waiting reveal', () => {
  const h = harness(true);
  h.dwell.enter(300);
  h.state.pressure = false;
  h.advance(299);
  assert.equal(h.log.reveals, 0);
  h.advance(1);
  assert.equal(h.log.reveals, 1, 'stuck waiting for a pressure that never comes');
});

test('pressure sense switched off after the dwell elapsed reveals on recheck', () => {
  const h = harness(true);
  h.dwell.enter(300);
  h.advance(300);
  assert.equal(h.log.reveals, 0, 'dwell done but pressure still required');
  h.state.pressure = false;
  h.dwell.recheck();
  assert.equal(h.log.reveals, 1, 'dock stays hidden until the pointer re-enters');
  h.dwell.recheck();
  assert.equal(h.log.reveals, 1, 'recheck never reveals twice');
});

test('recheck off the strip or before the dwell elapsed does nothing', () => {
  const h = harness(false);
  h.dwell.recheck();
  assert.equal(h.log.reveals, 0);
  h.dwell.enter(300);
  h.advance(100);
  h.dwell.recheck();
  assert.equal(h.log.reveals, 0);
});

test('revealing from inside onReveal may cancel without a double reveal', () => {
  let reveals = 0;
  const timers = new Map();
  const dwell = new RevealDwell({
    schedule: (fn) => {
      timers.set(1, fn);
      return 1;
    },
    cancel: (id) => timers.delete(id),
    onReveal: () => {
      reveals++;
      dwell.cancel(); // what AutoHide.show() does
    },
  });
  dwell.enter(300);
  timers.get(1)();
  dwell.pressure();
  assert.equal(reveals, 1);
  assert.equal(dwell.onEdge, false);
});

run();
