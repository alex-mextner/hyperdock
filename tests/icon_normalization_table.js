// gjs -m tests/icon_normalization_table.js [extra.png ...]
// Opaque diameters of real app icons before/after the dock's size correction.
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

import { normalization, opaqueBBox } from '../iconGeometry.js';

const home = GLib.get_home_dir();
const files = [
  '/usr/share/icons/hicolor/128x128/apps/firefox.png',
  '/usr/share/icons/hicolor/64x64/apps/firefox.png',
  `${home}/.local/share/icons/hicolor/256x256/apps/org.telegram.desktop.png`,
  '/usr/share/icons/hicolor/256x256/apps/google-chrome.png',
  '/usr/share/icons/hicolor/128x128/apps/google-chrome.png',
  `${home}/.local/opt/google-chrome/opt/google/chrome/product_logo_256.png`,
  `${home}/.local/opt/google-chrome/opt/google/chrome/product_logo_128.png`,
  ...ARGV,
].filter(f => Gio.File.new_for_path(f).query_exists(null));

let after = [];
print('icon                                                    canvas  before  k      after');
for (let f of files) {
  let pb = GdkPixbuf.Pixbuf.new_from_file(f);
  let w = pb.get_width();
  let h = pb.get_height();
  let bbox = opaqueBBox(pb.get_pixels(), w, h, pb.get_rowstride(), pb.get_has_alpha() ? pb.get_n_channels() : 3);
  let n = normalization(bbox, w, h);
  let before = Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0) / Math.max(w, h);
  after.push(n.fill);
  print(`${f.replace(home, '~').padEnd(55)} ${String(w).padStart(5)}  ${(before * 100).toFixed(1).padStart(5)}%  ${n.k.toFixed(3)}  ${(n.fill * 100).toFixed(1)}%`);
}
let spread = (Math.max(...after) - Math.min(...after)) / Math.max(...after);
print(`spread after correction: ${(spread * 100).toFixed(2)}% (limit 3%)`);
System.exit(spread < 0.03 ? 0 : 1);
