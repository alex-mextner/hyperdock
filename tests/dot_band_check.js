// gjs -m tests/dot_band_check.js (needs GI_TYPELIB_PATH/LD_LIBRARY_PATH for St)
// Independent oracle for iconGeometry.indicatorBand: draws every running
// indicator style with the real apps/dot.js code onto a cairo surface and
// compares the painted rows with the band the dock reserves for it.
import Cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import System from 'system';

import { DotCanvas } from '../apps/dot.js';
import { indicatorBand } from '../iconGeometry.js';

const CANVAS = 96;
const STYLES = [
  'dots', 'dot', 'dashes', 'dash', 'squares', 'square', 'segmented', 'solid',
  'triangles', 'triangle', 'diamonds', 'diamond', 'binary',
];

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    print(`FAIL ${msg}`);
    failures++;
  }
}

// the DotCanvas drawing methods only read these members
const canvas = Object.create(DotCanvas.prototype);
canvas._padding = 8;
canvas._barHeight = 6;
canvas.get_surface_size = () => [CANVAS, CANVAS];

function paintedRows(style, sizeIndex, count) {
  const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, CANVAS, CANVAS);
  const ctx = new Cairo.Context(surface);
  const state = { count, style, size: sizeIndex, color: [1, 1, 1, 1] };
  canvas.state = state;
  ctx.setLineWidth(1);
  ctx.setLineCap(Cairo.LineCap.ROUND);
  ctx.setOperator(Cairo.Operator.SOURCE);
  canvas[`_draw_${style}`](ctx, state);
  // gjs cairo cannot expose the pixels: round-trip through a PNG
  const [fd, path] = GLib.file_open_tmp('dot-band-XXXXXX.png');
  surface.writeToPNG(path);
  const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
  GLib.unlink(path);
  const data = pixbuf.get_pixels();
  const stride = pixbuf.get_rowstride();
  let top = CANVAS;
  let bottom = -1;
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      if (data[y * stride + x * 4 + 3] > 0) {
        if (y < top) top = y;
        if (y >= bottom) bottom = y + 1;
      }
    }
  }
  ctx.$dispose();
  surface.finish();
  return { top, bottom };
}

for (const style of STYLES) {
  for (const sizeIndex of [0, 1, 2]) {
    for (const count of [1, 3, 4]) {
      const rows = paintedRows(style, sizeIndex, count);
      const band = indicatorBand(style, sizeIndex, CANVAS);
      // inside (nothing painted outside the band) and tight (the band is
      // not so loose that the indicator floats away from the icon)
      check(
        rows.bottom > 0 &&
          rows.top >= band.top &&
          rows.bottom <= band.bottom &&
          rows.top - band.top <= 3 &&
          band.bottom - rows.bottom <= 3,
        `${style} size=${sizeIndex} count=${count}: painted ${rows.top}..${rows.bottom} in band ${band.top.toFixed(1)}..${band.bottom.toFixed(1)}`
      );
    }
  }
}

print(failures ? `${failures} check(s) failed` : 'dot_band_check: OK');
System.exit(failures ? 1 : 0);
