# Spike: drops from other apps onto the dock

Prototype code behind section 6 of [STACK_INTERACTIONS.md](../STACK_INTERACTIONS.md). Sandboxed nested shells as in [DRAG_OUT.md](DRAG_OUT.md); the source is our own GTK4 client offering eight payloads (a file, a folder, a `.desktop` file, a Chrome-style link, a Firefox-style link, plain text, an image, a GTK copy), the targets are the Downloads and Screenshots stacks, the Trash, an app icon, a gap between icons, empty dock area and outside, with `org.gnome.Nautilus` either absent (the GIO fallback ran) or a mock recording `MoveURIs`, `CopyURIs` and `TrashURIs`. Real Nautilus, Firefox and Chrome were not exercised. Reference for slices S9-S13, **not** shipped code: the parsing it contains is replaced by `dropClassify.js` and `webLinks.js`.

## Results

The matrix of the baseline is in section 6.2 of the design document. With the extended helper and shell patch below: files and folders move or copy into stacks, are trashed on the Trash, open in apps with `%U/%f`; a `.desktop` file dropped between favourites is pinned at the gap index (gap 1, left end 0, right end 3), a folder dropped in a gap becomes a stack, a plain file dropped in a gap is refused; links, text and images reach the helper once its drop formats are widened (the prototype wrote a `Type=Link` launcher, a `.txt` and `Pasted image.png` into a stack; the design refuses those on stacks and adds links to the dock instead). The Firefox payload decodes: `text/x-moz-url` is UTF-16LE `url\ntitle`. Spring loading cannot work with a modal dropdown (section 6.7).

## Extended helper (`apps/file-drops.js`)

```js
// File-drop helper for Hyperdock: transparent GTK4 windows that the extension
// lays over its docks while a file drag is in progress.
//
// Why a separate client: on Wayland a drag that starts in a client (Files, a
// browser) delivers its drop and its data only to a Wayland surface. GNOME
// Shell actors see hover positions (XdndHandler) but never the drop, so the
// dock itself cannot receive a file list. The extension starts this process
// through Meta.WaylandClient, which lets it type, stack and place the
// windows; this process only accepts the drop and reports the URIs.
//
// Protocol, one line per message:
//   stdin   "show <n> <drag>"  map n drop windows (one per dock) for drag
//                         id <drag>
//           "hide"        unmap them once any drop in flight is delivered
//           "target 0|1"  whether the pointer is over a dock item that takes
//                         files; decides the drag cursor and whether a drop
//                         is accepted
//   stdout  {"ready":true}  once commands are read; the Shell sends no "show"
//           before it
//           {"accepted":<drag>}  a drop of that drag was taken; its "drop"
//           line follows once the data is read, so the Shell keeps where
//           the drag ended however many drags begin meanwhile
//           {"enter":{"drag":<drag>,"formats":["text/uri-list",...]}}  the
//           mimetypes a drag offers, sent when it enters a drop window, so
//           the Shell can decide per payload kind whether a dock item takes
//           it before any drop
//           {"drop":{"drag":<drag>,"uris":[...],"formats":[...],
//            "payloads":{"<mime>":"<base64>"}}}  the drag id is the one
//           shown when the drop entered, so the Shell can route a drop read
//           after the next drag began; uris is the file/URI list (empty when
//           none or reading failed); payloads holds the raw bytes of the
//           other text/image formats that were read, only for drops that are
//           not a plain list of file: URIs (see PAYLOAD_MIMES, size caps)
//           {"leave":<drag>}  the drag left a drop window without dropping
//           (moved off the dock, or ended or was cancelled over it)
// EOF on stdin ends the process, so it never outlives the extension.

import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const URI_LIST = 'text/uri-list';
// read for drops that carry no local files (links, text, images); in this
// order of preference, the first one offered per entry wins
const PAYLOAD_MIMES = [
  {key: 'text/x-moz-url', offered: ['text/x-moz-url'], cap: 64 * 1024},
  {key: 'text/html', offered: ['text/html'], cap: 256 * 1024},
  {key: 'text/plain', offered: ['text/plain;charset=utf-8', 'text/plain'], cap: 256 * 1024},
  {key: 'image/png', offered: ['image/png'], cap: 16 * 1024 * 1024},
];
// the extension runs the trash / open / move itself: COPY keeps the source
// from deleting its file after the drop
const ACTION = Gdk.DragAction.COPY;
// "hide" is sent when the Shell sees the drag end, which can be before this
// process has read the Wayland drop event; unmapping then would lose it
const HIDE_GRACE_MS = 400;

Gtk.init();

const css = new Gtk.CssProvider();
// Adwaita outlines a widget under a drag (:drop(active)); the dock's own
// magnification and label are the feedback, so nothing is drawn here
const CSS = `
  window.d2d-file-drops, window.d2d-file-drops * {
    background: none; box-shadow: none; outline: none; border: none;
  }
  window.d2d-file-drops *:drop(active) { box-shadow: none; outline: none; }
