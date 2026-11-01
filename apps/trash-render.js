#!/usr/bin/env -S gjs -m
'use strict';

// Glass Trash picture (trash-style = 1): a macOS 26 style frosted, translucent
// bin with the Trash's real contents inside, written as a PNG to stdout.
//
// What the picture shows:
// * fill level: how many items the Trash holds, on a log scale (full at ~50);
// * the newest few items on top of the pile: pictures, videos and PDFs as
//   their real thumbnails (freedesktop thumbnail cache, else a small scaled
//   decode for images), everything else as a card coloured by its type;
// * the pile under them coloured by the type mix of all the other items.
//
// Why a separate process: thumbnails must be decoded and composited, which
// needs GdkPixbuf + Cairo + Gdk.cairo_set_source_pixbuf. Doing that inside
// gnome-shell would stall the compositor's main loop and drag GTK's Gdk into
// it. The shell (apps/trash.js) runs this only when the Trash changes and
// shows the PNG as an ordinary icon texture, so drawing the dock costs nothing
// extra per frame.
//
// usage: gjs -m trash-render.js <size-px>

import Cairo from 'cairo';
import Gio from 'gi://Gio';
import System from 'system';
import { drawCard, familyOfType, loadPicture, roundedRect } from './cards.js';

const FULL_AT = 50; // item count drawn as a full bin
const TOP_CARDS = 5; // newest items drawn as recognisable cards
const MAX_FILLER = 36; // pile cards under them; more adds nothing at icon size
const ATTRS = [
  'standard::name',
  'standard::type',
  'standard::content-type',
  'standard::target-uri',
  'standard::size',
  'trash::deletion-date',
  'trash::orig-path',
].join(',');

function familyOf(info) {
  let isDir = info.get_file_type() === Gio.FileType.DIRECTORY;
  return familyOfType(info.get_content_type() ?? '', isDir);
}

// newest first; a trashed folder is one item, as in Finder
function listTrash() {
  let items = [];
  let enumerator = null;
  try {
    enumerator = Gio.File.new_for_uri('trash:///').enumerate_children(
      ATTRS,
      Gio.FileQueryInfoFlags.NONE,
      null
    );
    let info;
    while ((info = enumerator.next_file(null)) !== null) {
      let date = info.get_deletion_date();
      items.push({
        info,
        name: info.get_name(),
        time: date ? date.to_unix() : 0,
        family: familyOf(info),
      });
    }
  } catch (e) {
    printerr(`trash-render: ${e.message}`);
  } finally {
    enumerator?.close(null);
  }
  items.sort((a, b) => b.time - a.time || (a.name < b.name ? -1 : 1));
  return items;
}

function trashedPicture(item, px) {
  let target = item.info.get_attribute_string('standard::target-uri');
  let uris = [];
  if (target) uris.push(target);
  // trashing keeps the mtime, so the thumbnail of the file where it used to
  // live still matches
  let orig = item.info.get_attribute_byte_string('trash::orig-path');
  if (orig) uris.push(Gio.File.new_for_path(orig).get_uri());
  return loadPicture(
    {
      uris,
      local: target ? Gio.File.new_for_uri(target).get_path() : null,
      size: item.info.get_size(),
      family: item.family,
    },
    px
  );
}


// deterministic jitter: the same Trash always draws the same pile
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


