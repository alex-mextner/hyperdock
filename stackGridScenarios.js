'use strict';

// What the open stack panel's Grid really laid out, read back from the actors
// so the nested-shell scenarios can check it (stackOpenScenarios.js).

import St from 'gi://St';

function collect(actor, type, out = []) {
  if (actor instanceof type) out.push(actor);
  actor.get_children().forEach((c) => collect(c, type, out));
  return out;
}

const rectOf = (actor, origin) => {
  const [x, y] = actor.get_transformed_position();
  const [w, h] = actor.get_transformed_size();
  return { x: Math.round(x - origin.x), y: Math.round(y - origin.y), w: Math.round(w), h: Math.round(h) };
};

// Rects (relative to the scroll's top-left, scrolled content included) of the
// panel, scroll, cells (buttons) and batch headers (labels outside cells).
export function gridGeometry(panel) {
  const scroll = panel._scroll;
  const [ox, oy] = scroll.get_transformed_position();
  const origin = { x: ox, y: oy };
  const cells = collect(scroll, St.Button);
  const inCell = (label) => cells.some((c) => c.contains(label));
  const headers = collect(scroll, St.Label).filter((l) => !inCell(l));
  return {
    scale: panel._scale,
    scroll: rectOf(scroll, origin),
    panel: rectOf(panel._panel, origin),
    popover: rectOf(panel._popover, origin),
    cells: cells.map((c) => rectOf(c, origin)),
    headers: headers.map((l) => ({ text: l.text, ...rectOf(l, origin) })),
  };
}

// What is wrong with the grid as laid out (empty when nothing): a cell off the
// column grid or overlapping another, a header that does not span the width.
export function gridProblems(geometry) {
  const problems = [];
  const cell = Math.min(...geometry.cells.map((c) => c.w).filter((w) => w > 0), Infinity);
  const seen = new Set();
  geometry.cells.forEach((c, i) => {
    if (c.x % cell !== 0) problems.push(`cell ${i} is off the columns: x=${c.x}`);
    const key = `${c.x},${c.y}`;
    if (seen.has(key)) problems.push(`cell ${i} overlaps another at ${key}`);
    seen.add(key);
  });
  const widest = Math.max(0, ...geometry.cells.map((c) => c.x + c.w));
  geometry.headers.forEach((hd) => {
    if (hd.x !== 0 || hd.w < widest) problems.push(`header "${hd.text}" does not span the width`);
  });
  return problems;
}
