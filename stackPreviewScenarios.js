'use strict';

// Quick Look scenario for the nested shell (D2DA_PROBE_SCENARIO=stackint-preview,
// driven by tools/stacks-shell.sh). A fake org.gnome.NautilusPreviewer service
// owned on the private bus stands in for Sushi and records every ShowFile and
// Close, so nothing real is started. The checks:
//   - the overlay draws a real PNG and the head of a text file, and its
//     screenshots are saved (stackint-preview-*.png);
//   - a PDF goes to Sushi's ShowFile and the overlay is gone; Sushi's arrow
//     keys (SelectionEvent) move the preview; closing closes Sushi;
//   - with the service absent, or the setting off, the PDF gets the overlay card;
//   - a multi-selection shows "n of m" and walks only the items it was given.
// `h` carries probeScenarios.js's helpers: check, say, sleep, shot, closeOverview.

import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { StackPreview } from './stackPreview.js';
import { SUSHI_NAME } from './stackPreviewModel.js';

const S = 'stackint-preview';
// GtkDirectionType: LEFT and RIGHT, as Sushi sends them
const DIRECTION_LEFT = 4;
const DIRECTION_RIGHT = 5;

const SERVICE_XML = `<node>
  <interface name="org.gnome.NautilusPreviewer2">
    <method name="ShowFile">
      <arg type="s" direction="in" name="uri"/>
      <arg type="s" direction="in" name="windowHandle"/>
      <arg type="b" direction="in" name="closeIfAlreadyShown"/>
      <arg type="s" direction="in" name="activationToken"/>
    </method>
    <method name="Close"/>
    <signal name="SelectionEvent"><arg type="q" name="direction"/></signal>
    <property name="Visible" type="b" access="read"/>
  </interface>
</node>`;

// the Sushi stand-in: records its calls, flips Visible like the real window
class FakeSushi {
  constructor() {
    this.shown = [];
    this.closes = 0;
    // how long the window takes to map after ShowFile (a cold D-Bus activation)
    this.mapDelayMs = 0;
    this._pending = 0;
    this._visible = false;
    this._exported = Gio.DBusExportedObject.wrapJSObject(SERVICE_XML, this);
    this._exported.export(Gio.DBus.session, `/${SUSHI_NAME.replaceAll('.', '/')}`);
    this._owner = Gio.bus_own_name_on_connection(Gio.DBus.session, SUSHI_NAME, Gio.BusNameOwnerFlags.NONE, null, null);
  }

  get Visible() {
    return this._visible;
  }

  ShowFile(uri) {
    this.shown.push(uri);
    if (this.mapDelayMs === 0) return this._setVisible(true);
    this._cancelPending();
    this._pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.mapDelayMs, () => {
      this._pending = 0;
      this._setVisible(true);
      return GLib.SOURCE_REMOVE;
    });
  }

  Close() {
    this.closes++;
    this._cancelPending();
    this._setVisible(false);
  }

  _cancelPending() {
    if (this._pending) GLib.source_remove(this._pending);
    this._pending = 0;
  }

  // Files opened its own Sushi window, no preview of ours asked for it
  openForeign() {
    this._setVisible(true);
  }

  _setVisible(visible) {
    if (visible === this._visible) return;
    this._visible = visible;
    this._exported.emit_property_changed('Visible', GLib.Variant.new_boolean(visible));
  }

  // an arrow key pressed inside the Sushi window
  press(direction) {
    this._exported.emit_signal('SelectionEvent', new GLib.Variant('(q)', [direction]));
  }

  // the user closes the Sushi window itself (Esc inside it)
  dismiss() {
    this._setVisible(false);
  }

  stop() {
    this._cancelPending();
    Gio.bus_unown_name(this._owner);
    this._exported.unexport();
  }
}

function makeFixtures() {
  const dir = GLib.dir_make_tmp('d2da-preview-XXXXXX');
  const png = GLib.build_filenamev([dir, 'wide-picture.png']);
  const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 2400, 1200);
  pixbuf.fill(0x3478f6ff);
  pixbuf.savev(png, 'png', [], []);
  const tall = GLib.build_filenamev([dir, 'tall-picture.png']);
  const tallBuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 300, 900);
  tallBuf.fill(0xe0457bff);
  tallBuf.savev(tall, 'png', [], []);
  const lines = Array.from({ length: 160 }, (_, i) => `line ${String(i + 1).padStart(3, '0')}: the quick brown fox jumps over the lazy dog`);
  const text = GLib.build_filenamev([dir, 'notes.txt']);
  GLib.file_set_contents(text, lines.join('\n') + '\n');
  const pdf = GLib.build_filenamev([dir, 'report.pdf']);
  GLib.file_set_contents(pdf, '%PDF-1.4\n%%EOF\n');
  const raw = GLib.build_filenamev([dir, 'camera.dng']);
  GLib.file_set_contents(raw, 'not a picture any gdk-pixbuf loader knows');
  const video = GLib.build_filenamev([dir, 'clip.mp4']);
  GLib.file_set_contents(video, '\0\0\0\x18ftypmp42');
  const item = (path, number, mime) => ({
    number,
    path,
    uri: Gio.File.new_for_path(path).get_uri(),
    name: GLib.path_get_basename(path),
    mime,
  });
  return {
    dir,
    wide: item(png, 0, 'image/png'),
    notes: item(text, 1, 'text/plain'),
    pdf: item(pdf, 2, 'application/pdf'),
    tall: item(tall, 3, 'image/png'),
    video: item(video, 4, 'video/mp4'),
    raw: item(raw, 5, 'image/x-adobe-dng'),
  };
}

