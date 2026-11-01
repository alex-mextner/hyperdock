# Spike: dragging out of a Shell popover through a helper client

Prototype code behind section 5 of [STACK_INTERACTIONS.md](../STACK_INTERACTIONS.md). It ran in sandboxed nested headless shells (private session bus with an empty service directory, display variables unset, temporary `HOME`, `prlimit --core=0`), against our own GTK4 sink window, the existing `fileDrops.js` dock layer and the real `StackPanel`. It is reference material for slice S8, **not** shipped code: the scenario registers itself as `dragout` in `probeScenarios.js` of an installed copy, and the helper client below is the `role source` / `role sink` test client.

## What it proved (probe names in brackets)

- Under any `Main.pushModal` a Wayland client receives no pointer event at all (`e0`).
- A synthetic release and press of button 1 while the physical button is held does not reach the client: mutter's seat drops the repeated press (`t1`, `t2`).
- A virtual press of a spare button (9; 2, 3 and 8 also worked) while button 1 is held gives the helper a valid serial: `Gdk.Drag.begin` starts a real `wl_data_device` drag that follows the physical button; the sink window and the dock Downloads stack and Trash received it (`t3`, `t6`, `t7`, `real`).
- Escape cancels (`t62`); a release before the window mapped aborts without injecting anything (`t80`); the helper window can hide 50 ms after `drag-begin` (`t81`); `Main.popModal` is mandatory (`t82`); the helper layer must be raised above the popover (`t83`).
- Timing, warm helper: popModal to `dnd-enter` about 21 ms; the first show of a cold helper took 250-300 ms and the first extra-button handoff of a cold helper failed until the helper had shown and hidden a window once, or the window was at least 160 px.
- A helper surface mapped before the press and no modal grab also works with the real button 1 (`altA`) but blinds the covered Shell actors (the documented fallback).
- Shell-internal DnD never reaches a client surface (`sd`).

## Scenario and helper code

### `spikeLib.js`

```js
'use strict';
// Spike helpers (not shipped): a Wayland test client host, virtual input, event capture.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const now = () => GLib.get_monotonic_time();
export const ms = (us) => Math.round(us / 100) / 10; // 0.1ms resolution
const BUTTONS = Clutter.ModifierType.BUTTON1_MASK | Clutter.ModifierType.BUTTON2_MASK | Clutter.ModifierType.BUTTON3_MASK;
export const buttonHeld = () => (global.get_pointer()[2] & BUTTONS) !== 0;

export function sleep(msec) {
  return new Promise((resolve) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, msec, () => { resolve(); return GLib.SOURCE_REMOVE; }));
}

// One layer above everything in uiGroup (what fileDrops.js does for its windows)
export function makeLayer(name) {
  const layer = new Clutter.Actor({ name });
  layer.add_constraint(new Clutter.BindConstraint({ source: global.stage, coordinate: Clutter.BindCoordinate.ALL }));
  Main.uiGroup.add_child(layer);
  Main.uiGroup.set_child_above_sibling(layer, null);
  layer.connect('destroy', (l) => l.get_children().forEach((a) => { l.remove_child(a); global.window_group.add_child(a); }));
  return layer;
}

// A Wayland client run through Meta.WaylandClient; its stdout lines are JSON events.
export class Client {
  constructor(role, { layer = null, dock = false, rect = null, extDir, env = {} } = {}) {
    this.role = role;
    this.events = [];
    this.waiters = [];
    this.layer = layer;
    this.dock = dock;
    this.rect = rect; // [x,y,w,h] to move_resize_frame into when shown
    this.window = null;
    this.windowEvents = [];
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE });
    for (const [k, v] of Object.entries(env)) launcher.setenv(k, v, true);
    const gjs = GLib.find_program_in_path('gjs') ?? '/usr/bin/gjs';
    this.client = Meta.WaylandClient.new_subprocess(global.context, launcher, [gjs, '-m', `${extDir}/apps/client.js`, role]);
    this.proc = this.client.get_subprocess();
    this.stdin = this.proc.get_stdin_pipe();
    this._read(new Gio.DataInputStream({ base_stream: this.proc.get_stdout_pipe() }));
    global.display.connectObject('window-created', (_d, w) => this._onWindow(w), this);
  }

  _read(stream) {
    stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (s, res) => {
      let line;
      try { [line] = s.read_line_finish_utf8(res); } catch { return; }
      if (line === null) return;
      try {
        const e = JSON.parse(line);
        e.rt = now(); // when the Shell read it
        this._push(e);
      } catch (err) { console.log(`client ${this.role} garbage: ${line}`); }
      this._read(s);
    });
  }

  _push(e) {
    this.events.push(e);
    this.waiters = this.waiters.filter((w) => { if (w.pred(e)) { w.resolve(e); return false; } return true; });
  }

  _onWindow(window) {
    const owns = this.client.owns_window(window);
    console.log(`SPIKE window-created for ${this.role}: owns=${owns} title=${window.title}`);
    this.seen = (this.seen ?? 0) + 1;
    if (!owns) return;
    this.window = window;
    this._push({ ev: 'w-created', t: now(), role: this.role });
    if (this.dock) { window.set_type(Meta.WindowType.DOCK); window.hide_from_window_list(); window.stick(); }
    const place = () => {
      this._push({ ev: 'w-shown', t: now(), role: this.role });
      if (this.rect) window.move_resize_frame(false, ...this.rect);
      const actor = window.get_compositor_private();
      const parent = actor?.get_parent();
      if (this.layer && parent && parent !== this.layer) { parent.remove_child(actor); this.layer.add_child(actor); }
    };
    window.connectObject('shown', place, 'unmanaged', () => this._push({ ev: 'w-unmanaged', t: now(), role: this.role }), this);
    if (this.rect) window.move_resize_frame(false, ...this.rect);
  }

  send(line) { this.stdin.write_all(new TextEncoder().encode(`${line}\n`), null); }

  // resolves with the first event (past or future if sinceT is given) matching pred, or null on timeout
  when(pred, timeoutMs = 1000, sinceT = 0) {
    const old = this.events.find((e) => e.t >= sinceT && pred(e));
    if (old) return Promise.resolve(old);
    return new Promise((resolve) => {
      const w = { pred: (e) => e.t >= sinceT && pred(e), resolve };
      this.waiters.push(w);
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
        if (this.waiters.includes(w)) { this.waiters = this.waiters.filter((x) => x !== w); resolve(null); }
        return GLib.SOURCE_REMOVE;
      });
    });
  }
  evs(name, sinceT = 0) { return this.events.filter((e) => e.ev === name && e.t >= sinceT); }
  summary(sinceT = 0, skip = ['cmd']) {
    return this.events.filter((e) => e.t >= sinceT && !skip.includes(e.ev)).map((e) => {
      const { role, rt, ...rest } = e;
      return { ...rest, t: ms(e.t - sinceT) };
    });
  }
  async stop() {
    try { this.send('quit'); } catch { /* gone */ }
    await sleep(200);
    this.window?.disconnectObject(this);
    global.display.disconnectObject(this);
    try { this.proc.force_exit(); } catch { /* gone */ }
  }
}

// Virtual pointer(s) and keyboard
export function virtualInput() {
  const seat = global.stage.context.get_backend().get_default_seat();
  const mk = (t) => seat.create_virtual_device(t);
  const vp = mk(Clutter.InputDeviceType.POINTER_DEVICE);
  const vp2 = mk(Clutter.InputDeviceType.POINTER_DEVICE);
  const kb = mk(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  return {
    vp, vp2, kb,
    move: (x, y, dev = vp) => dev.notify_absolute_motion(now(), x, y),
    press: (b = Clutter.BUTTON_PRIMARY, dev = vp) => dev.notify_button(now(), b, Clutter.ButtonState.PRESSED),
    release: (b = Clutter.BUTTON_PRIMARY, dev = vp) => dev.notify_button(now(), b, Clutter.ButtonState.RELEASED),
    key: (sym) => { kb.notify_keyval(now(), sym, Clutter.KeyState.PRESSED); kb.notify_keyval(now(), sym, Clutter.KeyState.RELEASED); },
  };
}

// Log every pointer button / enter / leave the stage sees, with the source device and target actor
export function captureStage(log) {
  const id = global.stage.connect('captured-event', (_s, evt) => {
    const type = evt.type();
    const T = Clutter.EventType;
    log.types = log.types ?? {};
    const tn = Object.keys(T).find((k) => T[k] === type);
    log.types[tn] = (log.types[tn] ?? 0) + 1;
    if (![T.BUTTON_PRESS, T.BUTTON_RELEASE, T.ENTER, T.LEAVE].includes(type)) return Clutter.EVENT_PROPAGATE;
    const actor = global.stage.get_event_actor(evt);
    log.push({
      t: now(),
      type: Object.keys(T).find((k) => T[k] === type),
      dev: evt.get_source_device()?.get_device_name?.() ?? null,
      actor: actor ? `${actor.constructor.name}:${actor.name ?? ''}` : null,
    });
    return Clutter.EVENT_PROPAGATE;
  });
  return () => global.stage.disconnect(id);
}

export function captureDnd(log) {
  const dnd = global.backend.get_dnd();
  const ids = ['dnd-enter', 'dnd-position-change', 'dnd-leave'].map((n) => {
    let last = 0;
    return dnd.connect(n, (_d, x, y) => {
      if (n === 'dnd-position-change') { if (now() - last < 150000) return; last = now(); }
      log.push({ t: now(), ev: n, x, y });
    });
  });
  return () => ids.forEach((i) => dnd.disconnect(i));
}

export function say(h, rec) { h.say({ scenario: 'dragout', ...rec }); }
```

