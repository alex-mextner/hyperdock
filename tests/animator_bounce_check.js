// gjs -m tests/animator_bounce_check.js
// A bounce translates the icon's pooled renderer along the axis away from the docked
// edge; the badge/counter/progress overlay and the running dots mirror that translation
// (TranslationFollower), so a bounce that is cut short must leave nothing behind: after
// it ends, is cancelled, is restarted, loses its icon (dragging, item removed), or its
// renderer is rebound to another item, the icon, its badge, its dots and its appwell
// are at translation 0 on BOTH axes, and every item's dots are back on one baseline.
//
// Runs the production Animator and BounceRun on bottom, left, right and top docks;
// only the actors, the timer and the Shell are fakes (tests/animator_rig.js).
import { rig, frame, removeItems, disposedWrites, FakeOverlay } from './animator_rig.js';
import { createChecker } from './harness.js';

const { check, finish } = createChecker();

// the dots' cross-axis baseline, and the offset their inner actor keeps at rest
const BASELINE = 700;
const INNER = { x: 2, y: 3 };

// same binding as DockItemDotsOverlay/DockItemBadgeOverlay: follow the renderer, sit
// on the shared baseline, keep the baseline offset on the inner actor
class Overlay extends FakeOverlay {
  update(icon, data) {
    this._follower.to(icon._renderer);
    const along = data.vertical ? icon._slotY : icon._slotX;
    this.set_position(data.vertical ? BASELINE : along, data.vertical ? along : BASELINE);
    this.renderer.translationX = INNER.x;
    this.renderer.translationY = INNER.y;
  }
}

const POSITIONS = ['bottom', 'left', 'right', 'top'];
const SETTLE = 6;

async function newRig(position, timerFirst) {
  const r = await rig(position, { overlay: Overlay, windows: [1, 2, 1, 3] });
  r.timerFirst = timerFirst;
  r.dock.extension.notification_badge_style = 1;
  r.dock.extension.services._appNotices['app1.desktop'] = { count: 3 };
  r.away = () => r.dock.pointerAway();
  for (let i = 0; i < SETTLE; i++) frame(r, r.away());
  return r;
}

function tick(r, count) {
  for (let i = 0; i < count; i++) frame(r, r.away());
}

const nonZero = (actor) => actor.translationX !== 0 || actor.translationY !== 0;

// every actor a bounce can leave translated, with a name for the message
function bounceActors(r) {
  const actors = [];
  const { animator, dock } = r;
  animator._renderers.forEach((a, i) => actors.push([`renderer${i}`, a]));
  animator._dots.forEach((a, i) => actors.push([`dots${i}`, a]));
  animator._badges.forEach((a, i) => actors.push([`badge${i}`, a]));
  dock._icons.forEach((c, i) => actors.push([`appwell${i}`, c._appwell]));
  return actors;
}

function leftovers(r) {
  return bounceActors(r)
    .filter(([, actor]) => nonZero(actor))
    .map(([name, actor]) => `${name}(${actor.translationX},${actor.translationY})`);
}

function atRest(r, message) {
  const left = leftovers(r);
  check(left.length === 0, `${message}${left.length ? `: left ${left.join(' ')}` : ''}`);
}

// all shown dots overlays sit on one baseline, with the same inner offset
function dotsOnOneBaseline(r, message) {
  const shown = r.animator._dots.filter((d) => d.visible);
  const cross = (d) => (r.dock.vertical ? d.x : d.y);
  const same =
    shown.length > 1 &&
    shown.every(
      (d) =>
        cross(d) === BASELINE &&
        d.renderer.translationX === INNER.x &&
        d.renderer.translationY === INNER.y
    );
  check(same, `${message}: ${shown.length} dots share one baseline`);
}

// the main axis a bounce moves along
const axisOf = (r) => (r.dock.vertical ? 'translationX' : 'translationY');
const crossAxisOf = (r) => (r.dock.vertical ? 'translationY' : 'translationX');

const target = (r) => r.dock._icons[1]._appwell;

function startBounce(r, hops = 2) {
  r.animator.bounceIcon(target(r), hops);
  // 12 frames of 16 ms: still on the rise, well off the baseline
  tick(r, 12);
}

// mid-flight: the icon moved along its axis only, and everything follows it
function midFlight(r, label) {
  const renderer = r.animator._renderers[1];
  check(renderer[axisOf(r)] !== 0, `${label}: the renderer moves along its axis mid-bounce`);
  check(renderer[crossAxisOf(r)] === 0, `${label}: the renderer stays on its cross axis`);
  [r.animator._dots[1], r.animator._badges[1]].forEach((overlay, k) => {
    const what = k === 0 ? 'dots' : 'badge';
    check(
      overlay.translationX === renderer.translationX &&
        overlay.translationY === renderer.translationY,
      `${label}: ${what} follow the renderer on both axes`
    );
    check(overlay.visible, `${label}: ${what} shown mid-bounce`);
  });
}

