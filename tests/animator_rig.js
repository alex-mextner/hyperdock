// Shared rig for the animator checks (not itself a check): loads the production
// animator.js under gjs with its Shell-only imports stubbed, and builds a fake dock
// the animator can run frames on. DockLayout, the animator's own sibling modules
// and the overlay follower are the real ones, so a frame exercises the production
// code path; only actors, the Shell and the timer are fakes.
//
// Every property write on a fake actor (and on the dock's own bookkeeping) is
// logged as "name.prop=value", so a scenario's digest pins what the animator did
// on every frame, not just where it ended.
import GLib from 'gi://GLib';

import { importWithStubs, REPO_ROOT } from './harness.js';
import { SEPARATOR_CLASS } from '../dockLayout.js';
import { TranslationFollower } from '../overlayFollow.js';

// the animator reads the stage pointer through the Shell global
globalThis.global = { get_pointer: () => [0, 0] };

// ---------------------------------------------------------------- fake actors
const log = [];
export const writes = {
  take() {
    return log.splice(0).join(';');
  },
};

// property writes to actors that were already destroyed (GJS logs those as errors)
export const disposedWrites = [];

// Pool actors share their production names (d2daIcon, d2daDotsOverlay, ...): a
// counter per name tells the slots apart in the trace. Reset for each loaded animator.
const counters = new Map();
function uniqueName(name) {
  const n = counters.get(name) ?? 0;
  counters.set(name, n + 1);
  return `${name}#${n}`;
}

const PROPS = [
  'x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'translationX', 'translationY',
  'opacity', 'icon_size', 'visible', 'gicon', 'icon_name', 'style_class', 'text', 'style',
];

function fmt(v) {
  if (typeof v === 'number') return String(Math.round(v * 1e3) / 1e3);
  if (v && typeof v === 'object') return v.name ?? '[obj]';
  return String(v);
}

function record(name, prop, value) {
  log.push(`${name}.${prop}=${fmt(value)}`);
}

export class FakeActor {
  constructor(name, props = {}) {
    this.name = name;
    this._v = {
      x: 0, y: 0, width: 0, height: 0, scaleX: 1, scaleY: 1, translationX: 0,
      translationY: 0, opacity: 255, icon_size: 24, visible: true, gicon: null,
      icon_name: null, style_class: '', text: '', style: '',
    };
    this._handlers = [];
    this._children = [];
    this._parent = null;
    Object.assign(this._v, props);
  }

  _set(prop, value) {
    if (this._disposed) disposedWrites.push(`${this.name}.${prop}`);
    if (this._v[prop] === value) return;
    this._v[prop] = value;
    record(this.name, prop, value);
    if (prop === 'translationX') this._emit('notify::translation-x');
    if (prop === 'translationY') this._emit('notify::translation-y');
  }

