'use strict';

// Sizes and reach both apps/stack-pile.js (draws a pile) and
// appGridPileLayout.js (lays an icon heap out so that it fits exactly) measure
// by; one copy, so the layout never drifts from what is drawn. No gi:// imports:
// plain gjs tests load it.

// a card's (an icon's) side as a fraction of the picture, before the fit
export const CARD = 0.78;

// a card's drop shadow reaches this far below it, in units of the card's side
export const SHADOW = 0.07;

// An app icon's shadow is its own silhouette drawn SHADOW_PASSES times, each
// pass further down and right. Offset of pass `pass` (1-based) in units of the
// icon's side, in the icon's own frame (x right, y down).
export const SHADOW_PASSES = 3;
export function shadowPassShift(pass) {
  return [0.01 * pass, 0.02 + 0.015 * pass];
}

// How far an app icon of side `side` (picture fractions), turned by `angle`
// degrees, and its deepest shadow reach from the icon's centre in each
// direction (the shadow is turned with the icon).
export function iconBounds(side, angle) {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const half = (side * (Math.abs(cos) + Math.abs(sin))) / 2;
  // the shift changes steadily with the pass, so the first and the last pass
  // bound every pass in between
  const shifts = [1, SHADOW_PASSES].map((pass) => {
    const [ux, uy] = shadowPassShift(pass);
    return [side * (ux * cos - uy * sin), side * (ux * sin + uy * cos)];
  });
  const xs = shifts.map(([x]) => x);
  const ys = shifts.map(([, y]) => y);
  return {
    left: half - Math.min(0, ...xs),
    right: half + Math.max(0, ...xs),
    top: half - Math.min(0, ...ys),
    bottom: half + Math.max(0, ...ys),
  };
}

// Farthest the icon (and its shadow) reaches from the picture's centre when
// its own centre is at x, y.
export function iconReach(side, angle, x, y) {
  const b = iconBounds(side, angle);
  return Math.max(x + b.right, b.left - x, y + b.bottom, b.top - y);
}
