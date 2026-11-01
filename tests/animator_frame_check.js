// gjs -m tests/animator_frame_check.js
// Golden master of Animator._animate on the production code path: a fake dock runs
// scripted phases (settle, hover, badges, bounce, drag, hide, fade-in, icons coming and
// going, icon overrides, stack list, fullscreen) on every dock edge, and the SHA-256 of
// every property write the animator made in a phase is compared with tests/animator_golden.json.
// The golden was recorded from the animator as it was before it was split into modules, so a
// refactor that changes any write, its value (to 1e-3) or its order fails.
//
// A mismatch writes the phase's trace to $TMPDIR/animator_<edge>_<phase>.trace; diff it against the
// trace of the previous version to see the first write that differs.
// Re-recording on purpose (a behaviour change), written only once every phase has run:
//   ANIM_DUMP=tests/animator_golden.json gjs -m tests/animator_frame_check.js
// and list the changed phases in the commit message.
import GLib from 'gi://GLib';
import System from 'system';

import { rig, frame, writes, digest, removeItems, FakeActor } from './animator_rig.js';
import { createChecker, REPO_ROOT } from './harness.js';

const { check, finish } = createChecker();
const GOLDEN_PATH = `${REPO_ROOT}/tests/animator_golden.json`;
const DUMP = GLib.getenv('ANIM_DUMP');

// ---------------------------------------------------------------- the phases
function run(r, count, pointerOf, dt = 16) {
  for (let i = 0; i < count; i++) frame(r, pointerOf(i), dt);
}

