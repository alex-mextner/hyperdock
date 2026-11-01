'use strict';

// The scrolling file area of a stack dropdown: the Grid or the List as an
// St.ScrollView that holds an actor only for the cells near the window.
//
// stackLayout.js places every cell and header; this module creates the headers
// (a handful) up front and a cell's actor only when the window comes within a
// page of it, and drops those that fell more than two pages away. A folder of
// two thousand files is thus a few dozen actors, and opening the dropdown
// costs the same for ten files as for ten thousand.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { layoutFor, scrollToReveal, viewportSize, visibleSlice } from './stackLayout.js';

const HEADER_STYLE =
  'font-weight: bold; font-size: 9pt; color: rgba(255,255,255,0.62); padding: 6px 8px 2px 8px;';

export class StackContent {
  // groups: stackModel.groupItems(); view: 'grid' | 'list'; scale: the theme
  // scale; workAreaWidth: of the dock's monitor (the number of columns);
  // makeCell(item, rect, inView): an St.Button for a cell, placed and sized here
  constructor({ groups, view, scale, workAreaWidth, makeCell }) {
    this._scale = scale;
    this._makeCell = makeCell;
    this._items = groups.flatMap((group) => group.items);
    this.layout = layoutFor(groups, view, workAreaWidth);
    this.size = viewportSize(this.layout);
    this._realized = new Map();
    this._idle = 0;

    this.actor = new St.ScrollView({
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      overlay_scrollbars: true,
    });
    this._canvas = new St.Widget({
      width: this.layout.width * scale,
      height: this.layout.height * scale,
    });
    const box = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL });
    box.add_child(this._canvas);
    this.actor.set_child(box);
    this.actor.set_size(this.size.width * scale, this.size.height * scale);

    this._addHeaders();
    this._adjustment = this.actor.vadjustment;
    this._valueId = this._adjustment.connect('notify::value', () => this._schedule());
    this.actor.connect('destroy', () => this.destroy());
    // only what is in view before the first frame; the page around it follows
    this._sync(0);
    this._schedule();
  }

  _addHeaders() {
    const s = this._scale;
    this.layout.headers.forEach((rect) => {
      const label = new St.Label({ text: rect.title, style: HEADER_STYLE });
      label.set_position(rect.x * s, rect.y * s);
      label.set_size(rect.w * s, rect.h * s);
      this._canvas.add_child(label);
    });
  }

  // the window in layout px
  _window() {
    const s = this._scale;
    const height = (this.actor.height || this.size.height * s) / s;
    return { top: this._adjustment.value / s, height };
  }

  // After the window moved: what is in view first, the page around it in a
  // second step, so that a jump across the list shows the view before the
  // margin is made.
  _schedule() {
    if (this._idle) return;
    this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._sync(0);
      this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        this._idle = 0;
        this._sync();
        return GLib.SOURCE_REMOVE;
      });
      return GLib.SOURCE_REMOVE;
    });
  }

  // makes the cells within `ahead` px of the window (a page by default),
  // drops those beyond two pages
  _sync(ahead = null) {
    const { top, height } = this._window();
    const cells = this.layout.cells;
    const [from, to] = visibleSlice(cells, top, height, ahead ?? height);
    const [keepFrom, keepTo] = visibleSlice(cells, top, height, 2 * height);
    this._realized.forEach((actor, number) => {
      if (number >= keepFrom && number < keepTo) return;
      actor.destroy();
      this._realized.delete(number);
    });
    const s = this._scale;
    const [inFrom, inTo] = visibleSlice(cells, top, height, 0);
    for (let number = from; number < to; number++) {
      if (this._realized.has(number)) continue;
      const rect = cells[number];
      const inView = number >= inFrom && number < inTo;
      const cell = this._makeCell(this._items[number], rect, inView);
      cell.set_position(rect.x * s, rect.y * s);
      cell.set_size(rect.w * s, rect.h * s);
      this._canvas.add_child(cell);
      this._realized.set(number, cell);
    }
    // cells made as margin that the window has reached
    for (let number = inFrom; number < inTo; number++) {
      const cell = this._realized.get(number);
      cell?._promote?.();
      if (cell) cell._promote = null;
    }
  }

  // The items whose cells exist now (what is on screen or a page away)
  realizedItems() {
    return [...this._realized.keys()].map((number) => this._items[number]);
  }

  // The actor of cell `number` if it is on screen now, else null.
  cellActor(number) {
    return this._realized.get(number) ?? null;
  }

  // Scrolls cell `number` (reading order across all batches) into view.
  ensureVisible(number) {
    const rect = this.layout.cells[number];
    if (!rect) return;
    const s = this._scale;
    const { top, height } = this._window();
    this._adjustment.value = scrollToReveal(rect, top, height) * s;
    this._sync();
  }

  destroy() {
    if (this._idle) GLib.source_remove(this._idle);
    this._idle = 0;
    try {
      if (this._valueId) this._adjustment.disconnect(this._valueId);
    } catch {
      // the adjustment went with the scroll view
    }
    this._valueId = 0;
    this._realized.clear();
  }
}
