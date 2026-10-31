'use strict';

// Drawing helpers shared by the two icon renderers that run in their own gjs
// process (apps/trash-render.js, apps/stack-pile.js): type families and their
// colours, freedesktop thumbnail lookup, bounded picture decoding, and the
// cards (real picture in a print border, or a recognisable page/glyph) both
// icons are made of. Needs GdkPixbuf + Cairo + Gdk, so it must never be
// imported from gnome-shell.

import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// no thumbnail: decode pictures up to this size, show bigger ones as a card
const MAX_DECODE_BYTES = 64 * 1024 * 1024;
const THUMB_DIRS = ['xx-large', 'x-large', 'large', 'normal'];

const ARCHIVE_RE = new RegExp(
  'zip|x-tar|compressed|gzip|bzip|x-xz|zstd|x-7z|rar|x-cpio|x-lzma|x-lzip|' +
    'x-deb|x-rpm|x-archive|x-iso9660|x-apple-diskimage'
);

// card colours per type family: [main, accent]
const COLORS = {
  folder: [[0.42, 0.72, 0.96], [0.3, 0.6, 0.9]],
  image: [[0.86, 0.92, 0.98], [0.36, 0.7, 0.38]],
  video: [[0.17, 0.18, 0.22], [1, 1, 1]],
  audio: [[1.0, 0.37, 0.54], [0.98, 0.18, 0.3]],
  archive: [[0.86, 0.66, 0.38], [0.55, 0.38, 0.18]],
  pdf: [[0.98, 0.98, 0.98], [0.9, 0.24, 0.24]],
  sheet: [[0.98, 0.98, 0.98], [0.2, 0.66, 0.36]],
  slides: [[0.98, 0.98, 0.98], [0.96, 0.55, 0.16]],
  doc: [[0.98, 0.98, 0.98], [0.3, 0.52, 0.92]],
  other: [[0.9, 0.9, 0.92], [0.55, 0.56, 0.6]],
};

// type family of a content type; `isDir` for directories
export function familyOfType(t, isDir) {
  if (isDir || t === 'inode/directory') return 'folder';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (ARCHIVE_RE.test(t)) return 'archive';
  if (t === 'application/pdf') return 'pdf';
  if (/spreadsheet|excel|csv/.test(t)) return 'sheet';
  if (/presentation|powerpoint/.test(t)) return 'slides';
  if (
    t.startsWith('text/') ||
    /document|msword|rtf|epub|json|xml|x-tex|markdown/.test(t)
  ) {
    return 'doc';
  }
  return 'other';
}

// Whether the freedesktop thumbnail at `thumb` predates the file `local`
// (overwritten since): a stale thumbnail would show the old picture. Trashed
// items have no local file to compare with.
function isStale(thumb, local) {
  if (!local) return false;
  try {
    let mtime = (path) =>
      Gio.File.new_for_path(path)
        .query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null)
        .get_modification_date_time()
        .to_unix();
    return mtime(local) > mtime(thumb);
  } catch {
    return false;
  }
}

// freedesktop thumbnail for the first of `uris` that has a current one
function thumbnailFor(uris, local) {
  let cache = GLib.build_filenamev([GLib.get_user_cache_dir(), 'thumbnails']);
  for (let uri of uris) {
    let md5 = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, uri, -1);
    for (let dir of THUMB_DIRS) {
      let path = GLib.build_filenamev([cache, dir, `${md5}.png`]);
      if (GLib.file_test(path, GLib.FileTest.EXISTS) && !isStale(path, local)) {
        return path;
      }
    }
  }
  return null;
}

// The real picture of an item at most `px` wide: its cached thumbnail, else
// (images only) the file itself when it is small enough to decode; null when
// there is nothing readable. `src` = {uris, local, size, family}.
export function loadPicture(src, px) {
  let path = thumbnailFor(src.uris, src.local);
  if (!path && src.family === 'image' && src.local) {
    if (src.size <= MAX_DECODE_BYTES) path = src.local;
  }
  return path ? loadPixbuf(path, px) : null;
}

