'use strict';

// stackSelection.js - the selection model and keyboard navigation of a stack
// dropdown (contract 11.1 of docs/STACK_INTERACTIONS.md).
//
// Decides which items are selected, where the keyboard cursor goes for an
// arrow / Home / End / Page key, what a click or a pointer hover does to a
// selection, and which item a typed prefix jumps to. It only knows numbers
// (an item's 0-based position in reading order) and the shape of what is on
// screen, never a Clutter actor, so it has no `gi://` imports and runs under
// plain `gjs -m` in tests/stack_selection_check.js. The dropdown glue calls it
// and paints the result.
//
// Choices where the contract is silent:
// - A Shift range or Shift click whose anchor is unset (or no longer on screen)
//   grows from the cursor when there is one, else from the target; a Shift
//   navigation stores that start as the new anchor (without it the next Shift
//   step would restart the range). A Shift click keeps the anchor unchanged, as
//   the contract says, and starts from the first item of the reading order.
// - In the fan "reading order" is the `visual` order (nearest the dock first).
// - `selectAll` has no previous selection to read: the anchor is the first item
//   of the reading order and the focus the last.
// - PageUp with no focus selects the last item, like Up, Left and End.
// - A name matches a typed buffer by its stripped form (one leading '.' removed)
//   or by its raw form, so '.b' still finds '.bashrc'.
// - Numbers that are not on screen (negative, fractional, >= count) given to
//   `clickSelect` / `hoverSelect` leave the selection unchanged.

const DEFAULT_PAGE_ROWS = 4;

export const EMPTY_SELECTION = Object.freeze({
  focus: -1,
  anchor: -1,
  selected: Object.freeze([]),
});

const range = (start, length) => Array.from({ length }, (_, i) => start + i);
const ascending = (a, b) => a - b;
const toCount = (value) => Math.max(0, Math.floor(Number(value)) || 0);

function single(number) {
  return { focus: number, anchor: number, selected: [number] };
}

function batchesOf(shape, count) {
  const sizes = Array.isArray(shape.groupSizes) ? shape.groupSizes : [count];
  const batches = [];
  let next = 0;
  for (const size of sizes) {
    const length = Math.min(toCount(size), count - next);
    if (length > 0) {
      batches.push(range(next, length));
      next += length;
    }
  }
  // sizes that do not add up to count must not hide items
  if (next < count) batches.push(range(next, count - next));
  return batches;
}

function chunk(items, size) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export function rowsOf(shape) {
  const count = toCount(shape.count);
  if (shape.view === 'fan') return (shape.visual ?? []).map((number) => [number]);
  if (shape.view === 'list') return range(0, count).map((number) => [number]);
  const columns = Math.max(1, toCount(shape.columns));
  return batchesOf(shape, count).flatMap((batch) => chunk(batch, columns));
}

const orderOf = (shape) => rowsOf(shape).flat();

export function initialSelection(shape) {
  const order = orderOf(shape);
  return order.length === 0 ? EMPTY_SELECTION : single(order[0]);
}

// Where the focus sits: its row and column, or null when it is not on screen.
function locate(rows, focus) {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].indexOf(focus);
    if (c >= 0) return { r, c };
  }
  return null;
}

const pageRowsOf = (shape) => toCount(shape.pageRows) || DEFAULT_PAGE_ROWS;

// Signed row steps per key; in the fan a row is one step away from the dock.
function rowSteps(shape) {
  const page = pageRowsOf(shape);
  if (shape.view === 'fan') {
    return new Map([['Up', 1], ['Right', 1], ['PageUp', page], ['Down', -1], ['Left', -1], ['PageDown', -page]]);
  }
  return new Map([['Up', -1], ['Down', 1], ['PageUp', -page], ['PageDown', page]]);
}

function rowTarget(rows, at, delta, isPage) {
  const row = at.r + delta;
  if (row < 0 || row >= rows.length) {
    if (!isPage) return null;
    return delta < 0 ? rows[0][0] : rows[rows.length - 1].at(-1);
  }
  return rows[row][Math.min(at.c, rows[row].length - 1)];
}

// Left/Right walk the reading order of a grid; a list reserves them.
function sideTarget(shape, order, key, here) {
  if (shape.view !== 'grid') return null;
  const delta = key === 'Right' ? 1 : key === 'Left' ? -1 : 0;
  return order[here + delta] ?? null;
}

const FROM_THE_END = new Set(['Up', 'Left', 'End', 'PageUp']);

