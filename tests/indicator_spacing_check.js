// gjs -m tests/indicator_spacing_check.js
// Pure-math checks for indicatorSpacing.js: the icon art, the running indicator
// and the dock edge never share space, at any icon size, magnification,
// indicator style, padding setting or dock position.
import System from 'system';
import { CONTENT_TARGET, indicatorBand, indicatorPlacement, outward } from '../iconGeometry.js';
import {
  ART_GAP,
  BAND_RESERVE,
  EDGE_MARGIN,
  OUTER_PADDING_SHARE,
  artToBand,
  artToItemEdge,
  edgeMargin,
  outerGrowth,
  outwardChange,
  platterPadding,
  slideWithoutLift,
  animatedEdgeDistance,
  platterCentreShift,
} from '../indicatorSpacing.js';

let failures = 0;
function check(cond, msg) {
  print(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}

const STYLES = [
  'default', 'dots', 'dot', 'dashes', 'dash', 'squares', 'square', 'segmented', 'solid',
  'triangles', 'triangle', 'diamonds', 'diamond', 'binary',
];
const CANVAS = 96;
const EPS = 1e-9;

// every band the dock can draw, as a share of the icon size
const bands = [];
for (const style of STYLES) {
  for (const size of [0, 1, 2]) bands.push(indicatorBand(style, size, CANVAS));
}

check(
  bands.every(b => (b.bottom - b.top) / CANVAS <= BAND_RESERVE + EPS),
  `BAND_RESERVE ${BAND_RESERVE} covers the tallest of ${bands.length} indicator bands (${Math.max(...bands.map(b => (b.bottom - b.top) / CANVAS)).toFixed(4)})`
);

// dock configurations: icon size (px as drawn), device scale, icon spread, dock_padding
const sizes = [];
for (let f = 16; f <= 512; f += f < 64 ? 4 : 16) sizes.push(f);
const configs = [];
for (const f of sizes) {
  for (const scale of [1, 1.25, 1.5, 2, 3]) {
    for (const spread of [0, 0.4, 0.75, 1]) {
      for (const dockPadding of [0, 0.5, 1, 2, 4]) {
        const unscaled = f / scale;
        configs.push({ f, scale, itemSize: Math.floor((unscaled + 2 + 8 * spread) * scale), pad: platterPadding(unscaled, dockPadding, scale) });
      }
    }
  }
}

// magnified sizes an icon can be drawn at: 1x up to 3x of the unmagnified size
const magnifications = [1, 1.05, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

// world model of one dock: edge E at `edge`; returns the clear space between the
// art of an icon drawn `size` px and the band, along the outward axis
function clearance(position, cfg, size, band) {
  const growth = outerGrowth(cfg.f, cfg.itemSize, cfg.pad);
  const [ox, oy] = outward(position);
  const o = ox + oy;
  const edge = 500;
  const at = indicatorPlacement({ position, edge, along: 300, rest: cfg.f, band, canvas: CANVAS, margin: edgeMargin(cfg.f) });
  const rect = at.rect;
  const lo = ox !== 0 ? rect.x : rect.y;
  const hi = lo + (ox !== 0 ? rect.w : rect.h);
  // outward distance of the band's two ends and of the art, measured from the edge
  const bandInner = o > 0 ? edge - lo : hi - edge;
  const bandOuter = o > 0 ? edge - hi : lo - edge;
  const artFromEdge = growth + artToItemEdge(size, cfg.itemSize);
  return { gap: artFromEdge - bandInner, outer: bandOuter, growth, platterReach: growth };
}

let cases = 0;
let tooClose = 0;
let worst = Infinity;
let outside = 0;
let thin = 0;
let formulaMismatch = 0;
for (const cfg of configs) {
  for (const position of ['bottom', 'top', 'left', 'right']) {
    for (const band of bands) {
      for (const m of magnifications) {
        const size = cfg.f * m;
        const r = clearance(position, cfg, size, band);
        cases++;
        worst = Math.min(worst, r.gap / cfg.f);
        if (r.gap < ART_GAP * cfg.f - EPS) tooClose++;
        // band fully inside the dock: no further out than the margin from the edge
        if (r.outer < edgeMargin(cfg.f) - 1e-6 || r.outer > r.growth + 1) outside++;
        if (r.growth < OUTER_PADDING_SHARE * cfg.pad - EPS) thin++;
        const bandHeight = (band.bottom - band.top) * (cfg.f / CANVAS);
        if (Math.abs(artToBand(size, cfg.itemSize, r.growth, cfg.f, bandHeight) - r.gap) > 1e-6) formulaMismatch++;
      }
    }
  }
}
check(tooClose === 0, `art to indicator gap >= ${ART_GAP} of the icon for every size, scale, spread, padding, style, position and magnification (${cases} cases, worst ${worst.toFixed(4)})`);
check(outside === 0, 'indicator band lies inside the dock, at least the edge margin from its edge');
check(thin === 0, 'the platter never reaches less far than its own padding');
check(formulaMismatch === 0, 'artToBand() agrees with the placed band');

// the default dock at the sizes the user runs: 3 numbers of the spec
{
  const f = 48;
  const scale = 1.5;
  const unscaled = f / scale;
  const itemSize = Math.floor((unscaled + 2 + 8 * 0.4) * scale);
  const pad = platterPadding(unscaled, 0.5, scale);
  const growth = outerGrowth(f, itemSize, pad);
  const band = indicatorBand('dot', 0, CANVAS);
  const dot = ((band.bottom - band.top) / CANVAS - 3 / CANVAS) * f; // painted dot: without the 1.5 unit fuzz
  const gap = artToBand(f, itemSize, growth, f, (band.bottom - band.top) * (f / CANVAS)) + (1.5 / CANVAS) * f;
  const toEdge = edgeMargin(f) + (1.5 / CANVAS) * f;
  print(`spec @ icon ${f}px: art->dot ${(gap / f).toFixed(3)}, dot ${(dot / f).toFixed(3)}, dot->edge ${(toEdge / f).toFixed(3)}, growth ${(growth / f).toFixed(3)} (all x icon size)`);
  check(gap / f > ART_GAP, 'default dot clears the art by more than the minimum');
  check(Math.abs(toEdge / f - (EDGE_MARGIN + 1.5 / CANVAS)) < 1e-6, 'painted dot sits a fixed share of the icon from the dock edge');
}

// identical dot position for items of any size: placement ignores the item
{
  const cfg = configs[configs.length >> 1];
  const band = indicatorBand('dot', 0, CANVAS);
  const ys = new Set();
  for (const along of [50, 123.4, 900]) {
    ys.add(indicatorPlacement({ position: 'bottom', edge: 800, along, rest: cfg.f, band, canvas: CANVAS, margin: edgeMargin(cfg.f) }).rect.y);
  }
  check(ys.size === 1, 'every item gets the same dot y wherever it sits along the dock');
}

// a roomy dock_padding keeps its look: the platter is not made thinner
{
  const f = 64;
  const itemSize = 70;
  const pad = platterPadding(f, 4, 1);
  check(outerGrowth(f, itemSize, pad) === OUTER_PADDING_SHARE * pad, 'a large dock_padding keeps its own outward padding');
  check(outerGrowth(f, itemSize, 0) > 0, 'no padding still reserves room for the indicator');
}

// the content share the clearance relies on is the one icons are normalized to
check(Math.abs(artToItemEdge(60, 60) - ((1 - CONTENT_TARGET) / 2) * 60) < EPS, 'an icon filling its item has the normalization margin to the edge');
check(artToItemEdge(90, 60) === ((1 - CONTENT_TARGET) / 2) * 90, 'a magnified icon grows away from the edge: its bottom stays on the item edge');
check(artToItemEdge(40, 60) === 10 + ((1 - CONTENT_TARGET) / 2) * 40, 'a small icon is centred in its item');

// geometry helpers
{
  check(JSON.stringify(outwardChange('bottom', 7)) === '{"x":0,"y":0,"width":0,"height":7}', 'bottom platter grows downwards');
  check(JSON.stringify(outwardChange('top', 7)) === '{"x":0,"y":-7,"width":0,"height":7}', 'top platter grows upwards');
  check(JSON.stringify(outwardChange('left', 7)) === '{"x":-7,"y":0,"width":7,"height":0}', 'left platter grows leftwards');
  check(JSON.stringify(outwardChange('right', 7)) === '{"x":0,"y":0,"width":7,"height":0}', 'right platter grows rightwards');
  check(outwardChange('bottom', -3).height === -3, 'a negative change shortens the platter');
  check(slideWithoutLift('bottom', -20, 12) === -8, 'bottom: the lift is taken out of the slide');
  check(slideWithoutLift('top', 20, 12) === 8, 'top: the lift is taken out of the slide');
  check(slideWithoutLift('left', 20, 12) === 8, 'left: the lift is taken out of the slide');
  check(slideWithoutLift('right', -20, 12) === -8, 'right: the lift is taken out of the slide');
  check(animatedEdgeDistance(-10 + 13.044, 13.044) === 13.044, 'a negative edge distance never eats the indicator lift while animating');
  check(animatedEdgeDistance(30, 13) === 30, 'a positive edge distance is kept');
  check(animatedEdgeDistance(-4) === 0, 'without growth a negative distance is zero');
  {
    // separators stay centred on the platter: it spans [-1.5 pad, item + growth] around the items
    const pad = platterPadding(32, 0.5, 1.5);
    const growth = outerGrowth(48, 56, pad);
    const inner = OUTER_PADDING_SHARE * pad;
    const centre = (-inner + (56 + growth)) / 2;
    check(Math.abs(centre - 56 / 2 - platterCentreShift(growth, pad)) < EPS, 'separators are moved by the platter centre shift to stay centred');
    check(platterCentreShift(OUTER_PADDING_SHARE * pad, pad) === 0, 'no shift when the platter keeps its own padding');
  }
  check(platterPadding(48, undefined, 1.5) === 0, 'no dock_padding setting means no padding');
  check(Math.abs(platterPadding(48, 0.5, 1.5) - 3.6) < EPS, 'platter padding = 0.1 x icon x dock_padding x scale');
}

if (failures) {
  print(`${failures} check(s) failed`);
  System.exit(1);
}
print('all passed');