function drawTrash(items, S) {
  let surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, S, S);
  let cr = new Cairo.Context(surface);

  let cx = S / 2;
  // proportions of the macOS 26 bin, filling the icon like theme icons do
  let rim = {
    top: 0.075 * S,
    bottom: 0.185 * S,
    half: 0.405 * S,
    r: 0.055 * S,
  };
  let body = {
    top: 0.13 * S,
    bottom: 0.945 * S,
    topHalf: 0.385 * S,
    botHalf: 0.31 * S,
    r: 0.085 * S,
  };
  let halfAt = (y) =>
    body.topHalf +
    ((body.botHalf - body.topHalf) * (y - body.top)) / (body.bottom - body.top);

  let bodyPath = () => {
    let { top, bottom, topHalf, botHalf, r } = body;
    cr.newPath();
    cr.moveTo(cx - topHalf, top);
    cr.lineTo(cx + topHalf, top);
    cr.lineTo(cx + halfAt(bottom - r), bottom - r);
    let rx = cx + botHalf;
    cr.curveTo(rx, bottom - r * 0.2, rx - r * 0.2, bottom, rx - r, bottom);
    cr.lineTo(cx - botHalf + r, bottom);
    let lx = cx - botHalf;
    let ly = bottom - r;
    cr.curveTo(lx + r * 0.2, bottom, lx, ly + r * 0.8, cx - halfAt(ly), ly);
    cr.closePath();
  };
  let rimPath = (inset) =>
    roundedRect(
      cr,
      cx - rim.half + inset,
      rim.top + inset,
      2 * (rim.half - inset),
      rim.bottom - rim.top - 2 * inset,
      rim.r - inset * 0.5
    );

  // contact shadow on the dock
  cr.save();
  cr.translate(cx, body.bottom);
  cr.scale(1, 0.13);
  let shadow = new Cairo.RadialGradient(0, 0, 0, 0, 0, body.botHalf * 1.25);
  shadow.addColorStopRGBA(0, 0, 0, 0, 0.22);
  shadow.addColorStopRGBA(1, 0, 0, 0, 0);
  cr.setSource(shadow);
  cr.arc(0, 0, body.botHalf * 1.25, 0, 2 * Math.PI);
  cr.fill();
  cr.restore();

  // back wall, seen through the front glass
  bodyPath();
  cr.setSourceRGBA(1, 1, 1, 0.1);
  cr.fill();

  // the opening: inside of the bin, darker towards the back rim
  rimPath(0);
  let inside = new Cairo.LinearGradient(0, rim.top, 0, rim.bottom);
  inside.addColorStopRGBA(0, 0.55, 0.57, 0.62, 0.55);
  inside.addColorStopRGBA(1, 0.88, 0.89, 0.92, 0.45);
  cr.setSource(inside);
  cr.fill();

  // contents, clipped to the inside of the bin
  let n = items.length;
  if (n > 0) {
    cr.save();
    bodyPath();
    rimPath(S * 0.012);
    cr.setFillRule(Cairo.FillRule.WINDING);
    cr.clip();

    let floor = body.bottom - 0.035 * S;
    let level = 0.22 + (0.78 * Math.log1p(n)) / Math.log1p(FULL_AT);
    level = Math.min(1, level);
    let pileTop = floor - level * (floor - (rim.top + 0.03 * S));
    let rand = rng(hashString(`${n}:${items[0].name}`));

    // the pile: one paper card per older item, coloured by its type
    let shown = Math.min(n, TOP_CARDS);
    let rest = items.slice(shown, shown + MAX_FILLER);
    if (rest.length) {
      let mass = new Cairo.LinearGradient(0, pileTop, 0, floor);
      mass.addColorStopRGBA(0, 0.96, 0.95, 0.92, 0.0);
      mass.addColorStopRGBA(0.25, 0.96, 0.95, 0.92, 0.55);
      mass.addColorStopRGBA(1, 0.92, 0.91, 0.88, 0.75);
      cr.setSource(mass);
      cr.rectangle(0, pileTop, S, floor - pileTop + 0.05 * S);
      cr.fill();
      let fc = 0.2 * S;
      // the oldest at the bottom of the pile, filling it evenly
      rest
        .slice()
        .reverse()
        .forEach((item, i, all) => {
          let t = all.length > 1 ? i / (all.length - 1) : 0;
          let y =
            floor -
            fc * 0.2 -
            t * (floor - pileTop - fc * 0.55) +
            (rand() - 0.5) * fc * 0.35;
          let span = halfAt(y) - fc * 0.3;
          let x = cx + (rand() * 2 - 1) * span;
          cr.save();
          cr.translate(x, y);
          let size = fc * (0.85 + rand() * 0.3);
          drawCard(cr, item, size, (rand() - 0.5) * 1.6, null, false);
          cr.restore();
        });
    }

    // the newest items on top, oldest of them drawn first
    let c = (n === 1 ? 0.44 : n <= 3 ? 0.36 : 0.31) * S;
    let slots = [
      [0.0, 0.22, 0.12],
      [-0.5, 0.4, -0.26],
      [0.5, 0.36, 0.22],
      [-0.2, 0.72, 0.16],
      [0.3, 0.8, -0.12],
    ];
    for (let i = shown - 1; i >= 0; i--) {
      let item = items[i];
      let [sx, sy, sa] = slots[i];
      let y = Math.min(pileTop + sy * c, floor - c * 0.36);
      let x = cx + sx * (halfAt(y) - c * 0.42);
      let angle = sa + (rand() - 0.5) * 0.18;
      let pixbuf = trashedPicture(item, Math.ceil(c * 1.5));
      cr.save();
      cr.translate(x, y);
      drawCard(cr, item, c, angle, pixbuf, true);
      cr.restore();
    }
    cr.restore();
  }

  // front glass: frosted, a little denser towards the bottom
  bodyPath();
  let frost = new Cairo.LinearGradient(0, body.top, 0, body.bottom);
  frost.addColorStopRGBA(0, 1, 1, 1, 0.24);
  frost.addColorStopRGBA(0.6, 1, 1, 1, 0.34);
  frost.addColorStopRGBA(1, 1, 1, 1, 0.56);
  cr.setSource(frost);
  cr.fillPreserve();
  // curved sides: slightly grey edges, a bright sheen left of centre
  let side = new Cairo.LinearGradient(
    cx - body.topHalf,
    0,
    cx + body.topHalf,
    0
  );
  side.addColorStopRGBA(0, 0.45, 0.48, 0.54, 0.22);
  side.addColorStopRGBA(0.1, 1, 1, 1, 0.0);
  side.addColorStopRGBA(0.22, 1, 1, 1, 0.16);
  side.addColorStopRGBA(0.34, 1, 1, 1, 0.0);
  side.addColorStopRGBA(0.88, 1, 1, 1, 0.0);
  side.addColorStopRGBA(1, 0.45, 0.48, 0.54, 0.24);
  cr.setSource(side);
  cr.fill();

  // outline: a faint dark edge so it reads on light backdrops, then the
  // bright glass edge on top
  bodyPath();
  cr.setLineWidth(0.03 * S);
  cr.setSourceRGBA(0, 0, 0, 0.1);
  cr.strokePreserve();
  cr.setLineWidth(0.014 * S);
  cr.setSourceRGBA(1, 1, 1, 0.6);
  cr.stroke();

  // rim: one solid bright lip, like the dock's glass rim
  rimPath(0);
  cr.setLineWidth(0.02 * S);
  cr.setSourceRGBA(0, 0, 0, 0.12);
  cr.stroke();
  rimPath(0);
  rimPath(0.03 * S);
  cr.setFillRule(Cairo.FillRule.EVEN_ODD);
  let lip = new Cairo.LinearGradient(0, rim.top, 0, rim.bottom);
  lip.addColorStopRGBA(0, 1, 1, 1, 0.98);
  lip.addColorStopRGBA(0.5, 0.93, 0.94, 0.96, 0.92);
  lip.addColorStopRGBA(1, 1, 1, 1, 0.98);
  cr.setSource(lip);
  cr.fill();
  cr.setFillRule(Cairo.FillRule.WINDING);
  // the lip's inner edge casts a little shade into the opening
  rimPath(0.03 * S);
  cr.setLineWidth(0.008 * S);
  cr.setSourceRGBA(0.3, 0.32, 0.38, 0.35);
  cr.stroke();

  return surface;
}

let size = parseInt(ARGV[0] ?? '256', 10);
if (!(size >= 16 && size <= 1024)) size = 256;

let surface = drawTrash(listTrash(), size);
// cairo writes straight into the pipe the shell reads
surface.writeToPNG('/dev/stdout');
System.exit(0);