// any image file (also svg) scaled to fit px x px, orientation applied
export function loadPixbuf(path, px) {
  try {
    let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, px, px, true);
    return pixbuf.apply_embedded_orientation() ?? pixbuf;
  } catch {
    return null;
  }
}

export function roundedRect(cr, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  cr.newSubPath();
  cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
  cr.closePath();
}

export function rgb(cr, c, a = 1) {
  cr.setSourceRGBA(c[0], c[1], c[2], a);
}

// card outline for the shadow pass, centred on the origin
function cardShape(cr, family, c, aspect) {
  let [w, h] = cardSize(family, c, aspect);
  roundedRect(cr, -w / 2, -h / 2, w, h, c * 0.07);
}

function cardSize(family, c, aspect) {
  if (aspect) {
    return aspect >= 1 ? [c, c / aspect] : [c * aspect, c];
  }
  switch (family) {
    case 'folder':
      return [c, c * 0.78];
    case 'video':
      return [c, c * 0.68];
    case 'audio':
      return [c * 0.86, c * 0.86];
    case 'archive':
      return [c * 0.8, c * 0.92];
    case 'image':
      return [c, c * 0.76];
    default:
      return [c * 0.76, c];
  }
}

function drawPicture(cr, pixbuf, w, h, r) {
  cr.save();
  roundedRect(cr, -w / 2, -h / 2, w, h, r);
  cr.clip();
  cr.translate(-w / 2, -h / 2);
  cr.scale(w / pixbuf.get_width(), h / pixbuf.get_height());
  Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
  cr.paint();
  cr.restore();
}

function drawPlay(cr, s) {
  cr.arc(0, 0, s, 0, 2 * Math.PI);
  cr.setSourceRGBA(0, 0, 0, 0.45);
  cr.fill();
  cr.moveTo(-s * 0.35, -s * 0.5);
  cr.lineTo(s * 0.55, 0);
  cr.lineTo(-s * 0.35, s * 0.5);
  cr.closePath();
  cr.setSourceRGBA(1, 1, 1, 0.95);
  cr.fill();
}

// page outline with its folded corner
function drawPageSheet(cr, main, w, h, c) {
  let fold = w * 0.26;
  let x = -w / 2;
  let y = -h / 2;
  cr.moveTo(x, y + c * 0.05);
  cr.arc(x + c * 0.05, y + c * 0.05, c * 0.05, Math.PI, 1.5 * Math.PI);
  cr.lineTo(x + w - fold, y);
  cr.lineTo(x + w, y + fold);
  cr.lineTo(x + w, y + h - c * 0.05);
  cr.arc(x + w - c * 0.05, y + h - c * 0.05, c * 0.05, 0, Math.PI / 2);
  cr.arc(x + c * 0.05, y + h - c * 0.05, c * 0.05, Math.PI / 2, Math.PI);
  cr.closePath();
  rgb(cr, main);
  cr.fillPreserve();
  cr.setSourceRGBA(0, 0, 0, 0.18);
  cr.setLineWidth(c * 0.025);
  cr.stroke();
  // folded corner
  cr.moveTo(x + w - fold, y);
  cr.lineTo(x + w - fold, y + fold);
  cr.lineTo(x + w, y + fold);
  cr.closePath();
  cr.setSourceRGBA(0.82, 0.83, 0.86, 1);
  cr.fill();
}

// spreadsheet grid on a page
function drawGrid(cr, accent, w, h, c) {
  let ix = -w / 2 + w * 0.16;
  let iw = w * 0.68;
  let y = -h / 2;
  rgb(cr, accent);
  cr.rectangle(ix, y + h * 0.34, iw, h * 0.48);
  cr.fill();
  cr.setSourceRGBA(1, 1, 1, 0.9);
  cr.setLineWidth(c * 0.02);
  for (let i = 1; i < 4; i++) {
    cr.moveTo(ix, y + h * (0.34 + i * 0.12));
    cr.lineTo(ix + iw, y + h * (0.34 + i * 0.12));
  }
  cr.moveTo(ix + iw / 2, y + h * 0.34);
  cr.lineTo(ix + iw / 2, y + h * 0.82);
  cr.stroke();
}

