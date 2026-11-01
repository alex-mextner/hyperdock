// gjs -m tests/stack_pile_check.js - the stack dock icon: apps/stack-pile.js
// run for real on fixture files (PNG signature, size, transparent canvas edges,
// missing files fall back to a card) and the StackPile wrapper that feeds it.
// Needs no GNOME Shell. Exits 1 on failure.
import Cairo from 'cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { createChecker } from './harness.js';
import { StackPile } from '../stackPile.js';
import { PLATE, layoutPile } from '../appGridPileLayout.js';

const { check, finish } = createChecker();
const ROOT = GLib.path_get_dirname(
  GLib.path_get_dirname(import.meta.url.replace(/^file:\/\//, ''))
);
const SIZE = 256;
const dir = GLib.dir_make_tmp('stack-pile-check-XXXXXX');

function fixture(name) {
  return GLib.build_filenamev([dir, name]);
}

function makePicture() {
  let surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 400, 260);
  let cr = new Cairo.Context(surface);
  cr.setSourceRGBA(0.2, 0.4, 0.9, 1);
  cr.paint();
  cr.setSourceRGBA(1, 0.8, 0.2, 1);
  cr.arc(300, 90, 50, 0, 2 * Math.PI);
  cr.fill();
  surface.writeToPNG(fixture('shot.png'));
  let jpeg = GdkPixbuf.Pixbuf.new_from_file(fixture('shot.png'));
  jpeg.savev(fixture('photo.jpg'), 'jpeg', [], []);
}

function makeFixtures() {
  makePicture();
  GLib.file_set_contents(fixture('note.txt'), 'hello\n');
  GLib.file_set_contents(fixture('bundle.zip'), 'PK\x03\x04');
  GLib.file_set_contents(
    fixture('icon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
      '<rect width="64" height="64" rx="12" fill="#c33"/></svg>'
  );
}

const POSITIONS = [
  { x: 0, y: 0, angle: 0, scale: 1 },
  { x: -0.07, y: -0.05, angle: -9, scale: 0.92 },
  { x: -0.09, y: -0.06, angle: -13, scale: 0.88 },
  { x: 0.08, y: -0.03, angle: 10, scale: 0.92 },
  { x: 0, y: 0.04, angle: -2, scale: 1 },
];
const THREE = [POSITIONS[2], POSITIONS[3], POSITIONS[4]];

function layer(pos, content) {
  return { ...pos, file: null, type: null, name: '', icon: null, ...content };
}

const CONTENT = {
  image: { file: fixture('shot.png'), type: 'image/png', name: 'shot.png' },
  jpeg: { file: fixture('photo.jpg'), type: 'image/jpeg', name: 'photo.jpg' },
  pdf: { file: fixture('absent.pdf'), type: 'application/pdf', name: 'absent.pdf' },
  text: { file: fixture('note.txt'), type: 'text/plain', name: 'note.txt' },
  zip: { file: fixture('bundle.zip'), type: 'application/zip', name: 'bundle.zip' },
  icon: { icon: fixture('icon.svg'), name: 'App' },
};

function pile(contents) {
  let positions = contents.length === 3 ? THREE : POSITIONS.slice(0, contents.length);
  return contents.map((c, i) => layer(positions[i], c));
}

// runs the renderer with `input` on stdin; null if it could not even start
function render(input, size = SIZE, cacheDir = null) {
  let launcher = new Gio.SubprocessLauncher({
    flags:
      Gio.SubprocessFlags.STDIN_PIPE |
      Gio.SubprocessFlags.STDOUT_PIPE |
      Gio.SubprocessFlags.STDERR_PIPE,
  });
  if (cacheDir) launcher.setenv('XDG_CACHE_HOME', cacheDir, true);
  let proc = launcher.spawnv([
    'gjs',
    '-m',
    GLib.build_filenamev([ROOT, 'apps', 'stack-pile.js']),
    `${size}`,
  ]);
  let [, stdout, stderr] = proc.communicate(GLib.Bytes.new(new TextEncoder().encode(input)), null);
  return { status: proc.get_exit_status(), png: stdout, err: new TextDecoder().decode(stderr.toArray()) };
}

function decode(png) {
  let stream = Gio.MemoryInputStream.new_from_bytes(png);
  return GdkPixbuf.Pixbuf.new_from_stream(stream, null);
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(png) {
  let b = png.toArray();
  return SIGNATURE.every((v, i) => b[i] === v);
}

// alpha plane as a function; get_pixels() copies the buffer, so only once
function alphaOf(pixbuf) {
  let pixels = pixbuf.get_pixels();
  let channels = pixbuf.get_n_channels();
  let stride = pixbuf.get_rowstride();
  return (x, y) => pixels[y * stride + x * channels + 3];
}

function opaquePixels(pixbuf) {
  let alpha = alphaOf(pixbuf);
  let n = 0;
  for (let y = 0; y < pixbuf.get_height(); y++) {
    for (let x = 0; x < pixbuf.get_width(); x++) if (alpha(x, y) > 0) n++;
  }
  return n;
}

function edgeAlphaMax(pixbuf) {
  let alpha = alphaOf(pixbuf);
  let max = 0;
  let last = pixbuf.get_width() - 1;
  for (let i = 0; i <= last; i++) {
    max = Math.max(max, alpha(i, 0), alpha(i, last), alpha(0, i), alpha(last, i));
  }
  return max;
}

function checkPile(name, layers) {
  let r = render(JSON.stringify({ layers }));
  check(r.status === 0, `${name}: exit 0 (${r.err.trim()})`);
  check(isPng(r.png), `${name}: PNG signature`);
  let pixbuf = decode(r.png);
  check(pixbuf.get_width() === SIZE && pixbuf.get_height() === SIZE, `${name}: ${SIZE}x${SIZE}`);
  check(opaquePixels(pixbuf) > SIZE * SIZE * 0.1, `${name}: pixels are not empty`);
  check(edgeAlphaMax(pixbuf) === 0, `${name}: outermost row and column stay transparent`);
  return pixbuf;
}

function runRenderChecks() {
  checkPile('1 layer, picture', pile([CONTENT.image]));
  checkPile('2 layers, picture over pdf card', pile([CONTENT.pdf, CONTENT.jpeg]));
  let three = checkPile('3 layers, picture + pdf card + icon', pile([CONTENT.image, CONTENT.pdf, CONTENT.icon]));
  let corners = [[0, 0], [SIZE - 1, 0], [0, SIZE - 1], [SIZE - 1, SIZE - 1]];
  let alpha = alphaOf(three);
  check(corners.every(([x, y]) => alpha(x, y) === 0), '3 layers: the four corners stay transparent');
  checkPile('3 layers, text + zip + picture', pile([CONTENT.text, CONTENT.zip, CONTENT.image]));
  checkPile('icon that does not exist', pile([{ icon: fixture('nope.svg'), name: 'x' }]));
  let missing = checkPile('nonexistent file', pile([{ file: fixture('gone.png'), type: 'image/png', name: 'gone.png' }]));
  check(opaquePixels(missing) > 0, 'nonexistent file still renders a card');
  checkPile('corrupt image', pile([{ file: fixture('note.txt'), type: 'image/png', name: 'broken.png' }]));
  check(decode(render(JSON.stringify({ layers: THREE.map((p) => layer(p, CONTENT.image)) }), 64).png).get_width() === 64, 'size argument is honoured');
}

// The app-grid pile: nine app icons on a translucent rounded plate. The plate
// shows through, its corners are cut round, and nothing is drawn outside it.
function runPlateChecks() {
  let ids = Array.from({ length: 9 }, (_, i) => `app${i}.desktop`);
  let layers = layoutPile(ids).map((l) => ({ ...l, icon: fixture('icon.svg') }));
  let r = render(JSON.stringify({ layers, plate: PLATE }));
  check(r.status === 0 && isPng(r.png), `plate: renders (${r.err.trim()})`);
  let alpha = alphaOf(decode(r.png));
  let edge = Math.round(SIZE * PLATE.inset);
  let outside = [];
  for (let i = 0; i < SIZE; i++) {
    for (let d = 0; d < edge - 3; d++) outside.push(alpha(d, i), alpha(i, d), alpha(SIZE - 1 - d, i), alpha(i, SIZE - 1 - d));
  }
  check(outside.every((a) => a === 0), 'plate: nothing is drawn outside the plate');
  check(alpha(edge + 1, edge + 1) === 0, 'plate: its corners are rounded');
  let side = alpha(edge + 3, SIZE >> 1);
  check(side > 10 && side < 230, `plate: translucent where no icon lies (alpha ${side})`);
  check(alpha(SIZE >> 1, edge + 3) > 10, 'plate: the top edge is drawn');
  let bare = render(JSON.stringify({ layers }));
  check(alphaOf(decode(bare.png))(edge + 3, SIZE >> 1) === 0, 'plate: without a plate the margin stays empty');
}

// colour of the pixel at the canvas centre
function centre(pixbuf) {
  let n = pixbuf.get_n_channels();
  let at = (pixbuf.get_height() >> 1) * pixbuf.get_rowstride() + (pixbuf.get_width() >> 1) * n;
  let px = pixbuf.get_pixels();
  return { r: px[at], g: px[at + 1], b: px[at + 2] };
}

// A cached thumbnail older than its file shows the old picture: the pile must
// use the file instead; a current thumbnail is used.
function runThumbnailChecks() {
  let cache = GLib.build_filenamev([dir, 'cache']);
  let thumbDir = GLib.build_filenamev([cache, 'thumbnails', 'normal']);
  GLib.mkdir_with_parents(thumbDir, 0o755);
  let surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 128, 128);
  let cr = new Cairo.Context(surface);
  cr.setSourceRGBA(0.1, 0.9, 0.1, 1);
  cr.paint();
  let source = fixture('shot.png');
  let md5 = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, Gio.File.new_for_path(source).get_uri(), -1);
  let thumb = GLib.build_filenamev([thumbDir, `${md5}.png`]);
  surface.writeToPNG(thumb);
  let setTime = (path, seconds) =>
    Gio.File.new_for_path(path).set_attribute_uint64('time::modified', seconds, Gio.FileQueryInfoFlags.NONE, null);
  let now = Math.floor(Date.now() / 1000);
  let input = JSON.stringify({ layers: [layer(POSITIONS[0], CONTENT.image)] });
  setTime(source, now);
  setTime(thumb, now - 3600);
  let stale = centre(decode(render(input, SIZE, cache).png));
  check(stale.b > stale.g, 'a thumbnail older than its file is ignored: the file shows');
  setTime(thumb, now + 3600);
  let fresh = centre(decode(render(input, SIZE, cache).png));
  check(fresh.g > fresh.b, 'a current thumbnail is used');
}

function runErrorChecks() {
  let bad = render('{not json');
  check(bad.status === 1 && bad.err.length > 0, 'malformed JSON: exit 1 and a message on stderr');
  let noLayers = render('{"layers": 3}');
  check(noLayers.status === 1, 'layers that is not an array: exit 1');
  let empty = render('{"layers": []}');
  check(empty.status === 0 && opaquePixels(decode(empty.png)) === 0, 'no layers: a transparent canvas');
}

// the wrapper: renders, coalesces requests made while one runs, last one wins
function runWrapperChecks() {
  let loop = new GLib.MainLoop(null, false);
  let changes = 0;
  let sp = new StackPile(ROOT, () => {
    changes++;
    if (changes === 2) loop.quit();
  });
  check(sp.gicon === null, 'StackPile: no icon before the first render');
  sp.render(pile([CONTENT.image]));
  sp.render(pile([CONTENT.text]));
  sp.render(pile([CONTENT.image, CONTENT.text]));
  let guard = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
  });
  loop.run();
  GLib.source_remove(guard);
  check(changes === 2, `StackPile: three requests give two renders (${changes})`);
  check(sp.gicon instanceof Gio.BytesIcon, 'StackPile: gicon is a BytesIcon');
  check(isPng(sp.gicon.get_bytes()), 'StackPile: the icon holds the PNG');
  sp.destroy();
  check(sp.gicon === null, 'StackPile: destroy drops the icon');
  sp.render(pile([CONTENT.image]));
  check(sp._proc === null, 'StackPile: a destroyed pile spawns nothing');
}

try {
  makeFixtures();
  runRenderChecks();
  runPlateChecks();
  runErrorChecks();
  runThumbnailChecks();
  runWrapperChecks();
} finally {
  for (let name of ['shot.png', 'photo.jpg', 'note.txt', 'bundle.zip', 'icon.svg']) {
    GLib.unlink(fixture(name));
  }
  GLib.rmdir(dir);
}

finish();