function find(actor, predicate, out = []) {
  if (predicate(actor)) out.push(actor);
  actor.get_children().forEach((c) => find(c, predicate, out));
  return out;
}

const overlay = () => Main.uiGroup.get_children().find((c) => c.name === 'd2daStackPreview') ?? null;
const textOf = (name) => (overlay() ? find(overlay(), (a) => a.name === name)[0]?.text ?? '' : '');
const pictureOf = () => {
  const card = overlay()?.get_first_child();
  const body = card?.get_first_child();
  return body?.get_child?.() ?? null;
};

function removeTree(path) {
  const dir = Gio.File.new_for_path(path);
  const walk = (file) => {
    const children = file.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    for (const info of children) {
      const child = file.get_child(info.get_name());
      if (info.get_file_type() === Gio.FileType.DIRECTORY) walk(child);
      child.delete(null);
    }
  };
  walk(dir);
  dir.delete(null);
}

async function overlayChecks(ctrl, f, h, calls) {
  ctrl.open([f.wide, f.notes, f.pdf], f.wide.number);
  await h.sleep(1500);
  const wa = Main.layoutManager.getWorkAreaForMonitor(global.display.get_current_monitor());
  const picture = pictureOf();
  h.check(S, 'Space on an image opens the overlay d2daStackPreview', !!overlay());
  h.check(S, 'the overlay names the file', textOf('d2daStackPreviewTitle') === f.wide.name, textOf('d2daStackPreviewTitle'));
  h.check(S, 'the details say type, size and date', /PNG image.*kB|PNG image.*bytes/.test(textOf('d2daStackPreviewDetails')), textOf('d2daStackPreviewDetails'));
  const [pw, ph] = picture?.get_size() ?? [0, 0];
  h.check(S, 'the picture is scaled to fit 90% of the work area, aspect kept', pw > 0 && pw <= wa.width * 0.9 && ph <= wa.height * 0.9 && Math.abs(pw / ph - 2) < 0.02, { pw, ph, wa: [wa.width, wa.height] });
  await h.shot('stackint-preview-image');

  ctrl.update(f.notes.number);
  await h.sleep(1200);
  const text = find(overlay() ?? Main.uiGroup, (a) => a instanceof St.Label && a.text.startsWith('line 001'))[0];
  h.check(S, 'the arrow shows the next item: the text file', textOf('d2daStackPreviewTitle') === f.notes.name, textOf('d2daStackPreviewTitle'));
  h.check(S, 'a text file shows its head, cut at 4 KiB with an ellipsis', !!text && text.text.endsWith('…') && !text.text.includes('line 100'), text?.text.length);
  await h.shot('stackint-preview-text');

  ctrl.update(f.wide.number);
  await h.sleep(800);
  h.check(S, 'the arrow back shows the picture again', textOf('d2daStackPreviewTitle') === f.wide.name);
  h.check(S, 'no ShowFile happened for image and text', calls.shown.length === 0, calls.shown);
}

