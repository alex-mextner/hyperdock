'use strict';

// How a dock popover (the stack dropdown, an icon's menu, the dock's menu)
// holds the keyboard without locking the user out of the global shortcuts.
//
// Main.pushModal() filters every keybinding through the action mode it is
// given (windowManager.js _filterKeybinding): NONE, the default, blocks them
// all, which is why the layout shortcut (Super+Space) did nothing while a stack
// dropdown was open. POPUP is what the Shell's own menus use. It lets the
// input-source shortcut through (keyboard.js allows it in ALL modes, and under
// exactly POPUP it switches without opening its own switcher popup, which
// could not take a second grab on top of ours). A tap of Super is the
// 'overlay-key' keybinding, allowed only in NORMAL and OVERVIEW, so while a
// popover is open it is let through POPUP too, and only then.
//
// POPUP is also the mode of every other popup the Shell opens, and a keyboard
// shortcut can open one on top of a dock popover (PrintScreen's capture UI,
// Super+V's calendar, Super+S's quick settings). The allowance above is a mask
// per mode, blind to whose grab is on top, so a second filter, run by the
// window manager after the Shell's own, refuses 'overlay-key' unless the grab
// on top of the modal stack belongs to a dock popover: stacked over a foreign
// popup, a Super tap is ignored as in the stock Shell.

import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// the grab mode of every dock popover
export const POPOVER_ACTION_MODE = Shell.ActionMode.POPUP;

// main.js _sessionUpdated: where 'overlay-key' works at rest
const OVERLAY_KEY_AT_REST = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
const OVERLAY_KEY_WITH_POPOVER = OVERLAY_KEY_AT_REST | POPOVER_ACTION_MODE;

// The action modes 'overlay-key' is allowed in while `open` popovers are up.
export function overlayKeyModes(open) {
  return open > 0 ? OVERLAY_KEY_WITH_POPOVER : OVERLAY_KEY_AT_REST;
}

const OVERLAY_KEY = 'overlay-key';

// Tracks the open popovers' grab actors, tells the window manager when Super may
// work under their mode, and vetoes it while somebody else's grab is on top.
//   allow(name, modes)    Main.wm.allowKeybinding
//   watchFilter(veto)     calls veto(bindingName) on every keybinding the Shell let through
//                         (true: drop it) and returns what stops the watching
//   topGrabActor()        the actor of the grab on top of the modal stack, or null
//   actionMode()          the action mode of the grab on top (Main.actionMode)
export class OverlayKeyGate {
  constructor({ allow, watchFilter, topGrabActor, actionMode }) {
    this._allow = allow;
    this._watchFilter = watchFilter;
    this._topGrabActor = topGrabActor;
    this._actionMode = actionMode;
    this._owners = new Map(); // grab actor -> popovers open on it
    this._stopWatching = null;
  }

  // A popover opened with its grab on `actor`. The returned function (once)
  // says it closed.
  acquire(actor) {
    this._owners.set(actor, (this._owners.get(actor) ?? 0) + 1);
    this._sync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = this._owners.get(actor) - 1;
      if (left > 0) this._owners.set(actor, left);
      else this._owners.delete(actor);
      this._sync();
    };
  }

  // true: drop this keybinding (called after the Shell's own filter let it through). Only
  // the POPUP allowance is ours to take back: in any other mode the Shell's own rule stands.
  vetoes(name) {
    return (
      name === OVERLAY_KEY &&
      this._actionMode() === POPOVER_ACTION_MODE &&
      !this._owners.has(this._topGrabActor())
    );
  }

  _sync() {
    const open = this._owners.size;
    this._allow(OVERLAY_KEY, overlayKeyModes(open));
    if (open > 0 && !this._stopWatching) {
      this._stopWatching = this._watchFilter((name) => this.vetoes(name));
    } else if (open === 0 && this._stopWatching) {
      this._stopWatching();
      this._stopWatching = null;
    }
  }
}

const gate = new OverlayKeyGate({
  allow: (name, modes) => Main.wm.allowKeybinding(name, modes),
  // filter-keybinding stops at the first handler that returns true, so this one
  // (connected later than the Shell's) only ever sees what the Shell allowed
  watchFilter: (veto) => {
    const wm = global.window_manager;
    const id = wm.connect('filter-keybinding', (_wm, binding) => veto(binding.get_name()));
    return () => wm.disconnect(id);
  },
  topGrabActor: () => Main.modalActorFocusStack.at(-1)?.actor ?? null,
  actionMode: () => Main.actionMode,
});

// Opens `actor`'s modal grab for a dock popover. Returns the grab for
// Main.popModal and `release`, which the popover calls when it closes (it also
// runs if the actor is destroyed first).
export function pushPopoverGrab(actor) {
  const grab = Main.pushModal(actor, { actionMode: POPOVER_ACTION_MODE });
  const release = gate.acquire(actor);
  actor.connect('destroy', release);
  return { grab, release };
}

// Super toggles the overview, so a popover goes when the overview does either.
const OVERVIEW_TRANSITIONS = ['showing', 'hiding'];

// Calls `close` on the next overview transition; returns what to call to stop
// listening (before the transition, when the popover closed by itself). It
// may be called again: close() and 'destroy' both end up there.
export function closeOnOverviewTransition(close) {
  let ids = OVERVIEW_TRANSITIONS.map((signal) => Main.overview.connect(signal, close));
  return () => {
    ids.forEach((id) => Main.overview.disconnect(id));
    ids = [];
  };
}

const attached = new WeakSet();

// A PopupMenu already grabs with POPUP (PopupMenuManager); this lets Super
// through for as long as it is open, and closes the menu when the overview
// shows or hides (the Shell closes only its own app menus, and only on hiding),
// so that Super does what it does at rest. Safe to call again for the same
// menu, also when it is already open.
export function attachMenuToOverlayKey(menu) {
  if (attached.has(menu)) return;
  attached.add(menu);
  let release = null;
  let stopListening = null;
  const settle = (open) => {
    if (open && !release) {
      release = gate.acquire(menu.actor);
      stopListening = closeOnOverviewTransition(() => menu.close(false));
    } else if (!open && release) {
      release();
      release = null;
      stopListening();
    }
  };
  menu.connect('open-state-changed', (_menu, open) => settle(open));
  menu.connect('destroy', () => settle(false));
  // Shell menus are built and opened in one call, before anyone can attach
  settle(!!menu.isOpen);
}
