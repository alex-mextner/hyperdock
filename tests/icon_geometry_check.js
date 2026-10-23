// node --experimental-default-type=module tests/icon_geometry_check.js
// Pure-math checks for iconGeometry.js (bbox, normalization, indicator band).
import {
  CONTENT_TARGET,
  indicatorBand,
  indicatorLayout,
  normalization,
  opaqueBBox,
  rectsIntersect,
  snapToPixel,
} from '../iconGeometry.js';

let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
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
    console.log(`     ${r.name}: ${(r.before * 100).toFixed(1)}% -> ${(r.after * 100).toFixed(1)}%  k=${r.n.k.toFixed(3)}`);
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
  check(Math.abs(wild.dx) <= 0.08 * wild.k + 1e-9 && wild.k <= 1.35, 'correction and shift are clamped');
}

// snapping
{
  check(snapToPixel(10.3, 1.5) * 1.5 === Math.round(10.3 * 1.5), 'snap lands on a physical pixel at scale 1.5');
  check(snapToPixel(7.49, 1) === 7, 'snap at scale 1 rounds to integers');
}

// indicator never intersects the rendered icon, any position/style/size/slot
{
  let styles = [
    'dot', 'dots', 'dash', 'dashes', 'square', 'squares', 'triangle', 'triangles',
    'diamond', 'diamonds', 'segmented', 'solid', 'binary', 'default',
  ];
  let bad = 0;
  let cases = 0;
  for (let position of ['bottom', 'top', 'left', 'right']) {
    for (let style of styles) {
      for (let sizeIndex of [0, 1, 2]) {
        for (let w of [24, 48, 64, 96, 143.5, 200]) {
          for (let fill of [0.9, 1.0]) {
            let slot = { x: 31.25, y: 77.5, w };
            let content = {
              x: slot.x + (w * (1 - fill)) / 2,
              y: slot.y + (w * (1 - fill)) / 2,
              w: w * fill,
              h: w * fill,
            };
            let band = indicatorBand(style, sizeIndex, 96);
            let lay = indicatorLayout({ position, slot, content, band, canvas: 96, gap: Math.max(1, w * 0.06) });
            cases++;
            if (rectsIntersect(lay.rect, content) || rectsIntersect(lay.rect, slot) && fill === 1.0) bad++;
          }
        }
      }
    }
  }
  check(bad === 0, `indicator band clears the content rect (${cases} position/style/size/slot cases)`);

  // docked side: band lies on the outward side of the content
  let slot = { x: 0, y: 0, w: 64 };
  let content = { x: 3.2, y: 3.2, w: 57.6, h: 57.6 };
  let band = indicatorBand('dot', 0, 96);
  let at = p => indicatorLayout({ position: p, slot, content, band, canvas: 96, gap: 1.28 }).rect;
  check(at('bottom').y >= content.y + content.h, 'bottom: band below content');
  check(at('top').y + at('top').h <= content.y, 'top: band above content');
  check(at('left').x + at('left').w <= content.x, 'left: band left of content');
  check(at('right').x >= content.x + content.w, 'right: band right of content');
  let gapPx = at('bottom').y - (content.y + content.h);
  check(Math.abs(gapPx - 1.28) < 1e-9, 'band near edge sits exactly `gap` below content');
}

if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('icon_geometry_check: OK');
