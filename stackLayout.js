'use strict';

// Where every cell, row and header of a stack dropdown stands, as pure
// functions (no gi:// imports) so tests/stack_layout_check.js runs them under
// plain gjs. stackContent.js turns the rectangles into actors, only for the
// part that is on screen: a folder of two thousand files is two thousand
// rectangles here and a few dozen actors there.
//
// The Grid is one column grid for the whole dropdown: every batch (Today,
// Yesterday, ...) starts a new row under a header that spans the full width
// and fills the SAME columns, so a batch of two files has its files in the
// first two columns of the grid, not stretched across the row. (The earlier
// layout gave each batch its own homogeneous Clutter.GridLayout, which spread
// a short batch over the whole width: a batch of one sat in the middle.)
//
// All sizes are logical px; the caller multiplies by the theme scale.

export const PANEL = {
  GRID_COLUMNS: 5,
  MIN_COLUMNS: 2,
  GRID_CELL: 96,
  GRID_ROW: 108,
  GRID_THUMB: 64,
  LIST_THUMB: 24,
  LIST_ROW: 36,
  LIST_WIDTH: 300,
  HEADER: 26,
  // a panel shows at most this many rows (plus one batch header) and scrolls
  // the rest
  MAX_GRID_ROWS: 4,
  MAX_LIST_ROWS: 12,
  // the overlay scrollbar's lane, so it never sits on the last column
  SCROLL_LANE: 12,
  // the panel takes at most this share of the work area's width
  MAX_WIDTH_SHARE: 0.6,
};

// How many columns fit: GRID_COLUMNS, fewer on a work area too narrow for
// them (never below MIN_COLUMNS), and never more than there are files.
export function gridColumns(workAreaWidth, itemCount = Infinity) {
  const room = Math.floor((workAreaWidth * PANEL.MAX_WIDTH_SHARE) / PANEL.GRID_CELL);
  const fit = Math.max(PANEL.MIN_COLUMNS, Math.min(PANEL.GRID_COLUMNS, room));
  return Math.max(1, Math.min(fit, itemCount));
}

// The first index of `rects` (ascending in y) that starts at or below `limit`
function lowerBound(rects, limit) {
  let lo = 0;
  let hi = rects.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rects[mid].y < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Grid of `groups` ([{key, title, items}], see stackModel.groupItems) in
// `columns` columns. Returns
//   width, height   of the whole content
//   headers         [{title, key, x, y, w, h}] one per titled batch
//   cells           [{x, y, w, h, group, index, number}] in reading order;
//                   `number` counts across batches, `index` inside the batch
export function layoutGrid(groups, columns = PANEL.GRID_COLUMNS) {
  const width = columns * PANEL.GRID_CELL;
  const headers = [];
  const cells = [];
  let y = 0;
  groups.forEach((group, g) => {
    if (group.title) {
      headers.push({ title: group.title, key: group.key, x: 0, y, w: width, h: PANEL.HEADER });
      y += PANEL.HEADER;
    }
    for (let index = 0; index < group.items.length; index++) {
      cells.push({
        x: (index % columns) * PANEL.GRID_CELL,
        y: y + Math.floor(index / columns) * PANEL.GRID_ROW,
        w: PANEL.GRID_CELL,
        h: PANEL.GRID_ROW,
        group: g,
        index,
        number: cells.length,
      });
    }
    y += Math.ceil(group.items.length / columns) * PANEL.GRID_ROW;
  });
  return { view: 'grid', columns, width, height: y, headers, cells };
}

// The same for the List: one full-width row per file under its header.
export function layoutList(groups) {
  const headers = [];
  const cells = [];
  let y = 0;
  groups.forEach((group, g) => {
    if (group.title) {
      headers.push({ title: group.title, key: group.key, x: 0, y, w: PANEL.LIST_WIDTH, h: PANEL.HEADER });
      y += PANEL.HEADER;
    }
    for (let index = 0; index < group.items.length; index++) {
      cells.push({ x: 0, y, w: PANEL.LIST_WIDTH, h: PANEL.LIST_ROW, group: g, index, number: cells.length });
      y += PANEL.LIST_ROW;
    }
  });
  return { view: 'list', columns: 1, width: PANEL.LIST_WIDTH, height: y, headers, cells };
}

export function layoutFor(groups, view, workAreaWidth) {
  if (view === 'list') return layoutList(groups);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  return layoutGrid(groups, gridColumns(workAreaWidth, count));
}

// The visible size of the area that shows `layout`: as tall as the content,
// capped so a long stack scrolls, and wide enough for the scrollbar's lane
// when it does.
export function viewportSize(layout) {
  const cap =
    layout.view === 'list'
      ? PANEL.MAX_LIST_ROWS * PANEL.LIST_ROW + PANEL.HEADER
      : PANEL.MAX_GRID_ROWS * PANEL.GRID_ROW + PANEL.HEADER;
  const scrolls = layout.height > cap;
  return {
    width: layout.cells.length ? layout.width + (scrolls ? PANEL.SCROLL_LANE : 0) : 0,
    height: Math.min(layout.height, cap),
    scrolls,
  };
}

// The slice [first, last) of `rects` (ascending in y, as the layouts make
// them) that touches the window [top - margin, top + height + margin).
export function visibleSlice(rects, top, height, margin = 0) {
  const from = top - margin;
  const to = top + height + margin;
  // a rect is in when it ends below `from` and starts above `to`; rects are
  // at most one row tall, so the first candidate starts a row above `from`
  const tallest = rects.length ? rects[0].h : 0;
  let first = lowerBound(rects, from - tallest + 1);
  while (first < rects.length && rects[first].y + rects[first].h <= from) first++;
  let last = first;
  while (last < rects.length && rects[last].y < to) last++;
  return [first, last];
}

// The scroll offset that brings `rect` fully into a window of `height` at
// `top`, moving as little as possible.
export function scrollToReveal(rect, top, height) {
  if (rect.y < top) return rect.y;
  if (rect.y + rect.h > top + height) return rect.y + rect.h - height;
  return top;
}

// ---- names ----------------------------------------------------------------

// A file name for a cell label of two short lines (NAME_LINE characters fit a
// cell). A name of one line stays; one that fits two is broken at its last
// separator (a dash, underscore, space, or the dot before the extension) that
// leaves both lines within NAME_LINE; a longer one loses its middle and shows
// its start over its end: "Screenshot From 2026-11-01 16-10-04.png" is
// "Screenshot…" over "16-10-04.png", which is what tells it from its
// neighbours. The label draws each line on its own and cuts a line that is
// still too wide.
export const NAME_LINE = 12;

// where to break `chars` (the code points of a name of NAME_LINE+1 .. 2*NAME_LINE)
function breakAt(chars, line) {
  const lowest = chars.length - line;
  for (let i = line; i >= lowest; i--) {
    // the cut is before the dot, after the other separators
    if (chars[i] === '.' && i > 0) return i;
    if (i > 0 && /[\s\-_]/.test(chars[i - 1])) return i;
  }
  return line;
}

// Works on code points, so a character outside the BMP (an emoji) is never cut
// in half.
export function cellName(name, line = NAME_LINE) {
  const chars = Array.from(name);
  const join = (from, to) => chars.slice(from, to).join('');
  if (chars.length <= line) return name;
  if (chars.length <= 2 * line) {
    const cut = breakAt(chars, line);
    return `${join(0, cut).trimEnd()}\n${join(cut).trimStart()}`;
  }
  const head = join(0, line - 1).trimEnd();
  const tail = join(chars.length - line).trimStart();
  return `${head}…\n${tail}`;
}
