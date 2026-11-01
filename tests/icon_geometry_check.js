// gjs -m tests/icon_geometry_check.js
// Pure-math checks for iconGeometry.js (bbox, normalization, indicator band).
import {
  CONTENT_TARGET,
  indicatorBand,
  indicatorPlacement,
  visibleEdge,
  normalization,
  opaqueBBox,
  snapToPixel,
} from '../iconGeometry.js';
import System from 'system';

let failures = 0;
function check(cond, msg) {
  print(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}

// RGBA canvas with an opaque disc of `fraction` * size diameter at (cx, cy)
function disc(size, fraction, cx = size / 2, cy = size / 2, rowPad = 0) {
  let stride = size * 4 + rowPad;
  let data = new Uint8Array(stride * size);
  let r = (size * fraction) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r) data[y * stride + x * 4 + 3] = 255;
      else if (d <= r + 1) data[y * stride + x * 4 + 3] = 8; // haze below threshold
    }
  }
  return { data, stride };
}

// bbox
{
  let { data, stride } = disc(256, 1);
  let b = opaqueBBox(data, 256, 256, stride, 4);
  check(b.x0 === 0 && b.y0 === 0 && b.x1 === 256 && b.y1 === 256, 'full-canvas disc bbox spans the canvas');
  ({ data, stride } = disc(256, 0.9, 128, 128, 12));
  b = opaqueBBox(data, 256, 256, stride, 4);
  check(Math.abs((b.x1 - b.x0) / 256 - 0.9) < 0.01, 'rowstride padding is honoured, 90% disc measured');
  check(opaqueBBox(new Uint8Array(64 * 64 * 4), 64, 64, 256, 4) === null, 'fully transparent icon has no bbox');
  check(opaqueBBox(new Uint8Array(12 * 12 * 3), 12, 12, 36, 3).x1 === 12, 'RGB (no alpha) is opaque');
  let off = disc(128, 0.5, 40, 90);
  b = opaqueBBox(off.data, 128, 128, off.stride, 4);
  check(b.x0 > 0 && b.y1 < 128 && b.x0 < 20, 'off-centre disc bbox is off-centre');
}

// normalization: Chrome-like 100% and Telegram-like 90% end at the same diameter
{
  let chrome = disc(256, 1);
  let tg = disc(256, 0.902);
  let ff = disc(128, 0.938, 64, 64);
  let rows = [
    ['chrome-like (100%)', chrome, 256],
    ['telegram-like (90.2%)', tg, 256],
    ['firefox-like (93.8%)', ff, 128],
  ].map(([name, { data, stride }, s]) => {
    let b = opaqueBBox(data, s, s, stride, 4);
    let n = normalization(b, s, s);
    return { name, before: (b.x1 - b.x0) / s, after: n.fill, n };
  });
  for (let r of rows) {
    print(`     ${r.name}: ${(r.before * 100).toFixed(1)}% -> ${(r.after * 100).toFixed(1)}%  k=${r.n.k.toFixed(3)}`);
  }
  let max = Math.max(...rows.map(r => r.after));
  let min = Math.min(...rows.map(r => r.after));
  check((max - min) / max < 0.03, 'corrected diameters differ by < 3%');
  check(Math.abs(rows[0].after - CONTENT_TARGET) < 0.005, 'content lands on the target share');
}

// centering: off-centre content is shifted onto the slot centre (within clamp)
{
  let { data, stride } = disc(256, 0.8, 128 + 12, 128 - 8);
  let b = opaqueBBox(data, 256, 256, stride, 4);
  let n = normalization(b, 256, 256);
  let cx = (b.x0 + b.x1) / 2 / 256;
  let cy = (b.y0 + b.y1) / 2 / 256;
  // canvas pos of content centre after scale k about the canvas centre + shift
  let nx = 0.5 + (cx - 0.5) * n.k + n.dx;
  let ny = 0.5 + (cy - 0.5) * n.k + n.dy;
  check(Math.abs(nx - 0.5) < 0.001 && Math.abs(ny - 0.5) < 0.001, 'content centre lands on the slot centre');
  let wild = normalization({ x0: 0, y0: 0, x1: 20, y1: 20 }, 256, 256);
  check(wild.k <= 1.35, 'correction is clamped');
}

// content never leaves the target box, however off-centre: the running indicator
// is laid out for that (indicatorSpacing.js)
{
  let worst = 0;
  for (let size of [100, 256]) {
    for (let x0 = 0; x0 < size; x0 += size / 10) {
      for (let y0 = 0; y0 < size; y0 += size / 10) {
        for (let w of [size / 10, size / 4, size / 2, size * 0.8, size]) {
          let x1 = Math.min(size, x0 + w);
          let y1 = Math.min(size, y0 + w * 0.7);
          let n = normalization({ x0, y0, x1, y1 }, size, size);
          let edges = [
            ((x0 - size / 2) / size) * n.k + n.dx,
            ((x1 - size / 2) / size) * n.k + n.dx,
            ((y0 - size / 2) / size) * n.k + n.dy,
            ((y1 - size / 2) / size) * n.k + n.dy,
          ];
          worst = Math.max(worst, ...edges.map(Math.abs));
        }
      }
    }
  }
  check(worst <= CONTENT_TARGET / 2 + 1e-9, `content stays within the target box on every side (worst ${worst.toFixed(4)})`);
  let low = normalization({ x0: 20, y0: 40, x1: 80, y1: 100 }, 100, 100);
  check(((100 - 50) / 100) * low.k + low.dy <= CONTENT_TARGET / 2 + 1e-9, 'art sitting low in its canvas is pulled up inside the box');
}

