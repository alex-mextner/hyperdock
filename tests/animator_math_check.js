// gjs -m tests/animator_math_check.js
// Characterization of the animator's pure frame math (animatorMath.js) and the
// bounce timeline (animatorBounce.js). The expected numbers were taken from the
// animator before it was split into modules, by running its inline formulas.
import { createChecker } from './harness.js';
import {
  easeToward,
  presenceOpenStep,
  advancePresence,
  fadeInStep,
  positionEase,
  easedOffset,
  isSettling,
  textureBaseSize,
  sizeStep,
  slotOffsets,
} from '../animatorMath.js';
import { bounceFrames, bounceTravel } from '../animatorBounce.js';

const { check, finish } = createChecker();
const near = (a, b, msg) => check(Math.abs(a - b) < 1e-9, `${msg}: ${a} ~ ${b}`);

// easeToward: 35% of the way, snapping once imperceptible
near(easeToward(0, 10), 3.5, 'easeToward closes 35%');
check(easeToward(9.9995, 10) === 10, 'easeToward snaps within 0.001');
near(easeToward(-4, 4), -1.2, 'easeToward works downward');

// presence: an unseen icon opens by 20% of the rest per 16.6 ms
near(presenceOpenStep(16.6), 0.2, 'open step at 60 Hz');
near(presenceOpenStep(33.2), 0.36, 'open step at 30 Hz');
near(presenceOpenStep(0), 0.2, 'an unknown frame time counts as one frame');
near(advancePresence(0.5, presenceOpenStep(16)), 0.5967607828946134, 'presence advances');
check(advancePresence(0.99, 0.9) === 1, 'presence counts as open past 0.995');
check(advancePresence(1, 0.5) === 1, 'an open slot stays open');

// dock fade-in
check(fadeInStep(0, 16) === 8, 'fade-in gains 8 per 16 ms');
check(fadeInStep(250, 16) === 5, 'fade-in never overshoots 255');
check(fadeInStep(254, 100) === 1, 'fade-in finishes the last step');
check(fadeInStep(100, 0.001) === 0, 'a tiny frame gains nothing');

// position easing: 42% per 16.6 ms, clamped, snapping on the first frame
near(positionEase(16.6, 1, false), 0.42, 'position ease at 60 Hz');
near(positionEase(16, 0.5, false), 0.2032403779843449, 'position ease slowed down');
check(positionEase(0, 1, false) === 0, 'no time passed: no move');
check(positionEase(NaN, 1, false) === 1, 'an invalid frame time jumps to the goal');
near(positionEase(1000, 1, false), 1, 'a huge frame time all but reaches the goal');
check(positionEase(1000, 1, false) <= 1, 'and never passes it');
check(positionEase(16, 1, true) === 1, 'the first frame snaps');
check(positionEase(-16.6, 1, false) === 0, 'time running backwards never moves away');
near(easedOffset(10, 20, 0.25), 12.5, 'easedOffset moves a share of the way');
check(isSettling(10, 0, 9.5, 0), 'half a pixel from the goal is still settling');
check(!isSettling(10, 0, 9.8, 0.2), 'within a quarter pixel is settled');

// texture size: covers the largest magnified size in steps of 16, floor by quality
check(textureBaseSize(48, 2.2, 1) === 112, 'texture covers the magnified size');
check(textureBaseSize(10, 1.1, 2) === 64, 'texture never below the quality floor');
check(textureBaseSize(48, 1.9, 0) === 96, 'quality 0 counts as 1');

// size easing: fixed pixel rate, settling halfway when it would overshoot
near(sizeStep(40, 60, 1, 16), 4, 'grows 4 px per 16 ms');
near(sizeStep(40, 41, 1, 16), 0.5, 'a step that overshoots settles halfway');
near(sizeStep(60, 40, 0.5, 16), -2, 'shrinks slowed down');
check(sizeStep(50, 50, 1, 16) === 0, 'at the goal there is no step');

// slot placement within the dash item
{
  const out = { x: 0, y: 0 };
  const item = { width: 56, height: 56 };
  slotOffsets(out, item, 40, false, false, true);
  check(out.x === 8 && out.y === 8, 'a small icon is centred in its item');
  slotOffsets(out, item, 80, false, false, true);
  check(out.x === -12 && out.y === -12 - 12, 'a bigger icon rises up on a bottom dock');
  slotOffsets(out, item, 80, false, false, false);
  check(out.y === -12 + 12, 'a bigger icon rises down on a top dock');
  slotOffsets(out, item, 80, true, true, false);
  check(out.x === -12 + 12 && out.y === -12, 'a bigger icon rises right on a left dock');
  slotOffsets(out, item, 80, true, false, false);
  check(out.x === -12 - 12, 'a bigger icon rises left on a right dock');
}

// bounce timeline: `hops` x (rise, fall), then two closing frames
{
  const dock = { _iconSize: 48, extension: { animation_bounce_height: 0.5 } };
  near(bounceTravel(dock), 18, 'travel of a hop');
  const frames = bounceFrames({}, 'app.desktop', 24, 3);
  check(frames.length === 8, 'three hops are six frames plus two closing ones');
  check(
    frames.map((f) => f._duration).join() === '250,750,250,750,250,750,10,10',
    'bounce frame durations'
  );
  check(bounceFrames({}, 'app.desktop', 24, 1).length === 4, 'one hop is four frames');
}

finish();