const PHASES = {
  settle: (r) => run(r, 6, () => r.dock.pointerAway()),
  sweep: (r) => run(r, 24, (i) => r.dock.pointerAt(Math.min(3, Math.floor(i / 6)))),
  label: (r) => run(r, 44, () => r.dock.pointerAt(2)),
  leave: (r) => run(r, 20, () => r.dock.pointerAway()),
  badge: (r) => {
    const { extension } = r.dock;
    extension.notification_badge_style = 1;
    extension.services._appNotices['app1.desktop'] = { count: 3 };
    run(r, 12, () => r.dock.pointerAt(1));
    extension.notification_badge_style = 0;
    run(r, 3, () => r.dock.pointerAt(1));
    delete extension.services._appNotices['app1.desktop'];
  },
  bounce: (r) => {
    r.animator.bounceIcon(r.dock._icons[0]._appwell, 1);
    run(r, 75, () => r.dock.pointerAway());
  },
  bounceHover: (r) => {
    r.animator.bounceIcon(r.dock._icons[1]._appwell, 2);
    run(r, 60, (i) => r.dock.pointerAt(i % 4));
  },
  bounceAnimatorFirst: (r) => {
    // the animator's frame comes before the bounce timer's
    r.timerFirst = false;
    r.animator.bounceIcon(r.dock._icons[1]._appwell, 2);
    run(r, 60, (i) => r.dock.pointerAt(i % 4));
    r.timerFirst = true;
  },
  bounceRestartAnimatorFirst: (r) => {
    r.timerFirst = false;
    r.animator.bounceIcon(r.dock._icons[2]._appwell, 3);
    run(r, 20, () => r.dock.pointerAway());
    r.animator.bounceIcon(r.dock._icons[2]._appwell, 1);
    run(r, 80, () => r.dock.pointerAway());
    r.timerFirst = true;
  },
  bounceRestart: (r) => {
    r.animator.bounceIcon(r.dock._icons[2]._appwell, 3);
    run(r, 20, () => r.dock.pointerAway());
    r.animator.bounceIcon(r.dock._icons[2]._appwell, 1);
    run(r, 80, () => r.dock.pointerAway());
  },
  bounceDragged: (r) => {
    r.animator.bounceIcon(r.dock._icons[0]._appwell, 1);
    run(r, 10, () => r.dock.pointerAway());
    r.dock._dragging = true;
    run(r, 10, () => r.dock.pointerAway());
    r.dock._dragging = false;
    run(r, 70, () => r.dock.pointerAway());
  },
  drag: (r) => {
    r.dock._dragging = true;
    r.dock._dragged = r.dock._icons[1]._icon;
    run(r, 10, () => r.dock.pointerAt(0));
    r.dock._dragging = false;
    r.dock._dragged = null;
    run(r, 6, () => r.dock.pointerAway());
  },
  hide: (r) => {
    r.dock.extension.autohide_dash = true;
    r.dock._hidden = true;
    run(r, 14, () => r.dock.pointerAway());
    r.dock._hidden = false;
    run(r, 14, () => r.dock.pointerAt(1));
    r.dock.extension.autohide_dash = false;
  },
  fadeIn: (r) => {
    r.dock.opacity = 0;
    r.dock.renderArea.opacity = 100;
    run(r, 40, () => r.dock.pointerAway(), 20);
  },
  fps: (r) => {
    r.dock.extension.animation_fps = 60;
    run(r, 10, (i) => r.dock.pointerAt(i % 3));
    r.dock.extension.animation_fps = 0;
  },
  noAnimation: (r) => {
    r.dock.extension.animate_icons_unmute = false;
    run(r, 8, () => r.dock.pointerAt(2));
    r.dock.extension.animate_icons_unmute = true;
  },
  dts: (r) => {
    [0, 1, 33, 100, 16].forEach((dt) => run(r, 3, () => r.dock.pointerAt(1), dt));
  },
  fullscreen: (r) => {
    r.dock._monitor.inFullscreen = true;
    run(r, 6, () => r.dock.pointerAt(1));
    r.dock._monitor.inFullscreen = false;
  },
  stackPanel: (r) => {
    r.dock._stackPanel = {};
    run(r, 6, () => r.dock.pointerAt(1));
    r.dock._stackPanel = null;
  },
  list: (r) => {
    const calls = [];
    r.dock._list = { visible: true, _box: {}, _target: r.dock._icons[0], animate: (dt) => calls.push(dt) };
    r.dock._lastHoveredIcon = r.dock._icons[0];
    run(r, 6, () => r.dock.pointerAt(0));
    r.dock._list = null;
    if (!DUMP) check(calls.length === 6, 'the stack list is animated on every frame it is open');
  },
  overrides: (r) => {
    const ext = r.dock.extension;
    ext.icon_map = { app0: 'mapped-name' };
    ext.app_map = { app1: 'mapped-app' };
    ext.icon_map_cache = { app2: new FakeActor('cached-gicon') };
    ext.app_map_cache = { app3: new FakeActor('app-gicon') };
    run(r, 8, (i) => r.dock.pointerAt(i % 4));
    ext.icon_map = ext.app_map = ext.icon_map_cache = ext.app_map_cache = null;
  },
  fileIcons: (r) => {
    // image files are not scaled by the animator (SVG ones are); an override replaces them
    const file = (path) => ({ file: { get_path: () => path } });
    const [a, b, c, d] = r.dock._icons.map((icon) => icon._icon);
    a.gicon = file('/icons/app0.png');
    b.gicon = file('/icons/APP1.SVG');
    c.gicon = file(null);
    d.icon_name = '';
    d.gicon = { file: null };
    run(r, 8, (i) => r.dock.pointerAt(i % 4));
    r.dock.extension.icon_map_cache = { app0: new FakeActor('override-icon') };
    r.dock.extension.icon_map = {};
    run(r, 6, () => r.dock.pointerAt(0));
    r.dock.extension.icon_map_cache = r.dock.extension.icon_map = null;
    [a, b, c, d].forEach((icon) => { icon.gicon = null; });
    d.icon_name = 'app3';
  },
  launcherEntry: (r) => {
    // an app's own unread count and progress win over its notification banners
    const { extension } = r.dock;
    extension.notification_badge_style = 1;
    extension.services._appNotices['app1.desktop'] = { count: 3 };
    extension.services.launcherEntry = (id) => {
      if (id === 'app0.desktop') return { countVisible: true, count: 7, progressVisible: true, progress: 0.4 };
      if (id === 'app1.desktop') return { countVisible: true, count: 12, progressVisible: false, progress: 0 };
      if (id === 'app2.desktop') return { countVisible: false, count: 0, progressVisible: true, progress: 0.8 };
      return null;
    };
    run(r, 10, (i) => r.dock.pointerAt(i % 3));
    extension.services.launcherEntry = () => null;
    delete extension.services._appNotices['app1.desktop'];
    extension.notification_badge_style = 0;
  },
  edgeDistance: (r) => {
    // a negative edge distance (the prefs slider reaches -1) counts as 0 while hovering
    r.dock._edge_distance = -3;
    run(r, 8, (i) => r.dock.pointerAt(i % 4));
    run(r, 8, () => r.dock.pointerAway());
    r.dock._edge_distance = 4;
  },
  unmeasurable: (r) => {
    const { dock } = r;
    // an icon whose position is finite for the layout and NaN when it is placed
    const first = dock._icons[0];
    const real = first.get_transformed_position;
    let calls = 0;
    first.get_transformed_position = () => (calls++ % 2 ? [NaN, NaN] : real());
    run(r, 4, () => dock.pointerAt(1));
    first.get_transformed_position = real;
    // an icon without a box to sit in (dragged out)
    const inner = dock._icons[2]._icon;
    const parent = inner.get_parent;
    inner.get_parent = () => null;
    run(r, 3, () => dock.pointerAt(2));
    inner.get_parent = parent;
    // the render area is not on the stage yet
    const origin = dock.renderArea.get_transformed_position;
    dock.renderArea.get_transformed_position = () => [NaN, 0];
    run(r, 3, () => dock.pointerAt(1));
    dock.renderArea.get_transformed_position = origin;
    // the dock cannot lay itself out, and then has no icons
    dock._needsLayout = true;
    const relayout = dock.relayout;
    dock.relayout = () => false;
    run(r, 2, () => dock.pointerAway());
    dock.relayout = relayout;
    dock._needsLayout = false;
    const icons = dock._icons.splice(0);
    run(r, 2, () => dock.pointerAway());
    dock._icons.push(...icons);
    run(r, 3, () => dock.pointerAway());
  },
  separatorHidden: (r) => {
    const [separator] = r.dock._separators;
    separator.visible = false;
    run(r, 6, () => r.dock.pointerAt(1));
    separator.visible = true;
    separator.mapped = false;
    run(r, 6, () => r.dock.pointerAt(1));
    separator.mapped = true;
    run(r, 6, () => r.dock.pointerAt(1));
  },
  comeAndGo: (r) => {
    // an icon before the separator goes: the others' slots move, and the animator glides
    removeItems(r.dock, 0, 1);
    run(r, 12, () => r.dock.pointerAway());
    // a new icon is not allocated until its first layout pass, then its slot opens over time
    const fresh = r.dock.addIcon('new', 'app9', 2);
    // launched through the dock: the animator starts its bounce
    fresh._found = true;
    fresh._allocated = false;
    run(r, 3, () => r.dock.pointerAway());
    fresh._allocated = true;
    run(r, 24, () => r.dock.pointerAway());
  },
};

