'use strict';

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { startScenarios, stopScenarios } from './probeScenarios.js';

// Live instance counts (T-6): stage walks can't see actors that were
// unparented but never destroyed. Always counted; it's just an integer map.
const liveCounts = {};

export function live(kind, delta) {
  liveCounts[kind] = (liveCounts[kind] ?? 0) + delta;
}

// Smoke-only settings hook: D2DA_SMOKE_SETTINGS='key=value key=value', values
// in GVariant text format (strings quoted). Only with D2DA_PROBE=1 *and* the
// in-memory GSettings backend, so it can never write the user's dconf.
function applySettingsSpec(settings, spec) {
  const applied = [];
  for (const pair of spec.trim().split(/\s+/).filter(Boolean)) {
    try {
      const eq = pair.indexOf('=');
      if (eq < 1) {
        throw new Error(`malformed '${pair}' (want key=value)`);
      }
      const key = pair.slice(0, eq);
      if (!settings.settings_schema.has_key(key)) {
        throw new Error(`unknown key '${key}'`);
      }
      const type = settings.settings_schema.get_key(key).get_value_type();
      const value = GLib.Variant.parse(type, pair.slice(eq + 1), null, null);
      // the memory backend keeps values across re-enables; skip no-op writes
      if (!settings.get_value(key).equal(value)) {
        settings.set_value(key, value);
      }
      applied.push(`${key}=${value.print(false)}`);
    } catch (e) {
      console.error('d2da: probe settings', e);
    }
  }
  return applied;
}

export function applySmokeSettings(settings) {
  if (
    GLib.getenv('D2DA_PROBE') !== '1' ||
    GLib.getenv('GSETTINGS_BACKEND') !== 'memory'
  ) {
    return;
  }

  const spec = (GLib.getenv('D2DA_SMOKE_SETTINGS') ?? '').trim();
  if (!spec) {
    return;
  }

  console.log('d2da-probe settings applied: ' + applySettingsSpec(settings, spec).join(' '));
}

// Dev-only leak/regression probe (G1). No-op unless the shell runs with
// D2DA_PROBE=1 (tools/smoke-shell.sh sets it).
// `timers` lets disable() pass its timers in before it nulls them.
export function probe(ext, phase, timers) {
  if (GLib.getenv('D2DA_PROBE') !== '1') {
    return;
  }

  if (phase === 'after-enable') {
    startScenarios(ext);
  } else if (phase === 'after-disable') {
    stopScenarios();
  }

  try {
    timers = timers ?? {
      loop: ext._timer,
      hi: ext._hiTimer,
      lo: ext._loTimer,
    };

    let stage = 0;
    let dashes = 0;
    const stack = [global.stage];
    while (stack.length) {
      const actor = stack.pop();
      for (
        let child = actor.get_first_child();
        child;
        child = child.get_next_sibling()
      ) {
        stage++;
        if (child.constructor.name === 'Dash') {
          dashes++;
        }
        stack.push(child);
      }
    }

    const subscribers = (timer) => timer?._subscribers?.length ?? 0;

    console.log(
      'd2da-probe ' +
        JSON.stringify({
          phase,
          uiGroup: Main.uiGroup.get_n_children(),
          stage,
          dashes,
          docks: ext.docks?.length ?? 0,
          hi: subscribers(timers.hi),
          lo: subscribers(timers.lo),
          loop: subscribers(timers.loop),
          liveDock: liveCounts.dock ?? 0,
          liveDash: liveCounts.dash ?? 0,
          liveAnimator: liveCounts.animator ?? 0,
        })
    );
  } catch (e) {
    console.error('d2da: probe', e);
  }
}

// Visual smoke (dev only, same guards as applySmokeSettings): with
// D2DA_SMOKE_SHOTS=<prefix> the first enable sets D2DA_SMOKE_FAVORITES
// (comma-separated desktop ids) as the favourites and runs the
// D2DA_SMOKE_SCENARIOS JSON list [{name, settings:'k=v ...', area:[x,y,w,h],
// hover:[x,y]}]: apply the settings, write <prefix>-<name>-rest.png, then park
// the pointer at `hover` and write <prefix>-<name>-hover.png (plus the
// animate() cost while the dock magnifies). Only touches the in-memory GSettings backend.
let shotsStarted = false;

function shoot(path, area) {
  return new Promise((resolve) => {
    const file = Gio.File.new_for_path(path);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const screenshot = new Shell.Screenshot();
    screenshot.screenshot_area(area.x, area.y, area.width, area.height, stream, (o, res) => {
      try {
        o.screenshot_area_finish(res);
      } catch (e) {
        console.error('d2da: probe screenshot', e);
      }
      stream.close(null);
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
  }));
}

export async function smokeShots(ext) {
  const prefix = GLib.getenv('D2DA_SMOKE_SHOTS');
  if (
    !prefix ||
    shotsStarted ||
    GLib.getenv('D2DA_PROBE') !== '1' ||
    GLib.getenv('GSETTINGS_BACKEND') !== 'memory'
  ) {
    return;
  }
  shotsStarted = true;
  try {
    const favorites = (GLib.getenv('D2DA_SMOKE_FAVORITES') ?? '').split(',').filter(Boolean);
    if (favorites.length) {
      new Gio.Settings({ schema_id: 'org.gnome.shell' }).set_strv('favorite-apps', favorites);
    }
    const [W, H] = global.stage.get_size();
    const scenarios = JSON.parse(
      GLib.getenv('D2DA_SMOKE_SCENARIOS') ?? '[{"name":"default"}]'
    );
    const seat = Clutter.get_default_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    await sleep(6000);
    for (const sc of scenarios) {
      if (sc.settings) {
        applySettingsSpec(ext._settings, sc.settings);
        await sleep(4000);
      }
      const [x, y, w, h] = sc.area ?? [0, Math.max(0, H - 320), W, Math.min(320, H)];
      const area = { x, y, width: w, height: h };
      await shoot(`${prefix}-${sc.name}-rest.png`, area);
      if (!sc.hover) {
        continue;
      }
      pointer.notify_absolute_motion(GLib.get_monotonic_time(), sc.hover[0] - 30, sc.hover[1]);
      await sleep(400);
      // frame cost of the hover animation: wall time spent inside animate()
      const animator = ext.docks?.[0]?.animator;
      const animate = animator?.animate;
      let frames = 0;
      let spentUs = 0;
      if (animate) {
        animator.animate = function (dt) {
          const t0 = GLib.get_monotonic_time();
          animate.call(this, dt);
          spentUs += GLib.get_monotonic_time() - t0;
          frames++;
        };
      }
      pointer.notify_absolute_motion(GLib.get_monotonic_time(), sc.hover[0], sc.hover[1]);
      await sleep(2500);
      if (animate) {
        animator.animate = animate;
        console.log(
          `d2da-probe hover-frames ${sc.name} ` +
            JSON.stringify({ frames, msPerFrame: frames ? +(spentUs / frames / 1000).toFixed(3) : 0 })
        );
      }
      await shoot(`${prefix}-${sc.name}-hover.png`, area);
      pointer.notify_absolute_motion(GLib.get_monotonic_time(), W / 2, H / 2);
      await sleep(1500);
    }
    console.log('d2da-probe shots done');
  } catch (e) {
    console.error('d2da: probe shots', e);
  }
}