// the coloured block of a page: pdf banner or slide
function drawPageBlock(cr, family, accent, w, h, c) {
  let x = -w / 2;
  let y = -h / 2;
  if (family === 'pdf') {
    roundedRect(cr, x + w * 0.1, y + h * 0.5, w * 0.8, h * 0.28, c * 0.03);
  } else {
    roundedRect(cr, x + w * 0.16, y + h * 0.36, w * 0.68, h * 0.34, c * 0.02);
  }
  rgb(cr, accent);
  cr.fill();
}

// text lines: a full page of them for text, a caption for the others
function drawPageLines(cr, family, accent, w, h) {
  let ix = -w / 2 + w * 0.16;
  let iw = w * 0.68;
  let y = -h / 2;
  let text = family === 'doc' || family === 'other';
  rgb(cr, text ? accent : [0.6, 0.62, 0.66], 0.85);
  let lines = text ? 5 : 2;
  let top = text ? 0.34 : 0.2;
  if (family === 'slides') top = 0.76;
  for (let i = 0; i < lines; i++) {
    let lw = i === lines - 1 ? iw * 0.6 : iw;
    roundedRect(cr, ix, y + h * (top + i * 0.11), lw, h * 0.05, h * 0.025);
    cr.fill();
  }
}

function drawPage(cr, family, w, h, c) {
  let [main, accent] = COLORS[family];
  drawPageSheet(cr, main, w, h, c);
  if (family === 'sheet') {
    drawGrid(cr, accent, w, h, c);
    return;
  }
  if (family === 'pdf' || family === 'slides') {
    drawPageBlock(cr, family, accent, w, h, c);
  }
  drawPageLines(cr, family, accent, w, h);
}

// back with tab, then the front flap
function drawFolder(cr, w, h, c) {
  let [main, accent] = COLORS.folder;
  let x = -w / 2;
  let y = -h / 2;
  roundedRect(cr, x, y, w * 0.45, h * 0.3, c * 0.05);
  roundedRect(cr, x, y + h * 0.1, w, h * 0.9, c * 0.07);
  rgb(cr, accent);
  cr.fill();
  roundedRect(cr, x, y + h * 0.24, w, h * 0.76, c * 0.07);
  rgb(cr, main);
  cr.fill();
}

function drawImageGlyph(cr, w, h, c) {
  let [main, accent] = COLORS.image;
  let x = -w / 2;
  let y = -h / 2;
  roundedRect(cr, x, y, w, h, c * 0.07);
  rgb(cr, main);
  cr.fill();
  cr.arc(x + w * 0.72, y + h * 0.3, h * 0.12, 0, 2 * Math.PI);
  cr.setSourceRGBA(1, 0.78, 0.2, 1);
  cr.fill();
  cr.moveTo(x, y + h);
  cr.lineTo(x + w * 0.35, y + h * 0.42);
  cr.lineTo(x + w * 0.6, y + h * 0.75);
  cr.lineTo(x + w * 0.75, y + h * 0.58);
  cr.lineTo(x + w, y + h * 0.9);
  cr.lineTo(x + w, y + h);
  cr.closePath();
  rgb(cr, accent);
  cr.fill();
}

function drawVideoGlyph(cr, w, h, c) {
  let x = -w / 2;
  let y = -h / 2;
  roundedRect(cr, x, y, w, h, c * 0.07);
  rgb(cr, COLORS.video[0]);
  cr.fill();
  cr.setSourceRGBA(1, 1, 1, 0.55);
  for (let i = 0; i < 6; i++) {
    let px = x + w * (0.08 + i * 0.16);
    cr.rectangle(px, y + h * 0.06, w * 0.07, h * 0.08);
    cr.rectangle(px, y + h * 0.86, w * 0.07, h * 0.08);
  }
  cr.fill();
  drawPlay(cr, h * 0.24);
}

