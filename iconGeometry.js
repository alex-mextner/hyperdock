// Pure icon geometry (no gi imports, unit-tested under node): opaque-bbox
// measurement, size normalization, snapping and the running-indicator band.

// Share of the slot every icon's visible content is normalized to.
export const CONTENT_TARGET = 0.9;
// Alpha at or below this counts as transparent: drop shadows and glow haze
// (Firefox: 93% tall at alpha 16, 90.6% at 64) must not inflate the size.
export const ALPHA_THRESHOLD = 64;
// Bounds on the correction so a mostly empty icon is not blown up.
const MIN_CORRECTION = 0.6;
const MAX_CORRECTION = 1.35;
// Largest bbox-centering shift, in canvas fractions.
const MAX_CENTER_SHIFT = 0.08;

// Leftmost / rightmost opaque pixel of one row (`row` = offset of its first
// alpha byte), -1 when the row is transparent.
function firstOpaque(data, row, width, nChannels, threshold) {
  for (let x = 0; x < width; x++) {
    if (data[row + x * nChannels] > threshold) return x;
  }
  return -1;
}

function lastOpaque(data, row, width, nChannels, threshold) {
  for (let x = width - 1; x >= 0; x--) {
    if (data[row + x * nChannels] > threshold) return x;
  }
  return -1;
}

/**
 * Opaque bounding box of a pixel buffer.
 * @param {ArrayLike<number>} data pixels, rowstride bytes per row
 * @param {number} nChannels 4 = RGBA; anything else is treated as opaque
 * @returns {{x0:number,y0:number,x1:number,y1:number}|null} x1/y1 exclusive;
 *   null when fully transparent
 */
export function opaqueBBox(data, width, height, rowstride, nChannels, threshold = ALPHA_THRESHOLD) {
  if (width <= 0 || height <= 0) {
    return null;
  }
  if (nChannels < 4) {
    return { x0: 0, y0: 0, x1: width, y1: height };
  }
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    let row = y * rowstride + 3;
    let first = firstOpaque(data, row, width, nChannels, threshold);
    if (first < 0) continue;
    if (first < x0) x0 = first;
    let last = lastOpaque(data, row, width, nChannels, threshold);
    if (last > x1) x1 = last;
    if (y < y0) y0 = y;
    y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// fill: share of the slot the visible content covers once corrected
export const IDENTITY_NORMALIZATION = Object.freeze({ k: 1, dx: 0, dy: 0, fill: 1 });

/**
 * Correction that makes the visible content fill CONTENT_TARGET of the slot.
 * k scales the canvas about its centre; (dx, dy) shift the scaled canvas, in
 * slot-size fractions, so the content centre lands on the slot centre.
 */
export function normalization(bbox, width, height, target = CONTENT_TARGET) {
  if (!bbox) {
    return IDENTITY_NORMALIZATION;
  }
  let canvas = Math.max(width, height);
  let content = Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0) / canvas;
  let k = Math.min(MAX_CORRECTION, Math.max(MIN_CORRECTION, target / content));
  let clamp = v => Math.min(MAX_CENTER_SHIFT, Math.max(-MAX_CENTER_SHIFT, v));
  let cx = ((bbox.x0 + bbox.x1) / 2 - width / 2) / canvas;
  let cy = ((bbox.y0 + bbox.y1) / 2 - height / 2) / canvas;
  return { k, dx: -clamp(cx) * k, dy: -clamp(cy) * k, fill: content * k };
}

/** Snap a logical coordinate to the physical pixel grid. */
export function snapToPixel(v, scale) {
  return Math.round(v * scale) / scale;
}

// Indicator drawing geometry mirrored from apps/dot.js, in canvas units.
const BAR_HEIGHT = 6;
const SIZE_FACTORS = [0.8, 0.5, 1.0];
const PADDING = 8;
// Antialiasing, the 1-unit stroke and whole-pixel rows on each side.
const BAND_FUZZ = 1.5;

/**
 * Vertical extent [top, bottom] of an indicator style inside a canvas of
 * `canvas` units, drawn for a dock at the bottom (y grows towards the screen
 * edge). Must track the style functions in apps/dot.js.
 */
