'use strict';

// Dev-only scripted checks that run inside the nested smoke shell
// (tools/smoke-shell.sh): D2DA_PROBE=1, the in-memory GSettings backend and
// D2DA_PROBE_SCENARIO=<name,name> select them; with anything else nothing
// here runs. Each check prints `d2da-probe-scenario {json}`; the smoke script
// fails on any "ok":false. D2DA_PROBE_SHOTS=<dir> also saves PNG screenshots
// of the headless stage.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Fav from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Compat from './compat.js';
import { layoutScenario, widthScenario } from './layoutScenarios.js';
import { stacksScenario } from './stackScenarios.js';
import { appGridPileScenario } from './appGridPileScenarios.js';
import { stackPreviewScenario } from './stackPreviewScenarios.js';

let started = false;
let stopped = false;
const timeouts = new Set();

const sleep = (ms) =>
  new Promise((resolve) => {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      timeouts.delete(id);
      resolve();
      return GLib.SOURCE_REMOVE;
    });
    timeouts.add(id);
  });

function say(record) {
  console.log('d2da-probe-scenario ' + JSON.stringify(record));
}

function check(scenario, name, ok, detail = null) {
  say({ scenario, name, ok: !!ok, detail });
}

// the headless shell starts in the overview; hide it once startup is done
async function closeOverview() {
  for (let i = 0; i < 20 && Main.overview.visible; i++) {
    if (!Main.overview.animationInProgress) Main.overview.hide();
    await sleep(500);
  }
}

async function shot(name) {
  const dir = GLib.getenv('D2DA_PROBE_SHOTS');
  if (!dir) return;
  GLib.mkdir_with_parents(dir, 0o755);
  const path = GLib.build_filenamev([dir, `${name}.png`]);
  const stream = Gio.File.new_for_path(path).replace(
    null,
    false,
    Gio.FileCreateFlags.NONE,
    null
  );
  try {
    await new Shell.Screenshot().screenshot(false, stream);
    say({ shot: path });
  } catch (e) {
    console.error('d2da: probe scenario screenshot', e);
  } finally {
    stream.close(null);
  }
}

// Calendar/Clock auto-pin and the live Minimize Effect switch (#13, #14)
async function widgets(ext) {
  const S = 'widgets';
  const settings = ext._settings;
  const favorites = Fav.getAppFavorites();
  const ids = () => favorites.getFavorites().map((a) => a.get_id());
  // the apps the extension itself detected; the smoke container has neither
  const CAL = ext.services?.widgetApp('calendar')?.id;
  const CLOCK = ext.services?.widgetApp('clock')?.id;
  if (!CAL || !CLOCK) {
    say({ scenario: S, skipped: 'Calendar and Clocks are not both installed' });
    return;
  }

  await closeOverview();
  await sleep(2000);
  say({ scenario: S, favoritesBefore: ids() });
  check(S, 'neither app is pinned to begin with', !ids().includes(CAL) && !ids().includes(CLOCK), ids());
  await shot('widgets-1-before');

  settings.set_boolean('calendar-icon', true);
  settings.set_boolean('clock-icon', true);
  await sleep(3000);
  say({ scenario: S, favoritesAfter: ids() });
  check(S, 'Calendar was pinned by switching it on', ids().includes(CAL), ids());
  check(S, 'Clocks was pinned by switching it on', ids().includes(CLOCK), ids());
  check(S, 'calendar widget is drawn over its dock item', ext.docks?.[0]?._calendar != null);
  check(S, 'clock widget is drawn over its dock item', ext.docks?.[0]?._clock != null);
  check(S, 'the midnight timer is armed', ext.services?._calendarTicker?._handle != null);
  await shot('widgets-2-pinned');

  // switching off never unpins
  settings.set_boolean('calendar-icon', false);
  await sleep(1500);
  check(S, 'switching Calendar off keeps it pinned', ids().includes(CAL), ids());

  // a pin the user removed must not come back when another switch changes
  settings.set_boolean('calendar-icon', true);
  await sleep(1500);
  favorites.removeFavorite(CAL);
  await sleep(1500);
  settings.set_boolean('clock-icon', false);
  await sleep(1500);
  check(S, 'toggling Clock does not re-pin a removed Calendar', !ids().includes(CAL), ids());
  settings.set_boolean('clock-icon', true);
  await sleep(1500);
  await shot('widgets-3-after-toggles');

  // Minimize Effect switches without restarting the extension
  const genie = () => ext.windowFeedback?._genie?.enabled;
  settings.set_int('minimize-effect', 1);
  await sleep(1500);
  check(S, 'Minimize Effect = Genie enables the genie live', genie() === true, genie());
  settings.set_int('minimize-effect', 0);
  await sleep(1500);
  check(S, 'Minimize Effect = Shell disables it live', genie() === false, genie());
}

// what the scenarios of other modules (layoutScenarios.js) record with
const helpers = { check, say, sleep, shot, closeOverview };

const SCENARIOS = {
  widgets,
  layout: (ext) => layoutScenario(ext, helpers),
  width: (ext) => widthScenario(ext, helpers),
  stacks: (ext) => stacksScenario(ext, helpers),
  appgrid: (ext) => appGridPileScenario(ext, helpers),
  'stackint-preview': (ext) => stackPreviewScenario(ext, helpers),
};

// Called by probe() after the first enable
export function startScenarios(ext) {
  if (started || GLib.getenv('GSETTINGS_BACKEND') !== 'memory') return;
  started = true;
  const names = (GLib.getenv('D2DA_PROBE_SCENARIO') ?? '').split(',').filter(Boolean);
  (async () => {
    for (const name of names) {
      if (stopped) return;
      try {
        if (!SCENARIOS[name]) throw new Error(`unknown scenario '${name}'`);
        await SCENARIOS[name](ext);
      } catch (e) {
        console.error(`d2da: probe scenario ${name}`, e);
        check(name, 'scenario ran to the end', false, String(e));
      }
      say({ scenario: name, done: true });
    }
  })();
}

// Called by probe() after disable: pending waits are dropped
export function stopScenarios() {
  stopped = true;
  timeouts.forEach((id) => GLib.source_remove(id));
  timeouts.clear();
}
