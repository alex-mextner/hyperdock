'use strict';

// Dock layout scenarios (#1 #2 #11 #15) for the nested smoke shell, run by
// probeScenarios.js (D2DA_PROBE=1, D2DA_PROBE_SCENARIO=layout,width, see
// tools/smoke-shell.sh). `layout` sweeps a simulated pointer across the dock
// and measures, on the real actors, the clearance between every separator and
// the icons drawn next to it, then right-clicks with a virtual pointer
// (separator slot, the icon beside it, Show Apps) and checks #11. `width`
// adds and removes a favourite and watches the platter's width frame by frame.
// `h` carries probeScenarios.js's helpers: check, say, sleep, shot,
// closeOverview.

import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Fav from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Compat from './compat.js';

export async function layoutScenario(ext, h) {
  const S = 'layout';
  const nextFrame = () => h.sleep(24);
  let failures = 0;
  const fail = (msg) => {
    failures++;
    h.check(S, msg, false);
  };
  const dock = ext.docks?.[0];
  const layout = dock?.animator?.layout;
  if (!dock || !layout) {
    return fail('no dock to run the scenario on');
  }
  await h.closeOverview();
  // let the Dash populate and the dock draw its first frames
  await h.sleep(1500);
  const vertical = dock.isVertical();
  const axis = vertical ? 1 : 0;
  const [dx, dy] = dock.dash.get_transformed_position();
  const [dw, dh] = dock.dash.get_transformed_size();
  const cross = vertical ? dx + dw / 2 : dy + dh / 2;
  const at = (p, c = cross) => (vertical ? [c, p] : [p, c]);

  // let the dock settle and run a frame so the layout holds separators
  ext.simulated_pointer = null;
  for (let i = 0; i < 30; i++) {
    dock.animate(16);
    await nextFrame();
  }
  const summary = {
    scenario: 'layout',
    position: dock._position,
    icons: layout.iconCount,
    separators: layout.sepCount,
    thickness: ext.separator_thickness,
  };
  if (layout.sepCount === 0) {
    fail(`the dock has no separator to measure (${JSON.stringify(summary)})`);
  }
  await h.shot(`${dock._position}-rest`);

  // 1. sweep: clearance between each separator and its neighbours' rects
  let samples = 0;
  let minClear = Infinity;
  let bad = 0;
  const lo = (vertical ? dy : dx) - 200;
  const hi = (vertical ? dy + dh : dx + dw) + 200;
  let shotAt = lo + (hi - lo) * 0.55;
  let shotTaken = false;
  for (let p = lo; p <= hi; p += 6) {
    ext.simulated_pointer = at(p);
    dock.animate(16);
    await nextFrame();
    for (let j = 0; j < layout.sepCount; j++) {
      const a = layout.sepActors[j];
      if (a.opacity === 0) continue;
      const pos = a.get_transformed_position();
      const sStart = pos[axis];
      const sEnd = sStart + (vertical ? a.height : a.width);
      const prev = layout.icons[layout.sepPrev[j]]._renderer;
      const next = layout.icons[layout.sepNext[j]]._renderer;
      const pp = prev.get_transformed_position();
      const ps = prev.get_transformed_size();
      const np = next.get_transformed_position();
      const clearPrev = sStart - (pp[axis] + ps[axis]);
      const clearNext = np[axis] - sEnd;
      const c = Math.min(clearPrev, clearNext);
      samples++;
      minClear = Math.min(minClear, c);
      if (c < -0.51) {
        bad++;
        if (bad <= 5) {
          fail(`separator ${j} overlaps an icon by ${(-c).toFixed(2)}px at pointer ${p}`);
        }
      }
    }
    if (!shotTaken && p >= shotAt) {
      shotTaken = true;
      await h.shot(`${dock._position}-magnified`);
    }
  }
  ext.simulated_pointer = null;
  for (let i = 0; i < 40; i++) {
    dock.animate(16);
    await nextFrame();
  }
  h.check(
    S,
    'separators stay clear of the icons over the whole sweep',
    bad === 0 && samples >= 50,
    { ...summary, sweepSamples: samples, minClearancePx: Number(minClear.toFixed(3)), overlaps: bad }
  );

  let phaseStart = failures;
  // 2. right-click hit areas through the real input path: a virtual pointer
  // moves and clicks; the whole slot (line and padding, across the dock)
  // opens the dock menu, the icons beside it keep their own menus
  const menuOpen = () => !!dock.interactions?._menu?.isOpen;
  const closeMenu = async () => {
    dock.interactions?._menu?.close(false);
    await nextFrame();
  };
  const seat = global.stage.context.get_backend().get_default_seat();
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const moveTo = async (x, y) => {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    for (let i = 0; i < 25; i++) {
      dock.animate(16);
      await nextFrame();
    }
  };
  const press = async (button) => {
    pointer.notify_button(GLib.get_monotonic_time(), button, Clutter.ButtonState.PRESSED);
    await nextFrame();
    pointer.notify_button(GLib.get_monotonic_time(), button, Clutter.ButtonState.RELEASED);
    await nextFrame();
    await nextFrame();
  };
  const centreOf = (actor) => {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x + w / 2, y + h / 2];
  };
  // away from the dock, and from the hot corner a point beside a vertical
  // dock's end would reach
  const parkPointer = () => moveTo(global.stage.width / 2, global.stage.height / 2);
  // the dock magnifies under the pointer, so the slot moves: chase it
  const settleOnSlot = async (j, along = 0.5) => {
    for (let i = 0; i < 3; i++) {
      const s = layout.slotStart[j];
      const e = layout.slotEnd[j];
      await moveTo(...at(s + (e - s) * along));
    }
  };

  for (let j = 0; j < layout.sepCount; j++) {
    await settleOnSlot(j);
    const s = layout.slotStart[j];
    const e = layout.slotEnd[j];
    const where = `[${s.toFixed(1)}, ${e.toFixed(1)}]`;
    if (e - s < 2 + (ext.separator_thickness || 0)) fail(`slot ${j} ${where} is not wider than the line`);
    for (const p of [s + 0.5, (s + e) / 2, e - 0.5]) {
      if (!dock.interactions._inSeparatorSlot(...at(p))) fail(`slot ${j}: ${p.toFixed(1)} inside ${where} is not a hit`);
    }
    for (const p of [s - 3, e + 3]) {
      if (dock.interactions._inSeparatorSlot(...at(p))) fail(`slot ${j}: ${p.toFixed(1)} beside ${where} is a hit`);
    }
    if (dock.interactions._inSeparatorSlot(...at((s + e) / 2, cross + 600))) {
      fail(`slot ${j}: a point far across the dock is a hit`);
    }

    // right-click near both edges and in the middle of the slot
    for (const along of [0.05, 0.5, 0.95]) {
      await settleOnSlot(j, along);
      await press(Clutter.BUTTON_SECONDARY);
      if (!menuOpen()) {
        fail(`slot ${j}: right-click ${Math.round(along * 100)}% across the slot did not open the dock menu`);
      }
      if (along === 0.5) await h.shot(`${dock._position}-menu-slot`);
      await closeMenu();
    }

    // right-click on the icon next to the slot: its own menu, not the dock's
    const neighbour = layout.icons[layout.sepPrev[j]];
    if (neighbour?._appwell) {
      await moveTo(...centreOf(neighbour._renderer));
      await moveTo(...centreOf(neighbour._renderer));
      await press(Clutter.BUTTON_SECONDARY);
      if (menuOpen()) fail(`slot ${j}: right-click on the neighbouring app icon opened the dock menu`);
      const appMenu = neighbour._appwell._menu;
      if (!appMenu?.isOpen) fail(`slot ${j}: right-click on the neighbouring app icon did not open its own menu`);
      await h.shot(`${dock._position}-menu-app`);
      appMenu?.close(false);
      await nextFrame();
    }
  }

  h.check(S, '#15: right-click in every separator slot opens the dock menu, beside it does not, the neighbouring app icon keeps its own menu', failures === phaseStart);
  phaseStart = failures;
  // 3. Show Apps: right-click is a menu, never the grid, never a launch
  if (Main.overview.visible) {
    Main.overview.hide();
    await parkPointer();
  }
  const showApps = Compat.getDashShowAppsIcon(dock.dash);
  if (showApps?._icon && showApps.visible) {
    const hovered = layout.icons.find((i) => i._appwell);
    let launched = 0;
    const realActivate = hovered?._appwell.activate;
    if (hovered) {
      hovered._appwell.activate = () => {
        launched++;
      };
    }
    try {
      await moveTo(...centreOf(showApps._icon));
      await moveTo(...centreOf(showApps._icon));
      await press(Clutter.BUTTON_SECONDARY);
      if (Main.overview.visible) fail('right-click on Show Apps opened the app grid');
      if (launched) fail('right-click on Show Apps launched an app');
      if (!menuOpen()) fail('right-click on Show Apps did not open a menu');
      else if (!dock.interactions._showAppsItem?.visible) fail('Show Apps menu has no Show Applications item');
      await h.shot(`${dock._position}-menu-showapps`);
      await closeMenu();

      await moveTo(...centreOf(showApps._icon));
      await press(Clutter.BUTTON_PRIMARY);
      if (!Main.overview.visible) fail('left click on Show Apps no longer opens the app grid');
      if (menuOpen()) fail('left click on Show Apps opened a menu');
      Main.overview.hide();
      await nextFrame();
    } finally {
      if (hovered) hovered._appwell.activate = realActivate;
    }
  } else {
    fail('no Show Apps icon to test (apps-icon setting)');
  }
  // the pointer leaves the dock
  await parkPointer();
  h.check(S, '#15: Show Apps right-click opens a menu (no grid, no launch); left click opens the grid', failures === phaseStart);

  phaseStart = failures;
  // 4. #11: frames in which the first, a middle and the last icon cannot be
  // measured must not throw (called without animate()'s catch)
  {
    const icons = [...dock._icons];
    const picks = new Set([icons[0], icons[icons.length >> 1], icons[icons.length - 1]]);
    const real = new Map();
    picks.forEach((icon) => {
      real.set(icon, icon.get_transformed_position);
      icon.get_transformed_position = () => [NaN, NaN];
    });
    try {
      for (let i = 0; i < 6; i++) {
        dock.animator._animate(16);
        await nextFrame();
      }
      if (layout.iconCount !== icons.length - picks.size) {
        fail(`#11: measured ${layout.iconCount} icons, expected ${icons.length - picks.size}`);
      }
    } catch (e) {
      fail(`#11: a frame with unmeasured icons threw: ${e}`);
    } finally {
      real.forEach((fn, icon) => {
        icon.get_transformed_position = fn;
      });
    }
    for (let i = 0; i < 6; i++) {
      dock.animate(16);
      await nextFrame();
    }
    if (layout.iconCount !== icons.length) fail('#11: icons did not come back once measurable');
  }
  h.check(S, '#11: frames with an unmeasurable first/middle/last icon do not throw', failures === phaseStart);

  // 5. #1: adding and removing a favourite animates the dock width
  await addFavoriteWidth(dock, S, h);
}

