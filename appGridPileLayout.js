'use strict';

// Where each app icon lies in the app-grid pile, as pure functions (no gi://
// imports) so tests/app_grid_pile_layout_check.js runs them under plain gjs.
// apps/stack-pile.js draws the result on a translucent rounded plate.
//
// Units are fractions of the picture's side; x, y are from the centre (x right,
// y down), angle in degrees, scale sizes the icon like stackModel.js layers do
// (apps/stack-pile.js draws an icon CARD * scale of the picture wide).
//
// "Tossed in a heap": the best app lies on top near the middle, the rest
// spiral outwards under it (golden angle, so neighbours never line up), each
// with a turn and a nudge drawn from a generator seeded by its app id. The same
// app therefore lies the same way on every redraw and keeps its tilt direction
// when the set around it changes (the size of its tilt depends only on whether
// it is on top, the size of its icon on its rank and the size of the heap).

import { CARD, iconBounds, iconReach } from './pileMetrics.js';

// the plate: `inset` clear of the picture edge, corners rounded by `radius`,
// `pad` kept clear of the icons inside it
export const PLATE = Object.freeze({ inset: 0.05, radius: 0.2, pad: 0.01 });

// half the side of the area an icon must stay inside
export const ROOM = 0.5 - PLATE.inset - PLATE.pad;

const GOLDEN_ANGLE = 2.399963229728653;
const SPIRAL_PHASE = 0.6; // where the spiral starts, radians

const MAX_TILT = 24; // degrees, loosest icon
const TOP_TILT = 6; // the icon on top lies nearly square
const MIN_TILT_SHARE = 0.35; // the least of the allowed tilt an icon gets

const TOP_OFFSET = 0.1; // the top icon's distance from the middle, of the heap's radius
const RADIUS_JITTER = 0.12; // an icon's distance from the middle varies by this much
const NUDGE = 0.02; // and it is nudged sideways by up to this, of the picture
const DEPTH_SHRINK = 0.1; // the lowest icon is this much smaller than the top one

const BIGGEST_ICON = 0.54; // side of a lone icon, of the picture
const SHRINK_PER_ICON = 0.03; // each further icon makes all of them this much smaller
const SMALLEST_ICON = 0.2;

// icon side for `count` icons: big alone, smaller as the heap grows
export function iconSide(count) {
  return Math.max(SMALLEST_ICON, BIGGEST_ICON - SHRINK_PER_ICON * (count - 1));
}

// FNV-1a: a stable 32-bit hash of the id
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: small seeded generator, values in [0, 1)
function generator(seed) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // the first outputs of nearby seeds are alike; skip them
  for (let i = 0; i < 4; i++) next();
  return next;
}

// How far from the centre the layer's picture reaches (icon rotated, offset,
// plus its shadow): the same measure apps/stack-pile.js fits to.
export function layerReach(layer) {
  return iconReach(CARD * layer.scale, layer.angle, layer.x, layer.y);
}

// where the layer's centre may lie so that icon and shadow stay in the room
function limits(layer) {
  const b = iconBounds(CARD * layer.scale, layer.angle);
  return {
    minX: -ROOM + b.left,
    maxX: ROOM - b.right,
    minY: -ROOM + b.top,
    maxY: ROOM - b.bottom,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// one icon's place; `rank` 0 is the top of the heap
function place(id, rank, count, side) {
  const random = generator(hash(id));
  const tilt =
    (rank === 0 ? TOP_TILT : MAX_TILT) *
    (MIN_TILT_SHARE + (1 - MIN_TILT_SHARE) * random());
  // lower icons are a little smaller, so the heap has a top and a depth
  const depth = count > 1 ? 1 - DEPTH_SHRINK * (rank / (count - 1)) : 1;
  const layer = {
    id,
    x: 0,
    y: 0,
    angle: random() < 0.5 ? -tilt : tilt,
    scale: (side * depth) / CARD,
  };
  const room = limits(layer);
  const reachRadius = Math.min(room.maxX, -room.minX, room.maxY, -room.minY);
  // the top icon lies near the middle; the others spread outwards by area (the
  // radius grows as the square root of the rank), so the heap fills the plate
  const spread = count > 1 ? Math.sqrt(rank / (count - 1)) : 0;
  const turn = rank * GOLDEN_ANGLE + SPIRAL_PHASE;
  const radius = rank === 0 ? TOP_OFFSET * reachRadius : reachRadius * spread;
  const jitter = 1 + RADIUS_JITTER * (random() - 0.5);
  layer.x = clamp(Math.cos(turn) * radius * jitter + NUDGE * (random() - 0.5), room.minX, room.maxX);
  layer.y = clamp(Math.sin(turn) * radius * jitter + NUDGE * (random() - 0.5), room.minY, room.maxY);
  return layer;
}

// The icons' bounding box, shadows included
export function extent(layers) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const layer of layers) {
    const b = iconBounds(CARD * layer.scale, layer.angle);
    bounds.minX = Math.min(bounds.minX, layer.x - b.left);
    bounds.maxX = Math.max(bounds.maxX, layer.x + b.right);
    bounds.minY = Math.min(bounds.minY, layer.y - b.top);
    bounds.maxY = Math.max(bounds.maxY, layer.y + b.bottom);
  }
  return bounds;
}

// Moves the whole heap so its bounding box is centred on the plate: a few
// icons would otherwise lie bunched up in one corner of it.
function centre(layers) {
  const { minX, maxX, minY, maxY } = extent(layers);
  const dx = -(minX + maxX) / 2;
  const dy = -(minY + maxY) / 2;
  for (const layer of layers) {
    const room = limits(layer);
    layer.x = clamp(layer.x + dx, room.minX, room.maxX);
    layer.y = clamp(layer.y + dy, room.minY, room.maxY);
  }
}

// ids: app ids, top of the heap first. Layers come back to front, the order
// apps/stack-pile.js draws them in, so the last one is the top icon.
export function layoutPile(ids) {
  const side = iconSide(ids.length);
  const layers = ids.map((id, rank) => place(id, rank, ids.length, side));
  centre(layers);
  return layers.reverse();
}