function targetFor(focus, key, shape, rows) {
  const order = rows.flat();
  const at = locate(rows, focus);
  if (key === 'Home') return order[0];
  if (key === 'End') return order.at(-1);
  if (!at) return FROM_THE_END.has(key) ? order.at(-1) : order[0];
  const delta = rowSteps(shape).get(key);
  if (delta !== undefined) return rowTarget(rows, at, delta, key.startsWith('Page'));
  if (key === 'Left' || key === 'Right') {
    return sideTarget(shape, order, key, order.indexOf(focus));
  }
  return null;
}

function rangeBetween(order, from, to) {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  return order.slice(Math.min(a, b), Math.max(a, b) + 1).sort(ascending);
}

function moveTo(sel, target, mods, order) {
  if (mods.shift) {
    const start = [sel.anchor, sel.focus].find((n) => order.includes(n)) ?? target;
    return { focus: target, anchor: start, selected: rangeBetween(order, start, target) };
  }
  if (mods.ctrl) return { focus: target, anchor: sel.anchor, selected: [...sel.selected] };
  return single(target);
}

export function applyNav(sel, key, mods, shape) {
  const rows = rowsOf(shape);
  if (rows.length === 0) return sel;
  const target = targetFor(sel.focus, key, shape, rows);
  if (target === null || target === undefined) return sel;
  return moveTo(sel, target, mods ?? {}, rows.flat());
}

export function selectAll(shape) {
  const order = orderOf(shape);
  if (order.length === 0) return EMPTY_SELECTION;
  return { focus: order.at(-1), anchor: order[0], selected: [...order].sort(ascending) };
}

function toggled(selected, number) {
  if (selected.includes(number)) return selected.filter((n) => n !== number);
  return [...selected, number].sort(ascending);
}

export function clickSelect(sel, number, mods, shape) {
  const order = orderOf(shape);
  if (!order.includes(number)) return { selection: sel, open: false };
  if (mods?.shift) {
    const start = order.includes(sel.anchor) ? sel.anchor : order[0];
    const selected = rangeBetween(order, start, number);
    return { selection: { focus: number, anchor: sel.anchor, selected }, open: false };
  }
  if (mods?.ctrl) {
    const selected = toggled(sel.selected, number);
    return { selection: { focus: number, anchor: number, selected }, open: false };
  }
  return { selection: single(number), open: true };
}

// `shape` (optional) bounds the hovered number to 0..shape.count-1, like clickSelect.
export function hoverSelect(sel, number, shape) {
  if (!Number.isInteger(number) || number < 0) return sel;
  if (shape && number >= toCount(shape.count)) return sel;
  if (sel.selected.length > 1) return sel;
  if (sel.focus === number && sel.selected.length === 1 && sel.selected[0] === number) return sel;
  return single(number);
}

export function toggleFocus(sel) {
  if (sel.focus < 0) return sel;
  return { focus: sel.focus, anchor: sel.focus, selected: toggled(sel.selected, sel.focus) };
}

const stripDot = (name) => (name.startsWith('.') ? name.slice(1) : name);

function matchesPrefix(name, prefix) {
  const lower = String(name).toLocaleLowerCase();
  return stripDot(lower).startsWith(prefix) || lower.startsWith(prefix);
}

// The characters of `buffer` when it is one character typed again and again.
function repeatedChar(buffer) {
  const chars = [...buffer];
  if (chars.length < 2) return null;
  return chars.every((c) => c === chars[0]) ? chars[0] : null;
}

export function typeSelect(names, buffer, from) {
  const count = names.length;
  if (count === 0 || !buffer) return -1;
  const typed = buffer.toLocaleLowerCase();
  const char = repeatedChar(typed);
  const prefix = char ?? typed;
  const inRange = Number.isInteger(from) && from >= 0 && from < count;
  const start = inRange ? (from + (char === null ? 0 : 1)) % count : 0;
  for (let i = 0; i < count; i++) {
    const index = (start + i) % count;
    if (matchesPrefix(names[index], prefix)) return index;
  }
  return -1;
}

export function actTargets(sel) {
  if (sel.selected.length > 0) return [...sel.selected];
  return sel.focus >= 0 ? [sel.focus] : [];
}

export function reconcile(sel, shape) {
  const count = toCount(shape.count);
  if (count === 0) return EMPTY_SELECTION;
  const selected = sel.selected.filter((n) => n < count);
  if (sel.focus < count) {
    const anchor = sel.anchor < count ? sel.anchor : sel.focus;
    return { focus: sel.focus, anchor, selected };
  }
  if (selected.length === 0) return initialSelection(shape);
  const focus = selected.at(-1);
  return { focus, anchor: focus, selected };
}
