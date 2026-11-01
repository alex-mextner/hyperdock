// The launch/attention bounce of a dock icon, as frames for the hi-res timer.
//
// A bounce is an offset of the icon's appwell along the axis away from the docked
// edge, mirrored onto the pooled renderer that draws the icon (the badge, counter,
// progress and running dots follow the renderer: overlayFollow.js). Each frame
// looks the icon up again by app id, because items come and go while it runs; with
// nothing to look up (dragging, disabled, item removed) the frame does nothing.
//
// `animator` is the Animator that owns the pooled renderers: this module reads its
// `dock`, its `_target` (null once disabled) and its edge() flags.
import { Bounce, Linear } from './effects/easing.js';
import { getAppId } from './compat.js';

// the rise lasts this long (ms); the fall back (a bounce easing) three times as long
const RISE_MS = 250;
const FALL_MS = RISE_MS * 3;
// a bounce's closing frames
const CLOSE_MS = 10;

const NO_TARGET = [null, null];

/** How far (px) an icon rises at the top of a hop. */
export function bounceTravel(dock) {
  return (
    (dock._iconSize / 3) * ((0.25 + dock.extension.animation_bounce_height) * 1.5)
  );
}

// [container, appwell] of the app's icon right now, or [null, null]
function findTarget(animator, appId) {
  const dock = animator.dock;
  // disabled: the pool is destroyed and container._renderer is stale
  if (!animator._target) return NO_TARGET;
  if (dock._dragging) return NO_TARGET;
  const icon = dock._findIcons().find((candidate) => {
    return candidate._appwell && getAppId(candidate._appwell) === appId;
  });
  if (!icon || !icon._appwell) return NO_TARGET;
  return [icon._appwell.get_parent(), icon._appwell];
}

// Offsets the appwell by `res` away from the docked edge and copies it onto the
// renderer along the same axis.
function offsetBy(animator, container, appwell, res) {
  const edge = animator.edge();
  if (edge.vertical) {
    appwell.translation_x = edge.left ? res : -res;
    if (container._renderer) {
      container._renderer.translationX = appwell.translationX;
    }
  } else {
    appwell.translation_y = edge.bottom ? -res : res;
    if (container._renderer) {
      container._renderer.translationY = appwell.translationY;
    }
  }
}

// Mirrors the appwell's Y onto the icon's other drawn parts and keeps its label
// from showing while it bounces.
function translateDecor(container, appwell) {
  try {
    if (!container._icon) return;
    if (container._renderer) {
      container._renderer.translationY = appwell.translationY;
    }
    if (container._image) {
      container._image.translationY = appwell.translationY;
    }
    if (container._badge) {
      container._badge.translationY = appwell.translationY;
    }
    if (container._label) {
      container._label.opacity = 0;
    }
  } catch (err) {
    console.log(err);
  }
}

// one frame of a hop: the icon is `res` px away from its resting place
function hopFrame(animator, appId, res) {
  const [container, appwell] = findTarget(animator, appId);
  if (!appwell) return;
  try {
    appwell._bounce = true;
    offsetBy(animator, container, appwell, res);
  } catch (err) {
    console.log(err);
  }
  translateDecor(container, appwell);
}

// the bounce is over: everything back at rest
function restFrame(animator, appId) {
  const [container, appwell] = findTarget(animator, appId);
  if (!appwell) return;
  try {
    appwell._bounce = true;
    appwell.translation_x = 0;
    appwell.translation_y = 0;
    if (container._renderer) {
      container._renderer.translationX = 0;
    }
  } catch (err) {
    console.log(err);
  }
  translateDecor(container, appwell);
}

// the renderer pass of the animator may clear the offset now
function releaseFrame(animator, appId) {
  const [, appwell] = findTarget(animator, appId);
  if (!appwell) return;
  appwell._bounce = false;
}

/**
 * Timer frames of `hops` hops (a linear rise, then a bouncing fall) followed by
 * the closing frames.
 */
export function bounceFrames(animator, appId, travel, hops) {
  const frames = [];
  for (let i = 0; i < hops; i++) {
    frames.push(
      {
        _duration: RISE_MS,
        _func: (f) =>
          hopFrame(animator, appId, Linear.easeNone(f._time, 0, travel, f._duration)),
      },
      {
        _duration: FALL_MS,
        _func: (f) =>
          hopFrame(animator, appId, Bounce.easeOut(f._time, travel, -travel, f._duration)),
      }
    );
  }
  frames.push(
    { _duration: CLOSE_MS, _func: () => restFrame(animator, appId) },
    { _duration: CLOSE_MS, _func: () => releaseFrame(animator, appId) }
  );
  return frames;
}
