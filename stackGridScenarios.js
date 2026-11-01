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
