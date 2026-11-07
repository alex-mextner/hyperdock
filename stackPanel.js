'use strict';

// Folder stack options (view / sort / display) and the macOS-style Grid and
// List panels a stack opens in when it is not shown as the classic fan.
// The panel is a popover like the Dock's: it stands clear of the dock on the
// screen side, with a pointer at its dock edge aimed at the stack's icon, and
// grows from / shrinks into that pointer. Its background is the dock's Liquid
// Glass (one GLSL pass, the pointer part of the same SDF) or, with the glass
// material off, the same shape as a flat translucent platter. Only the cells
// near the scroll window exist (stackContent.js); thumbnails come from the
// freedesktop cache or a worker process (stackThumbs.js), never decoded here.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { GlassPlatter } from './effects/glass.js';
import { trySpawnCommandLine } from './utils.js';
import { StackContent } from './stackContent.js';
import { PANEL, cellName } from './stackLayout.js';
import { fillThumbnail, stackIconFor } from './stackThumbs.js';
import { closeOnOverviewTransition, pushPopoverGrab } from './popoverInput.js';
import {
  STACK_DISPLAYS,
  STACK_DISPLAY_LABELS,
  STACK_GROUPS,
  STACK_GROUP_LABELS,
  STACK_SORTS,
  STACK_SORT_LABELS,
  STACK_VIEWS,
  STACK_VIEW_LABELS,
  groupItems,
  pick,
} from './stackModel.js';
import { anchorFor, clamp, directionFor, isVertical, originFor } from './stackGeometry.js';

export {
  STACK_VIEWS,
  STACK_SORTS,
  STACK_DISPLAYS,
  STACK_GROUPS,
  STACK_VIEW_LABELS,
  STACK_SORT_LABELS,
  STACK_DISPLAY_LABELS,
  STACK_GROUP_LABELS,
  pick,
};

function openCommand(item, fileExplorer) {
  if (item.type?.includes('directory')) {
    return `${fileExplorer} ${GLib.shell_quote(item.path)}`;
  }
  return `xdg-open ${GLib.shell_quote(item.path)}`;
}

// The int setting that stores an option of the Downloads or Recents stack;
// null for the stacks kept in the folder-stacks JSON.
function intKeyFor(stack, field) {
  if (stack.isDownloads) return `downloads-stack-${field}`;
  if (stack.isRecents) return `recents-stack-${field}`;
  return null;
}

// The folder-stacks entries with one option of `stack` changed. A stack that
// is not listed there yet (the built-in Screenshots one) is appended with its
// current options, which is also what makes the entry take it over.
export function withStackOption(entries, stack, field, value) {
  let index = stack.entryIndex;
  if (index === undefined) {
    let { path, view, sort, display, group } = stack;
    return [...entries, { path, view, sort, display, group, [field]: value }];
  }
  let entry = entries[index];
  if (entry === undefined) return entries;
  let next = [...entries];
  next[index] = { ...(typeof entry === 'string' ? { path: entry } : entry), [field]: value };
  return next;
}

function saveFolderEntry(settings, stack, field, value) {
  let entries;
  try {
    entries = JSON.parse(settings.get_string('folder-stacks'));
  } catch {
    return;
  }
  let next = withStackOption(entries, stack, field, value);
  if (next !== entries) settings.set_string('folder-stacks', JSON.stringify(next));
}

// Persist one option of a stack: Downloads and Recents have their own int
// keys, the other stacks keep theirs in their folder-stacks JSON entry. The
// write rebuilds the stacks (and this item with its menu), so it runs after
// the menu activation has finished instead of under it.
function saveStackOption(extension, stack, field, value, choices) {
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    let settings = extension._settings;
    if (!settings) return GLib.SOURCE_REMOVE;
    let key = intKeyFor(stack, field);
    if (key) {
      settings.set_int(key, choices.indexOf(value));
    } else {
      saveFolderEntry(settings, stack, field, value);
    }
    return GLib.SOURCE_REMOVE;
  });
}

function addRadioSubmenu(menu, title, current, choices, labels, onPick) {
  let sub = new PopupMenu.PopupSubMenuMenuItem(title);
  choices.forEach((choice) => {
    let item = sub.menu.addAction(labels[choice], () => onPick(choice));
    item.setOrnament(
      choice === current
        ? PopupMenu.Ornament.DOT
        : (PopupMenu.Ornament.NO_DOT ?? PopupMenu.Ornament.NONE)
    );
  });
  menu.addMenuItem(sub);
}