`;
css.load_from_string(CSS);
Gtk.StyleContext.add_provider_for_display(
  Gdk.Display.get_default(),
  css,
  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
);

const stdout = new Gio.DataOutputStream({
  base_stream: new GioUnix.OutputStream({fd: 1, close_fd: false}),
});
function send(obj) {
  stdout.put_string(`${JSON.stringify(obj)}\n`, null);
  stdout.flush(null);
}

let overTarget = false;
let currentDrop = null;
let currentDrag = 0;
const dragOf = new WeakMap(); // Gdk.Drop -> drag id when it entered
let pendingReads = 0;
let hideId = 0;
const windows = [];

function status(drop) {
  const action = overTarget ? ACTION : 0;
  drop.status(action, action);
  return action;
}

function parseUriList(text) {
  // RFC 2483: CRLF separated, '#' starts a comment line
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length && !l.startsWith('#'));
}

// the bytes of the first of `mimes` the source offers, at most `cap` of them
function readMime(drop, mimes, cap) {
  return new Promise((resolve, reject) => {
    drop.read_async(mimes, GLib.PRIORITY_DEFAULT, null, (d, res) => {
      try {
        const [stream] = d.read_finish(res);
        const out = Gio.MemoryOutputStream.new_resizable();
        out.splice_async(
          stream,
          Gio.OutputStreamSpliceFlags.CLOSE_SOURCE |
            Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
          GLib.PRIORITY_DEFAULT,
          null,
          (o, r) => {
            try {
              o.splice_finish(r);
              const bytes = o.steal_as_bytes().toArray();
              if (bytes.length > cap) reject(new Error(`payload over ${cap} bytes`));
              else resolve(bytes);
            } catch (e) {
              reject(e);
            }
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function readUris(drop) {
  const bytes = await readMime(drop, [URI_LIST], 1024 * 1024);
  return parseUriList(new TextDecoder().decode(bytes));
}

// Sandboxed sources may offer only the portal file list; GTK converts it
function readFileList(drop) {
  return new Promise((resolve, reject) => {
    drop.read_value_async(
      Gdk.FileList.$gtype,
      GLib.PRIORITY_DEFAULT,
      null,
      (d, res) => {
        try {
          const list = d.read_value_finish(res);
          resolve(list.get_files().map((f) => f.get_uri()));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function deliver(drop, drag) {
  pendingReads++;
  let uris = [];
  const payloads = {};
  const formats = drop.get_formats();
  try {
    uris = formats.contain_mime_type(URI_LIST)
      ? await readUris(drop)
      : formats.contain_gtype(Gdk.FileList.$gtype)
        ? await readFileList(drop)
        : [];
  } catch (e) {
    printerr(`d2da file-drops: reading the uri list failed: ${e.message}`);
  }
  // local files need nothing else; links, text and images do
  if (!uris.length || uris.some((u) => !u.startsWith('file:'))) {
    for (const {key, offered, cap} of PAYLOAD_MIMES) {
      if (!offered.some((m) => formats.contain_mime_type(m))) continue;
      // an image dragged out of a page also offers its link as text: the
      // picture is only worth its bytes when nothing readable came along
      if (key === 'image/png' && (payloads['text/plain'] || uris.length)) continue;
      try {
        const bytes = await readMime(drop, offered, cap);
        payloads[key] = GLib.base64_encode(bytes);
      } catch (e) {
        printerr(`d2da file-drops: reading ${key} failed: ${e.message}`);
      }
    }
  }
  const got = uris.length || Object.keys(payloads).length;
  drop.finish(got ? ACTION : 0);
  // also when empty: it releases the drop the Shell holds since "accepted"
  send({drop: {drag, uris, formats: formats.get_mime_types() ?? [], payloads}});
  pendingReads--;
  if (hideId === -1) hideNow();
}

function createWindow() {
  const win = new Gtk.Window({
    title: 'hyperdock-file-drops',
    decorated: false,
    default_width: 64,
    default_height: 64,
    css_classes: ['d2d-file-drops'],
  });
  // GTK commits no buffer for an empty render tree and Mutter never maps a
  // surface without one; painting transparent pixels gives it a buffer
  const area = new Gtk.DrawingArea({hexpand: true, vexpand: true});
  area.set_draw_func((_a, cr) => {
    cr.setSourceRGBA(0, 0, 0, 0);
    cr.paint();
    cr.$dispose();
  });
  const target = new Gtk.DropTargetAsync({
    actions: ACTION,
    formats: Gdk.ContentFormats.new([
      URI_LIST,
      ...PAYLOAD_MIMES.flatMap((p) => p.offered),
    ]).union(Gdk.ContentFormats.new_for_gtype(Gdk.FileList.$gtype)),
  });
  target.connect('drag-enter', (_t, drop) => {
    currentDrop = drop;
    dragOf.set(drop, currentDrag);
    const drag = currentDrag;
    const mimes = drop.get_formats().get_mime_types() ?? [];
    // the mimetypes themselves, not GTK's converted gtypes
    send({enter: {drag, formats: mimes}});
    // a text/uri-list is files from a file manager and a link from Chrome:
    // read it ahead (Wayland allows it) so the Shell knows what hovers
    if (mimes.includes(URI_LIST) && !mimes.includes('text/x-moz-url')) {
      readUris(drop)
        .then((uris) => send({peek: {drag, uris}}))
        .catch((e) => printerr(`d2da file-drops: peek failed: ${e.message}`));
    }
    return status(drop);
  });
  target.connect('drag-motion', (_t, drop) => status(drop));
  target.connect('drag-leave', (_t, drop) => {
    if (currentDrop === drop) currentDrop = null;
    send({leave: dragOf.get(drop) ?? currentDrag});
  });
  target.connect('drop', (_t, drop) => {
    currentDrop = null;
    if (!overTarget) return false;
    const drag = dragOf.get(drop) ?? currentDrag;
    send({accepted: drag});
    deliver(drop, drag);
    return true;
  });
  area.add_controller(target);
  win.set_child(area);
  win.connect('close-request', () => true);
  return win;
}

function show(n) {
  if (hideId > 0) GLib.source_remove(hideId);
  hideId = 0;
  while (windows.length < n) windows.push(createWindow());
  while (windows.length > n) windows.pop().destroy();
  windows.forEach((w) => w.present());
}

function hideNow() {
  hideId = 0;
  overTarget = false;
  windows.forEach((w) => w.set_visible(false));
}

function hide() {
  if (hideId) return;
  hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_GRACE_MS, () => {
    // a drop still being read hides when it is delivered
    if (pendingReads > 0) {
      hideId = -1;
    } else {
      hideNow();
    }
    return GLib.SOURCE_REMOVE;
  });
}

const loop = new GLib.MainLoop(null, false);

const stdin = new Gio.DataInputStream({
  base_stream: new GioUnix.InputStream({fd: 0, close_fd: false}),
});
function readCommand() {
  stdin.read_line_async(GLib.PRIORITY_DEFAULT, null, (s, res) => {
    let line = null;
    try {
      [line] = s.read_line_finish_utf8(res);
    } catch {
      // treated as EOF
    }
    if (line === null) {
      loop.quit();
      return;
    }
    const [cmd, arg, arg2] = line.trim().split(' ');
    if (cmd === 'show') {
      currentDrag = parseInt(arg2) || 0;
      show(Math.max(1, parseInt(arg) || 1));
    } else if (cmd === 'hide') {
      hide();
    } else if (cmd === 'target') {
      overTarget = arg === '1';
      if (currentDrop) status(currentDrop);
    }
    readCommand();
  });
}
readCommand();
send({ready: true});
loop.run();
```

