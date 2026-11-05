// gjs -m tests/dock_indicator_geometry_check.js
// Integration of the production pieces that keep the running indicator clear of
// the icon art: the dock's lift of the dash (indicatorRoom), the platter that
// reaches past the items (DockBackground.update) and the dot placement
// (DockItemDotsOverlay.update), run on a fake dash. Removing either the lift or
// the platter expansion must put the indicator on the art or off the platter.
import System from 'system';

import { importWithStubs } from './harness.js';
import { CONTENT_TARGET, indicatorBand, resolveIndicatorStyle } from '../iconGeometry.js';
import { indicatorRoom } from '../indicatorSpacing.js';

const { module } = await importWithStubs('dockItems.js', {
  real: ['./iconGeometry.js', './indicatorSpacing.js'],
  stubs: {
    'gi://GObject': 'export default { registerClass: (a, b) => b ?? a };',
    'gi://St': 'export default { Widget: class { _init(p) { Object.assign(this, p); } } };',
    'resource:///org/gnome/shell/ui/popupMenu.js': 'export class PopupMenu {}',
    'resource:///org/gnome/shell/ui/dash.js':
      'export class DashIcon {} export class DashItemContainer {} export class Dash {}',
    './dock.js': "export const DockPosition = { BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right', TOP: 'top' };",
  },
});
const { DockBackground, DockItemDotsOverlay } = module;

let failures = 0;
function check(cond, msg) {
  print(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}

const MONITOR = { x: 0, y: 0, width: 1200, height: 800 };
const FRAME_ORIGIN = [0, 0];
const CANVAS = 96;

function actor(props = {}) {
  return {
    x: 0, y: 0, width: 0, height: 0, opacity: 0, translationX: 0, translationY: 0,
    get_transformed_position() { return [this.x + this.translationX, this.y + this.translationY]; },
    ...props,
  };
}

/**
 * One dock edge, laid out as Dock does and drawn by the real background and dot
 * code. Returns where the art, the platter and the indicator band end up along
 * the axis towards the screen edge (all on the "outward" axis, larger = nearer
 * the edge for bottom). `lift`/`expand` switch the two mechanisms off.
 */
function layout({ iconSize = 48, itemSize = 56, scaleFactor = 1, edgeDistance = 4, lift = true, expand = true, icons = 3 }) {
  const room = indicatorRoom({ iconSize, itemSize, dockPadding: 0.5, scaleFactor, edgeDistance });
  const growth = expand ? room.outerGrowth : 0;
  const dashEdge = lift ? room.edgeDistance : edgeDistance;

  const dash = actor({ width: icons * itemSize, height: itemSize });
  dash.x = 300;
  // the dash rests on the monitor's edge and is translated `dashEdge` inwards
  // (Animator.moveDash)
  dash.y = MONITOR.height - itemSize;
  dash.translationY = -dashEdge;
  const dock = actor({ x: 0, y: 0, width: MONITOR.width, height: MONITOR.height });
  dock._outerGrowth = growth;
  dock._position = 'bottom';
  dock._monitor = MONITOR;
  dock._iconSizeScaledDown = iconSize;
  dock._scaleFactor = scaleFactor;
  dock.dash = dash;
  dock.extension = { dock_padding: 0.5, running_indicator_style: 0, running_indicator_style_options: ['default'] };
  dock.renderArea = { get_transformed_position: () => FRAME_ORIGIN };

  const first = { _icon: actor() };
  const last = { _icon: actor() };
  const bg = Object.create(DockBackground.prototype);
  Object.assign(bg, actor());
  dock._background = bg;
  bg.update({
    first, last, iconSize, scaleFactor, vertical: false, position: 'bottom',
    panel_mode: false, dock,
  });
  const platterEnd = bg.y + bg.height;

  // the item of the middle icon, icon centred in it, art inside CONTENT_TARGET
  const slotY = dash.y + dash.translationY + (itemSize - iconSize * scaleFactor) / 2;
  const artEnd = slotY + iconSize * scaleFactor * (1 - (1 - CONTENT_TARGET) / 2);

  const overlay = Object.create(DockItemDotsOverlay.prototype);
  const renderer = actor({
    _canvas: { width: CANVAS, set_scale() {} },
    set_size() {},
    set_state() {},
  });
  Object.assign(overlay, actor(), {
    _follower: { to() {} },
    set_size() {},
    set_scale() {},
    set_position(x, y) { this.x = x; this.y = y; },
    renderer,
  });
  overlay.update(
    { _slotSize: iconSize * scaleFactor, _slotX: 300 + itemSize, _slotY: slotY },
    { appCount: 1, position: 'bottom', vertical: false, extension: dock.extension, dock }
  );
  const rest = iconSize * scaleFactor;
  const k = rest / CANVAS;
  const band = indicatorBand(resolveIndicatorStyle('default'), 0, CANVAS);
  const top = overlay.y + renderer.translationY + band.top * k;
  const bottom = overlay.y + renderer.translationY + band.bottom * k;
  return { artEnd, platterEnd, bandTop: top, bandBottom: bottom, screenEnd: MONITOR.height - edgeDistance };
}

for (const [label, config] of [
  ['48 px icons, 56 px items', {}],
  ['24 px icons', { iconSize: 24, itemSize: 28 }],
  ['76 px icons', { iconSize: 76, itemSize: 88 }],
  ['1.5x scale', { iconSize: 48, itemSize: 84, scaleFactor: 1.5 }],
  ['negative edge distance (-9 px)', { edgeDistance: -9 }],
]) {
  const ok = layout(config);
  check(ok.bandTop >= ok.artEnd, `${label}: the indicator band starts below the art (${ok.bandTop.toFixed(2)} >= ${ok.artEnd.toFixed(2)})`);
  check(ok.bandBottom <= ok.platterEnd + 0.01, `${label}: the indicator band ends inside the platter (${ok.bandBottom.toFixed(2)} <= ${ok.platterEnd.toFixed(2)})`);
  // a negative edge distance puts the dock past the screen edge on purpose
  if (!(config.edgeDistance < 0)) check(ok.bandBottom <= MONITOR.height, `${label}: the indicator band is on screen (${ok.bandBottom.toFixed(2)} <= ${MONITOR.height})`);

  // the dash is not lifted: the platter, which grows into the lift, and the
  // dots with it, are pushed off the screen
  const noLift = layout({ ...config, lift: false });
  if (!(config.edgeDistance < 0)) check(noLift.bandBottom > MONITOR.height, `${label}: without the dash lift the indicator leaves the screen`);
  // the platter does not reach past the items: the indicator sits on the art
  const noExpand = layout({ ...config, expand: false });
  check(noExpand.bandTop < noExpand.artEnd, `${label}: without the platter expansion the indicator reaches the art`);
}

print(failures ? `${failures} check(s) failed` : 'all passed');
System.exit(failures ? 1 : 0);
