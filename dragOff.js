'use strict';

// macOS "drag off the dock, hold, let go to remove" as pure logic, free of
// gi:// imports and of any clock of its own: the caller injects the one-shot
// scheduler (interactions.js uses GLib.timeout_add), which is what lets
// tests/drag_off_check.js drive it under plain node.
//
// idle -> inside      begin(): a drag of a removable icon started on the dock
// inside -> holding   the pointer left the dock zone: the hold timer runs
// holding -> armed    it stayed out for the whole hold: "Remove" shows
// holding -> inside   it came back first: nothing happens
// armed -> inside     it came back: "Remove" hides again
// letting go only removes from `armed`, with the pointer still out

export const HOLD_MS = 1000;

// The pointer is outside the dock: further than `margin` from the dock's
// rectangle [x, y, width, height] on any side. The rectangle is the dock's
// own, so this holds for a bottom, left or right dock alike.
export function isOutside(rect, margin, x, y) {
  return (
    x < rect[0] - margin ||
    x > rect[0] + rect[2] + margin ||
    y < rect[1] - margin ||
    y > rect[1] + rect[3] + margin
  );
}

// What letting go of a dragged dock icon does: 'unpin' a pinned app, 'forget'
// a recent one, nothing (null) for the rest. The overview has drop targets of
// its own.
export function removalKind({ enabled, overviewOpen, pinned, recent }) {
  if (!enabled || overviewOpen) return null;
  if (pinned) return 'unpin';
  return recent ? 'forget' : null;
}

export let DragOffGesture = class {
  // schedule(fn, ms) -> handle; cancel(handle); onArm() / onDisarm() show and
  // hide the "Remove" state and fire in pairs
  constructor({ schedule, cancel, onArm, onDisarm }) {
    this._schedule = schedule;
    this._cancel = cancel;
    this._onArm = onArm;
    this._onDisarm = onDisarm;
    this._handle = null;
    this._state = 'idle';
  }

  get state() {
    return this._state;
  }

  begin() {
    this.end();
    this._state = 'inside';
  }

  // One pointer sample of the running drag. holdMs 0 arms the moment the
  // pointer is out.
  move(outside, holdMs) {
    if (this._state === 'idle') return;
    if (!outside) {
      this._stopHold();
      const wasArmed = this._state === 'armed';
      this._state = 'inside';
      if (wasArmed) this._onDisarm();
      return;
    }
    if (this._state !== 'inside') return;
    if (!(holdMs > 0)) {
      this._arm();
      return;
    }
    this._state = 'holding';
    this._handle = this._schedule(() => {
      this._handle = null;
      this._arm();
    }, holdMs);
  }

  // The button was released, the pointer is (or is not) `outside`. True when
  // this removes the app; the drag is over either way.
  drop(outside) {
    const remove = this._state === 'armed' && outside;
    this.end();
    return remove;
  }

  // The drag is over (dropped, cancelled, escape) or the dock is going away
  end() {
    this._stopHold();
    const armed = this._state === 'armed';
    this._state = 'idle';
    if (armed) this._onDisarm();
  }

  _arm() {
    this._state = 'armed';
    this._onArm();
  }

  _stopHold() {
    if (this._handle !== null) {
      this._cancel(this._handle);
      this._handle = null;
    }
  }
};
