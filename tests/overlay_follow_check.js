// gjs -m tests/overlay_follow_check.js
// A bounce translates the icon's renderer; badges/counters/progress overlays
// must carry exactly the same offset on every frame, and so must the running dots,
// whose baseline lives on an inner actor and is untouched at rest.
import System from 'system';

import { TranslationFollower } from '../overlayFollow.js';

let failures = 0;
function check(cond, msg) {
  print(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}

// Actor with GObject-like translation properties and notify emission
class FakeActor {
  constructor() {
    this._tx = 0;
    this._ty = 0;
    this._handlers = [];
  }
  get translationX() { return this._tx; }
  get translationY() { return this._ty; }
  set translationX(v) { if (v !== this._tx) { this._tx = v; this._emit('notify::translation-x'); } }
  set translationY(v) { if (v !== this._ty) { this._ty = v; this._emit('notify::translation-y'); } }
  connectObject(...args) {
    let owner = args.pop();
    for (let i = 0; i < args.length; i += 2) this._handlers.push({ sig: args[i], cb: args[i + 1], owner });
  }
  disconnectObject(owner) {
    this._handlers = this._handlers.filter(h => h.owner !== owner);
  }
  _emit(sig) {
    for (let h of [...this._handlers]) if (h.sig === sig) h.cb();
  }
}

// the dock's launch bounce: rise to `travel`, then bounce back, 3 hops
function bounceOffset(frame, travel) {
  let hop = frame % 40;
  return hop < 10 ? (travel * hop) / 10 : travel * Math.abs(Math.cos(((hop - 10) / 30) * Math.PI * 1.5)) * (1 - (hop - 10) / 60);
}

for (let [label, axis, sign] of [['bottom', 'translationY', -1], ['left', 'translationX', 1], ['top', 'translationY', 1]]) {
  let renderer = new FakeActor();
  let badge = new FakeActor();
  let dots = new FakeActor();
  let follower = new TranslationFollower(badge);
  let dotsFollower = new TranslationFollower(dots);
  follower.to(renderer);
  dotsFollower.to(renderer);
  let mismatched = 0;
  let dotsOff = 0;
  let moved = 0;
  for (let frame = 0; frame < 130; frame++) {
    renderer[axis] = sign * bounceOffset(frame, 21.5);
    // overlay update pass of the same frame must not disturb the offset
    if (frame % 3 === 0) { follower.to(renderer); dotsFollower.to(renderer); }
    if (badge.translationX !== renderer.translationX || badge.translationY !== renderer.translationY) mismatched++;
    if (dots.translationX !== renderer.translationX || dots.translationY !== renderer.translationY) dotsOff++;
    if (renderer[axis] !== 0) moved++;
  }
  // the bounce's last frame resets the offset
  renderer.translationX = 0;
  renderer.translationY = 0;
  check(moved > 60, `${label}: the bounce actually moves the renderer (${moved} frames)`);
  check(mismatched === 0, `${label}: badge offset equals icon offset on every frame`);
  check(dotsOff === 0, `${label}: dots offset equals icon offset on every frame`);
  check(dots.translationX === 0 && dots.translationY === 0, `${label}: dots overlay offset is 0 after the bounce`);
  check(badge.translationX === 0 && badge.translationY === 0, `${label}: badge is back at rest after the bounce`);
}

// pooled renderer swapped under the overlay: follow the new one only
{
  let a = new FakeActor();
  let b = new FakeActor();
  let badge = new FakeActor();
  let follower = new TranslationFollower(badge);
  follower.to(a);
  a.translationY = -5;
  follower.to(b);
  check(badge.translationY === 0, 'rebinding adopts the new renderer translation immediately');
  a.translationY = -9;
  check(badge.translationY === 0, 'the old renderer no longer drives the overlay');
  b.translationY = -7;
  check(badge.translationY === -7, 'the new renderer drives the overlay');
  follower.to(null);
  b.translationY = -8;
  check(badge.translationY === -7, 'unbound overlay keeps its last offset');
}

// several items, each bouncing; mid-bounce restart and cancel leave no residue
{
  const BASELINE_Y = 100; // shared, from indicatorPlacement, never touched by follow
  let items = [0, 1, 2].map(() => {
    let renderer = new FakeActor();
    let dots = new FakeActor();
    dots.y = BASELINE_Y;
    new TranslationFollower(dots).to(renderer);
    return { renderer, dots };
  });
  let [a, b, c] = items;
  for (let f = 0; f < 25; f++) a.renderer.translationY = -bounceOffset(f, 20);
  // a new bounce starts mid-bounce: the renderer restarts from its own value
  a.renderer.translationY = 0;
  for (let f = 0; f < 25; f++) {
    a.renderer.translationY = -bounceOffset(f, 20);
    check(a.dots.translationY === a.renderer.translationY, `restart frame ${f}: no accumulated offset`);
  }
  b.renderer.translationY = -12; // interrupted: reset without finishing
  b.renderer.translationY = 0;
  a.renderer.translationY = 0;
  check(items.every(i => i.dots.translationX === 0 && i.dots.translationY === 0), 'after end/cancel/interrupt no dots offset remains');
  check(items.every(i => i.dots.y === BASELINE_Y && i.dots.y === c.dots.y), 'dots baseline y identical across items');
}

if (failures) {
  print(`${failures} check(s) failed`);
  System.exit(1);
}
print('all passed');
