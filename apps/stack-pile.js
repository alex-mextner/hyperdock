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

const CARD = 0.78; // card width as a fraction of the icon, before the fit
const PRINT = 1.1; // a photo print is its picture plus a border on each side
const MARGIN = 0.03; // kept clear at every canvas edge, shadow included
const SHADOW = 0.07; // the drop shadow reaches this far below a card

function readLayers() {
  let [, bytes] = Gio.File.new_for_path('/dev/stdin').load_contents(null);
  let doc = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(doc?.layers)) throw new Error('"layers" must be an array');
  return doc.layers;
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

// half-extent of a w x h box rotated by `deg`, plus the layer's offset
function reach(p, S) {
  let a = ((p.layer.angle ?? 0) * Math.PI) / 180;
  let [w, h] = p.extent;
  let half = (w * Math.abs(Math.cos(a)) + h * Math.abs(Math.sin(a))) / 2;
  let dx = Math.abs(p.layer.x ?? 0) * S;
  let dy = Math.abs(p.layer.y ?? 0) * S;
  return Math.max(half + dx, half + dy + SHADOW * p.box);
}

// shrink factor that keeps every rotated, offset card inside the canvas
function fitFactor(prepared, S) {
  let room = S / 2 - MARGIN * S;
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
function drawIcon(cr, pixbuf, box) {
  cr.save();
  let pattern = iconPattern(cr, pixbuf, box);
  for (let i = 3; i >= 1; i--) {
    cr.save();
    cr.translate(box * 0.01 * i, box * (0.02 + 0.015 * i));
    cr.setSourceRGBA(0, 0, 0, 0.08);
    cr.mask(pattern);
    cr.restore();
  }
  cr.setSource(pattern);
  cr.paint();
  cr.restore();
}

function drawLayer(cr, p, S, k) {
  let { layer } = p;
  cr.save();
  cr.translate(
    S / 2 + (layer.x ?? 0) * S * k,
    S / 2 + (layer.y ?? 0) * S * k
  );
  let angle = ((layer.angle ?? 0) * Math.PI) / 180;
  if (p.icon) {
    cr.rotate(angle);
    drawIcon(cr, p.icon, p.box * k);
  } else {
    drawCard(cr, p.item, p.c * k, angle, p.pixbuf, true);
  }
  cr.restore();
}

function drawPile(layers, S) {
  let surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, S, S);
  let cr = new Cairo.Context(surface);
  let prepared = layers.map((layer) => prepare(layer, S));
  let k = fitFactor(prepared, S);
  for (let p of prepared) drawLayer(cr, p, S, k);
  return surface;
}

let size = parseInt(ARGV[0] ?? '256', 10);
if (!(size >= 16 && size <= 1024)) size = 256;

try {
  let surface = drawPile(readLayers(), size);
  // cairo writes straight into the pipe the shell reads
  surface.writeToPNG('/dev/stdout');
} catch (e) {
  printerr(`stack-pile: ${e.message}`);
  System.exit(1);
}
System.exit(0);