function drawAudioGlyph(cr, w, h, c) {
  let [main, accent] = COLORS.audio;
  let x = -w / 2;
  let y = -h / 2;
  let g = new Cairo.LinearGradient(0, y, 0, y + h);
  g.addColorStopRGBA(0, main[0], main[1], main[2], 1);
  g.addColorStopRGBA(1, accent[0], accent[1], accent[2], 1);
  roundedRect(cr, x, y, w, h, c * 0.16);
  cr.setSource(g);
  cr.fill();
  // two beamed eighth notes
  cr.setSourceRGBA(1, 1, 1, 1);
  cr.arc(x + w * 0.33, y + h * 0.7, w * 0.1, 0, 2 * Math.PI);
  cr.arc(x + w * 0.68, y + h * 0.63, w * 0.1, 0, 2 * Math.PI);
  cr.fill();
  cr.setLineWidth(w * 0.07);
  cr.moveTo(x + w * 0.41, y + h * 0.7);
  cr.lineTo(x + w * 0.41, y + h * 0.28);
  cr.lineTo(x + w * 0.76, y + h * 0.21);
  cr.lineTo(x + w * 0.76, y + h * 0.63);
  cr.stroke();
}

function drawArchiveGlyph(cr, w, h, c) {
  let [main, accent] = COLORS.archive;
  let x = -w / 2;
  let y = -h / 2;
  roundedRect(cr, x, y, w, h, c * 0.07);
  rgb(cr, main);
  cr.fill();
  rgb(cr, accent);
  cr.rectangle(-w * 0.07, y, w * 0.14, h * 0.62);
  cr.fill();
  cr.setSourceRGBA(1, 1, 1, 0.75);
  for (let i = 0; i < 5; i++) {
    let zx = i % 2 ? 0 : -w * 0.07;
    cr.rectangle(zx, y + h * (0.04 + i * 0.11), w * 0.07, h * 0.06);
  }
  cr.fill();
  roundedRect(cr, -w * 0.11, y + h * 0.6, w * 0.22, h * 0.16, c * 0.03);
  rgb(cr, accent);
  cr.fill();
}

const GLYPHS = {
  folder: drawFolder,
  image: drawImageGlyph,
  video: drawVideoGlyph,
  audio: drawAudioGlyph,
  archive: drawArchiveGlyph,
};

function drawGlyphCard(cr, family, w, h, c) {
  if (GLYPHS[family]) GLYPHS[family](cr, w, h, c);
  else drawPage(cr, family, w, h, c);
}

// one item, centred on the origin, `c` = card size
export function drawCard(cr, item, c, angle, pixbuf, detailed) {
  let aspect = pixbuf ? pixbuf.get_width() / pixbuf.get_height() : 0;
  let [w, h] = cardSize(item.family, c, aspect);
  cr.save();
  cr.rotate(angle);

  // soft drop shadow so cards stay apart from each other and the glass
  cr.save();
  cr.translate(c * 0.02, c * 0.05);
  for (let i = 3; i >= 1; i--) {
    cardShape(cr, item.family, c + c * 0.03 * i, aspect);
    cr.setSourceRGBA(0, 0, 0, detailed ? 0.07 : 0.05);
    cr.fill();
  }
  cr.restore();

  if (pixbuf) {
    // a photo print: white border round the real thumbnail
    let b = c * 0.05;
    roundedRect(cr, -w / 2 - b, -h / 2 - b, w + 2 * b, h + 2 * b, c * 0.08);
    cr.setSourceRGBA(0.99, 0.99, 0.99, 1);
    cr.fill();
    drawPicture(cr, pixbuf, w, h, c * 0.04);
    if (item.family === 'video') drawPlay(cr, Math.min(w, h) * 0.22);
  } else {
    drawGlyphCard(cr, item.family, w, h, c);
  }
  cr.restore();
}