const RECENTS_DISPLAY_LABELS = { folder: 'Plain icon', stack: 'Stack' };

// The macOS stack context menu (Sort by, Display as, View content as, Group
// by, Open "<Title>") on a stack's dock item; Recents lists apps, so it has
// no folder to open, sort or group and gets Clear Recents instead.
function addStackMenu(extension, menu, stack) {
  if (!menu) return;
  let open = menu._newWindowItem;
  if (stack.isRecents) {
    open?.destroy();
    open = null;
  } else if (open) {
    open.label.text = `Open "${stack.title}"`;
  }
  let save = (field, choices) => (value) =>
    saveStackOption(extension, stack, field, value, choices);
  let first = new PopupMenu.PopupSeparatorMenuItem();
  menu.addMenuItem(first, 0);
  if (!stack.isRecents) {
    addRadioSubmenu(menu, 'Sort by', stack.sort,
      ['name', 'date-added', 'date-modified', 'date-created', 'kind'],
      STACK_SORT_LABELS, save('sort', STACK_SORTS));
  }
  addRadioSubmenu(menu, 'Display as', stack.display, STACK_DISPLAYS,
    stack.isRecents ? RECENTS_DISPLAY_LABELS : STACK_DISPLAY_LABELS,
    save('display', STACK_DISPLAYS));
  addRadioSubmenu(menu, 'View content as', stack.view, STACK_VIEWS,
    STACK_VIEW_LABELS, save('view', STACK_VIEWS));
  if (!stack.isRecents) {
    addRadioSubmenu(menu, 'Group by', stack.group, STACK_GROUPS,
      STACK_GROUP_LABELS, save('group', STACK_GROUPS));
  }
  // macOS lists the options first and the Open item last
  menu.moveMenuItem(first, menu.numMenuItems - 1);
  if (open) menu.moveMenuItem(open, menu.numMenuItems - 1);
  if (stack.isRecents) menu.addAction('Clear Recents', () => extension.clearRecentApps());
}

// "Display as Stack": the dock icon is the rendered pile of the newest items
// (stack.pile, drawn off the shell's main loop), the top item's own icon
// until the first pile arrives.
function bindPile(dock, item, stack) {
  let extension = dock.extension;
  let dashIcon = item.child;
  let applyDisplay = () => {
    let pile = stack.files?.length ? stack.pile?.gicon : null;
    dashIcon?.setStackGicon?.(pile ?? stackIconFor(stack.files?.[0]));
    // The renderer copies the icon's gicon on its next frame, so starting
    // the animation is enough. A refresh would relayout synchronously, and
    // as this also runs while a relayout creates the item, that recursed.
    extension.animate?.();
  };
  // one listener per dock showing this stack (multi-monitor)
  stack.fileListeners = stack.fileListeners ?? new Set();
  stack.fileListeners.add(applyDisplay);
  item.connect('destroy', () => stack.fileListeners.delete(applyDisplay));
  if (stack.files) applyDisplay();
}

export function setupStackItem(dock, item, stack) {
  addStackMenu(dock.extension, item._menu, stack);
  if (stack.display === 'stack') bindPile(dock, item, stack);
}

const LIST_ROW_STYLE = 'border-radius: 8px; padding: 4px 8px;';
const HOVER = 'background-color: rgba(255,255,255,0.16);';

// popover geometry, logical px
const PANEL_RADIUS = 16;
const NOTCH_HALF = 11; // half the pointer's base
const NOTCH_DEPTH = 10;
const DOCK_GAP = 6; // between the dock's edge and the pointer's tip
const SCREEN_MARGIN = 8;
const MIN_SCROLL = 96; // the panel never shrinks its files below this
// the glass is darker than the dock's for the white labels on it
const GLASS_TINT = [0.1, 0.1, 0.12, 0.5];
const GLASS_MIN_BLUR = 24;
// glass-material off: the former CSS panel (rgba(40,40,46,0.72), 18px corners)
const FLAT_TINT = [40 / 255, 40 / 255, 46 / 255, 0.72];
const FLAT_RADIUS = 18;
const FLAT_RIM = 0.5;
const OPEN_MS = 220;
const CLOSE_MS = 160;
const START_SCALE = 0.2;