  set_scale(x, y) { this.scaleX = x; this.scaleY = y; }
  set_position(x, y) { this.x = x; this.y = y; }
  set_size(w, h) { this.width = w; this.height = h; }
  set_icon_size(s) { this.icon_size = s; }
  set_style_class_name(c) { this.style_class = c; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  get pivot_point() { return { x: 0, y: 0 }; }
  set pivot_point(_) {}
  has_allocation() { return true; }
  get_children() { return [...this._children]; }
  get_parent() { return this._parent; }
  add_child(c) { c._parent = this; this._children.push(c); }
  remove_all_children() { this._children = []; }
  get_transformed_position() { return [this.x, this.y]; }
  get_transformed_size() { return [this.width * this.scaleX, this.height * this.scaleY]; }
  connect() { return 1; }
  destroy() { this._disposed = true; }
  connectObject(...args) {
    const owner = args.pop();
    for (let i = 0; i < args.length; i += 2) {
      this._handlers.push({ sig: args[i], cb: args[i + 1], owner });
    }
  }
  disconnectObject(owner) {
    this._handlers = this._handlers.filter((h) => h.owner !== owner);
  }
  _emit(sig) {
    for (const h of [...this._handlers]) if (h.sig === sig) h.cb();
  }
}
PROPS.forEach((prop) => {
  Object.defineProperty(FakeActor.prototype, prop, {
    get() { return this._v[prop]; },
    set(value) { this._set(prop, value); },
  });
});

// GObject's snake_case names of the same properties
[['translation_x', 'translationX'], ['translation_y', 'translationY']].forEach(([alias, prop]) => {
  Object.defineProperty(FakeActor.prototype, alias, {
    get() { return this._v[prop]; },
    set(value) { this._set(prop, value); },
  });
});

// St.Icon stand-in the animator pools
class FakeIcon extends FakeActor {
  constructor(params = {}) {
    super(uniqueName(params.name ?? 'renderer'), { icon_size: params.icon_size ?? 24 });
  }
}

// the baseline offset an overlay keeps on its inner actor, untouched by a bounce
const OVERLAY_BASELINE = 3;

// Overlay with the same binding as DockItemBadgeOverlay/DockItemDotsOverlay: it follows
// the renderer through TranslationFollower and keeps its own baseline on an inner actor.
export class FakeOverlay extends FakeActor {
  constructor(renderer, params = {}) {
    super(uniqueName(params.name ?? 'overlay'), { visible: false });
    this.renderer = renderer;
    this._follower = new TranslationFollower(this);
  }
  update(icon, data) {
    this._follower.to(icon._renderer);
    record(
      this.name, 'update',
      `${data.appCount}/${data.noticesCount}/${data.progress}/${data.style}/${data.position}`
    );
    this.renderer.translationY = data.vertical === undefined ? 0 : OVERLAY_BASELINE;
  }
}

class FakeDot extends FakeActor {
  constructor() {
    super(uniqueName('dot'));
    this._canvas = new FakeActor(uniqueName('canvas'), { width: 96 });
  }
}

// -------------------------------------------------------------------- loading
const NORMALIZED = { k: 0.92, dx: 0.01, dy: -0.02, fill: 0.8 };

const STUBS = {
  'gi://St': 'export default { Icon: globalThis.__RigIcon };',
  './apps/dot.js': 'export const Dot = globalThis.__RigDot;',
  './dock.js':
    "export const DockPosition = { BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right', TOP: 'top' };",
  './textureFilters.js': 'export const smoothScaling = () => {};',
  './iconNormalizer.js': `export class IconNormalizer {
    constructor() { this.version = 0; this.onChange = null; }
    get() { return globalThis.__RigNorm; }
    destroy() {}
  }`,
  './dockItems.js': `export const DockItemDotsOverlay = globalThis.__RigOverlay;
    export const DockItemBadgeOverlay = globalThis.__RigOverlay;`,
  './probe.js': 'export const live = () => {};',
};

// Every sibling module animator.js imports that is not stubbed loads for real, whatever
// the animator is split into (they hold no Shell imports): a module that is renamed or
// missing fails the import instead of silently turning into an inert stub.
function realSiblings() {
  const source = new TextDecoder().decode(GLib.file_get_contents(`${REPO_ROOT}/animator.js`)[1]);
  const specifiers = [...source.matchAll(/from\s+'(\.\/[^']+)'/g)].map((m) => m[1]);
  return specifiers.filter((specifier) => !(specifier in STUBS));
}

export async function loadAnimator(overlay = FakeOverlay) {
  counters.clear();
  globalThis.__RigIcon = FakeIcon;
  globalThis.__RigDot = FakeDot;
  globalThis.__RigOverlay = overlay;
  globalThis.__RigNorm = NORMALIZED;
  const { module } = await importWithStubs('animator.js', { stubs: STUBS, real: realSiblings() });
  return module.Animator;
}

// ------------------------------------------------------------------ fake dock
const ICON = 48;
const CROSS = 900;
const ORIGIN = 300;
const ITEM = 56;
const GAP = 8;
const SEPARATOR_THICKNESS = 2;
const MONITOR = { x: 0, y: 0, width: 1200, height: 800 };

function fakeAppwell(id, windows) {
  const appwell = new FakeActor(`appwell-${id}`);
  appwell.app = {
    get_id: () => `${id}.desktop`,
    app_info: { get_id: () => `${id}.desktop` },
    get_n_windows: () => windows,
  };
  return appwell;
}

// where a dash item sits: `_at` is its start along the dock, which the Dash moves
function placeAlong(item, vertical) {
  item.get_transformed_position = () =>
    vertical ? [CROSS, item._at] : [item._at, CROSS];
}

/** A dash item holding an appwell. */
function fakeContainer(name, id, windows, at, scale, vertical) {
  const size = ITEM * scale;
  const container = new FakeActor(`container-${name}`, { width: size, height: size });
  container._at = at;
  container._icon = new FakeActor(`icon-${name}`, { icon_name: id });
  // the St.Icon sits in an inner box the animator offsets across the dock
  new FakeActor(`iconContainer-${name}`).add_child(container._icon);
  container._appwell = fakeAppwell(id, windows);
  container.add_child(container._appwell);
  container._label = new FakeActor(`label-${name}`, { text: id, opacity: 0, width: 40, height: 16 });
  // a new item has no allocation until its first layout pass
  container._allocated = true;
  container.has_allocation = () => container._allocated;
  placeAlong(container, vertical);
  return container;
}

// the line between two groups of icons: shifted along the dock by the animator
function fakeSeparator(at, vertical) {
  const size = SEPARATOR_THICKNESS + 0.5;
  const separator = new FakeActor('separator', {
    width: vertical ? 40 : size,
    height: vertical ? size : 40,
  });
  separator._cls = SEPARATOR_CLASS;
  separator.mapped = true;
  separator._at = at;
  separator.get_transformed_position = () =>
    vertical
      ? [CROSS, separator._at + separator.translationY]
      : [separator._at + separator.translationX, CROSS];
  return separator;
}

// bookkeeping the animator writes on the dock, traced like an actor's properties
function traceDockFields(dock) {
  ['animated', '_nearestIcon', '_hoveredIcon'].forEach((prop) => {
    let value = dock[prop];
    Object.defineProperty(dock, prop, {
      get: () => value,
      set: (next) => {
        if (next !== value) record('dock', prop, next);
        value = next;
      },
    });
  });
}

function defaultExtension() {
  return {
    animate_icons_unmute: true,
    animation_rise: 0.5,
    animation_magnify: 0.6,
    animation_fps: 0,
    animation_bounce_height: 0.5,
    animation_bounce_frequency: 0,
    animation_rise_curve: 0,
    icon_spacing: 0.5,
    separator_thickness: SEPARATOR_THICKNESS,
    icon_quality: 1,
    autohide_dash: false,
    autohide_speed: 0.5,
    panel_mode: false,
    notification_badge_style: 0,
    notification_badge_style_options: ['default', 'badge'],
    _config: { speed_up: 1 },
    _backgroundStyle: '',
    integrations: { bms_update_size: () => record('integrations', 'bmsUpdateSize', '') },
    services: {
      _appNotices: {},
      launcherEntry: () => null,
      updateIcon: (icon, data) =>
        record('services', 'updateIcon', `${icon.name}/${data.scaleFactor}/${data.iconSize}`),
    },
  };
}

/**
 * A dock of `icons` items in a row (a column when left/right), with one separator after
 * icon `separatorAfter`, at `scale` times the base size. `_icons` is what the dock keeps,
 * `_dashItems` what the Dash holds (icons and separators): the icons in two lists.
 */
export function buildDock(
  position,
  { icons = 4, windows = [1, 0, 2, 3], scale = 1, separatorAfter = 1 } = {}
) {
  const vertical = position === 'left' || position === 'right';
  const step = (ITEM + GAP) * scale;
  const containers = [];
  const items = [];
  let at = ORIGIN;
  for (let i = 0; i < icons; i++) {
    const c = fakeContainer(i, `app${i}`, windows[i % windows.length], at, scale, vertical);
    containers.push(c);
    items.push(c);
    at += step;
    if (i === separatorAfter) {
      items.push(fakeSeparator(at - GAP * scale, vertical));
    }
  }
  const renderArea = new FakeActor('renderArea', { opacity: 255 });
  renderArea.get_transformed_position = () => [0, 0];
  const background = new FakeActor('bg', { x: ORIGIN, y: CROSS, width: 80, height: 80 });
  background._padding = 4;
  background.update = (data) =>
    record('bg', 'update', `${data.first?.name}/${data.last?.name}/${data.iconSize}/${data.scaleFactor}/${data.position}/${data.vertical}/${data.panel_mode}`);

  const dock = Object.assign(new FakeActor('dock', { ...MONITOR }), {
    _position: position,
    _icons: [...containers],
    _dashItems: items,
    _separators: items.filter((item) => item._cls === SEPARATOR_CLASS),
    _needsLayout: false,
    _dragging: false,
    _dragged: null,
    _hidden: false,
    _iconSize: ICON,
    _iconSizeScaledDown: ICON,
    _scaleFactor: scale,
    _edge_distance: 4,
    _monitor: { ...MONITOR, geometry_scale: scale, inFullscreen: false },
    animated: false,
    _nearestIcon: null,
    _hoveredIcon: null,
    renderArea,
    dash: new FakeActor('dash'),
    struts: new FakeActor('struts'),
    autohider: { _debounceCheckHide: () => record('autohider', 'debounceCheckHide', '') },
    isVertical: () => vertical,
    getMonitor: () => dock._monitor,
    relayout: () => true,
    _snapToContainerEdge() {},
    _isWithinDash: ([px, py]) =>
      vertical
        ? px > CROSS - 80 && px < CROSS + 120 && py > ORIGIN && py < dock._end
        : py > CROSS - 80 && py < CROSS + 120 && px > ORIGIN && px < dock._end,
    _maybeBounce: (icon, found) => record('dock', 'maybeBounce', `${icon.name}/${found}`),
    _findIcons: () => dock._icons,
    getAppWindowsFiltered: (app) => new Array(app.get_n_windows()).fill(0),
    _updateTransparenies: () => record('dock', 'updateTransparencies', ''),
    _syncGlass: () => record('dock', 'syncGlass', ''),
    _debounceEndAnimation: () => record('dock', 'debounceEndAnimation', ''),
    slideIn: () => record('dock', 'slideIn', ''),
    _background: background,
    extension: defaultExtension(),
    vertical,
    _end: at,
    _step: step,
    // pointer on the dock over icon `i`, and well away from it
    pointerAt: (i) => {
      const along = ORIGIN + i * step + (ITEM * scale) / 2;
      return vertical ? [CROSS + 20, along] : [along, CROSS + 20];
    },
    pointerAway: () => (vertical ? [CROSS - 400, 0] : [0, CROSS - 400]),
  });
  // a new icon at `index` among the icons (the end by default); the ones after it move over
  dock.addIcon = (name, id, windowCount, index = dock._icons.length) => {
    const before = dock._icons[index];
    const at = before ? before._at : dock._end;
    dock._dashItems.forEach((item) => {
      if (item._at >= at) item._at += step;
    });
    const c = fakeContainer(name, id, windowCount, at, scale, vertical);
    dock._end += step;
    dock._icons.splice(index, 0, c);
    dock._dashItems.splice(before ? dock._dashItems.indexOf(before) : dock._dashItems.length, 0, c);
    dock.renderArea.add_child(c);
    return c;
  };
  traceDockFields(dock);
  items.forEach((item) => renderArea.add_child(item));
  return dock;
}

/**
 * Takes `count` icons out of the dock from `index`, as the Dash does when items go:
 * the items after them move back to close the gap.
 */
export function removeItems(dock, index, count) {
  const gone = dock._icons.splice(index, count);
  const at = gone[0]._at;
  dock._dashItems = dock._dashItems.filter((item) => !gone.includes(item));
  dock._dashItems.forEach((item) => {
    if (item._at > at) item._at -= count * dock._step;
  });
  dock._end -= count * dock._step;
  dock.renderArea._children = dock.renderArea._children.filter((c) => !gone.includes(c));
  return gone;
}

// The hi-res timer's runAnimation(), as in timer.js, over a manual clock. tick() runs a
// snapshot of the subscribers, like the real timer: one cancelled during the tick still runs.
export class FakeTimer {
  constructor() {
    this.subscribed = new Set();
  }
  runAnimation(array, settings) {
    // as in timer.js: an empty list is taken for a subscriber object of its own
    if (!array.length) {
      array._time = 0;
      this.subscribed.add(array);
      return array;
    }
    let duration = 0;
    array.forEach((f) => {
      if (!f._start) f._start = duration;
      duration += f._duration;
    });
    const obj = {
      _time: 0,
      _duration: duration,
      _loop: false,
      _timer: this,
      _frames: [...array],
      onUpdate: (s, dt) => {
        s._time += dt;
        s._currentFrames = s._frames.filter(
          (f) => f._start <= s._time && s._time < f._start + f._duration
        );
        if (!s._func) {
          s._func = () => s._currentFrames.forEach((f) => {
            f._time = s._time - f._start;
            f._func(f, s);
          });
        }
        if (s._time > s._duration) {
          this.subscribed.delete(s);
          s._time = s._duration;
          s._func(s);
          return;
        }
        s._func(s);
      },
      ...(settings || {}),
    };
    this.subscribed.add(obj);
    return obj;
  }
  cancel(obj) {
    this.subscribed.delete(obj);
  }
  tick(dt) {
    [...this.subscribed].forEach((s) => s.onUpdate?.(s, dt));
  }
}

/** A dock plus a ready animator on it. */
export async function rig(position, options = {}) {
  const Animator = await loadAnimator(options.overlay);
  const dock = buildDock(position, options);
  const timer = new FakeTimer();
  dock.extension._hiTimer = timer;
  const animator = new Animator();
  animator.dock = dock;
  animator.extension = dock.extension;
  animator.enable();
  dock.animator = animator;
  return { dock, animator, timer, Animator, timerFirst: true };
}

/**
 * One frame: the bounce timer ticks and the animator runs, in the order `r.timerFirst`
 * says (the real timer runs its subscribers in subscription order, so either can come
 * first).
 */
export function frame(r, pointer, dt = 16) {
  r.dock.simulated_pointer = pointer;
  if (r.timerFirst) r.timer.tick(dt);
  r.animator._animate(dt);
  if (!r.timerFirst) r.timer.tick(dt);
}

export function digest(text) {
  return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, text, -1);
}