async function sushiChecks(ctrl, f, h, sushi, events) {
  ctrl.update(f.pdf.number);
  await h.sleep(1500);
  h.check(S, 'a PDF calls ShowFile of the (fake) NautilusPreviewer2 service', sushi.shown.length === 1 && sushi.shown[0] === f.pdf.uri, sushi.shown);
  h.check(S, 'the overlay is gone while Sushi shows the file', overlay() === null);
  h.check(S, 'Visible turning true reaches the dropdown (it gives up its grab)', events.visible.at(-1) === true, events.visible);

  sushi.press(DIRECTION_LEFT);
  await h.sleep(1500);
  h.check(S, 'Sushi\'s Left arrow moves the focus to the previous item', events.focus.at(-1) === f.notes.number, events.focus);
  h.check(S, 'the previous item is an overlay type, so Sushi was closed for it', sushi.closes >= 1 && !!overlay(), { closes: sushi.closes });
  h.check(S, 'Visible turning false reaches the dropdown (it takes its grab back)', events.visible.at(-1) === false, events.visible);
  h.check(S, 'closing Sushi by the preview is not a dismissal', events.dismissed === 0);

  ctrl.update(f.pdf.number);
  await h.sleep(1500);
  h.check(S, 'stepping back onto the PDF shows it in Sushi again', sushi.shown.length === 2 && events.visible.at(-1) === true, { shown: sushi.shown.length });

  sushi.dismiss();
  await h.sleep(800);
  h.check(S, 'Esc inside the Sushi window ends the preview', events.dismissed === 1 && !ctrl.isOpen, events.dismissed);

  ctrl.open([f.video, f.notes], f.video.number);
  await h.sleep(1500);
  h.check(S, 'a video goes to Sushi too', sushi.shown.at(-1) === f.video.uri, sushi.shown);
  const closesBefore = sushi.closes;
  ctrl.close();
  await h.sleep(800);
  h.check(S, 'closing the preview closes Sushi', sushi.closes === closesBefore + 1 && events.visible.at(-1) === false, { closes: sushi.closes });
  h.check(S, 'closing leaves no overlay', overlay() === null && !ctrl.isOpen);
}

// races a real Sushi has and the instant fake does not
async function raceChecks(ctrl, f, h, sushi, events) {
  sushi.mapDelayMs = 1200;
  const closesBefore = sushi.closes;
  const visibleBefore = events.visible.length;
  ctrl.open([f.pdf, f.notes], f.pdf.number);
  await h.sleep(300);
  ctrl.close();
  await h.sleep(2500);
  h.check(S, 'closing while Sushi is still starting up still sends Close', sushi.closes === closesBefore + 1, { closes: sushi.closes });
  h.check(S, 'the late window never reaches the dropdown', events.visible.length === visibleBefore, events.visible);

  ctrl.open([f.pdf, f.notes], f.pdf.number);
  await h.sleep(300);
  ctrl.update(f.notes.number);
  await h.sleep(2500);
  h.check(S, 'moving to an overlay item while Sushi starts closes it and shows the overlay', !!overlay() && textOf('d2daStackPreviewTitle') === f.notes.name && events.visible.length === visibleBefore, events.visible);
  ctrl.close();
  sushi.mapDelayMs = 0;
  await h.sleep(500);

  // a Sushi window Files opened itself is none of the dropdown's business
  ctrl.open([f.notes, f.wide], f.notes.number);
  await h.sleep(1200);
  const eventsBefore = events.visible.length;
  const focusBefore = events.focus.length;
  sushi.openForeign();
  sushi.press(DIRECTION_RIGHT);
  await h.sleep(600);
  h.check(S, 'a foreign Sushi window does not make the dropdown drop its grab', events.visible.length === eventsBefore, events.visible);
  h.check(S, 'its arrow keys do not move an overlay preview', events.focus.length === focusBefore && textOf('d2daStackPreviewTitle') === f.notes.name);
  ctrl.close();
  sushi.dismiss();
  await h.sleep(300);

  // Esc inside Sushi while the next file is still being sent ends the preview for good
  ctrl.open([f.pdf, f.video], f.pdf.number);
  await h.sleep(1200);
  const shownBefore = sushi.shown.length;
  sushi.dismiss();
  await h.sleep(800);
  h.check(S, 'a dismissed preview shows nothing afterwards', !ctrl.isOpen && sushi.shown.length === shownBefore && overlay() === null);
}

// A phone photo is stored 2000x1000 with EXIF orientation 6 and shows 1000x2000:
// the overlay must draw it upright in a portrait box. gdk-pixbuf cannot write
// EXIF, so the APP1 segment (big-endian, one Orientation entry) is inserted
// right after the JPEG's start marker.
async function rotatedPhotoChecks(ctrl, f, h) {
  const path = GLib.build_filenamev([f.dir, 'phone-photo.jpg']);
  const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 2000, 1000);
  pixbuf.fill(0xd03030ff);
  const [, jpeg] = pixbuf.save_to_bufferv('jpeg', [], []);
  const exif = [0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 1, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
  GLib.file_set_contents(path, new Uint8Array([...jpeg.subarray(0, 2), ...exif, ...jpeg.subarray(2)]));
  ctrl.open([{ number: 6, path, uri: Gio.File.new_for_path(path).get_uri(), name: 'phone-photo.jpg', mime: 'image/jpeg' }], 6);
  await h.sleep(2500);
  const picture = pictureOf();
  const [w, h2] = picture?.get_size() ?? [0, 0];
  h.check(S, 'an EXIF-rotated photo gets a portrait box that fits the work area', h2 > w && Math.abs(h2 / w - 2) < 0.02, { w, h: h2 });
  h.check(S, 'it is drawn from pixels, not from the texture cache (which ignores the orientation)', picture?.content instanceof St.ImageContent, picture?.toString());
  await h.shot('stackint-preview-rotated');
  ctrl.close();
  await h.sleep(300);
}

