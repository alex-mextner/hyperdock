// The launch/attention bounce of a dock icon, as frames for the hi-res timer.
//
// A bounce is an offset of the icon's appwell along the axis away from the docked
// edge, mirrored onto the pooled renderer that draws the icon (the badge, counter,
// progress and running dots follow the renderer: overlayFollow.js). Each frame
// looks the icon up again by app id, because items come and go while it runs.
//
// Whatever ends a bounce, the icon must be exactly at rest afterwards: translation
// X *and* Y of the appwell, the renderer and the actors that follow it are zero.
// A bounce ends by finishing (_end(), on the tick that completes the timeline, for
// any timer step), by being cancelled (cancel(): the dock's timers are torn down,
// or a new bounce of the same app restarts it), or by losing its icon mid-flight
// (dragging, item removed: the frame finds no target and releases the one it last
// drove). A cancelled bounce does nothing more, even if the timer, which runs a
// snapshot of its subscribers, still calls it in the tick it was cancelled in.
//
// `animator` is the Animator that owns the pooled renderers: this module reads its
// `dock`, its `_target` (null once disabled) and its edge() flags.
import { Bounce, Linear } from './effects/easing.js';
import { getAppId } from './compat.js';

// the rise lasts this long (ms); the fall back (a bounce easing) three times as long
const RISE_MS = 250;
const FALL_MS = RISE_MS * 3;

const NO_TARGET = [null, null];

/** How far (px) an icon rises at the top of a hop. */
export function bounceTravel(dock) {
  return (
    (dock._iconSize / 3) * ((0.25 + dock.extension.animation_bounce_height) * 1.5)
  );
}

/** Puts an actor's translation back to rest, on both axes. */
export function zeroTranslation(actor) {
  if (!actor) return;
  actor.translationX = 0;
  actor.translationY = 0;
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

// Offsets the appwell by `res` away from the docked edge.
function offsetBy(animator, appwell, res) {
  const edge = animator.edge();
  if (edge.vertical) {
    appwell.translation_x = edge.left ? res : -res;
  } else {
    appwell.translation_y = edge.bottom ? -res : res;
  }
}

// The renderer that draws the container's icon, or null. `container._renderer` goes
// stale when the container leaves the dock: its renderer is then another item's.
function rendererOf(container) {
  const renderer = container._renderer;
  return renderer && renderer._icon === container._icon ? renderer : null;
}

// Copies the appwell's offset onto the renderer, on both axes.
function mirrorToRenderer(container, appwell) {
  const renderer = rendererOf(container);
  if (!renderer) return;
  renderer.translationX = appwell.translationX;
  renderer.translationY = appwell.translationY;
}

// Copies the appwell's offset onto the icon's other drawn parts, and keeps its
// label from showing while it bounces.
function mirrorToDecor(container, appwell) {
  try {
    if (!container._icon) return;
    [container._image, container._badge].forEach((part) => {
      if (!part) return;
      part.translationX = appwell.translationX;
      part.translationY = appwell.translationY;
    });
    if (container._label) {
      container._label.opacity = 0;
    }
  } catch (err) {
    console.log(err);
  }
}

// Everything a bounce moves, back at rest.
function clearTarget(container, appwell) {
  zeroTranslation(appwell);
  zeroTranslation(rendererOf(container));
  zeroTranslation(container._image);
  zeroTranslation(container._badge);
}

/** One running bounce of one app's icon. */
export class BounceRun {
  constructor(animator, appId) {
    this._animator = animator;
    this._appId = appId;
    // the target the last frame drove, to release it if the icon goes away
    this._container = null;
    this._appwell = null;
    this._cancelled = false;
    this._ended = false;
  }

  get appId() {
    return this._appId;
  }

  // [container, appwell] to drive now. With no target the one last driven is
  // released: it would be left standing at the offset of the frame before.
  _target() {
    const target = findTarget(this._animator, this._appId);
    if (target[1]) {
      [this._container, this._appwell] = target;
    } else {
      this._release();
    }
    return target;
  }

  // puts the last driven target at rest and lets the animator's renderer pass
  // clear its offset too. A container that was destroyed (the dock's destroy handler
  // drops its `_appwell`: a dash recreated, a custom icon removed) is left alone: it
  // is disposed, and needs no reset.
  _release() {
    const container = this._container;
    const appwell = this._appwell;
    this._container = null;
    this._appwell = null;
    if (!container || container._appwell !== appwell || !this._animator._target) return;
    try {
      clearTarget(container, appwell);
      appwell._bounce = false;
    } catch (err) {
      console.log(err);
    }
  }

  // one frame of a hop: the icon is `res` px away from its resting place
  _hop(res) {
    if (this._cancelled) return;
    const [container, appwell] = this._target();
    if (!appwell) return;
    try {
      appwell._bounce = true;
      offsetBy(this._animator, appwell, res);
      mirrorToRenderer(container, appwell);
    } catch (err) {
      console.log(err);
    }
    mirrorToDecor(container, appwell);
  }

  // the timeline is complete: everything back at rest, and the animator's renderer
  // pass free to treat the icon as any other
  _end() {
    if (this._cancelled || this._ended) return;
    this._ended = true;
    const [container, appwell] = this._target();
    if (!appwell) return;
    try {
      clearTarget(container, appwell);
      appwell._bounce = false;
    } catch (err) {
      console.log(err);
    }
    mirrorToDecor(container, appwell);
  }

  /**
   * Stops the bounce where it is: the caller has taken it off the timer. The
   * icon goes back to rest on both axes at once.
   */
  cancel() {
    this._cancelled = true;
    // a finished bounce has put its icon at rest already: nothing to look up or touch
    if (this._ended) return;
    const target = findTarget(this._animator, this._appId);
    if (target[1]) [this._container, this._appwell] = target;
    this._release();
  }

  /** Timer frames of `hops` hops: a linear rise, then a bouncing fall. */
  frames(travel, hops) {
    const frames = [];
    for (let i = 0; i < hops; i++) {
      frames.push(
        {
          _duration: RISE_MS,
          _func: (f) => this._hop(Linear.easeNone(f._time, 0, travel, f._duration)),
        },
        {
          _duration: FALL_MS,
          _func: (f) =>
            this._hop(Bounce.easeOut(f._time, travel, -travel, f._duration)),
        }
      );
    }
    return frames;
  }

  /**
   * Settings for the timer's runAnimation(): it runs the frames of each tick and, once
   * the timeline is complete, ends the bounce. The timer runs a frame only on the tick
   * inside its window and its last call comes after the clamped end, so closing
   * frames of a few ms would be skipped by a coarse timer step.
   */
  settings() {
    return {
      _func: (s) => {
        s._currentFrames.forEach((f) => {
          f._time = s._time - f._start;
          f._func(f, s);
        });
        if (s._time >= s._duration) this._end();
      },
    };
  }
}
