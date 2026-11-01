// The animator's per-frame arithmetic with no actors and no Shell: easing steps,
// presence, normalization sizes and slot offsets. Pure functions over numbers so
// tests/animator_math_check.js can pin each one (the animator itself needs the Shell).

const ANIM_SIZE_PER_SEC = 250 / 1000;

// an icon the dock has not seen before opens its slot by this share of the
// remaining way per 16.6 ms frame, and counts as open from PRESENCE_DONE on
const PRESENCE_RATE = 0.2;
const PRESENCE_DONE = 0.995;
// frames go on while an icon is further than this (px) from where it is going
const SETTLE_EPSILON = 0.25;
// share of the opacity range a faded-in dock covers per millisecond
const FADE_PER_MS = 255 / 500;

// 35% of the remaining distance per frame; snaps once it is imperceptible
export function easeToward(current, target) {
  return Math.abs(target - current) < 0.001
    ? target
    : current + (target - current) * 0.35;
}

/** Share of the remaining way an opening slot covers in a frame of `dt` ms. */
export function presenceOpenStep(dt) {
  return 1 - Math.pow(1 - PRESENCE_RATE, dt > 0 ? dt / 16.6 : 1);
}

/** How open a slot is one frame later; `openStep` comes from presenceOpenStep. */
export function advancePresence(presence, openStep) {
  if (presence >= 1) return presence;
  const next = presence + (1 - presence) * openStep;
  return next > PRESENCE_DONE ? 1 : next;
}

/** Opacity a fading-in dock gains in a frame of `dt` ms (never overshooting 255). */
export function fadeInStep(opacity, dt) {
  const dst = 255 - opacity;
  const mag = Math.abs(dst);
  const dir = Math.sign(dst);
  let perMs = FADE_PER_MS;
  if (perMs > mag / dt) perMs = mag / dt;
  return Math.floor(perMs * dt * dir);
}

/**
 * Share of the way to its goal an icon's offset covers in a frame (42% per
 * 16.6 ms, scaled by `slowDown`); the very first frame (`snap`) covers all of it.
 */
export function positionEase(dt, slowDown, snap) {
  const base = 0.42 * slowDown;
  let factor = 1.0 - Math.pow(1.0 - base, dt / 16.6);
  // a massive or invalid dt must not fling anything
  if (isNaN(factor) || factor > 1.0) factor = 1.0;
  if (factor < 0.0) factor = 0.0;
  if (snap) factor = 1.0;
  return factor;
}

/** One axis of an offset after one eased step toward `goal`. */
export function easedOffset(current, goal, factor) {
  return current + (goal - current) * factor;
}

/** Frames go on while an icon is not yet where it is going. */
export function isSettling(goalX, goalY, x, y) {
  return Math.abs(goalX - x) > SETTLE_EPSILON || Math.abs(goalY - y) > SETTLE_EPSILON;
}

/**
 * Texture size a renderer is loaded at: it covers the largest magnified size in
 * steps of 16 (so a small layout change does not reload every texture), and
 * never less than the quality floor.
 */
export function textureBaseSize(unscaledIconSize, scaleAtMax, iconQuality) {
  return Math.max(
    32 * (iconQuality || 1),
    Math.ceil((unscaledIconSize * scaleAtMax) / 16) * 16
  );
}

/**
 * The slot size a renderer grows (or shrinks) to this frame: it moves toward
 * `targetSize` at a fixed pixel rate and settles halfway when a full step would
 * overshoot. Returns the signed step; the new size is `currentSize + step`.
 */
export function sizeStep(currentSize, targetSize, slowDown, dt) {
  const dst = targetSize - currentSize;
  const mag = Math.abs(dst);
  const dir = Math.sign(dst);
  const pixelOverTime = ANIM_SIZE_PER_SEC * slowDown;
  const appliedSize = pixelOverTime * dir * dt;
  return Math.abs(appliedSize) > mag ? dst * 0.5 : appliedSize;
}

/**
 * Where an icon's slot sits within its dash item, along x (`out.x`) and y
 * (`out.y`): centred, then pushed away from the docked edge by half of what the
 * icon rises above its item.
 */
export function slotOffsets(out, item, targetSize, vertical, left, bottom) {
  out.x = item.width / 2 - targetSize / 2;
  out.y = item.height / 2 - targetSize / 2;
  if (targetSize > item.height) {
    const rise = (targetSize - item.height) * 0.5;
    if (vertical) {
      out.x += rise * (left ? 1 : -1);
    } else {
      out.y += rise * (bottom ? -1 : 1);
    }
  }
}
