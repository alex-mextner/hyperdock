#!/usr/bin/env -S gjs -m
'use strict';

// Stack icon picture: a pile of the stack's newest real items (macOS-stack
// style), two or three overlapping, slightly rotated cards, written as a PNG
// to stdout.
//
// stdin is one JSON document, layers back to front:
//   {"layers": [{"x": -0.09, "y": -0.06, "angle": -13, "scale": 0.88,
//                "file": "/abs/path" | null, "type": "image/png" | null,
//                "name": "report.pdf", "icon": "/abs/icon.svg" | null}, ...]}
// x, y are fractions of the icon size from the centre (x right, y down),
// angle is in degrees, scale sizes the card (stackModel.js pileLayout()).
// Per layer:
// * `icon` set: an app icon, drawn as is (rounded, no card frame);
// * an image (or anything with a cached thumbnail): the real picture on a
//   photo-print card;
// * otherwise, and whenever the file is missing or unreadable: a card drawn
//   by content-type family, as in the glass Trash.
//
// Why a separate process: same reason as trash-render.js - decoding pictures
// and compositing needs GdkPixbuf + Cairo + Gdk, which must not run inside
// gnome-shell. The shell (stackPile.js) runs this when a stack's items change
// and shows the PNG as an ordinary icon texture.
//
// exit 0 with a PNG on stdout; exit 1 and a message on stderr only when the
// JSON is malformed or Cairo fails.
//
// An optional "plate" ({"inset": 0.05, "radius": 0.2, "pad": 0.01}, fractions
// of the picture) puts the pile on a translucent rounded square, as the app-grid
// icon does (appGridPileLayout.js); the pile is then fitted inside the plate.
//
// usage: gjs -m stack-pile.js <size-px>

import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import System from 'system';
import {
  drawCard,
  familyOfType,
  loadPicture,
  loadPixbuf,
  roundedRect,
} from './cards.js';
import {
  CARD,
  SHADOW,
  SHADOW_PASSES,
  iconReach,
  shadowPassShift,
} from '../pileMetrics.js';

const PRINT = 1.1; // a photo print is its picture plus a border on each side
const MARGIN = 0.03; // kept clear at every canvas edge, shadow included
// an icon's shadow, per pass; on a plate it is stronger, to set the many
// overlapping icons of a heap apart
const ICON_SHADOW = 0.08;
const PLATE_ICON_SHADOW = 0.13;

function readDoc() {
  let [, bytes] = Gio.File.new_for_path('/dev/stdin').load_contents(null);
  let doc = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(doc?.layers)) throw new Error('"layers" must be an array');
  return { layers: doc.layers, plate: doc.plate ? { inset: 0, radius: 0, pad: 0, ...doc.plate } : null };
}

function fileSize(path) {
  try {
    return Gio.File.new_for_path(path)
      .query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null)
      .get_size();
  } catch {
    return -1;
  }
}

// the real picture of a layer's file, or null (then a type card is drawn)
function pictureOf(layer, family, px) {
  if (!layer.file) return null;
  let size = fileSize(layer.file);
  if (size < 0) return null;
  let uri = Gio.File.new_for_path(layer.file).get_uri();
  return loadPicture({ uris: [uri], local: layer.file, size, family }, px);
}

// Everything a layer needs to be drawn, decoded up front so the whole pile can
// be sized to fit before anything is painted. `box` is the card's longest side.
function prepare(layer, S) {
  let box = CARD * S * (layer.scale ?? 1);
  let icon = layer.icon ? loadPixbuf(layer.icon, Math.ceil(box * 2)) : null;
  if (icon) return { layer, box, icon, extent: [box, box] };
  let family = familyOfType(layer.type ?? '', false);
  let c = box;
  let pixbuf = pictureOf(layer, family, Math.ceil(box * 2));
  if (pixbuf) c = box / PRINT;
  let item = { family };
  let extent = pixbuf ? [box, box] : [c, c];
  return { layer, box, c, item, pixbuf, extent };
}

