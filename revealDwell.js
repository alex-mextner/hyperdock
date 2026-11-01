'use strict';

// Edge-dwell state machine for the autohidden dock: the dock may only slide
// in once the pointer has stayed ON the reactive edge strip (DockDwell)
// continuously for `delayMs`; leaving the strip before that cancels. With
// pressure sense on, the pressure threshold must also be met (in either
// order; once met it holds for the rest of the visit). Kept free of gi://
// imports and of any clock of its own: the caller injects the one-shot
// scheduler (autohide.js uses GLib.timeout_add), which is what lets
// tests/reveal_dwell_check.js drive it under plain node.

export let RevealDwell = class {
  // schedule(fn, ms) -> handle; cancel(handle); onReveal() fires at most once
  // per entry onto the strip; pressureRequired() is read when a reveal is
  // decided, so switching pressure sense off while the dwell runs counts.
  constructor({ schedule, cancel, onReveal, pressureRequired = () => false }) {
    this._schedule = schedule;
    this._cancel = cancel;
    this._onReveal = onReveal;
    this._pressureRequired = pressureRequired;
    this._handle = null;
    this._reset();
  }

  _reset() {
    this._onEdge = false;
    this._dwelled = false;
    this._pressured = false;
    this._revealed = false;
  }

  get onEdge() {
    return this._onEdge;
  }

  // true while the dwell timer is armed and has not fired yet
  get pending() {
    return this._handle !== null;
  }

  // The pointer entered the strip (always restarts the dwell). delayMs 0 =
  // reveal at once, like before the dwell existed.
  enter(delayMs) {
    this.cancel();
    this._onEdge = true;
    const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    if (delay === 0) {
      this._dwelled = true;
      this._tryReveal();
      return;
    }
    this._handle = this._schedule(() => {
      this._handle = null;
      this._dwelled = true;
      this._tryReveal();
    }, delay);
  }

  // The caller sees motion over the strip (autohide.js does so with pressure
  // sense only) although no enter event started a dwell, e.g. the dock hid
  // under a resting pointer: start one only if none is running or done.
  touch(delayMs) {
    if (!this._onEdge) this.enter(delayMs);
  }

  // The pressure-sense threshold was reached; ignored off the strip.
  pressure() {
    if (!this._onEdge) return;
    this._pressured = true;
    this._tryReveal();
  }

  // A reveal condition changed while the pointer rests on the strip (pressure
  // sense switched off): decide again without waiting for the next enter.
  recheck() {
    this._tryReveal();
  }

  // Pointer left the strip, the dock was shown by another path, or the
  // autohider is being disabled: drop the timer and all progress.
  cancel() {
    if (this._handle !== null) {
      this._cancel(this._handle);
      this._handle = null;
    }
    this._reset();
  }

  _tryReveal() {
    if (this._revealed || !this._onEdge || !this._dwelled) return;
    if (this._pressureRequired() && !this._pressured) return;
    this._revealed = true;
    this._onReveal();
  }
};