## Shell-side patch of `fileDrops.js` against the baseline

```diff
--- a/fileDrops.js	2026-11-01 16:19:36.205019142 +0100
+++ b/fileDrops.js	2026-11-01 17:00:26.282892633 +0100
@@ -20,6 +20,14 @@
 import Meta from 'gi://Meta';
 import Shell from 'gi://Shell';
 import * as Main from 'resource:///org/gnome/shell/ui/main.js';
+import * as Fav from 'resource:///org/gnome/shell/ui/appFavorites.js';
+import {
+  ACCEPTS,
+  classifyDrop,
+  fileNameFor,
+  kindOffered,
+  linkDesktopEntry,
+} from './dropPayload.js';
 
 const HELPER = 'apps/file-drops.js';
 // the dock reacts this far around its strut (dock.js _isWithinDash)
@@ -113,6 +121,16 @@
   });
 }
 
+// a launcher or a folder: what has a place between dock items
+function isPinnable(uri) {
+  if (!uri.startsWith('file:')) return false;
+  const file = Gio.File.new_for_uri(uri);
+  return (
+    uri.endsWith('.desktop') ||
+    file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY
+  );
+}
+
 export class FileDrops {
   constructor(extension) {
     this.extension = extension;
@@ -127,6 +145,8 @@
     this._activeDock = null;
     this._target = null;
     this._hoverItem = null;
+    this._zoneKey = '';
+    this._offered = null; // {drag, mimes, peeked, kind} of the drag in progress
     this._drag = 0; // id of the current or last drag, echoed by the helper
     this._dragTargets = new Map(); // drag id -> target it ended on
     // drag ids whose drop the helper took and is still reading
@@ -299,7 +319,9 @@
         const msg = JSON.parse(line);
         if (msg.ready) this._onHelperReady();
         if (msg.accepted !== undefined) this._acceptedDrags.add(msg.accepted);
-        if (msg.drop) this._onDrop(msg.drop.uris ?? [], msg.drop.drag);
+        if (msg.enter) this._onHelperEnter(msg.enter);
+        if (msg.peek) this._onHelperPeek(msg.peek);
+        if (msg.drop) this._onDrop(msg.drop);
         if (msg.leave !== undefined) this._onHelperLeave(msg.leave);
       } catch (e) {
         console.error('d2da: file-drops helper message', e);
@@ -347,6 +369,8 @@
     this._dropDelivered = false;
     this._target = null;
     this._hoverItem = null;
+    this._zoneKey = '';
+    this._offered = null;
     this._activeDock = null;
     this._targets = (this.extension.docks ?? [])
       .filter((d) => d.visible && d.dash && !d.getMonitor()?.inFullscreen)
@@ -475,6 +499,7 @@
     this._targets = [];
     this._target = null;
     this._hoverItem = null;
+    this._zoneKey = '';
   }
 
   _buttonHeld() {
@@ -503,20 +528,81 @@
     this._watchId = 0;
   }
 
+  // what the drag offers is known once it entered the helper's window; the
+  // item under the pointer is judged again with it
+  _onHelperEnter({ drag, formats }) {
+    if (drag !== this._drag) return;
+    this._offered = { drag, mimes: formats, peeked: null, kind: kindOffered(formats) };
+    this._rejudge();
+  }
+
+  // text/uri-list read ahead: file: or a web link?
+  _onHelperPeek({ drag, uris }) {
+    if (drag !== this._drag || !this._offered) return;
+    this._offered.peeked = uris;
+    this._offered.kind = kindOffered(this._offered.mimes, uris);
+    this._rejudge();
+  }
+
+  _rejudge() {
+    this._hoverItem = null;
+    this._zoneKey = '';
+    this._updateTarget();
+  }
+
+  // Where on the hovered item the pointer is: over its middle half the drop
+  // is "onto" it, towards either edge it is "between" it and the neighbor,
+  // with the favorites index it would take. The dock magnifies, so the item's
+  // current rect is used, not its resting slot.
+  _zoneOf(dock, item) {
+    const actor = item._renderer ?? item;
+    const [px, py] = global.get_pointer();
+    const [ax, ay] = actor.get_transformed_position();
+    const [aw, ah] = actor.get_transformed_size();
+    const vertical = dock.isVertical();
+    const f = vertical ? (py - ay) / ah : (px - ax) / aw;
+    if (f >= 0.25 && f <= 0.75) return { type: 'onto' };
+    const favs = Fav.getAppFavorites().getFavorites().map((a) => a.get_id());
+    const id = item._appwell?.app?.get_id?.();
+    const at = favs.indexOf(id);
+    // before/after a favorite: its slot; next to anything else: after the favorites
+    const index = at >= 0 ? at + (f > 0.5 ? 1 : 0) : favs.length;
+    return { type: 'between', index };
+  }
+
   _updateTarget() {
     const dock = this._activeDock;
     const item = dock?.animated ? dock._hoveredIcon : null;
-    if (item === this._hoverItem) return;
+    const zone = item ? this._zoneOf(dock, item) : null;
+    const key = zone ? `${zone.type}:${zone.index ?? ''}` : '';
+    if (item === this._hoverItem && key === this._zoneKey) return;
     this._hoverItem = item;
+    this._zoneKey = key;
     const prev = this._target;
-    this._target = item ? this._targetFor(dock, item) : null;
+    this._target = item ? this._targetFor(dock, item, zone) : null;
     if (!!prev !== !!this._target) {
       this._send(`target ${this._target ? 1 : 0}`);
     }
   }
 
-  // what a drop on this dock item does, or null when it takes no files
-  _targetFor(dock, item) {
+  // what a drop here does with what the drag offers, or null when nothing
+  _targetFor(dock, item, zone) {
+    const target = zone?.type === 'between'
+      ? { item, dock, kind: 'pin', index: zone.index }
+      : this._targetOnto(dock, item);
+    // before the offer is known (helper not entered yet) judge by the item only
+    if (target && this._offered && !ACCEPTS[target.kind].includes(this._offered.kind)) {
+      return null;
+    }
+    // only launchers and folders have a place between dock items; the uris
+    // are known once the helper read ahead (peek)
+    if (target?.kind === 'pin' && this._offered?.peeked && !this._offered.peeked.some(isPinnable)) {
+      return null;
+    }
+    return target;
+  }
+
+  _targetOnto(dock, item) {
     if (item === dock._trashIcon) return { item, dock, kind: 'trash' };
     if (item._folderStack) {
       // Recents lists apps, not a folder: nothing to drop files into
@@ -533,7 +619,9 @@
     const app = item._appwell?.app;
     if (!item.custom_icon && app instanceof Shell.App) {
       const info = app.get_app_info();
-      if (info?.supports_uris() || info?.supports_files()) {
+      // a %f-only app cannot be handed a web link
+      const links = this._offered?.kind === 'links';
+      if (links ? info?.supports_uris() : info?.supports_uris() || info?.supports_files()) {
         return { item, dock, kind: 'app', app, info };
       }
     }
@@ -544,7 +632,8 @@
   // drop actions
   //---------------------
 
-  _onDrop(uris, drag) {
+  _onDrop(msg) {
+    const drag = msg.drag;
     this._acceptedDrags.delete(drag);
     // The helper's drop line and Meta.Dnd's dnd-leave travel unrelated
     // channels in no fixed order: a drop reported while its drag is still
@@ -561,21 +650,23 @@
       target = this._dragTargets.get(drag);
       this._dragTargets.delete(drag);
     }
-    if (!target || !uris.length) return;
-    this._perform(target, uris).catch((e) => {
+    const data = classifyDrop(msg);
+    if (!target || data.kind === 'empty') return;
+    if (!ACCEPTS[target.kind].includes(data.kind)) return;
+    this._perform(target, data).catch((e) => {
       console.error('d2da: file-drops', target.kind, e);
     });
   }
 
-  async _perform(target, uris) {
+  async _perform(target, data) {
     switch (target.kind) {
       case 'trash':
-        await this._trash(uris);
+        await this._trash(data.files);
         break;
       case 'app':
         // async: a D-Bus activated app must not block the compositor
         target.info.launch_uris_async(
-          uris,
+          [...data.files, ...data.links.map((l) => l.url)],
           global.create_app_launch_context(0, -1),
           null,
           (info, res) => {
@@ -589,11 +680,77 @@
         target.dock._maybeBounce?.(target.item);
         break;
       case 'folder':
-        await this._transfer(uris, target.dir);
+        if (data.kind === 'files') await this._transfer(data.files, target.dir);
+        else await this._saveInto(target.dir, data);
+        break;
+      case 'pin':
+        this._pin(target.index, data.files);
         break;
     }
   }
 
+  // links, text and images have no file: make one, the way the Finder's
+  // .webloc / clipping files work
+  async _saveInto(dir, data) {
+    const writes = [];
+    if (data.kind === 'links') {
+      for (const link of data.links) {
+        writes.push([fileNameFor(link.title ?? new URL(link.url).hostname, '.desktop'), new TextEncoder().encode(linkDesktopEntry(link))]);
+      }
+    } else if (data.kind === 'text') {
+      writes.push([fileNameFor(data.text.split('\n')[0].slice(0, 40), '.txt'), new TextEncoder().encode(data.text)]);
+    } else if (data.kind === 'image') {
+      writes.push([fileNameFor('Pasted image', '.png'), data.image]);
+    }
+    for (const [name, bytes] of writes) {
+      const file = this._freeChild(dir, name);
+      await new Promise((resolve) => {
+        file.replace_contents_bytes_async(
+          new GLib.Bytes(bytes), null, false, Gio.FileCreateFlags.NONE, null,
+          (f, res) => {
+            try {
+              f.replace_contents_finish(res);
+            } catch (e) {
+              console.error('d2da: file-drops save', name, e);
+            }
+            resolve();
+          }
+        );
+      });
+    }
+  }
+
+  // "name (2).ext" when `name` is taken
+  _freeChild(dir, name) {
+    const dot = name.lastIndexOf('.');
+    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
+    let file = dir.get_child(name);
+    for (let n = 2; file.query_exists(null); n++) file = dir.get_child(`${stem} (${n})${ext}`);
+    return file;
+  }
+
+  // dropped between dock items: an app's launcher is pinned at that place, a
+  // folder becomes a stack; any other file has no place in the dock
+  _pin(index, uris) {
+    for (const uri of uris) {
+      const file = Gio.File.new_for_uri(uri);
+      const path = file.get_path();
+      if (!path) continue;
+      if (path.endsWith('.desktop')) {
+        const info = Gio.DesktopAppInfo.new_from_filename(path);
+        const id = info?.get_id();
+        if (id) Fav.getAppFavorites().addFavoriteAtPos(id, index);
+      } else if (file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY) {
+        const settings = this.extension._settings;
+        const stacks = JSON.parse(settings.get_string('folder-stacks'));
+        if (!stacks.some((s) => s.path === path)) {
+          stacks.push({ path, icon: 'folder', view: 'grid', sort: 'date-added', display: 'stack', group: 'none' });
+          settings.set_string('folder-stacks', JSON.stringify(stacks));
+        }
+      }
+    }
+  }
+
   // Files performs these when it is installed, so they show its progress,
   // conflict dialogs and Undo; plain GIO is the fallback.
   async _trash(uris) {
```

