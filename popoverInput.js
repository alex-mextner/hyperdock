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

// Counts the open popovers and tells the window manager about each change.
// `allow(name, modes)` is Main.wm.allowKeybinding.
export class OverlayKeyGate {
  constructor(allow) {
    this._allow = allow;
    this._open = 0;
  }

  // A popover opened. The returned function (once) says it closed.
  acquire() {
    this._open++;
    this._sync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._open--;
      this._sync();
    };
  }

  _sync() {
    this._allow('overlay-key', overlayKeyModes(this._open));
  }
}

const gate = new OverlayKeyGate((name, modes) => Main.wm.allowKeybinding(name, modes));

// Opens `actor`'s modal grab for a dock popover. Returns the grab for
// Main.popModal and `release`, which the popover calls when it closes (it also
// runs if the actor is destroyed first).
export function pushPopoverGrab(actor) {
  const grab = Main.pushModal(actor, { actionMode: POPOVER_ACTION_MODE });
  const release = gate.acquire();
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
      release = gate.acquire();
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