// snapping
{
  check(snapToPixel(10.3, 1.5) * 1.5 === Math.round(10.3 * 1.5), 'snap lands on a physical pixel at scale 1.5');
  check(snapToPixel(7.49, 1) === 7, 'snap at scale 1 rounds to integers');
}

// every item's indicator shares one baseline inside the dock edge, whatever the
// item's size (magnification), position, style or indicator size
{
  let styles = [
    'dot', 'dots', 'dash', 'dashes', 'square', 'squares', 'triangle', 'triangles',
    'diamond', 'diamonds', 'segmented', 'solid', 'binary', 'default',
  ];
  let rest = 48;
  let margin = 1;
  let cases = 0;
  let mismatched = 0;
  let outside = 0;
  let wrongMargin = 0;
  // dock edge per position in an arbitrary 1000x800 area; items magnify 1x..2x
  let edges = { bottom: 790.5, top: 12.25, left: 8.75, right: 991 };
  for (let position of ['bottom', 'top', 'left', 'right']) {
    let horizontal = position === 'bottom' || position === 'top';
    for (let style of styles) {
      for (let sizeIndex of [0, 1, 2]) {
        let band = indicatorBand(style, sizeIndex, 96);
        let first = null;
        for (let slotW of [24, 43.7, 48, 64, 71.3, 96]) {
          for (let along of [100, 333.3, 640]) {
            let at = indicatorPlacement({ position, edge: edges[position], along, rest, band, canvas: 96, margin });
            // reference: the band's cross-axis outer coordinate, independent of slotW/along
            let outer = horizontal
              ? (position === 'bottom' ? at.rect.y + at.rect.h : at.rect.y)
              : (position === 'right' ? at.rect.x + at.rect.w : at.rect.x);
            let centre = horizontal ? at.rect.y + at.rect.h / 2 : at.rect.x + at.rect.w / 2;
            first ??= centre;
            cases++;
            if (Math.abs(centre - first) > 1e-9) mismatched++;
            let inside = position === 'bottom' ? edges.bottom - outer
              : position === 'top' ? outer - edges.top
              : position === 'right' ? edges.right - outer
              : outer - edges.left;
            if (inside < margin - 1e-9) outside++;
            if (Math.abs(inside - margin) > 1e-9) wrongMargin++;
          }
        }
      }
    }
  }
  check(mismatched === 0, `indicator centres share one baseline for every slot size and position along the dock (${cases} cases)`);
  check(outside === 0, 'indicator band stays inside the dock edge');
  check(wrongMargin === 0, 'indicator band outer edge is exactly `margin` inside the dock edge');

  // the band reaches no farther than the overlay square would: bottom dock, 48px, dot
  let band = indicatorBand('dot', 0, 96);
  let at = indicatorPlacement({ position: 'bottom', edge: 800, along: 100, rest, band, canvas: 96, margin });
  check(at.rect.y + at.rect.h <= 800 - margin + 1e-9, 'bottom: band bottom is above the dock edge by the margin');
  check(at.rect.y >= 800 - rest, 'bottom: band lies within the overlay square footprint');
  check(at.dy === at.shift && at.dx === 0, 'bottom: shift is a pure vertical translation');
  let l = indicatorPlacement({ position: 'left', edge: 0, along: 100, rest, band, canvas: 96, margin });
  check(l.dx === -l.shift && l.dy === 0, 'left: shift is a pure horizontal translation towards the edge');
}

// along-axis: the overlay is centred on the item, whatever its size
{
  let band = indicatorBand('dot', 0, 96);
  let ok = true;
  for (let along of [40, 123.5, 700]) {
    let h = indicatorPlacement({ position: 'bottom', edge: 800, along, rest: 48, band, canvas: 96, margin: 1 });
    let v = indicatorPlacement({ position: 'left', edge: 0, along, rest: 48, band, canvas: 96, margin: 1 });
    ok = ok && h.x + 24 === along && h.rect.x + h.rect.w / 2 === along;
    ok = ok && v.y + 24 === along && v.rect.y + v.rect.h / 2 === along;
  }
  check(ok, 'overlay and band are centred on the item along the dock');
}

// autohide: platter padded past the screen is clamped at rest, the slide is kept
{
  check(visibleEdge('bottom', 803.75, 0, 800) === 800, 'bottom: padded platter clamps to the monitor');
  check(visibleEdge('bottom', 803.75 + 70, 70, 800) === 870, 'bottom: hidden dock (slid 70px) keeps its dots 70px off-screen');
  check(visibleEdge('top', -3.75 - 70, -70, 0) === -70, 'top: hidden dock leaves the screen with its dots');
  check(visibleEdge('left', -3 - 60, -60, 0) === -60, 'left: hidden dock leaves the screen with its dots');
  check(visibleEdge('right', 1203 + 60, 60, 1200) === 1260, 'right: hidden dock leaves the screen with its dots');
  check(visibleEdge('bottom', 790, -10, 800) === 790, 'bottom: dock raised by edge distance keeps its edge');
}

if (failures) {
  print(`${failures} check(s) failed`);
  System.exit(1);
}
print('all passed');