// Whether a button press whose source actor is `source` lands outside the
// popover (and so closes the panel).
export function pressClosesPanel(popover, source) {
  return !(source && popover.contains(source));
}

// A full-monitor transparent backdrop (a click outside closes, as in macOS)
// holding the popover beside the dock. `files` are the stack's items in its
// own order; they are listed in batches (Today, Yesterday, ... or by kind)
// when the stack's `group` says so.
export const StackPanel = GObject.registerClass(
  {},
  class StackPanel extends St.Widget {
    _init(dock, target, stack, files, view) {
      super._init({
        name: 'd2daStackBackdrop',
        reactive: true,
        x: dock._monitor.x,
        y: dock._monitor.y,
        width: dock._monitor.width,
        height: dock._monitor.height,
      });
      this.dock = dock;
      this._target = target;
      this._fileExplorer = dock.extension.file_explorer();
      this._scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
      this._connectBackdrop();
      this._buildPopover(stack, files, view);

      Main.uiGroup.add_child(this);
      this._place();
      // modal like a real popup: Escape reaches us and a click anywhere else
      // lands on the backdrop and closes the panel. The grab keeps the layout
      // and Super shortcuts alive (popoverInput.js); Super toggles the overview,
      // which this panel must not stay on top of.
      ({ grab: this._grab, release: this._releaseGrab } = pushPopoverGrab(this));
      this._stopOverviewWatch = closeOnOverviewTransition(() => this.close());
      this.connect('destroy', () => this._stopOverviewWatch?.());
      this.grab_key_focus();
      this._animateIn();
    }

    // A click outside the popover closes the panel. A press on the popover
    // is left unhandled: GNOME 50's St.Button is a click gesture that is
    // cancelled when an ancestor handles (stops) the press, so a STOP here
    // made every file in the panel unclickable.
    _connectBackdrop() {
      this.connect('button-press-event', (actor, evt) => {
        if (!pressClosesPanel(this._popover, global.stage.get_event_actor(evt))) {
          return Clutter.EVENT_PROPAGATE;
        }
        this.close();
        return Clutter.EVENT_STOP;
      });
      this.connect('key-press-event', (actor, evt) => {
        if (evt.get_key_symbol() === Clutter.KEY_Escape) {
          this.close();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });
    }

    _buildPopover(stack, files, view) {
      // the background, the content above it; both scale from the pointer
      this._popover = new St.Widget({ reactive: true });
      this.add_child(this._popover);
      this._glass = new GlassPlatter();
      this._popover.add_child(this._glass);
      this._panel = new St.BoxLayout({
        name: 'd2daStackPanel',
        orientation: Clutter.Orientation.VERTICAL,
        style: 'padding: 10px;',
      });
      this._popover.add_child(this._panel);
      this._panel.add_child(
        new St.Label({
          text: stack.title,
          style: 'font-weight: bold; color: white; padding: 2px 8px 8px 8px;',
          x_align: Clutter.ActorAlign.CENTER,
        })
      );
      this._thumbs = this.dock.extension.services?.thumbnails ?? null;
      let groups = groupItems(files, stack.group ?? 'none', { sort: stack.sort });
      this._scroll = this._buildScroll(groups, view);
      this._panel.add_child(this._scroll);
      if (stack.path) this._panel.add_child(this._openButton(stack));
    }

    _buildScroll(groups, view) {
      let wa = Main.layoutManager.getWorkAreaForMonitor(this.dock._monitorIndex);
      this._content = new StackContent({
        groups,
        view,
        scale: this._scale,
        workAreaWidth: wa.width,
        makeCell: (f, rect, inView) => (view === 'list' ? this._listRow(f, inView) : this._gridCell(f, inView)),
      });
      return this._content.actor;
    }

    _openButton(stack) {
      let open = new St.Button({
        label: 'Open in Files',
        style_class: 'button',
        x_align: Clutter.ActorAlign.END,
        style: 'margin-top: 8px;',
      });
      open.connect('clicked', () =>
        this._spawn(`${this._fileExplorer} ${GLib.shell_quote(stack.path)}`)
      );
      return open;
    }

    _animateIn() {
      this._popover.set_scale(START_SCALE, START_SCALE);
      this._popover.opacity = 0;
      this._popover.ease({
        scale_x: 1,
        scale_y: 1,
        opacity: 255,
        duration: OPEN_MS,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      });
    }

    // The panel stands DOCK_GAP + NOTCH_DEPTH off the dock's edge, on the
    // screen side (above a bottom dock, beside a side dock), centred on the
    // stack's icon but kept on the work area; the pointer follows the icon.
    _place() {
      let dock = this.dock;
      let s = this._scale;
      let sizes = { gap: DOCK_GAP * s, depth: NOTCH_DEPTH * s, margin: SCREEN_MARGIN * s };
      let glassOn = dock.extension.glass_material;
      this._radius = (glassOn ? PANEL_RADIUS : FLAT_RADIUS) * s;
      let pos = dock._position;
      let wa = Main.layoutManager.getWorkAreaForMonitor(dock._monitorIndex);
      // the dock's edge is its background's, so the panel never covers it
      let [x, y] = dock._background.get_transformed_position();
      let [w, h] = dock._background.get_transformed_size();
      let { tip, room } = anchorFor(pos, { x, y, w, h }, wa, sizes);
      let [pw, ph] = this._fitHeight(room);
      let [cx, cy] = this._iconCenter();
      let origin = originFor(pos, {
        tip,
        depth: sizes.depth,
        size: { w: pw, h: ph },
        icon: { x: cx, y: cy },
        wa,
        monitor: dock._monitor,
        margin: sizes.margin,
      });
      this._rect = {
        x: Math.round(origin.x),
        y: Math.round(origin.y),
        w: pw,
        h: ph,
        tip: Math.round(tip),
        vertical: isVertical(pos),
        ...directionFor(pos),
      };
      let r = this._rect;
      this._popover.set_position(r.x - dock._monitor.x, r.y - dock._monitor.y);
      this._popover.set_size(pw, ph);
      this._panel.set_size(pw, ph);
      this._applyMaterial(glassOn);
      this._aim(cx, cy);
    }

    // too tall for the room: give up file rows, never the dock
    _fitHeight(room) {
      let [, pw] = this._panel.get_preferred_width(-1);
      let [, ph] = this._panel.get_preferred_height(pw);
      if (ph > room) {
        let [, sh] = this._scroll.get_preferred_height(-1);
        this._scroll.height = Math.max(MIN_SCROLL * this._scale, sh - (ph - room));
        [, ph] = this._panel.get_preferred_height(pw);
      }
      return [pw, ph];
    }

    _applyMaterial(glassOn) {
      let ext = this.dock.extension;
      let s = this._scale;
      let glass = this._glass;
      if (!glassOn) {
        glass.setBackdrop('none', this.dock._monitorIndex);
        glass.setMaterial(this._radius, 0, 0, FLAT_RIM, ...FLAT_TINT, s);
        return;
      }
      // The windows behind, whatever the dock's glass-backdrop: the panel
      // floats over them (the dock's usual wallpaper-only backdrop would
      // show the wallpaper through a window). It is a still view, blurred
      // once while they do not change.
      glass.setBackdrop('windows', this.dock._monitorIndex);
      glass.setMaterial(
        this._radius,
        Math.max(ext.glass_blur, GLASS_MIN_BLUR) * s,
        ext.glass_refraction * s,
        ext.glass_rim,
        ...GLASS_TINT,
        s
      );
    }

    // Where the stack's icon is drawn: the animator's renderer, which the
    // dock packs apart from the item's own (layout) box.
    _iconCenter() {
      let icon = this._target._renderer ?? this._target;
      let [x, y] = icon.get_transformed_position();
      let [w, h] = icon.get_transformed_size();
      return [x + w / 2, y + h / 2];
    }

    // Points the pointer at (cx, cy), kept on the panel's straight edge.
    _aim(cx, cy) {
      let r = this._rect;
      let half = NOTCH_HALF * this._scale;
      let inset = this._radius + half;
      let tipX = r.vertical ? r.tip : clamp(cx, r.x + inset, r.x + r.w - inset);
      let tipY = r.vertical ? clamp(cy, r.y + inset, r.y + r.h - inset) : r.tip;
      tipX = Math.round(tipX) - r.x;
      tipY = Math.round(tipY) - r.y;
      this._popover.set_pivot_point(tipX / r.w, tipY / r.h);
      let depth = NOTCH_DEPTH * this._scale;
      this._glass.setNotch(tipX, tipY, r.dx, r.dy, half, depth);
      // the backdrop mirrors only the windows under the panel
      this._glass.setGeometry(0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
    }

    // The dock settled after the click (its magnification is off while the
    // panel is open): aim the pointer at where the icon rests.
    aimAtIcon() {
      if (this._closed || !this._rect) return;
      let [cx, cy] = this._iconCenter();
      this._aim(cx, cy);
    }

    // a size x size picture or type icon of `f`, filled in as it arrives
    _thumb(f, size, urgent) {
      let bin = new St.Bin({ width: size * this._scale, height: size * this._scale });
      fillThumbnail(bin, f, size, {
        scale: this._scale,
        service: this._thumbs,
        urgent,
      });
      return bin;
    }

    _gridCell(f, inView) {
      let base = 'border-radius: 10px; padding: 4px;';
      let cell = new St.Button({ style: base, track_hover: true });
      let box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
      });
      let thumb = this._thumb(f, PANEL.GRID_THUMB, inView);
      cell._promote = () => thumb._promote?.();
      thumb.x_align = Clutter.ActorAlign.CENTER;
      box.add_child(thumb);
      // two short lines (stackLayout.cellName): a long name keeps its start
      // and its end; a line still too wide is cut at its end
      let label = new St.Label({
        text: cellName(f.name),
        style: 'color: white; font-size: 9pt; text-align: center;',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      box.add_child(label);
      cell.set_child(box);
      cell.connect('clicked', () => this._open(f));
      cell.connect('notify::hover', () => {
        cell.style = cell.hover ? base + HOVER : base;
      });
      return cell;
    }

    _listRow(f, inView) {
      let row = new St.Button({
        style: LIST_ROW_STYLE,
        track_hover: true,
        x_expand: true,
      });
      let box = new St.BoxLayout({ x_expand: true });
      let thumb = this._thumb(f, PANEL.LIST_THUMB, inView);
      row._promote = () => thumb._promote?.();
      box.add_child(thumb);
      let label = new St.Label({
        text: f.name,
        style: 'color: white; padding-left: 10px;',
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      box.add_child(label);
      row.set_child(box);
      row.connect('clicked', () => this._open(f));
      row.connect('notify::hover', () => {
        row.style = row.hover ? LIST_ROW_STYLE + HOVER : LIST_ROW_STYLE;
      });
      return row;
    }

    // Buttons stay clickable while the panel shrinks away after close();
    // by then the dock reference is gone, so activation is ignored. An item
    // with its own `activate` (a recent app) starts itself; a file opens in
    // its default application, a folder in the file manager.
    _open(f) {
      if (this._closed) return;
      this.dock._maybeBounce(this._target);
      if (f.activate) {
        this.close();
        f.activate();
        return;
      }
      this._spawn(openCommand(f, this._fileExplorer));
    }

    _spawn(cmd) {
      if (this._closed) return;
      this.close();
      trySpawnCommandLine(cmd).catch((err) => console.log(err));
    }

    close() {
      if (this._closed) return;
      this._closed = true;
      if (this.dock?._stackPanel === this) {
        this.dock._stackPanel = null;
        // the dock stayed up for the panel; let autohide decide again
        this.dock.autohider?._debounceCheckHide?.();
      }
      this.dock = null;
      this._stopOverviewWatch?.();
      this._releaseGrab?.();
      if (this._grab) {
        Main.popModal(this._grab);
        this._grab = null;
      }
      // shrink back into the pointer; clicks already pass through
      this.reactive = false;
      this._popover.reactive = false;
      let destroyed = false;
      this.connect('destroy', () => (destroyed = true));
      this._popover.ease({
        scale_x: START_SCALE,
        scale_y: START_SCALE,
        opacity: 0,
        duration: CLOSE_MS,
        mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        onStopped: () => {
          if (!destroyed) this.destroy();
        },
      });
    }
  }
);