// how far the layer reaches from the picture's centre: its (rotated) box and
// shadow, at the layer's offset
function reach(p, S) {
  if (p.icon) {
    return iconReach(p.box, p.layer.angle ?? 0, (p.layer.x ?? 0) * S, (p.layer.y ?? 0) * S);
  }
  let a = ((p.layer.angle ?? 0) * Math.PI) / 180;
  let [w, h] = p.extent;
  let half = (w * Math.abs(Math.cos(a)) + h * Math.abs(Math.sin(a))) / 2;
  let dx = Math.abs(p.layer.x ?? 0) * S;
  let dy = Math.abs(p.layer.y ?? 0) * S;
  return Math.max(half + dx, half + dy + SHADOW * p.box);
}

// half the side of the area the pile must stay inside: the canvas, or the
// plate's inner square
function pileRoom(S, plate) {
  if (!plate) return S / 2 - MARGIN * S;
  return S * (0.5 - (plate.inset ?? 0) - (plate.pad ?? 0));
}

// shrink factor that keeps every rotated, offset card inside the room
function fitFactor(prepared, S, plate) {
  let room = pileRoom(S, plate);
  let widest = Math.max(...prepared.map((p) => reach(p, S)), 1);
  return Math.min(1, room / widest);
}

// the icon as a pattern (rounded clip, scaled to the box), so its own
// silhouette can cast the shadow
function iconPattern(cr, pixbuf, box) {
  cr.pushGroup();
  roundedRect(cr, -box / 2, -box / 2, box, box, box * 0.2);
  cr.clip();
  cr.translate(-box / 2, -box / 2);
  cr.scale(box / pixbuf.get_width(), box / pixbuf.get_height());
  Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
  cr.paint();
  return cr.popGroup();
}

// soft shadow: the icon's silhouette, offset down and smeared a little, so the
// icon lifts off the one behind it whatever shape it has
function drawIcon(cr, pixbuf, box, shadow) {
  cr.save();
  let pattern = iconPattern(cr, pixbuf, box);
  for (let i = SHADOW_PASSES; i >= 1; i--) {
    cr.save();
    let [dx, dy] = shadowPassShift(i);
    cr.translate(box * dx, box * dy);
    cr.setSourceRGBA(0, 0, 0, shadow);
    cr.mask(pattern);
    cr.restore();
  }
  cr.setSource(pattern);
  cr.paint();
  cr.restore();
}

function drawLayer(cr, p, S, k, shadow) {
  let { layer } = p;
  cr.save();
  cr.translate(
    S / 2 + (layer.x ?? 0) * S * k,
    S / 2 + (layer.y ?? 0) * S * k
  );
  let angle = ((layer.angle ?? 0) * Math.PI) / 180;
  if (p.icon) {
    cr.rotate(angle);
    drawIcon(cr, p.icon, p.box * k, shadow);
  } else {
    drawCard(cr, p.item, p.c * k, angle, p.pixbuf, true);
  }
  cr.restore();
}

// the frosted plate: a translucent rounded square, lighter at the top, with a
// bright hairline edge, so the dock shows through it
function drawPlate(cr, S, plate) {
  let x = S * plate.inset;
  let side = S - 2 * x;
  roundedRect(cr, x, x, side, side, S * plate.radius);
  let fill = new Cairo.LinearGradient(0, x, 0, x + side);
  fill.addColorStopRGBA(0, 1, 1, 1, 0.34);
  fill.addColorStopRGBA(1, 1, 1, 1, 0.14);
  cr.setSource(fill);
  cr.fillPreserve();
  cr.setLineWidth(S * 0.008);
  cr.setSourceRGBA(1, 1, 1, 0.45);
  cr.stroke();
}

function drawPile({ layers, plate }, S) {
  let surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, S, S);
  let cr = new Cairo.Context(surface);
  if (plate) drawPlate(cr, S, plate);
  let prepared = layers.map((layer) => prepare(layer, S));
  let k = fitFactor(prepared, S, plate);
  let shadow = plate ? PLATE_ICON_SHADOW : ICON_SHADOW;
  for (let p of prepared) drawLayer(cr, p, S, k, shadow);
  return surface;
}

let size = parseInt(ARGV[0] ?? '256', 10);
if (!(size >= 16 && size <= 1024)) size = 256;

try {
  let surface = drawPile(readDoc(), size);
  // cairo writes straight into the pipe the shell reads
  surface.writeToPNG('/dev/stdout');
} catch (e) {
  printerr(`stack-pile: ${e.message}`);
  System.exit(1);
}
System.exit(0);
