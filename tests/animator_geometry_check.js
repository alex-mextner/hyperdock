// gjs -m tests/animator_geometry_check.js
// Animator-level geometry around the running indicator: separators follow the
// platter on all four edges (#86) and keep their line beside off-centre art
// under magnification (#92), a renderer rebound to another icon starts at that
// icon's size correction (#82/#85), and a lone icon's strut keeps the lifted
// dash (#93).
import System from 'system';

import { rig, frame } from './animator_rig.js';
import { createChecker } from './harness.js';
import { easeNormalization } from '../animatorIcon.js';
import { updateStruts } from '../animatorDash.js';

const { check, finish } = createChecker();

const LEAN = 6;
const EDGES = {
  bottom: { prop: 'translationY', sign: 1 },
  top: { prop: 'translationY', sign: -1 },
  right: { prop: 'translationX', sign: 1 },
  left: { prop: 'translationX', sign: -1 },
};

// #86: the line stays centred on the platter, which reaches deeper towards the
// screen edge than the dash: the separator is moved there by the platter's
// centre shift, on every edge
for (const [position, { prop, sign }] of Object.entries(EDGES)) {
  const other = prop === 'translationX' ? 'translationY' : 'translationX';
  for (const lean of [0, LEAN]) {
    const r = await rig(position);
    r.dock._platterCentreShift = lean;
    for (let i = 0; i < 6; i++) frame(r, r.dock.pointerAway());
    const [separator] = r.dock._separators;
    check(
      Math.abs(separator[prop] - sign * lean) < 1e-6,
      `${position}: separator centre is ${sign * lean} px off the dash towards the edge (got ${separator[prop]})`
    );
    check(Math.abs(separator[other]) < 3, `${position}: lean=${lean} the separator is not shifted along the dock at rest`);
  }
}

// #92: art that sits off centre in its texture is normalized towards the slot
// centre; the separator is fitted to that art, not to the shifted texture
for (const position of Object.keys(EDGES)) {
  const r = await rig(position);
  globalThis.__RigNorm = { k: 1.35, dx: 0.2, dy: 0.2, fill: 0.9 };
  const along = position === 'left' || position === 'right' ? 'height' : 'width';
  for (let i = 0; i < 40; i++) frame(r, r.dock.pointerAt(1));
  const [separator] = r.dock._separators;
  check(separator[along] > 0 && separator.opacity === 255,
    `${position}: the separator beside magnified off-centre art keeps its line (${along} ${separator[along]}, opacity ${separator.opacity})`);
  globalThis.__RigNorm = { k: 0.92, dx: 0.01, dy: -0.02, fill: 0.8 };
}

// #82/#85: a pooled renderer shows another icon: its correction starts there
{
  const normals = { a: { k: 1.3, dx: 0.05, dy: -0.06, fill: 0.9 }, b: { k: 0.7, dx: -0.04, dy: 0.03, fill: 0.5 } };
  const normalizer = { version: 0, get: (src) => normals[src] };
  const renderer = {};
  const icon = { _icon: {} };
  let k = 1;
  for (let i = 0; i < 40; i++) k = easeNormalization(normalizer, renderer, icon, { name: 'a' }, 96);
  check(Math.abs(k - 1.3) < 0.01, 'icon a settles at its correction');
  k = easeNormalization(normalizer, renderer, icon, { name: 'b' }, 96);
  check(Math.abs(k - 0.7) < 1e-9 && renderer._appliedDx === -0.04 && renderer._appliedDy === 0.03,
    `the first frame of icon b is at b's correction, not eased from a's (k=${k})`);
  // the same icon changing size still eases
  k = easeNormalization(normalizer, renderer, icon, { name: 'b' }, 128);
  check(Math.abs(k - 0.7) < 1e-9, 'the same icon at a new texture size keeps its value');
}

// #93: one icon draws no platter; the strut still reserves the lifted dash
{
  const growth = 12.9;
  const edgeDistance = 3.9;
  const run = { vertical: false, edge: { bottom: true, right: false }, iconSize: 48, scaleFactor: 1, edgeDistance };
  const dock = (platter) => ({
    _outerGrowth: growth,
    struts: { width: 0, height: 0, x: 0, y: 0 },
    _background: { opacity: platter ? 255 : 0, width: platter ? 200 : 0, height: platter ? 60 : 0, x: 0, y: 0 },
    extension: { autohide_dash: false },
    _monitor: { x: 0, y: 0 },
    x: 0, y: 700, width: 1200, height: 100,
  });
  const alone = dock(false);
  updateStruts(alone, run);
  check(Math.abs(alone.struts.height - (48 * 0.2 + edgeDistance)) < 1e-9,
    `a lone icon's strut keeps the lift (${alone.struts.height.toFixed(2)} px)`);
  const row = dock(true);
  updateStruts(row, run);
  check(Math.abs(row.struts.height - (60 + 48 * 0.2 + edgeDistance - growth)) < 1e-9,
    `with a platter the strut follows the platter (${row.struts.height.toFixed(2)} px)`);
}

finish();
