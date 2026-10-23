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

const GOA_DAEMON = 'org.gnome.goa-daemon.desktop';
const OA_PANEL = 'gnome-online-accounts-panel.desktop';

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

// The Dash box as { kind, id, item } in box order: pinned | running | recent
// app icons, the Shell separator, the recents separator
function dashItems(ext) {
  const dock = ext.docks?.[0];
  const box = dock?.dash ? Compat.getDashBox(dock.dash) : null;
  const favorites = Fav.getAppFavorites();
  return (box?.get_children() ?? [])
    .map((item) => {
      const app = item.child?.app;
      if (app) {
        const id = app.get_id();
        let kind = 'recent';
        if (favorites.isFavorite(id)) kind = 'pinned';
        else if (app.state !== Shell.AppState.STOPPED) kind = 'running';
        return { kind, id, item };
      }
      if (item === dock._recentsSeparator) return { kind: 'sep-recents', item };
      if (item.has_style_class_name?.('dash-separator')) {
        return { kind: 'sep-shell', item };
      }
      return { kind: 'other', item };
    })
    .filter((i) => i.kind !== 'other');
}

const kindsOf = (items) => items.map((i) => i.kind);
const describe = (items) => items.map((i) => (i.id ? `${i.kind}:${i.id}` : i.kind));
const idsOf = (items, kind) => items.filter((i) => i.kind === kind).map((i) => i.id);
const itemOf = (items, id) => items.find((i) => i.id === id)?.item ?? null;

// pinned | running | recents: one separator between neighbouring sections
function expectedKinds(items) {
  const count = (kind) => items.filter((i) => i.kind === kind).length;
  const [pinned, running, recent] = ['pinned', 'running', 'recent'].map(count);
  return [
    ...Array(pinned).fill('pinned'),
    ...(pinned && running + recent ? ['sep-shell'] : []),
    ...Array(running).fill('running'),
    ...(running && recent ? ['sep-recents'] : []),
    ...Array(recent).fill('recent'),
  ];
}

async function openMenu(item) {
  item.child.popupMenu();
  await sleep(300);
  return item.child._menu;
}

async function recents(ext) {
  const S = 'recents';
  const settings = ext._settings;
  const listed = () => settings.get_strv('recent-apps');
  const now = () => dashItems(ext);

  // the headless shell starts in the overview; the dock and its separators
  // are what is looked at
  await closeOverview();
  settings.set_int('separator-thickness', 2);

  // a stored list like the one that exposed the ticket: an unpinned app,
  // an unknown id, a pinned one, the goa-daemon launcher, more than 3
  const pinnedId = Fav.getAppFavorites().getFavorites()[0].get_id();
  settings.set_strv('recent-apps', [
    'org.gnome.DejaDup.desktop',
    'nonexistent.example.desktop',
    pinnedId,
    GOA_DAEMON,
    'org.gnome.Settings.desktop',
    'org.gnome.Characters.desktop',
  ]);
  settings.set_int('recent-apps-count', 3);
  await sleep(3000);

  let items = now();
  say({ scenario: S, layout: describe(items) });
  check(S, 'dock has pinned icons', items.some((i) => i.kind === 'pinned'));
  check(
    S,
    'recents: existing ids only, panel for the daemon, count capped',
    idsOf(items, 'recent').join() ===
      ['org.gnome.DejaDup.desktop', OA_PANEL, 'org.gnome.Settings.desktop'].join(),
    idsOf(items, 'recent')
  );
  check(S, 'goa-daemon launcher never shown', !items.some((i) => i.id === GOA_DAEMON));
  check(
    S,
    'sections in order, one separator per boundary',
    kindsOf(items).join() === expectedKinds(items).join(),
    describe(items)
  );
  await shot('recents-1-before');

  // an unpinned running app puts a section between pinned and recents
  const calculator = Shell.AppSystem.get_default().lookup_app('org.gnome.Calculator.desktop');
  calculator?.activate();
  for (let i = 0; i < 40 && calculator?.state !== Shell.AppState.RUNNING; i++) {
    await sleep(500);
  }
  const launched = calculator?.state === Shell.AppState.RUNNING;
  if (launched) {
    await sleep(1500);
    items = now();
    say({ scenario: S, layout: describe(items) });
    check(
      S,
      'pinned | running | recents, the recents get their own separator',
      kindsOf(items).includes('sep-recents') &&
        kindsOf(items).join() === expectedKinds(items).join(),
      describe(items)
    );
    await shot('recents-2-running');
  } else {
    say({ scenario: S, skipped: 'no unpinned app could be started' });
  }

  // no entry on icons that are not recents
  for (const kind of ['pinned', 'running']) {
    const icon = items.find((i) => i.kind === kind);
    if (!icon) continue;
    const menu = await openMenu(icon.item);
    check(
      S,
      `no Remove from Dock on a ${kind} icon`,
      menu?._d2daRemoveFromDock?.visible === false
    );
    menu.close(0);
  }

  // right-click > Remove from Dock on a recent icon
  const first = items.find((i) => i.kind === 'recent');
  const menu = await openMenu(first.item);
  const entry = menu?._d2daRemoveFromDock;
  check(S, 'a recent icon menu offers Remove from Dock', entry?.visible === true);
  const order = menu._getMenuItems();
  check(
    S,
    'Remove from Dock sits right after the pin toggle',
    order.indexOf(entry) === order.indexOf(menu._toggleFavoriteItem) + 1
  );
  await shot('recents-3-menu');
  entry.activate(null);
  await sleep(1500);
  items = now();
  check(S, 'the id leaves recent-apps', !listed().includes(first.id), listed());
  check(S, 'the icon is gone at once', itemOf(items, first.id) === null);
  check(
    S,
    'the next recent takes its place, count kept',
    idsOf(items, 'recent').length === settings.get_int('recent-apps-count'),
    idsOf(items, 'recent')
  );
  await shot('recents-4-after');

  // Online Accounts: one removal clears the panel and the daemon spelling
  const panel = itemOf(items, OA_PANEL);
  if (panel) {
    const panelMenu = await openMenu(panel);
    panelMenu._d2daRemoveFromDock.activate(null);
    await sleep(1500);
    check(
      S,
      'removing Online Accounts clears panel and daemon ids',
      !listed().includes(OA_PANEL) && !listed().includes(GOA_DAEMON),
      listed()
    );
  }

  // 0 turns the section off; the stored list stays
  const stored = listed().join();
  settings.set_int('recent-apps-count', 0);
  await sleep(1500);
  items = now();
  check(
    S,
    'count 0: no recents, no recents separator',
    !kindsOf(items).includes('recent') && !kindsOf(items).includes('sep-recents')
  );
  check(S, 'count 0: stored list untouched', listed().join() === stored);
  await shot('recents-5-off');
  settings.set_int('recent-apps-count', 3);
  await sleep(1500);
  check(S, 'count 3 again: recents return', kindsOf(now()).includes('recent'));

  if (launched) calculator.request_quit();
}

// what the scenarios of other modules (layoutScenarios.js) record with
const helpers = { check, say, sleep, shot, closeOverview };

const SCENARIOS = {
  recents,
  layout: (ext) => layoutScenario(ext, helpers),
  width: (ext) => widthScenario(ext, helpers),
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
