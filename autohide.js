'use strict';

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import { DockPosition } from './dock.js';
import {
  get_distance_sqr,
  get_distance,
  isOverlapRect,
} from './utils.js';
import { RevealDwell } from './revealDwell.js';

const DEBOUNCE_HIDE_TIMEOUT = 120;
const PRESSURE_SENSE_DISTANCE = 40;
// Pointer must rest ON the edge strip this long (ms) before the hidden dock
// slides in; the reveal-delay-ms setting overrides it (0 = instant).
const DEFAULT_REVEAL_DELAY_MS = 300;

// some codes lifted from dash-to-dock intellihide
// Dodge regular windows and their dialogs/tool palettes. DOCK, TOOLBAR, MENU
// and SPLASHSCREEN stay excluded: they are panels, transient popups or
// short-lived, and must not make the dock hide.
const handledWindowTypes = [
  Meta.WindowType.NORMAL,
  // Meta.WindowType.DOCK,
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
  // Meta.WindowType.TOOLBAR,
  // Meta.WindowType.MENU,
  Meta.WindowType.UTILITY,
  // Meta.WindowType.SPLASHSCREEN
];

export let AutoHide = class {
  enable() {
    if (this._enabled) return;
    // console.log('enable autohide');
    this._enabled = true;
    this._shown = true;
    this._dwell = 0;
    this._revealDwell = new RevealDwell({
      schedule: (fn, ms) =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
          fn();
          return GLib.SOURCE_REMOVE;
        }),
      cancel: (id) => GLib.source_remove(id),
      onReveal: () => this.show(),
      pressureRequired: () => !!this.extension.pressure_sense,
    });
    console.log('autohide enabled');
  }

  disable() {
    // _debounceCheckHide() also runs while autohide is off, so always drop it
    this.extension._loTimer?.cancel(this._debounceCheckSeq);
    this._debounceCheckSeq = null;
    // a pending edge dwell must not outlive the autohider
    this._revealDwell?.cancel();

    if (!this._enabled) return;
    if (this.extension._hiTimer) {
      this.extension._hiTimer.cancel(this._animationSeq);
    }
    this._animationSeq = null;

    this.show();

    this._enabled = false;

    console.log('autohide disabled');
  }

  _getScaleFactor() {
    //! use dock scale factor
    let scaleFactor = this.dock._monitor.geometry_scale;
    return scaleFactor;
  }

  _onMotionEvent() {
    if (this.extension.pressure_sense && !this._shown) {
      // motion over the strip proves the pointer is on the edge: make sure a
      // dwell is running even if the enter event was missed
      this._revealDwell?.touch(this._revealDelayMs());
      let monitor = this.dock._monitor;
      let pointer = global.get_pointer();
      if (this.extension.simulated_pointer) {
        pointer = [...this.extension.simulated_pointer];
      }

      let sw = monitor.width;
      let sh = monitor.height;
      let scale = this._getScaleFactor();
      let area = scale * (PRESSURE_SENSE_DISTANCE * PRESSURE_SENSE_DISTANCE);
      let dx = 0;
      let dy = 0;

      if (this.last_pointer) {
        dx = pointer[0] - this.last_pointer[0];
        dx = dx * dx;
        dy = pointer[1] - this.last_pointer[1];
        dy = dy * dy;
      }

      let dwell_count =
        80 - 60 * (this.extension.pressure_sense_sensitivity || 0);

      if (this.dock.isVertical()) {
        if (
          // right
          (this.dock._position == DockPosition.RIGHT &&
            dy < area &&
            pointer[0] > monitor.x + sw - 4) ||
          // left
          (this.dock._position == DockPosition.LEFT &&
            dy < area &&
            pointer[0] < monitor.x + 4)
        ) {
          this._dwell++;
        } else {
          this._dwell = 0;
          this.last_pointer = pointer;
        }
      } else {
        if (
          // bottom
          (this.dock._position == DockPosition.BOTTOM &&
            dx < area &&
            pointer[1] + 4 > monitor.y + sh) ||
          // top
          (this.dock._position == DockPosition.TOP &&
            dx < area &&
            pointer[1] - 4 < monitor.y)
        ) {
          this._dwell++;
        } else {
          this._dwell = 0;
          this.last_pointer = pointer;
        }
      }

      // console.log(`${this._dwell} ${dwell_count} ${this.extension.pressure_sense_sensitivity}`);

      if (this._dwell > dwell_count) {
        // pressure alone is not enough: the dwell still has to elapse
        this._revealDwell?.pressure();
      }
    }
  }

  // pressure-sense changed: a dwell that already elapsed must not wait for
  // the pointer to leave and re-enter the strip
  recheckReveal() {
    this._revealDwell?.recheck();
  }

  _revealDelayMs() {
    return this.extension.reveal_delay_ms ?? DEFAULT_REVEAL_DELAY_MS;
  }

  // The pointer is ON the edge strip. Revealing needs it to stay there for
  // reveal-delay-ms (and, with pressure sense, to push hard enough too);
  // merely passing near the edge never reaches this strip.
  _onEnterEvent() {
    if (!this._enabled || this._shown) {
      // already shown (nothing to wait for) or autohide off (the pre-dwell
      // immediate reveal stays, e.g. a dock left hidden by a refused show)
      if (!this.extension.pressure_sense) this.show();
      return;
    }
    this._revealDwell?.enter(this._revealDelayMs());
  }

  _onLeaveEvent() {
    this._revealDwell?.cancel();
    // a push that did not end in a reveal must not count towards the next
    // visit: pressure has to be reached within one visit's dwell
    this._dwell = 0;
    if (this._shown) {
      this._debounceCheckHide();
    }
  }

  _onFocusWindow() {
    this._debounceCheckHide();
  }

  _onFullScreen() {
    this._debounceCheckHide();
  }

  show() {
    // every other reveal path is immediate and also settles a pending dwell;
    // done before the guards so a refused reveal (fullscreen) cannot leave
    // the dwell latched as already revealed
    this._revealDwell?.cancel();
    if (!this.dock._monitor || this.dock._monitor.inFullscreen) {
      return;
    }
    this._dwell = 0;
    this.frameDelay = 0;
    this._shown = true;
    this.dock.slideIn();
  }

  hide() {
    this._dwell = 0;
    this.frameDelay = 10;
    this._shown = false;
    this.dock.slideOut();
  }

  // A file drag from another client sends no pointer events to the dwell
  // strip, so the features that follow such a drag (spring-loading,
  // file-drops) reveal the dock through this one path; it stays up until
  // every holder has let go.
  holdForDrag(holder, held) {
    this._dragHolders ??= new Set();
    if (held) {
      this._dragHolders.add(holder);
      if (this._enabled && !this._shown) this.show();
    } else if (this._dragHolders.delete(holder) && this._enabled) {
      this._debounceCheckHide();
    }
  }

  _checkOverlap() {
    // console.log("checking overlap...");
    if (this.extension._inOverview) {
      return false;
    }
    // a file drag holds the dock up (holdForDrag), even over a window
    if (this._dragHolders?.size) {
      return false;
    }
    let pointer = global.get_pointer();
    if (this.extension.simulated_pointer) {
      pointer = [...this.extension.simulated_pointer];
    }

    // console.log(pointer);

    if (!this.extension.autohide_dash) {
      return false;
    }

    // keyboard-focus: a dock holding key focus stays up regardless of pointer
    if (this.dock._keyFocusIcon) {
      return false;
    }

    // an app asking for attention bounces on a shown dock (urgent-bounce)
    if (this.extension.windowFeedback?.revealsDock) {
      return false;
    }

    // console.log("checking pointer location...");

    // Only a shown dock is kept up by the pointer (_isWithinDash is false while
    // hidden); a hidden dock is revealed solely through the dwell edge strip.
    if (this.dock._isWithinDash(pointer)) {
      return false;
    }

    if (!this.extension.autohide_dodge) {
      return true;
    }

    // console.log("checking fullscreen...");

    if (this.dock._monitor && this.dock._monitor.inFullscreen) {
      return true;
    }

    // console.log("checking windows...");

    let monitor = this.dock._monitor;
    let actors = global.get_window_actors();
    let windows = actors.map((a) => a.get_meta_window());
    windows = windows.filter((w) => w.can_close());
    windows = windows.filter((w) => w.get_monitor() == monitor.index);
    // windows = windows.filter((w) => !w.is_override_redirect());
    let workspace = global.workspace_manager.get_active_workspace_index();
    // get_workspace() returns the active workspace for sticky windows, but may be
    // null for a window that is still being managed or is being unmanaged
    windows = windows.filter(
      (w) =>
        (w.is_on_all_workspaces() ||
          w.get_workspace()?.index() === workspace) &&
        w.showing_on_its_workspace()
    );
    windows = windows.filter((w) =>
      handledWindowTypes.includes(w.get_window_type())
    );

    let isOverlapped = false;
    let dockRect = this.dock.struts.get_transformed_position();
    dockRect.push(this.dock.struts.width);
    dockRect.push(this.dock.struts.height);

    windows.forEach((w) => {
      this.extension.windowTracker?.track(w);
      if (isOverlapped) return;

      let frame = w.get_frame_rect();
      let win = [frame.x, frame.y, frame.width, frame.height];

      if (isOverlapRect(dockRect, win)) {
        isOverlapped = true;
      }
    });

    this.windows = windows;

    // console.log(isOverlapped);
    return isOverlapped;
  }

  _debounceCheckHide() {
    if (this.extension._loTimer) {
      if (!this._debounceCheckSeq) {
        this._debounceCheckSeq = this.extension._loTimer.runDebounced(
          () => {
            this._checkHide();
          },
          DEBOUNCE_HIDE_TIMEOUT,
          'debounceCheckHide'
        );
      } else {
        this.extension._loTimer.runDebounced(this._debounceCheckSeq);
      }
    }
  }

  _checkHide() {
    if (this._enabled) {
      if (this._checkOverlap()) {
        this.hide();
      } else {
        this.show();
      }
    }
  }
};
