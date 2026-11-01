// Pure vertical layout of a dock item across its cross axis (no gi imports,
// unit-tested under node and gjs):
//
//   [platter pad][ icon art ][ gap ][ running indicator ][ edge margin ]
//
// The same order on every side: "down" is the screen edge the dock sits on.
// The icon art and the indicator never share space, whatever the icon size,
// magnification or indicator style: the platter reaches `outerGrowth` px past
// the row of items towards the screen edge, deep enough for the three bottom
// parts. All lengths are shares of the icon size, so nothing here is a
// setting. Numbers follow the macOS Dock (see docs/LAYOUT.md, "Indicator
// spacing").
import { CONTENT_TARGET, outward } from './iconGeometry.js';

// Tallest indicator band indicatorBand() reports, as a share of the icon size
// (size 2 diamonds: 19 of 96 canvas units; the default dot is 12.6, 0.131).
// Every style fits the reserved slot; the band is flush with its outer end,
// like the macOS dot, so a smaller one has more air above it.
export const BAND_RESERVE = 0.198;
// Indicator band's outer end to the dock's screen edge. The band includes
// 1.5 canvas units of antialiasing on each side, so the painted dot is about
// 0.066 of the icon from the edge (macOS: 0.06).
export const EDGE_MARGIN = 0.05;
// Icon art to the indicator band's inner end at the very least, for the
// tallest band; the default dot (band 0.131) is 0.15 clear of the art, 0.17
// to the painted dot. macOS: 0.23, the dock being taller there than we want.
export const ART_GAP = 0.08;

/** Padding the dock_padding setting adds around the items (px). */
export function platterPadding(iconSize, dockPadding, scaleFactor) {
  return iconSize * 0.1 * (dockPadding || 0) * scaleFactor;
}

// the platter's legacy outward padding: platterPadding() once more, half again
export const OUTER_PADDING_SHARE = 1.5;

/**
 * How far past the row of items (the dash) the platter reaches towards the
 * screen edge, in px. The dash is lifted by the same amount, so the platter's
 * outer edge stays where the dock's edge distance puts it and the icons rise.
 *
 * @param {number} iconSize drawn size of an unmagnified icon, px
 * @param {number} itemSize the dash item (slot plus spacing), px
 * @param {number} platterPad platterPadding() of this dock
 */
export function outerGrowth(iconSize, itemSize, platterPad) {
  const needed = edgeMargin(iconSize) + (BAND_RESERVE + ART_GAP) * iconSize;
  const slack = ((1 - CONTENT_TARGET) / 2) * itemSize;
  return Math.max(OUTER_PADDING_SHARE * platterPad, needed - slack);
}

/** Band's outer end to the dock edge, px; at least one. */
export function edgeMargin(iconSize) {
  return Math.max(1, EDGE_MARGIN * iconSize);
}

/**
 * Distance from the opaque icon art to the screen-edge side of the dash item,
 * px, for an icon drawn `size` px big. Icons are centred in their item and
 * grow away from the edge once larger than it (slotOffsets()), and the art is
 * normalized to CONTENT_TARGET of the icon.
 */
export function artToItemEdge(size, itemSize) {
  const centred = size > itemSize ? 0 : (itemSize - size) / 2;
  return centred + ((1 - CONTENT_TARGET) / 2) * size;
}

/**
 * Clear distance between the art of an icon drawn `size` px big and an
 * indicator band `bandHeight` px tall (px), in a dock that grew `growth`.
 */
export function artToBand(size, itemSize, growth, iconSize, bandHeight) {
  return artToItemEdge(size, itemSize) + growth - edgeMargin(iconSize) - bandHeight;
}

/**
 * Change of the platter rectangle that makes it reach `delta` px further
 * towards the screen edge `position` (negative: less far).
 * @returns {{x:number,y:number,width:number,height:number}} added to the rect
 */
export function outwardChange(position, delta) {
  const [ox, oy] = outward(position);
  return {
    x: ox < 0 ? -delta : 0,
    y: oy < 0 ? -delta : 0,
    width: ox !== 0 ? delta : 0,
    height: oy !== 0 ? delta : 0,
  };
}

/**
 * The dash slide visibleEdge() should see: what the dash is translated by
 * apart from the lift `growth` gives it.
 */
export function slideWithoutLift(position, translation, growth) {
  const [ox, oy] = outward(position);
  return translation + growth * (ox + oy);
}

/**
 * The dash's distance from the screen edge while the dock animates: a negative
 * edge distance setting is not honoured then, but the lift for the indicator
 * (`growth`) is, however negative the setting.
 */
export function animatedEdgeDistance(distance, growth = 0) {
  return Math.max(distance, growth);
}

/**
 * How far the platter's centre moved towards the screen edge, px: it reaches
 * `growth` past the items instead of its own outward padding. Things that sit
 * centred on the platter (separators) are moved by this much.
 */
export function platterCentreShift(growth, platterPad) {
  return (growth - OUTER_PADDING_SHARE * platterPad) / 2;
}
