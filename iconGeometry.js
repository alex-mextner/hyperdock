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
    for (let x = 0; x < width; x++) {
      if (data[row + x * nChannels] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
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
 * Distance to move the indicator overlay (a square of `size` px drawing the
 * band at its bottom edge) towards the docked side so the band's icon-facing
 * edge sits `gap` px past the visible content. `fill` is the share of the
 * slot the content covers (centred). Allocation-free: runs every frame.
 */
export function indicatorShift(size, fill, bandTop, canvas, gap) {
  return (size * fill) / 2 + gap - (bandTop * size) / canvas + size / 2;
}

/**
 * Where to put the indicator overlay.
 * `content` is the rendered visible icon rect {x, y, w, h}; `slot` the square
 * the overlay is sized to ({x, y, w}). The overlay draws a band at the slot's
 * bottom edge; this returns the shift (dx, dy) that moves the band's
 * icon-facing edge to `gap` px past the content on the docked side, and the
 * resulting world-space band rect.
 */
export function indicatorLayout({ position, slot, content, band, canvas, gap }) {
  let k = slot.w / canvas;
  let [ox, oy] = outward(position);
  let cx = slot.x + slot.w / 2;
  let cy = slot.y + slot.w / 2;
  let contentEdge =
    ox !== 0
      ? (ox > 0 ? content.x + content.w - cx : cx - content.x)
      : (oy > 0 ? content.y + content.h - cy : cy - content.y);
  let shift = indicatorShift(slot.w, (2 * contentEdge) / slot.w, band.top, canvas, gap);
  let a = band.top * k - slot.w / 2 + shift;
  let b = band.bottom * k - slot.w / 2 + shift;
  let rect =
    ox !== 0
      ? { x: Math.min(cx + ox * a, cx + ox * b), y: slot.y, w: Math.abs(b - a), h: slot.w }
      : { x: slot.x, y: Math.min(cy + oy * a, cy + oy * b), w: slot.w, h: Math.abs(b - a) };
  return { dx: ox * shift, dy: oy * shift, rect };
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