## Test source client (`dragSource.js`)

```js
// Test "source" Wayland client: one window with a drag source per payload kind.
// argv: <payload dir> ; payload dir holds payloads.json (see run.sh/dropinProbe.js)
// stdout lines: {"ready":true,"rects":[{id,x,y,w,h}]}  {"ev":"begin|end|cancel",...}
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix';
import Gtk from 'gi://Gtk?version=4.0';

Gtk.init();

const out = new Gio.DataOutputStream({
  base_stream: new GioUnix.OutputStream({ fd: 1, close_fd: false }),
});
const send = (o) => {
  out.put_string(`${JSON.stringify(o)}\n`, null);
  out.flush(null);
};

const home = GLib.getenv('HOME');
const dataHome = GLib.getenv('XDG_DATA_HOME');
const shot = `${home}/Pictures/Screenshots/Screenshot from 2026-10-30 10-00-00.png`;
const folder = `${home}/Documents/Project Folder`;
const desktop = `${dataHome}/applications/${GLib.getenv('D2DA_C_DESKTOP') ?? 'd2da-visual-editor.desktop'}`;
const URL = 'https://example.com/some/page?x=1&y=2';
const TITLE = 'Example Page — Title ünïcode';
const enc = new TextEncoder();
const bytes = (s) => new GLib.Bytes(enc.encode(s));
const fileUri = (p) => Gio.File.new_for_path(p).get_uri();

function utf16le(s) {
  const buf = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    buf[2 * i] = c & 255;
    buf[2 * i + 1] = c >> 8;
  }
  return new GLib.Bytes(buf);
}

const mime = (type, b) => Gdk.ContentProvider.new_for_bytes(type, b);
const fileList = (paths) => {
  const v = new GObject.Value();
  v.init(Gdk.FileList.$gtype);
  v.set_boxed(Gdk.FileList.new_from_list(paths.map((p) => Gio.File.new_for_path(p))));
  return Gdk.ContentProvider.new_for_value(v);
};
import GObject from 'gi://GObject';

const pngBytes = GLib.file_get_contents(shot)[1];
// payloads, ordered as a real source would offer them
const PAYLOADS = [
  { id: 'A-file', label: 'A file (uri-list+FileList)', make: () => [mime('text/uri-list', bytes(`${fileUri(shot)}\r\n`)), fileList([shot])] },
  { id: 'B-folder', label: 'B folder (uri-list+FileList)', make: () => [mime('text/uri-list', bytes(`${fileUri(folder)}\r\n`)), fileList([folder])] },
  { id: 'C-desktop', label: 'C .desktop file', make: () => [mime('text/uri-list', bytes(`${fileUri(desktop)}\r\n`)), fileList([desktop])] },
  { id: 'D-chrome', label: 'D Chrome link', make: () => [mime('text/uri-list', bytes(`${URL}\r\n`)), mime('text/plain', bytes(URL)), mime('text/html', bytes(`<a href="${URL}">${TITLE}</a>`))] },
  { id: 'E-firefox', label: 'E Firefox link', make: () => [mime('text/x-moz-url', utf16le(`${URL}\n${TITLE}`)), mime('text/uri-list', bytes(`${URL}\r\n`)), mime('text/plain', bytes(URL)), mime('text/html', bytes(`<a href="${URL}">${TITLE}</a>`))] },
  { id: 'F-text', label: 'F text with URL', make: () => [mime('text/plain;charset=utf-8', bytes('see https://example.com/x for details')), mime('text/plain', bytes('see https://example.com/x for details'))] },
  { id: 'G-image', label: 'G image/png only', make: () => [mime('image/png', pngBytes)] },
  { id: 'H-gtkcopy', label: 'H uri-list+gnome-copied-files', make: () => [mime('text/uri-list', bytes(`${fileUri(shot)}\r\n`)), mime('x-special/gnome-copied-files', bytes(`copy\n${fileUri(shot)}`))] },
];

const win = new Gtk.Window({ title: 'dropin-source', decorated: false, default_width: 280, default_height: PAYLOADS.length * 52 });
const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });
const css = new Gtk.CssProvider();
css.load_from_string('.src { background: #3465a4; color: white; border: 1px solid white; padding: 4px; }');
Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

const widgets = [];
for (const p of PAYLOADS) {
  const l = new Gtk.Label({ label: p.label, css_classes: ['src'], height_request: 48, hexpand: true });
  const src = new Gtk.DragSource({ actions: Gdk.DragAction.COPY | Gdk.DragAction.MOVE | Gdk.DragAction.LINK });
  src.connect('prepare', () => {
    const provider = Gdk.ContentProvider.new_union(p.make());
    send({ ev: 'prepare', id: p.id, formats: provider.ref_formats().to_string() });
    return provider;
  });
  src.connect('drag-begin', () => send({ ev: 'begin', id: p.id }));
  src.connect('drag-end', (_s, drag, del) => send({ ev: 'end', id: p.id, action: drag.get_selected_action(), deleteData: del }));
  src.connect('drag-cancel', (_s, _d, reason) => { send({ ev: 'cancel', id: p.id, reason }); return false; });
  l.add_controller(src);
  box.append(l);
  widgets.push([p.id, l]);
}
win.set_child(box);
win.connect('close-request', () => true);
win.present();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
  const rects = widgets.map(([id, w]) => {
    const [ok, r] = w.compute_bounds(win);
    return { id, x: r.get_x(), y: r.get_y(), w: r.get_width(), h: r.get_height() };
  });
  send({ ready: true, rects });
  return GLib.SOURCE_REMOVE;
});
new GLib.MainLoop(null, false).run();
```

