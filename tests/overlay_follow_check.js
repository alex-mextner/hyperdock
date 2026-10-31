// gjs -m tests/overlay_follow_check.js
// A bounce translates the icon's renderer; badges/counters/progress overlays
// must carry exactly the same offset on every frame, the running dots must not.
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
  let dots = new FakeActor(); // never follows: fixed running-state baseline
  let follower = new TranslationFollower(badge);
  follower.to(renderer);
  let mismatched = 0;
  let dotsMoved = 0;
  let moved = 0;
  for (let frame = 0; frame < 130; frame++) {
    renderer[axis] = sign * bounceOffset(frame, 21.5);
    // overlay update pass of the same frame must not disturb the offset
    if (frame % 3 === 0) follower.to(renderer);
    if (badge.translationX !== renderer.translationX || badge.translationY !== renderer.translationY) mismatched++;
    if (dots.translationX !== 0 || dots.translationY !== 0) dotsMoved++;
    if (renderer[axis] !== 0) moved++;
  }
  // the bounce's last frame resets the offset
  renderer.translationX = 0;
  renderer.translationY = 0;
  check(moved > 60, `${label}: the bounce actually moves the renderer (${moved} frames)`);
  check(mismatched === 0, `${label}: badge offset equals icon offset on every frame`);
  check(dotsMoved === 0, `${label}: dots overlay stays on the fixed baseline`);
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

if (failures) {
  print(`${failures} check(s) failed`);
  System.exit(1);
}
print('all passed');