### `apps/client.js` (the GTK4 helper: source and sink roles)

```js
// Spike client (not shipped): one gjs/GTK4 Wayland client playing two roles.
//   gjs -m client.js sink     window 300x200 with a Gtk.DropTargetAsync; logs pointer + drop events
//   gjs -m client.js source   96x96 undecorated window; on pointer press starts a real drag
// stdout: one JSON object per line, {ev, t(monotonic us, same clock as the Shell), ...}
// stdin lines: "arm <mode> <icon-png> <uri>..." (source), "hide", "show", "quit"
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

Gtk.init();
const role = System.programArgs[0] ?? 'sink';
const out = new Gio.DataOutputStream({ base_stream: new GioUnix.OutputStream({ fd: 1, close_fd: false }) });
const now = () => GLib.get_monotonic_time();
function send(obj) {
  out.put_string(`${JSON.stringify({ t: now(), role, ...obj })}\n`, null);
  out.flush(null);
}
const URI_LIST = 'text/uri-list';
const ACTIONS = Gdk.DragAction.COPY | Gdk.DragAction.MOVE;

const win = new Gtk.Window({ title: `spike-${role}`, decorated: false, resizable: role === 'source' });
win.set_default_size(role === 'sink' ? 300 : 96, role === 'sink' ? 200 : 96);

// ---- pointer logging (both roles)
const motion = new Gtk.EventControllerMotion();
let lastMotion = 0;
motion.connect('enter', (_c, x, y) => send({ ev: 'enter', x, y }));
motion.connect('leave', () => send({ ev: 'leave' }));
motion.connect('motion', (_c, x, y) => {
  if (now() - lastMotion > 200000) { lastMotion = now(); send({ ev: 'motion', x, y }); }
});
win.add_controller(motion);
const click = new Gtk.GestureClick({ button: 0 });
click.connect('pressed', (g, n, x, y) => {
  send({ ev: 'pressed', button: g.get_current_button(), x, y });
  if (role === 'source') onSourcePress(g, x, y);
});
click.connect('released', (g, n, x, y) => send({ ev: 'released', button: g.get_current_button(), x, y }));
win.add_controller(click);
const keys = new Gtk.EventControllerKey();
keys.connect('key-pressed', (_c, keyval) => { send({ ev: 'key', keyval }); return false; });
win.add_controller(keys);
win.connect('map', () => send({ ev: 'map' }));
win.connect('notify::is-active', () => send({ ev: 'active', active: win.active }));

// ---- sink
function readUris(drop) {
  return new Promise((resolve, reject) => {
    drop.read_async([URI_LIST], GLib.PRIORITY_DEFAULT, null, (d, res) => {
      try {
        const [stream] = d.read_finish(res);
        const mem = Gio.MemoryOutputStream.new_resizable();
        mem.splice_async(stream, Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET, GLib.PRIORITY_DEFAULT, null, (o, r) => {
          try {
            o.splice_finish(r);
            resolve(new TextDecoder().decode(o.steal_as_bytes().toArray()).split(/\r?\n/).filter((l) => l && !l.startsWith('#')));
          } catch (e) { reject(e); }
        });
      } catch (e) { reject(e); }
    });
  });
}
if (role === 'sink') {
  const label = new Gtk.Label({ label: 'SINK' });
  const target = new Gtk.DropTargetAsync({
    actions: ACTIONS,
    formats: Gdk.ContentFormats.new([URI_LIST]).union(Gdk.ContentFormats.new_for_gtype(Gdk.FileList.$gtype)),
  });
  target.connect('drag-enter', (_t, drop, x, y) => { send({ ev: 'drag-enter', x, y, formats: drop.get_formats().to_string(), actions: drop.get_actions() }); drop.status(Gdk.DragAction.COPY, Gdk.DragAction.COPY); return Gdk.DragAction.COPY; });
  target.connect('drag-motion', (_t, drop) => { drop.status(Gdk.DragAction.COPY, Gdk.DragAction.COPY); return Gdk.DragAction.COPY; });
  target.connect('drag-leave', () => send({ ev: 'drag-leave' }));
  target.connect('drop', (_t, drop, x, y) => {
    send({ ev: 'drop', x, y });
    readUris(drop).then((uris) => { drop.finish(Gdk.DragAction.COPY); send({ ev: 'drop-data', uris }); })
      .catch((e) => { drop.finish(0); send({ ev: 'drop-error', error: e.message }); });
    return true;
  });
  label.add_controller(target);
  win.set_child(label);
}

// ---- source
let armed = null; // {mode, icon, uris}
let dragSource = null;
const picture = new Gtk.Picture({ can_shrink: true, halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER, width_request: 96, height_request: 96 });
function content(uris) {
  const text = `${uris.join('\r\n')}\r\n`;
  const providers = [Gdk.ContentProvider.new_for_bytes(URI_LIST, new GLib.Bytes(new TextEncoder().encode(text)))];
  if (!GLib.getenv('SPIKE_NO_FILELIST')) {
    const v = new GObject.Value();
    v.init(Gdk.FileList.$gtype);
    v.set_boxed(Gdk.FileList.new_from_array(uris.map((u) => Gio.File.new_for_uri(u))));
    providers.push(Gdk.ContentProvider.new_for_value(v));
  }
  return Gdk.ContentProvider.new_union(providers);
}
function iconTexture(path) { try { return Gdk.Texture.new_from_filename(path); } catch { return null; } }
function hookDrag(drag) {
  drag.connect('cancel', (_d, reason) => send({ ev: 'drag-cancel', reason: reason }));
  drag.connect('drop-performed', () => send({ ev: 'drag-drop-performed' }));
  drag.connect('dnd-finished', () => { send({ ev: 'drag-finished', action: drag.get_selected_action() }); if (armed?.hideOnDrag) win.set_visible(false); });
  drag.connect('notify::selected-action', () => send({ ev: 'drag-action', action: drag.get_selected_action() }));
}
function onSourcePress(g, x, y) {
  if (!armed || armed.mode !== 'direct') return;
  const event = g.get_current_event();
  const device = event.get_device();
  const surface = win.get_surface();
  const t0 = now();
  let drag = null;
  try {
    drag = Gdk.Drag.begin(surface, device, content(armed.uris), ACTIONS, x, y);
  } catch (e) { send({ ev: 'drag-begin-error', error: e.message }); return; }
  send({ ev: 'drag-begin', mode: 'direct', ok: !!drag, us: now() - t0 });
  if (!drag) return;
  hookDrag(drag);
  const tex = iconTexture(armed.icon);
  if (tex) Gtk.DragIcon.set_from_paintable(drag, tex, 48, 48);
  if (armed.hideOnDrag) GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => { win.set_visible(false); send({ ev: 'hidden-after-drag-begin' }); return GLib.SOURCE_REMOVE; });
}
function arm(mode, icon, uris, hideOnDrag) {
  armed = { mode, icon, uris, hideOnDrag };
  const tex = iconTexture(icon);
  if (tex) picture.set_paintable(tex);
  if (dragSource) { win.remove_controller(dragSource); dragSource = null; }
  if (mode === 'gtk') {
    // GTK's own drag starts after the drag threshold of motion with the button held
    dragSource = new Gtk.DragSource({ actions: ACTIONS, button: 0 });
    dragSource.connect('prepare', () => { send({ ev: 'prepare' }); return content(uris); });
    dragSource.connect('drag-begin', (_s, drag) => {
      send({ ev: 'drag-begin', mode: 'gtk', ok: true });
      hookDrag(drag);
      if (tex) dragSource.set_icon(tex, 48, 48);
      if (hideOnDrag) GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => { win.set_visible(false); send({ ev: 'hidden-after-drag-begin' }); return GLib.SOURCE_REMOVE; });
    });
    dragSource.connect('drag-cancel', (_s, _d, reason) => { send({ ev: 'gtk-drag-cancel', reason }); return false; });
    dragSource.connect('drag-end', (_s, _d, del) => send({ ev: 'gtk-drag-end', deleteData: del }));
    win.add_controller(dragSource);
  }
}
if (role === 'source') win.set_child(picture);

// ---- command channel
const loop = new GLib.MainLoop(null, false);
const stdin = new Gio.DataInputStream({ base_stream: new GioUnix.InputStream({ fd: 0, close_fd: false }) });
function readCommand() {
  stdin.read_line_async(GLib.PRIORITY_DEFAULT, null, (s, res) => {
    let line = null;
    try { [line] = s.read_line_finish_utf8(res); } catch { /* EOF */ }
    if (line === null) { loop.quit(); return; }
    const [cmd, ...args] = line.trim().split(' ');
    send({ ev: 'cmd', cmd });
    if (cmd === 'arm') { const [mode, icon, hide, ...uris] = args; arm(mode, icon, uris, hide === '1'); }
    else if (cmd === 'show') win.present();
    else if (cmd === 'hide') win.set_visible(false);
    else if (cmd === 'quit') { loop.quit(); return; }
    readCommand();
  });
}
readCommand();
send({ ev: 'ready' });
if (role === 'sink' || GLib.getenv('SPIKE_SHOW_ON_START')) win.present();
loop.run();
```