## Mock `org.gnome.Nautilus.FileOperations2` (`mock-nautilus.js`)

```js
// Stand-in for org.gnome.Nautilus FileOperations2: records each call and does the
// operation with GIO, so the scenario can see which D-Bus method fileDrops used.
// D-Bus-activated through $XDG_DATA_HOME/dbus-1/services (run.sh, D2DA_NAUT=mock).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const XML = `<node><interface name="org.gnome.Nautilus.FileOperations2">
<method name="CopyURIs"><arg type="as" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/></method>
<method name="MoveURIs"><arg type="as" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/></method>
<method name="TrashURIs"><arg type="as" direction="in"/><arg type="a{sv}" direction="in"/></method>
</interface></node>`;
const logPath = GLib.getenv('D2DA_NAUT_LOG');
const log = (o) => {
  const f = Gio.File.new_for_path(logPath);
  const s = f.append_to(Gio.FileCreateFlags.NONE, null);
  s.write_all(new TextEncoder().encode(`${JSON.stringify(o)}\n`), null);
  s.close(null);
};
const loop = new GLib.MainLoop(null, false);
const node = Gio.DBusNodeInfo.new_for_xml(XML);
Gio.bus_own_name(Gio.BusType.SESSION, 'org.gnome.Nautilus', Gio.BusNameOwnerFlags.NONE, (conn) => {
  conn.register_object('/org/gnome/Nautilus/FileOperations2', node.interfaces[0], (c, sender, path, iface, method, params, inv) => {
    const args = params.recursiveUnpack();
    log({ method, uris: args[0], dest: method === 'TrashURIs' ? null : args[1] });
    try {
      for (const uri of args[0]) {
        const src = Gio.File.new_for_uri(uri);
        if (method === 'TrashURIs') src.trash(null);
        else {
          const dst = Gio.File.new_for_uri(args[1]).get_child(src.get_basename());
          if (method === 'MoveURIs') src.move(dst, Gio.FileCopyFlags.NONE, null, null);
          else src.copy(dst, Gio.FileCopyFlags.NONE, null, null);
        }
      }
      inv.return_value(null);
    } catch (e) {
      log({ error: e.message });
      inv.return_gerror(e);
    }
  }, null, null);
}, null, () => loop.quit());
loop.run();
```
