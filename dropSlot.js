'use strict';

// Where on the dock a drop lands, as a pure function (no gi:// imports) so
// tests/drop_slot_check.js runs it under plain gjs. The dock glue measures the
// rectangle of every item, in dock order, and asks which gap or which item
// the pointer is over.
//
// slots: [{ role, x, y, w, h, accepts }], dock order (increasing along the
// dock's axis: x on a horizontal dock, y on a vertical one). `role` is only
// carried for the caller. Along the axis an item that `accepts` the drop is
// "onto" in its middle `ontoShare` (both ends inclusive) and every other part
// of it, or the whole item when it does not accept, belongs to the gap before
// it (the half before the item's midline) or after it (the rest).
//
// Choices where the contract is silent:
//   * The dock's bounds are the union of the slot rectangles; the pointer is
//     off the dock when it is further than `margin` outside them, across the
//     dock as well as along it. A point exactly on the edge is on the dock.
//   * An item owns [start, end) along the axis, the last item also its end,
//     so a point where two items touch belongs to the second.
//   * A pointer before the first item is `between` 0 and after the last one
//     `between` count.
//   * A slot whose x, y, w or h is not a finite number, or whose w or h is not
//     above 0, is unmeasured: it is ignored for the dock's bounds and can
//     never be hit or be `onto`, but its index still counts (indices are
//     positions in `slots`). With no measured slot the answer is `none`.
//   * A pointer that is not finite is `none`, a negative margin is 0, a
//     non-finite margin counts as 0, an `ontoShare` outside 0..1 is clamped
//     (0 never gives `onto`).
//   * `accepts` must be exactly true.

const NONE = Object.freeze({ kind: 'none' });

const finite = (value) => (Number.isFinite(value) ? value : 0);

const isMeasured = (slot) =>
  [slot?.x, slot?.y].every(Number.isFinite) &&
  [slot?.w, slot?.h].every((size) => Number.isFinite(size) && size > 0);

// the extent of a slot along the dock and across it, null when unmeasured
function extents(slot, vertical) {
  if (!isMeasured(slot)) return null;
  const { x, y, w, h } = slot;
  return vertical
    ? { start: y, end: y + h, crossStart: x, crossEnd: x + w }
    : { start: x, end: x + w, crossStart: y, crossEnd: y + h };
}

function within(value, low, high, margin) {
  return value >= low - margin && value <= high + margin;
}

function isOnDock(boxes, along, across, margin) {
  if (boxes.length === 0) return false;
  const crossStart = Math.min(...boxes.map((box) => box.crossStart));
  const crossEnd = Math.max(...boxes.map((box) => box.crossEnd));
  const start = Math.min(...boxes.map((box) => box.start));
  const end = Math.max(...boxes.map((box) => box.end));
  return (
    within(across, crossStart, crossEnd, margin) &&
    within(along, start, end, margin)
  );
}

function isInside(box, along, isLast) {
  return (
    along >= box.start && (along < box.end || (isLast && along === box.end))
  );
}

function isOnto(box, along, share) {
  const mid = (box.start + box.end) / 2;
  return (
    share > 0 && Math.abs(along - mid) <= ((box.end - box.start) * share) / 2
  );
}

function landOnItem(box, slot, index, along, share) {
  if (slot?.accepts === true && isOnto(box, along, share)) {
    return { kind: 'onto', index };
  }
  const beforeMidline = along < (box.start + box.end) / 2;
  return { kind: 'between', index: beforeMidline ? index : index + 1 };
}

// -> { kind: 'onto', index } | { kind: 'between', index } | { kind: 'none' }
// `index` of `onto` is the item, of `between` the insertion index (the number
// of items before the gap).
export function dropSlot(slots, x, y, vertical, opts) {
  if (!Array.isArray(slots) || slots.length === 0) return NONE;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NONE;
  const margin = Math.max(0, finite(opts?.margin));
  const share = Math.min(1, Math.max(0, opts?.ontoShare ?? 0.5));
  const boxes = slots.map((slot) => extents(slot, vertical));
  const along = vertical ? y : x;
  const across = vertical ? x : y;
  if (!isOnDock(boxes.filter(Boolean), along, across, margin)) return NONE;
  const last = boxes.findLastIndex(Boolean);
  for (let i = 0; i < boxes.length; i += 1) {
    if (boxes[i] === null) continue;
    if (isInside(boxes[i], along, i === last)) {
      return landOnItem(boxes[i], slots[i], i, along, share);
    }
    if (along < boxes[i].start) return { kind: 'between', index: i };
  }
  return { kind: 'between', index: slots.length };
}
