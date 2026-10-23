// gjs -m tests/drag_off_check.js - drag-off-remove gesture (pure logic, fake
// clock, no GNOME Shell): hold zone geometry, the hold/arm/disarm state
// machine, what a release removes. Exits 1 on failure.
import { createChecker } from './harness.js';
import { DragOffGesture, HOLD_MS, isOutside, removalKind } from '../dragOff.js';

// the few node:assert calls the cases use, for gjs (no node modules there)
const assert = {
  equal(actual, expected, msg = '') {
    if (actual !== expected) {
      throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  ok(value, msg = 'not ok') {
    if (!value) throw new Error(msg);
  },
};
const { check, finish } = createChecker();

// manual clock: schedule() arms, advance(ms) fires what is due
function harness() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const log = { arms: 0, disarms: 0 };
  const gesture = new DragOffGesture({
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, due: now + ms });
      return id;
    },
    cancel: (id) => {
      assert.ok(timers.delete(id), 'cancel() of an unknown/expired handle');
    },
    onArm: () => log.arms++,
    onDisarm: () => log.disarms++,
  });
  return {
    gesture,
    log,
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

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('the hold is about a second', () => {
  assert.equal(HOLD_MS, 1000);
});

test('outside for the whole hold arms "Remove", with the pointer at rest', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  assert.equal(h.gesture.state, 'holding');
  h.advance(HOLD_MS - 1);
  assert.equal(h.log.arms, 0, 'armed before the hold was over');
  h.advance(1);
  assert.equal(h.gesture.state, 'armed');
  assert.equal(h.log.arms, 1);
  assert.equal(h.timers.size, 0);
});

test('letting go before the hold is over removes nothing', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.advance(HOLD_MS - 100);
  assert.equal(h.gesture.drop(true), false);
  assert.equal(h.timers.size, 0, 'hold timer leaked');
  h.advance(5000);
  assert.equal(h.log.arms, 0);
  assert.equal(h.gesture.state, 'idle');
});

test('letting go armed and still outside removes, and un-shows "Remove"', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.advance(HOLD_MS);
  assert.equal(h.gesture.drop(true), true);
  assert.equal(h.gesture.state, 'idle');
  assert.equal(h.log.disarms, 1);
});

test('letting go over the dock removes nothing, even when armed a moment ago', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.advance(HOLD_MS);
  // the last motion sample was not processed yet: the release says inside
  assert.equal(h.gesture.drop(false), false);
  assert.equal(h.log.disarms, 1);
});

test('dragging back after "Remove" showed hides it; letting go then removes nothing', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.advance(HOLD_MS);
  h.gesture.move(false, HOLD_MS);
  assert.equal(h.gesture.state, 'inside');
  assert.equal(h.log.disarms, 1);
  assert.equal(h.gesture.drop(false), false);
  assert.equal(h.log.arms, 1);
});

test('back in before the hold is over: it never arms', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.advance(600);
  h.gesture.move(false, HOLD_MS);
  assert.equal(h.timers.size, 0, 'hold timer leaked');
  h.advance(5000);
  assert.equal(h.log.arms, 0);
  assert.equal(h.gesture.state, 'inside');
});

test('going out again restarts the whole hold', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.advance(600);
  h.gesture.move(false, HOLD_MS);
  h.gesture.move(true, HOLD_MS);
  h.advance(600);
  assert.equal(h.log.arms, 0, 'the first visit must not count');
  h.advance(400);
  assert.equal(h.log.arms, 1);
});

test('hand jitter outside does not restart the hold', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.advance(600);
  h.gesture.move(true, HOLD_MS);
  h.gesture.move(true, HOLD_MS);
  h.advance(400);
  assert.equal(h.log.arms, 1);
});

test('hold 0 arms the moment the pointer is out, no timer', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(false, 0);
  assert.equal(h.log.arms, 0);
  h.gesture.move(true, 0);
  assert.equal(h.gesture.state, 'armed');
  assert.equal(h.timers.size, 0);
});

test('no drag, nothing happens: samples and releases are ignored', () => {
  const h = harness();
  h.gesture.move(true, HOLD_MS);
  assert.equal(h.gesture.state, 'idle');
  assert.equal(h.timers.size, 0);
  assert.equal(h.gesture.drop(true), false);
});

test('end() stops the hold, un-shows "Remove" once, and is repeatable', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.gesture.end();
  assert.equal(h.timers.size, 0);
  assert.equal(h.log.disarms, 0, 'nothing was shown');

  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.advance(HOLD_MS);
  h.gesture.end();
  h.gesture.end();
  assert.equal(h.log.disarms, 1);
  assert.equal(h.gesture.state, 'idle');
});

test('a new drag starts clean after a cancelled one', () => {
  const h = harness();
  h.gesture.begin();
  h.gesture.move(true, HOLD_MS);
  h.advance(HOLD_MS);
  h.gesture.begin();
  assert.equal(h.gesture.state, 'inside');
  assert.equal(h.log.arms, h.log.disarms, 'Remove left showing');
});

test('arm and disarm come in pairs over a long drag', () => {
  const h = harness();
  h.gesture.begin();
  for (let i = 0; i < 3; i++) {
    h.gesture.move(true, HOLD_MS);
    h.advance(HOLD_MS);
    h.gesture.move(false, HOLD_MS);
  }
  h.gesture.move(true, HOLD_MS);
  h.advance(HOLD_MS);
  h.gesture.end();
  assert.equal(h.log.arms, 4);
  assert.equal(h.log.disarms, 4);
});

test('zone: a bottom dock, outside by more than the margin on any side', () => {
  const dock = [100, 700, 1000, 100];
  assert.equal(isOutside(dock, 40, 500, 750), false, 'on the dock');
  assert.equal(isOutside(dock, 40, 500, 661), false, 'just above');
  assert.equal(isOutside(dock, 40, 500, 659), true, 'above');
  assert.equal(isOutside(dock, 40, 59, 750), true, 'left of it');
  assert.equal(isOutside(dock, 40, 1141, 750), true, 'right of it');
  assert.equal(isOutside(dock, 40, 500, 841), true, 'below it');
});

test('zone: a left and a right dock work the same way', () => {
  const left = [0, 100, 90, 600];
  assert.equal(isOutside(left, 45, 40, 400), false);
  assert.equal(isOutside(left, 45, 134, 400), false);
  assert.equal(isOutside(left, 45, 136, 400), true, 'right of a left dock');
  assert.equal(isOutside(left, 45, 40, 54), true, 'above it');
  const right = [1110, 100, 90, 600];
  assert.equal(isOutside(right, 45, 1150, 400), false);
  assert.equal(isOutside(right, 45, 1064, 400), true, 'left of a right dock');
  assert.equal(isOutside(right, 45, 1066, 400), false);
});

test('what a release removes: pinned unpins, recent forgets, the rest nothing', () => {
  const on = { enabled: true, overviewOpen: false };
  assert.equal(removalKind({ ...on, pinned: true, recent: false }), 'unpin');
  assert.equal(removalKind({ ...on, pinned: false, recent: true }), 'forget');
  assert.equal(removalKind({ ...on, pinned: false, recent: false }), null, 'running only');
  assert.equal(removalKind({ enabled: false, overviewOpen: false, pinned: true, recent: false }), null);
  assert.equal(removalKind({ enabled: true, overviewOpen: true, pinned: true, recent: false }), null);
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