// every edge at the base scale, and the same dock at 2x (scale factor and monitor scale)
const EDGES = [
  ['bottom', 1], ['left', 1], ['right', 1], ['top', 1],
  ['bottom', 2], ['left', 2], ['right', 2], ['top', 2],
];

async function recordEdge(position, scale) {
  const r = await rig(position, { scale });
  const phases = {};
  for (const name of Object.keys(PHASES)) {
    writes.take();
    PHASES[name](r);
    phases[name] = writes.take();
  }
  r.animator.destroy();
  return phases;
}

const golden = DUMP ? {} : JSON.parse(new TextDecoder().decode(GLib.file_get_contents(GOLDEN_PATH)[1]));
const recorded = {};
for (const [position, scale] of EDGES) {
  const edge = `${position}@${scale}x`;
  const phases = await recordEdge(position, scale);
  recorded[edge] = {};
  for (const [name, trace] of Object.entries(phases)) {
    recorded[edge][name] = digest(trace);
    if (DUMP) continue;
    const ok = recorded[edge][name] === golden[edge]?.[name];
    check(ok, `${edge}: phase '${name}' matches the golden`);
    if (!ok) {
      const path = `${GLib.get_tmp_dir()}/animator_${position}_${scale}x_${name}.trace`;
      GLib.file_set_contents(path, trace.split(';').join('\n'));
      print(`     ${trace.length} chars of writes, saved to ${path}`);
    }
  }
}
if (DUMP) {
  GLib.file_set_contents(DUMP, JSON.stringify(recorded, null, 2) + '\n');
  System.exit(0);
}
// a phase or edge the golden still has but the check no longer runs would go unchecked
const stale = Object.entries(golden).flatMap(([edge, phases]) =>
  Object.keys(phases).filter((name) => !(name in (recorded[edge] ?? {})))
    .map((name) => `${edge}/${name}`)
);
check(stale.length === 0, `the golden holds no phase the check no longer runs${stale.length ? `: ${stale.join(', ')}` : ''}`);
finish();