// an image no gdk-pixbuf loader decodes (camera RAW) shows its icon, not an empty box
async function unreadableImageChecks(ctrl, f, h) {
  ctrl.open([f.raw], f.raw.number);
  await h.sleep(1500);
  const body = overlay()?.get_first_child()?.get_first_child()?.get_child?.();
  h.check(S, 'an image no loader decodes shows the type icon', body instanceof St.Icon, body?.toString());
  ctrl.close();
  await h.sleep(300);
}

async function fallbackChecks(ext, f, h, sushi, events) {
  const shownBefore = sushi.shown.length;
  const absent = new StackPreview({ settings: ext._settings, monitorIndex: 0, ...events.handlers, busName: 'org.example.NoSuchPreviewer' });
  absent.open([f.pdf], f.pdf.number);
  await h.sleep(1500);
  h.check(S, 'with the service absent the PDF gets the overlay card', !!overlay() && textOf('d2daStackPreviewTitle') === f.pdf.name);
  h.check(S, 'the card says what it is', /PDF/.test(textOf('d2daStackPreviewDetails')), textOf('d2daStackPreviewDetails'));
  await h.shot('stackint-preview-card');
  absent.destroy();

  ext._settings.set_boolean('stack-preview-sushi', false);
  const off = new StackPreview({ settings: ext._settings, monitorIndex: 0, ...events.handlers });
  off.open([f.video], f.video.number);
  await h.sleep(1500);
  h.check(S, 'with stack-preview-sushi off the video gets the card and ShowFile is not called', !!overlay() && sushi.shown.length === shownBefore, { shown: sushi.shown.length });
  off.destroy();
  ext._settings.set_boolean('stack-preview-sushi', true);
}

async function multiChecks(ctrl, f, h, sushi) {
  const shownBefore = sushi.shown.length;
  const sushiUsed = () => sushi.shown.length !== shownBefore;
  // the selected items in reading order (numbers 0, 1, 3); the PDF (2) is not selected
  const picked = [f.wide, f.notes, f.tall];
  ctrl.open(picked, f.notes.number, true);
  await h.sleep(1500);
  h.check(S, 'a multi-selection shows "n of m"', /\(2 of 3\)/.test(textOf('d2daStackPreviewTitle')), textOf('d2daStackPreviewTitle'));
  await h.shot('stackint-preview-multi');
  ctrl.update(f.tall.number);
  await h.sleep(800);
  h.check(S, 'next walks to the third selected item', /\(3 of 3\)/.test(textOf('d2daStackPreviewTitle')) && textOf('d2daStackPreviewTitle').startsWith(f.tall.name), textOf('d2daStackPreviewTitle'));
  ctrl.update(f.pdf.number);
  await h.sleep(500);
  h.check(S, 'an item outside the selection is not walked to', /\(3 of 3\)/.test(textOf('d2daStackPreviewTitle')) && !sushiUsed(), textOf('d2daStackPreviewTitle'));
  ctrl.open([f.wide, f.notes], f.wide.number, false);
  await h.sleep(1200);
  h.check(S, 'a single selection shows no count', !/ of /.test(textOf('d2daStackPreviewTitle')), textOf('d2daStackPreviewTitle'));
  ctrl.close();
  await h.sleep(300);
}

export async function stackPreviewScenario(ext, h) {
  await h.closeOverview();
  await h.sleep(2000);
  const f = makeFixtures();
  const sushi = new FakeSushi();
  const events = { visible: [], focus: [], dismissed: 0 };
  events.handlers = {
    onSushiVisible: (visible) => events.visible.push(visible),
    onFocus: (number) => events.focus.push(number),
    onDismissed: () => events.dismissed++,
  };
  const ctrl = new StackPreview({ settings: ext._settings, monitorIndex: 0, ...events.handlers });
  try {
    await overlayChecks(ctrl, f, h, sushi);
    await sushiChecks(ctrl, f, h, sushi, events);
    await raceChecks(ctrl, f, h, sushi, events);
    await unreadableImageChecks(ctrl, f, h);
    await rotatedPhotoChecks(ctrl, f, h);
    await fallbackChecks(ext, f, h, sushi, events);
    await multiChecks(ctrl, f, h, sushi);
  } finally {
    ctrl.destroy();
    sushi.stop();
    removeTree(f.dir);
  }
}