export async function widthScenario(ext, h) {
  const dock = ext.docks?.[0];
  if (!dock) return h.check('width', 'no dock to run the scenario on', false);
  await h.closeOverview();
  await h.sleep(1500);
  await addFavoriteWidth(dock, 'width', h);
}

// #1: adding and removing a favourite must animate the dock width. Reads only
// the platter, so it works on any build: the `width` scenario runs just this.
async function addFavoriteWidth(dock, S, h) {
  const nextFrame = () => h.sleep(24);
  const widthOf = () => (dock.isVertical() ? dock._background.height : dock._background.width);
  const sample = async (frames) => {
    const series = [widthOf()];
    for (let i = 0; i < frames; i++) {
      await nextFrame();
      series.push(widthOf());
    }
    return series;
  };
  const judge = (what, series) => {
    const total = series[series.length - 1] - series[0];
    let maxStep = 0;
    let wrongWay = 0;
    let steps = 0;
    for (let i = 1; i < series.length; i++) {
      const d = series[i] - series[i - 1];
      maxStep = Math.max(maxStep, Math.abs(d));
      if (Math.abs(d) > 0.5) steps++;
      if (d * total < -0.5) wrongWay++;
    }
    h.check(
      S,
      `#1 ${what}: the dock width animates (no jump, no wrong-way frame)`,
      Math.abs(total) >= 10 &&
        maxStep <= 0.5 * Math.abs(total) &&
        steps >= 4 &&
        wrongWay === 0,
      {
        from: Number(series[0].toFixed(1)),
        to: Number(series[series.length - 1].toFixed(1)),
        maxStepPx: Number(maxStep.toFixed(1)),
        framesChanging: steps,
        wrongWayFrames: wrongWay,
        series: series.map((v) => Number(v.toFixed(1))),
      }
    );
  };
  const favorites = Fav.getAppFavorites();
  const have = favorites.getFavorites().map((a) => a.get_id());
  const candidate = Shell.AppSystem.get_default()
    .get_installed()
    .find((info) => info.should_show() && !have.includes(info.get_id()));
  if (!candidate) {
    h.check(S, '#1: an installed app to add as a favourite', false);
  } else {
    for (let i = 0; i < 40; i++) await nextFrame();
    await sample(5);
    favorites.addFavorite(candidate.get_id());
    judge('add favourite', await sample(60));
    await h.shot(`${dock._position}-added`);
    for (let i = 0; i < 20; i++) await nextFrame();
    favorites.removeFavorite(candidate.get_id());
    judge('remove favourite', await sample(60));
  }
}