// ------------------------------------------------------------------ scenarios
for (const [position, timerFirst] of POSITIONS.flatMap((p) => [[p, true], [p, false]])) {
  const L = (what) => `${position}${timerFirst ? '' : ' (animator frame first)'}: ${what}`;

  {
    const r = await newRig(position, timerFirst);
    dotsOnOneBaseline(r, L('before any bounce'));
    startBounce(r);
    midFlight(r, L('bounce'));
    tick(r, 120);
    atRest(r, L('a finished bounce leaves every actor at rest'));
    check(!target(r)._bounce, L('a finished bounce clears the bounce flag'));
    dotsOnOneBaseline(r, L('after a finished bounce'));
  }

  {
    // the dock's timers are torn down (dock._cancelTimers -> cancelBounces)
    const r = await newRig(position, timerFirst);
    startBounce(r);
    r.animator.cancelBounces();
    atRest(r, L('cancel: at rest at once, before any frame'));
    tick(r, 2);
    atRest(r, L('cancel: still at rest two frames later'));
    tick(r, 120);
    atRest(r, L('cancel: nothing resurrects it'));
    dotsOnOneBaseline(r, L('after a cancelled bounce'));
  }

  {
    // a new bounce of the same app starts mid-flight
    const r = await newRig(position, timerFirst);
    startBounce(r, 3);
    r.animator.bounceIcon(target(r), 1);
    atRest(r, L('restart: the interrupted bounce leaves the icon at rest'));
    tick(r, 12);
    midFlight(r, L('restart'));
    tick(r, 120);
    atRest(r, L('restart: the restarted bounce also ends at rest'));
    check(r.timer.subscribed.size === 0, L('restart: no bounce is left on the timer'));
    dotsOnOneBaseline(r, L('after a restart'));
  }

  {
    // dragging begins: the bounce has no target any more (getTarget -> null)
    const r = await newRig(position, timerFirst);
    startBounce(r);
    r.dock._dragging = true;
    tick(r, 1);
    atRest(r, L('dragging: at rest on the first frame without a target'));
    tick(r, 10);
    atRest(r, L('dragging: stays at rest while dragging'));
    r.dock._dragging = false;
    tick(r, 150);
    atRest(r, L('dragging: at rest after the bounce resumes and ends'));
    dotsOnOneBaseline(r, L('after dragging'));
  }

  {
    // the bouncing item is removed from the dock
    const r = await newRig(position, timerFirst);
    startBounce(r);
    const [gone] = removeItems(r.dock, 1, 1);
    tick(r, 1);
    atRest(r, L('item removed: every slot and the removed appwell at rest'));
    check(!gone._appwell._bounce, L('item removed: no bounce flag left on the removed item'));
    tick(r, 150);
    atRest(r, L('item removed: stays at rest'));
    dotsOnOneBaseline(r, L('after an item was removed'));
  }

  {
    // an item before the bouncing one is removed: the pooled renderers shift one
    // item over, so the renderer that carried the bounce now draws a neighbour
    const r = await newRig(position, timerFirst);
    startBounce(r);
    const bouncer = target(r);
    removeItems(r.dock, 0, 1);
    tick(r, 1);
    const others = [r.animator._renderers[1], r.animator._renderers[2]];
    check(
      others.every((renderer) => !nonZero(renderer)),
      L('renderer rebind: renderers now drawing other items carry no offset')
    );
    check(
      [r.animator._dots[1], r.animator._dots[2], r.animator._badges[1], r.animator._badges[2]]
        .every((overlay) => !nonZero(overlay)),
      L('renderer rebind: their dots and badges carry no offset')
    );
    // the bouncing icon moved to slot 0: that renderer keeps carrying its offset on every frame
    for (let i = 0; i < 3; i++) {
      const renderer = r.animator._renderers[0];
      check(
        renderer[axisOf(r)] !== 0 && renderer[axisOf(r)] === bouncer[axisOf(r)],
        L(`renderer rebind: the bouncing icon keeps its offset on its new renderer (frame ${i})`)
      );
      tick(r, 1);
    }
    tick(r, 150);
    atRest(r, L('renderer rebind: at rest after the bounce ends'));
    dotsOnOneBaseline(r, L('after a rebind'));
  }

  {
    // a finished bounce is not touched again when the dock's timers are cancelled later
    const r = await newRig(position, timerFirst);
    r.animator.bounceIcon(target(r), 1);
    tick(r, 120);
    check(r.timer.subscribed.size === 0, L('a finished bounce is off the timer'));
    target(r).destroy();
    disposedWrites.length = 0;
    r.animator.cancelBounces();
    check(disposedWrites.length === 0, L('cancelling after a finished bounce touches no actor'));
  }

  {
    // a bounce frequency outside the list, or no hops: nothing to run, nothing left on the timer
    const r = await newRig(position, timerFirst);
    r.dock.extension.animation_bounce_frequency = 7;
    r.animator.bounceIcon(target(r));
    r.animator.bounceIcon(target(r), 0);
    tick(r, 10);
    check(r.timer.subscribed.size === 0, L('no hops: nothing is subscribed to the timer'));
    atRest(r, L('no hops: the icon stays at rest'));
  }

  {
    // the last icon bounces, an icon before it is removed and another put in front of it
    // again: the last slot was hidden meanwhile and is drawn again, still bouncing
    const r = await newRig(position, timerFirst);
    const last = r.dock._icons[3]._appwell;
    r.animator.bounceIcon(last, 2);
    tick(r, 12);
    removeItems(r.dock, 0, 1);
    tick(r, 2);
    r.dock.addIcon('again', 'app9', 1, 0);
    for (let i = 0; i < 3; i++) {
      tick(r, 1);
      const renderer = r.animator._renderers[3];
      check(
        renderer[axisOf(r)] !== 0 && renderer[axisOf(r)] === last[axisOf(r)],
        L(`a hidden slot drawn again: its renderer shows the bouncing icon's offset (frame ${i})`)
      );
    }
    tick(r, 150);
    atRest(r, L('a hidden slot drawn again: at rest after the bounce ends'));
  }

  {
    // the bouncing item is destroyed (dash recreated, custom icon removed): its actors are
    // disposed, and nothing may write to them any more
    const r = await newRig(position, timerFirst);
    startBounce(r);
    const appwell = target(r);
    const [gone] = removeItems(r.dock, 1, 1);
    // the dock's destroy handler, then Shell disposes the actors
    gone._appwell = null;
    gone._icon = null;
    appwell.destroy();
    gone.destroy();
    disposedWrites.length = 0;
    tick(r, 150);
    check(disposedWrites.length === 0, L(`item destroyed: no write reaches a disposed actor${disposedWrites.length ? `: ${disposedWrites.join(' ')}` : ''}`));
    atRest(r, L('item destroyed: the remaining actors are at rest'));
  }

  {
    // two icons bounce and the first is removed: the other keeps bouncing on its new renderer
    const r = await newRig(position, timerFirst);
    startBounce(r);
    const second = r.dock._icons[2]._appwell;
    r.animator.bounceIcon(second, 2);
    tick(r, 12);
    const [gone] = removeItems(r.dock, 1, 1);
    for (let i = 0; i < 3; i++) {
      tick(r, 1);
      const renderer = r.animator._renderers[1];
      check(
        renderer[axisOf(r)] !== 0 && renderer[axisOf(r)] === second[axisOf(r)],
        L(`two bounces, one item removed: the other keeps its offset (frame ${i})`)
      );
      check(!nonZero(gone._appwell), L(`two bounces, one item removed: the removed appwell is at rest (frame ${i})`));
    }
    tick(r, 150);
    atRest(r, L('two bounces, one item removed: all at rest after the other ends'));
  }

  {
    // a restart made from inside a timer tick (the dock bounces a new icon from the
    // animator's frame): the cancelled bounce is still called once in that tick
    const r = await newRig(position, timerFirst);
    let restart = false;
    r.timer.subscribed.add({
      onUpdate: () => {
        if (!restart) return;
        restart = false;
        r.animator.bounceIcon(target(r), 1);
      },
    });
    startBounce(r, 3);
    restart = true;
    r.dock.simulated_pointer = r.away();
    r.timer.tick(16);
    atRest(r, L('restart inside a timer tick: the cancelled bounce does not drive the icon again'));
    check(!target(r)._bounce, L('restart inside a timer tick: no bounce flag left by the cancelled one'));
  }

  {
    // the timer advances by 15 ms (the default) up to 100 ms: it only runs a frame whose
    // window holds the tick, but however it steps the bounce ends at rest
    for (const dt of [15, 16, 30, 45, 100]) {
      const r = await newRig(position, timerFirst);
      r.animator.bounceIcon(target(r), 2);
      let ticks = 0;
      while (r.timer.subscribed.size > 0 && ticks++ < 1000) frame(r, r.away(), dt);
      check(r.timer.subscribed.size === 0, L(`timer step ${dt} ms: the bounce completes`));
      atRest(r, L(`timer step ${dt} ms: at rest as soon as the timeline completes`));
      check(!target(r)._bounce, L(`timer step ${dt} ms: the bounce flag is clear`));
    }
  }

  {
    // slots beyond the icon count are hidden at rest, so a later icon starts clean
    const r = await newRig(position, timerFirst);
    startBounce(r);
    removeItems(r.dock, 2, 2);
    tick(r, 1);
    const hidden = [2, 3].flatMap((i) => [
      r.animator._renderers[i], r.animator._dots[i], r.animator._badges[i],
    ]);
    check(
      hidden.every((a) => !a.visible && !nonZero(a)),
      L('hidden slots are hidden and at rest')
    );
  }

  {
    // a disabled animator (pool destroyed) cancels without touching stale actors
    const r = await newRig(position, timerFirst);
    startBounce(r);
    disposedWrites.length = 0;
    r.animator.disable();
    let threw = false;
    try {
      r.animator.cancelBounces();
      tick(r, 3);
    } catch {
      threw = true;
    }
    check(!threw, L('cancelling bounces of a disabled animator is harmless'));
    check(disposedWrites.length === 0, L('a disabled animator writes to no destroyed actor'));
  }
}

finish();