### `dragoutProbe.js` (the scenario: `e0`, `trial()`, `handoff()`, `moveAndDrop()`, `altA`, `shellDnd`, `real`)

```js
'use strict';
// Spike scenario "dragout" (not shipped). Experiments chosen by D2DA_EXPS (comma list).
// Trials: D2DA_TRIALS='{"name":[{opts},{opts}]}' defines experiment "name" as a list of handoff trials.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { pointerFor } from './stackScenarios.js';
import { Client, buttonHeld, captureDnd, captureStage, makeLayer, ms, now, sleep, virtualInput } from './spikeLib.js';

const S = 'dragout';
const HOME = GLib.getenv('HOME');
const ICON = GLib.getenv('SPIKE_ICON');
const SRC = `${HOME}/dragsrc`;
const SINK_RECT = [650, 120, 300, 200];
const SINK_C = [800, 220];
const POP = { x: 150, y: 250 };
const ITEM_C = [POP.x + 20 + 48, POP.y + 20 + 48];

function jsonEnv(name, dflt) {
  try { return JSON.parse(GLib.getenv(name)) ?? dflt; } catch { return dflt; }
}

function makeFiles(tag) {
  GLib.mkdir_with_parents(SRC, 0o755);
  return ['a', 'b'].map((n) => {
    const p = `${SRC}/${tag}-${n}.txt`;
    Gio.File.new_for_path(p).replace_contents(new TextEncoder().encode(`spike ${tag} ${n}\n`), null, false, Gio.FileCreateFlags.NONE, null);
    return Gio.File.new_for_path(p).get_uri();
  });
}

// a stand-in for the stack dropdown: full-monitor reactive backdrop under a modal grab, a popover and one item
function makePopover(log) {
  const backdrop = new St.Widget({ name: 'spikeBackdrop', reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height });
  const popover = new St.Widget({ name: 'spikePopover', reactive: true, x: POP.x, y: POP.y, width: 300, height: 300, style: 'background-color: rgba(40,40,90,0.95);' });
  const item = new St.Widget({ name: 'spikeItem', reactive: true, x: 20, y: 20, width: 96, height: 96, style: 'background-color: #c60;' });
  backdrop.add_child(popover);
  popover.add_child(item);
  Main.uiGroup.add_child(backdrop);
  if (log) for (const sig of ['button-press-event', 'button-release-event']) backdrop.connect(sig, (_a, evt) => { log.push({ t: now(), type: sig, dev: evt.get_source_device()?.get_device_name?.() ?? null, actor: `${global.stage.get_event_actor(evt)?.name}` }); return Clutter.EVENT_PROPAGATE; });
  const grab = Main.pushModal(backdrop);
  backdrop.grab_key_focus();
  return {
    backdrop, popover, item, grab, popped: false,
    pop() { if (!this.popped) { Main.popModal(this.grab); this.popped = true; } },
    destroy() { this.pop(); this.backdrop.destroy(); },
  };
}

const rectOf = (w) => { const r = w?.get_frame_rect(); return r ? [r.x, r.y, r.width, r.height] : null; };

export async function dragoutScenario(ext, h) {
  const dock = ext.docks?.[0];
  if (!dock) return h.check(S, 'a dock exists', false);
  const rec = (r) => h.say({ scenario: S, ...r });
  new Gio.Settings({ schema_id: 'org.gnome.shell' }).set_strv('favorite-apps', ['d2da-visual-terminal.desktop', 'd2da-visual-files.desktop']);
  await h.closeOverview();
  await sleep(3000);
  const extDir = ext.path;
  const input = virtualInput();
  const layer = makeLayer('spikeLayer');
  const exps = (GLib.getenv('D2DA_EXPS') ?? 'e0').split(',');
  const d = pointerFor(dock, h);
  const stageLog = [];
  const dndLog = [];
  const stopStage = captureStage(stageLog);
  const stopDnd = captureDnd(dndLog);

  const sink = new Client('sink', { rect: SINK_RECT, extDir });
  await sink.when((e) => e.ev === 'map', 5000);
  await sleep(300);
  rec({ step: 'sink-ready', mapped: !!sink.window, rect: rectOf(sink.window), type: sink.window?.get_window_type() });

  const ctx = { ext, dock, h, rec, input, layer, stageLog, dndLog, sink, extDir, d };
  for (const e of exps) {
    const fn = EXPERIMENTS[e];
    if (!fn) { rec({ step: 'unknown-exp', e }); continue; }
    rec({ step: 'EXP-START', exp: e });
    try { await fn(ctx); } catch (err) { rec({ step: 'EXP-ERROR', exp: e, error: String(err), stack: err.stack }); }
    rec({ step: 'EXP-END', exp: e });
    input.release(Clutter.BUTTON_PRIMARY); input.release(Clutter.BUTTON_PRIMARY, input.vp2);
    input.move(5, 5); await sleep(300);
  }
  stopStage(); stopDnd();
  await sink.stop();
  await ctx.src?.stop();
  layer.destroy();
}

// ---------- e0: do Wayland clients get pointer events while a Shell modal is up?
async function e0(c) {
  const { sink, input, rec, stageLog } = c;
  const clickOnSink = async (label) => {
    const t0 = now(); stageLog.length = 0;
    input.move(...SINK_C); await sleep(150);
    input.press(); await sleep(60); input.release(); await sleep(150);
    input.move(5, 5); await sleep(150);
    rec({ step: 'e0-click', label, sink: sink.summary(t0), stage: stageLog.map((s) => `${s.type}@${s.actor}`), types: JSON.stringify(stageLog.types) });
  };
  await clickOnSink('no-modal');
  const pop = makePopover(stageLog);
  await sleep(300);
  rec({ step: 'e0-modal-up', modalCount: Main.modalCount });
  await clickOnSink('modal-backdrop-full-stage');
  pop.destroy();
  // a modal whose actor is small and far away: does the client under the pointer still get events?
  const small = new St.Widget({ name: 'spikeSmall', reactive: true, x: 20, y: 600, width: 100, height: 100, style: 'background-color:#060;' });
  Main.uiGroup.add_child(small);
  for (const sig of ['button-press-event', 'button-release-event']) small.connect(sig, () => { stageLog.push({ t: now(), type: sig, actor: 'small' }); return Clutter.EVENT_PROPAGATE; });
  const grab = Main.pushModal(small);
  await sleep(300);
  await clickOnSink('modal-small-actor-elsewhere');
  Main.popModal(grab);
  small.destroy();
  await sleep(300);
  await clickOnSink('after-popModal');
}

// ---------- handoff trials
async function trial(c, o) {
  const { input, rec, stageLog, dndLog, sink, layer, extDir } = c;
  const uris = makeFiles(o.tag);
  if (!c.src) {
    c.src = new Client('source', { dock: !o.noDock, layer: o.noLayer ? null : layer, extDir, env: o.env ?? {} });
    if (o.prewarm === 'process') await sleep(1500);
    else if (o.prewarm) { c.src.rect = [900, 500, 96, 96]; c.src.send('show'); await c.src.when((e) => e.ev === 'w-shown', 3000); await sleep(300); c.src.send('hide'); await sleep(500); }
  }
  const src = c.src;
  const pop = makePopover(stageLog);
  await sleep(250);
  stageLog.length = 0; dndLog.length = 0;
  if (o.verbose) for (const tp of o.verbose) Meta.add_verbose_topic(Meta.DebugTopic[tp]);
  const T0 = now();
  const R = { tag: o.tag };
  // "physical" device: vp. injected device: vp2 (dual) or vp (single)
  const inj = o.devices === 'dual' ? input.vp2 : input.vp;
  src.send(`arm ${o.mode} ${ICON} ${o.hide ? 1 : 0} ${uris.join(' ')}`);
  await sleep(120);
  input.move(...ITEM_C); await sleep(120);
  input.press(); await sleep(80);
  R.heldAfterPress = buttonHeld();
  // the item's own motion handler (a real Clutter handler under the modal grab) triggers the handoff
  let handoffStarted = false;
  const done = new Promise((resolve) => {
    let sx = null;
    pop.item.connect('motion-event', (_a, evt) => {
      const [x, y] = evt.get_coords();
      if (sx === null) { sx = [x, y]; return Clutter.EVENT_PROPAGATE; }
      if (!handoffStarted && Math.hypot(x - sx[0], y - sx[1]) >= 8) {
        handoffStarted = true;
        R.threshold = [x, y];
        handoff(c, o, pop, src, inj, R).then(resolve);
      }
      return Clutter.EVENT_PROPAGATE;
    });
  });
  for (let i = 1; i <= 6; i++) { input.move(ITEM_C[0] + i * 3, ITEM_C[1]); await sleep(16); }
  const res = await Promise.race([done, sleep(4000).then(() => 'timeout')]);
  rec({ step: 'handoff-done', R, result: res === R ? 'R' : res });
  if (o.drop && !R.abort && res !== 'timeout') await moveAndDrop(c, o, R, src, T0);
  await sleep(500);
  if (o.verbose) for (const tp of o.verbose) Meta.remove_verbose_topic(Meta.DebugTopic[tp]);
  rec({
    step: 'trial-end', tag: o.tag, R,
    src: src.summary(T0), sink: sink.summary(T0),
    stage: stageLog.map((s) => `${ms(s.t - T0)} ${s.type} ${s.dev} @${s.actor}`),
    dnd: dndLog.map((s) => `${ms(s.t - T0)} ${s.ev} ${s.x ?? ''},${s.y ?? ''}`),
    files: dirList(),
  });
  if (buttonHeld()) { input.release(); input.release(Clutter.BUTTON_PRIMARY, input.vp2); }
  await sleep(100);
  pop.destroy();
  src.send('hide');
  await sleep(300);
}

function dirList() {
  const r = {};
  for (const dir of [SRC, `${HOME}/Downloads`, `${GLib.getenv('XDG_DATA_HOME')}/Trash/files`]) {
    try {
      const it = Gio.File.new_for_path(dir).enumerate_children('standard::name', 0, null);
      const k = dir.replace(HOME, '~').replace(GLib.getenv('XDG_DATA_HOME'), '$XDG_DATA_HOME');
      r[k] = [];
      let i;
      while ((i = it.next_file(null))) r[k].push(i.get_name());
    } catch { /* none */ }
  }
  return r;
}

async function handoff(c, o, pop, src, inj, R) {
  const { input } = c;
  const t0 = now();
  const t = {};
  const at = (k) => { t[k] = ms(now() - t0); };
  R.t = t;
  R.heldAtThreshold = buttonHeld();
  const [px, py] = global.get_pointer();
  R.pointer = [px, py];
  // 2. release every Shell grab
  if (o.popModal !== false) pop.pop();
  if (o.closeBackdrop !== false) { pop.backdrop.reactive = false; pop.popover.reactive = false; pop.item.reactive = false; }
  Main.uiGroup.set_child_above_sibling(c.layer, null); // above the backdrop that was added after the layer
  at('popModal');
  // 3. map the helper window under the pointer
  const half = (o.winSize ?? 96) / 2;
  src.rect = [px - half, py - half, 2 * half, 2 * half];
  src.send('show');
  if (o.earlyRelease === 'map') GLib.timeout_add(GLib.PRIORITY_DEFAULT, o.earlyReleaseMs ?? 5, () => { input.release(); R.earlyReleased = now() - t0; return GLib.SOURCE_REMOVE; });
  const shownEv = await src.when((e) => e.ev === 'w-shown' || e.ev === 'enter', 3000, t0);
  at('windowShownOrEnter');
  R.mapped = !!shownEv;
  R.windowRect = rectOf(src.window);
  if (!buttonHeld()) { R.abort = 'button released during map'; src.send('hide'); return R; }
  let enter = await src.when((e) => e.ev === 'enter', o.noWaitEnter ? 1 : 300, t0);
  at('enterWaited');
  R.enterWithoutNudge = !!enter;
  if (!enter && o.nudge !== 'none') {
    const tn = now();
    input.move(px, py);
    enter = await src.when((e) => e.ev === 'enter', 300, tn);
    at('enterAfterNudge');
    R.enterAfterNudge = !!enter;
    if (!enter) {
      input.move(px + 1, py);
      enter = await src.when((e) => e.ev === 'enter', 300, tn);
      at('enterAfterNudge1px');
      R.enterAfterNudge1px = !!enter;
    }
  }
  R.enterT = enter ? ms(enter.t - t0) : null;
  for (const [k, ev] of [['clientMap', 'map'], ['windowCreated', 'w-created'], ['windowShown', 'w-shown']]) {
    const e = src.events.find((x) => x.ev === ev && x.t >= t0);
    t[k] = e ? ms(e.t - t0) : null;
  }
  if (!buttonHeld()) { R.abort = 'button released before inject'; src.send('hide'); return R; }
  // 4. inject the press that gives the helper a pointer serial. injButton 1 = release+press of the SAME button
  //    the user holds (needs the held button to be virtual); another button = press of an extra button, the held
  //    one stays down.
  if (o.settle) await sleep(o.settle);
  const ti = now();
  const ib = o.injButton ?? 1;
  if (ib === 1 && !o.noRelease) input.release(Clutter.BUTTON_PRIMARY, inj);
  if (o.relPressGap) await sleep(o.relPressGap);
  input.press(ib, inj);
  at('injected');
  let begin = await src.when((e) => e.ev === 'drag-begin' || e.ev === 'drag-begin-error', o.mode === 'direct' ? 500 : 60, ti);
  if (!begin && o.mode === 'gtk') {
    // GTK starts its drag after the drag threshold of motion with the button held
    for (let i = 1; i <= 6 && !begin; i++) { input.move(px + i * 3, py, inj); begin = await src.when((e) => e.ev === 'drag-begin', 60, ti); }
  }
  at('dragBegin');
  if (ib !== 1 && o.injRelease !== 'never') { if (o.injReleaseGap) await sleep(o.injReleaseGap); input.release(ib, inj); R.injReleasedAfterBegin = true; }
  if (o.retry) {
    await sleep(80);
    R.dndEnterAfterFirst = c.dndLog.some((e) => e.ev === 'dnd-enter');
    if (!R.dndEnterAfterFirst) {
      const tr = now();
      input.release(ib, inj);
      await sleep(50);
      input.press(o.retryButton ?? 9, inj);
      R.retryBegin = !!(await src.when((e) => e.ev === 'drag-begin', 300, tr));
      await sleep(80);
      R.dndEnterAfterRetry = c.dndLog.some((e) => e.ev === 'dnd-enter');
      o.injButton = o.retryButton ?? 9;
    }
  }
  R.dragBegin = begin ? { ev: begin.ev, ok: begin.ok, error: begin.error, us: begin.us, afterInjectMs: ms(begin.t - ti) } : null;
  R.pressReachedClient = !!src.events.find((e) => e.ev === 'pressed' && e.t >= ti);
  return R;
}

async function moveAndDrop(c, o, R, src, T0) {
  const { input, sink, dock, d } = c;
  if (o.moveDelay) await sleep(o.moveDelay);
  let [x, y] = global.get_pointer();
  const step = async (X, Y) => {
    const n = 12;
    for (let i = 1; i <= n; i++) { input.move(x + ((X - x) * i) / n, y + ((Y - y) * i) / n); await sleep(20); }
    [x, y] = [X, Y];
  };
  if (o.drop === 'dock') {
    const item = o.dockItem === 'trash' ? dock._trashIcon : dock._folderIcons.get('downloads');
    let [tx, ty] = d.centreOf(item);
    await step(tx, ty - 120);
    for (let i = 0; i < 3; i++) {
      [tx, ty] = d.centreOf(item);
      input.move(tx, ty);
      for (let k = 0; k < 10; k++) { dock.animate?.(16); await sleep(24); }
    }
    [x, y] = [tx, ty];
    R.dockTarget = [tx, ty];
    R.hovered = dock._hoveredIcon?.constructor?.name;
    R.hoveredIsTarget = dock._hoveredIcon === item;
  } else if (o.drop === 'sink') {
    await step(...SINK_C);
  } else {
    await step(x + 40, y - 40);
  }
  if (o.escape) {
    input.key(Clutter.KEY_Escape);
    await sleep(300);
    R.escapeSent = true;
  }
  await sleep(200);
  const tr = now();
  R.releaseHeldBefore = buttonHeld();
  input.release(Clutter.BUTTON_PRIMARY, input.vp); // the physical release (vp holds the user's press)
  await sleep(50);
  R.releaseHeldAfter = buttonHeld();
  if ((o.injButton ?? 1) !== 1 && o.injRelease === 'never') { await sleep(100); input.release(o.injButton, o.devices === 'dual' ? input.vp2 : input.vp); R.injReleasedAfterDrop = true; }
  await sink.when((e) => e.ev === 'drop-data' || e.ev === 'drop-error', 1200, tr);
  await sleep(800);
}

const EXPERIMENTS = { e0 };
for (const [name, opts] of Object.entries(jsonEnv('D2DA_TRIALS', {}))) {
  EXPERIMENTS[name] = async (c) => {
    for (const [i, o] of (Array.isArray(opts) ? opts : [opts]).entries()) {
      await trial(c, { tag: `${name}${i}`, devices: 'single', mode: 'direct', nudge: 'auto', hide: false, ...o });
    }
  };
}

// ---------- alternative (a): the helper surface is mapped BEFORE the press, over the item, popover not modal
async function altA(c) {
  const { input, rec, stageLog, dndLog, sink, layer, extDir } = c;
  for (const o of [{ tag: 'a-direct', mode: 'direct', modal: false }, { tag: 'a-gtk', mode: 'gtk', modal: false }, { tag: 'a-modal-direct', mode: 'direct', modal: true }]) {
    const uris = makeFiles(o.tag);
    if (!c.src) c.src = new Client('source', { dock: true, layer, extDir });
    const src = c.src;
    // popover without a modal grab (unless o.modal): backdrop + popover + item
    const backdrop = new St.Widget({ name: 'spikeBackdrop', reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height });
    const popover = new St.Widget({ name: 'spikePopover', reactive: true, x: POP.x, y: POP.y, width: 300, height: 300, style: 'background-color: rgba(40,40,90,0.95);' });
    const item = new St.Widget({ name: 'spikeItem', reactive: true, x: 20, y: 20, width: 96, height: 96, style: 'background-color: #c60;' });
    backdrop.add_child(popover); popover.add_child(item);
    Main.uiGroup.add_child(backdrop);
    const shellLog = [];
    for (const sig of ['button-press-event', 'button-release-event', 'enter-event', 'motion-event']) item.connect(sig, () => { shellLog.push(sig); return Clutter.EVENT_PROPAGATE; });
    const grab = o.modal ? Main.pushModal(backdrop) : null;
    Main.uiGroup.set_child_above_sibling(layer, null);
    await sleep(200);
    stageLog.length = 0; dndLog.length = 0;
    const T0 = now();
    src.send(`arm ${o.mode} ${ICON} 0 ${uris.join(' ')}`);
    src.rect = [ITEM_C[0] - 48, ITEM_C[1] - 48, 96, 96];
    input.move(5, 5); await sleep(100);
    src.send('show');
    await src.when((e) => e.ev === 'w-shown', 3000, T0);
    await sleep(200);
    input.move(...ITEM_C); await sleep(150);
    const enter = src.events.find((e) => e.ev === 'enter' && e.t >= T0);
    input.press(); await sleep(60);
    for (let i = 1; i <= 8; i++) { input.move(ITEM_C[0] + i * 3, ITEM_C[1]); await sleep(16); }
    await sleep(100);
    const R = { tag: o.tag, modal: o.modal, clientEnter: !!enter, shellEventsOnItem: [...shellLog], dragBegun: !!src.events.find((e) => e.ev === 'drag-begin' && e.t >= T0), dndEnter: dndLog.some((e) => e.ev === 'dnd-enter') };
    if (R.dndEnter) {
      backdrop.reactive = false; popover.reactive = false; // else the backdrop sits over the sink
      let [x, y] = global.get_pointer();
      for (let i = 1; i <= 12; i++) { input.move(x + ((SINK_C[0] - x) * i) / 12, y + ((SINK_C[1] - y) * i) / 12); await sleep(20); }
      await sleep(200);
    }
    const tr = now();
    input.release();
    await sink.when((e) => e.ev === 'drop-data', 1200, tr);
    await sleep(500);
    rec({ step: 'altA', R, src: src.summary(T0), sink: sink.summary(T0), dnd: dndLog.map((s) => `${ms(s.t - T0)} ${s.ev}`), stage: stageLog.map((s) => `${ms(s.t - T0)} ${s.type} @${s.actor}`) });
    src.send('hide'); await sleep(300);
    if (grab) Main.popModal(grab);
    backdrop.destroy();
    input.move(5, 5); await sleep(200);
  }
}
EXPERIMENTS.altA = altA;

// ---------- F: the Shell's own imports.ui.dnd (makeDraggable) with a Wayland client surface under the pointer
async function shellDnd(c) {
  const { input, rec, sink, stageLog } = c;
  const DND = await import('resource:///org/gnome/shell/ui/dnd.js');
  const actor = new St.Widget({ name: 'spikeDraggable', reactive: true, x: 100, y: 500, width: 80, height: 80, style: 'background-color:#a0a;' });
  actor._delegate = { getDragActor: () => new St.Widget({ width: 60, height: 60, style: 'background-color:#fa0;' }), getDragActorSource: () => actor, handleDragOver: () => DND.DragMotionResult.CONTINUE, acceptDrop: () => false };
  Main.uiGroup.add_child(actor);
  const draggable = DND.makeDraggable(actor, { manualMode: false });
  const events = [];
  draggable.connect('drag-begin', () => events.push('drag-begin'));
  draggable.connect('drag-end', () => events.push('drag-end'));
  draggable.connect('drag-cancelled', () => events.push('drag-cancelled'));
  const targets = new Map();
  DND.addDragMonitor({ dragMotion: (e) => { const k = `${e.targetActor?.constructor?.name}:${e.targetActor?.name ?? ''}`; targets.set(k, (targets.get(k) ?? 0) + 1); return DND.DragMotionResult.CONTINUE; } });
  c.layer.hide();
  const T0 = now();
  input.move(140, 540); await sleep(150);
  input.press(); await sleep(60);
  for (let i = 1; i <= 8; i++) { input.move(140 + i * 10, 540 - i * 5); await sleep(20); }
  rec({ step: 'shellDnd-started', events: [...events], modalCount: Main.modalCount, dragging: DND.isDragging?.() ?? null });
  let [x, y] = global.get_pointer();
  for (let i = 1; i <= 20; i++) { input.move(x + ((SINK_C[0] - x) * i) / 20, y + ((SINK_C[1] - y) * i) / 20); await sleep(25); }
  await sleep(300);
  rec({ step: 'shellDnd-over-sink', targets: Object.fromEntries(targets), sink: sink.summary(T0), pointer: global.get_pointer().slice(0, 2) });
  input.release(); await sleep(500);
  rec({ step: 'shellDnd-end', events, sink: sink.summary(T0), targets: Object.fromEntries(targets) });
  actor.destroy();
  c.layer.show();
}
EXPERIMENTS.shellDnd = shellDnd;

// ---------- real: the actual hyperdock StackPanel (real pushModal backdrop, real St.Button cells), handoff to the helper
function collectOf(actor, type, out = []) {
  if (actor instanceof type) out.push(actor);
  actor.get_children().forEach((c) => collectOf(c, type, out));
  return out;
}
async function realPanel(c) {
  const { input, rec, stageLog, dndLog, sink, layer, extDir, dock, d, ext } = c;
  const variants = jsonEnv('D2DA_REAL', [{ tag: 'real-sink', drop: 'sink' }, { tag: 'real-dock', drop: 'dock', dockItem: 'downloads' }]);
  const shotsDir = `${HOME}/Pictures/Screenshots`;
  ext._settings.set_string('folder-stacks', JSON.stringify([{ path: shotsDir, icon: 'folder-pictures', view: 'grid', sort: 'date-added', display: 'stack', group: 'none' }]));
  await sleep(3000);
  for (const v of variants) {
    const o = { devices: 'dual', mode: 'direct', injButton: 9, injRelease: 'never', winSize: 160, ...v };
    const item = [...dock._folderIcons.values()].find((i) => i._folderStack?.path?.endsWith('Screenshots'));
    if (!item) { rec({ step: 'real-no-item' }); return; }
    await d.park();
    await d.clickOn(item._renderer ?? item);
    await sleep(900);
    const panel = dock._stackPanel;
    const cell = panel ? collectOf(panel._scroll, St.Button)[0] : null;
    if (!cell) { rec({ step: 'real-no-cell', hasPanel: !!panel }); return; }
    const name = collectOf(cell, St.Label)[0]?.text;
    const uri = Gio.File.new_for_path(`${shotsDir}/${name}`).get_uri();
    if (!c.src) {
      c.src = new Client('source', { dock: true, layer, extDir });
      c.src.rect = [900, 500, 96, 96]; c.src.send('show'); await c.src.when((e) => e.ev === 'w-shown', 3000); await sleep(300); c.src.send('hide'); await sleep(500);
    }
    const src = c.src;
    src.send(`arm ${o.mode} ${ICON} 0 ${uri}`);
    await sleep(150);
    stageLog.length = 0; dndLog.length = 0;
    const T0 = now();
    const R = { tag: o.tag, name, uri, panelGrabbed: !!panel._grab, modalCount: Main.modalCount };
    const [cx, cy] = d.centreOf(cell);
    const inj = input.vp2;
    input.move(cx, cy); await sleep(150);
    input.press(); await sleep(80);
    let started = false;
    const pop = { pop() { panel.close(); }, backdrop: panel, popover: panel._popover, item: cell };
    const done = new Promise((resolve) => {
      let sx = null;
      cell.connect('motion-event', (_a, evt) => {
        const [x, y] = evt.get_coords();
        if (sx === null) { sx = [x, y]; return Clutter.EVENT_PROPAGATE; }
        if (!started && Math.hypot(x - sx[0], y - sx[1]) >= 8) { started = true; R.threshold = [x, y]; handoff(c, o, pop, src, inj, R).then(resolve); }
        return Clutter.EVENT_PROPAGATE;
      });
    });
    for (let i = 1; i <= 6; i++) { input.move(cx + i * 3, cy); await sleep(16); }
    const res = await Promise.race([done, sleep(4000).then(() => 'timeout')]);
    R.panelAfter = { stackPanel: !!dock._stackPanel, modalCount: Main.modalCount };
    if (res !== 'timeout' && !R.abort) await moveAndDrop(c, o, R, src, T0);
    await sleep(600);
    rec({ step: 'real-end', R, src: src.summary(T0), sink: sink.summary(T0), dnd: dndLog.map((s) => `${ms(s.t - T0)} ${s.ev}`), stage: stageLog.map((s) => `${ms(s.t - T0)} ${s.type} ${s.actor}`), files: dirList() });
    if (buttonHeld()) { input.release(); input.release(Clutter.BUTTON_PRIMARY, input.vp2); }
    src.send('hide'); await sleep(300);
    dock._destroyList?.(); dock._stackPanel?.close(); await sleep(800);
    await d.park();
  }
}
EXPERIMENTS.real = realPanel;
```