export function indicatorBand(style, sizeIndex, canvas) {
  let m = SIZE_FACTORS[sizeIndex] || 1;
  let bar = (extra = 0) => (BAR_HEIGHT + extra) * m;
  let top;
  let bottom;
  switch (style) {
    case 'segmented':
    case 'solid': {
      let h = bar();
      top = canvas - h * 2.5;
      bottom = top + h;
      break;
    }
    case 'dashes':
    case 'dash': {
      // dash thickness is width / 14, independent of the size setting
      let h = bar(2);
      top = canvas - h * 1.5;
      bottom = top + (canvas - PADDING * 2) / 14;
      break;
    }
    case 'squares':
    case 'square':
    case 'triangles':
    case 'triangle':
    case 'diamonds':
    case 'diamond': {
      let extra = style.startsWith('square') ? 5 : style.startsWith('tri') ? 6 : 10;
      let h = bar(extra);
      top = canvas - h * 1.5;
      bottom = top + h;
      break;
    }
    case 'binary': {
      let h = bar(2);
      let r = h * 0.9;
      let y0 = canvas - h * 1.5 - r / 2;
      top = y0 - r / 2;
      bottom = Math.max(y0 + r / 2 + r, y0 + h - 2);
      break;
    }
    default: {
      let h = bar();
      top = canvas - h * 3;
      bottom = canvas - h;
    }
  }
  return { top: top - BAND_FUZZ, bottom: bottom + BAND_FUZZ };
}

const OUTWARD = {
  top: Object.freeze([0, -1]),
  left: Object.freeze([-1, 0]),
  right: Object.freeze([1, 0]),
  bottom: Object.freeze([0, 1]),
};

/** Shared unit vector from the icon towards the screen edge it docks to. */
export function outward(position) {
  return OUTWARD[position] || OUTWARD.bottom;
}

/**
 * Outer edge of a dock for the indicators. `outer` is the platter's outward
 * coordinate as drawn (it already includes `slide`, the dash translation along
 * the cross axis: autohide, edge distance); `bound` is the monitor edge on
 * that side. A platter padded past the screen is clamped to the monitor in its
 * resting place, then the slide is added back, so a hidden dock keeps its dots
 * with it instead of leaving them on screen.
 */
export function visibleEdge(position, outer, slide, bound) {
  let rest = outer - slide;
  let towardsMax = position === 'bottom' || position === 'right';
  return (towardsMax ? Math.min(rest, bound) : Math.max(rest, bound)) + slide;
}

/**
 * Where the running-indicator overlay goes. Every item shares one baseline:
 * the band is anchored to the dock's own edge, never to the item it belongs
 * to, so differently sized, normalized or magnified icons all get dots on the
 * same line, `margin` px inside the dock.
 *
 * The overlay is a fixed `rest` px square (the unmagnified icon size, not the
 * item's live slot) that draws the band at its bottom edge. It is put flush
 * against the dock edge (`edge`: the cross-axis coordinate of the dock's
 * outward side) and centred on `along` (the item's centre along the dock),
 * then shifted `shift` px outward so the band's outer edge lands `margin` px
 * inside the dock. Allocation-free except for the result: runs every frame.
 *
 * @returns {{x:number,y:number,shift:number,dx:number,dy:number,rect:{x:number,y:number,w:number,h:number}}}
 *   x/y overlay origin before the shift; dx/dy the shift as a translation;
 *   rect the band's world rectangle after it.
 */
export function indicatorPlacement({ position, edge, along, rest, band, canvas, margin }) {
  let k = rest / canvas;
  let [ox, oy] = outward(position);
  // band's outer edge, measured inward from the overlay's outer edge
  let shift = (canvas - band.bottom) * k - margin;
  let x = ox !== 0 ? (ox > 0 ? edge - rest : edge) : along - rest / 2;
  let y = oy !== 0 ? (oy > 0 ? edge - rest : edge) : along - rest / 2;
  // band extents along the outward axis, from the overlay's outer edge inward
  let near = (canvas - band.bottom) * k; // outer side of the band
  let far = (canvas - band.top) * k; // icon-facing side of the band
  let rect;
  if (ox !== 0) {
    let outer = edge - ox * (near - shift);
    let inner = edge - ox * (far - shift);
    rect = { x: Math.min(outer, inner), y, w: far - near, h: rest };
  } else {
    let outer = edge - oy * (near - shift);
    let inner = edge - oy * (far - shift);
    rect = { x, y: Math.min(outer, inner), w: rest, h: far - near };
  }
  return { x, y, shift, dx: ox * shift, dy: oy * shift, rect };
}
