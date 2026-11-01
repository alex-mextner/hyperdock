'use strict';

// App-grid pile scenario for the nested smoke shell (D2DA_PROBE=1,
// D2DA_PROBE_SCENARIO=appgrid, driven by tools/app-grid-pile-shell.sh): the Show
// Apps item shows the pile, follows favorites, installs and settings, and a
// real click with a virtual pointer still opens the app grid. `h` carries
// probeScenarios.js's helpers: check, sleep, shot, closeOverview.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Compat from './compat.js';
import { isHelperId } from './appGridPileSelection.js';
import { pointerFor } from './stackScenarios.js';

const S = 'appgrid';
const POSITIONS = ['bottom', 'left', 'right'];

// waits for `done()` to be true, up to `seconds`
async function until(h, done, seconds = 20) {
  for (let i = 0; i < seconds * 4 && !done(); i++) await h.sleep(250);
  return done();
}

const showApps = (dock) => Compat.getDashShowAppsIcon(dock.dash);
const shown = (ext) => ext.appGridPile?._shown ?? [];

// what the Show Apps item displays right now
function iconState(dock) {
  const icon = showApps(dock)?._icon;
  return { gicon: icon?.gicon ?? null, name: icon?.icon_name ?? null };
}

function favoriteIds() {
  return new Gio.Settings({ schema_id: 'org.gnome.shell' }).get_strv('favorite-apps');
}

// the pile's invariants for the current state of the dock
function checkSelection(ext, h, label) {
  const ids = shown(ext);
  const favorites = favoriteIds();
  const { frequent, recent } = ext.appGridPile.selection;
  h.check(S, `${label}: between 1 and 9 apps`, ids.length >= 1 && ids.length <= 9, ids);
  h.check(S, `${label}: no app twice`, new Set(ids).size === ids.length, ids);
  h.check(S, `${label}: none of the dock's own launchers`, !ids.some(isHelperId), ids);
  h.check(
    S,
    `${label}: at most ${ext.app_grid_pile_recent} recent installs, none of them pinned`,
    recent.length <= ext.app_grid_pile_recent && !recent.some((id) => favorites.includes(id)),
    { recent, favorites }
  );
  const dockIds = [...favorites, ...ext.appGridPile._dockApps().map((app) => app.get_id())];
  h.check(S, `${label}: no app of the dock in either group`, !ids.some((id) => dockIds.includes(id)), { ids, dockIds });
  h.check(S, `${label}: the groups share no app`, !frequent.some((id) => recent.includes(id)), { frequent, recent });
  h.check(S, `${label}: at most ${ext.app_grid_pile_frequent} most used`, frequent.length <= ext.app_grid_pile_frequent, frequent);
}

async function pileDrawn(dock, ext, h) {
  const drawn = await until(h, () => ext.appGridPile?.gicon);
  h.check(S, 'the pile is drawn', !!drawn);
  await until(h, () => iconState(dock).gicon === ext.appGridPile?.gicon, 5);
  const state = iconState(dock);
  h.check(S, 'the Show Apps item shows the pile, not the nine dots', !!state.gicon && state.name === null, state.name);
}

// a real left click on the item opens the app grid
async function clickOpensGrid(d, dock, h, label) {
  if (Main.overview.visible) Main.overview.hide();
  await d.park();
  await h.sleep(800);
  const item = showApps(dock);
  await d.clickOn(item._icon);
  await h.sleep(1200);
  h.check(S, `${label}: a click on the pile opens the app grid`, Main.overview.visible);
  await h.shot(`appgrid-${label}-click`);
  Main.overview.hide();
  await h.sleep(1200);
  await d.park();
}

async function favoritesFollow(ext, h) {
  const recent = ext.appGridPile.selection?.recent ?? [];
  if (!recent.length) return h.check(S, 'a recent install exists to pin', false);
  const settings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
  const pinned = recent[0];
  settings.set_strv('favorite-apps', [...favoriteIds(), pinned]);
  const gone = await until(h, () => !ext.appGridPile.selection.recent.includes(pinned), 15);
  h.check(S, 'pinning a recent app takes it out of the recent ones', gone, { pinned });
  const used = ext.appGridPile.selection.frequent[0];
  if (!used) return h.check(S, 'a most used app exists to pin', false);
  settings.set_strv('favorite-apps', [...favoriteIds(), used]);
  const usedGone = await until(h, () => !ext.appGridPile.selection.frequent.includes(used), 15);
  h.check(S, 'pinning a most used app takes it out of the most used ones', usedGone, { used });
}

async function installFollows(ext, h) {
  const dir = GLib.getenv('D2DA_PILE_APPS_DIR');
  const icon = GLib.getenv('D2DA_PILE_NEW_ICON');
  if (!dir || !icon) return;
  const id = 'd2da-pile-newapp.desktop';
  GLib.file_set_contents(
    GLib.build_filenamev([dir, id]),
    `[Desktop Entry]\nType=Application\nName=Fresh Install\nExec=true\nIcon=${icon}\nTerminal=false\n`
  );
  const seen = await until(h, () => ext.appGridPile.selection?.recent?.[0] === id, 30);
  h.check(S, 'a newly installed app joins the pile as the newest', !!seen, ext.appGridPile.selection);
}

// An upgrade (a snap refresh) removes a launcher for a while and writes it
// again (new inode, new change time); the app must not become "newly installed"
// because of it. The gap is longer than the pile's debounce, so a scan sees the
// launcher missing.
async function upgradeKeepsOrder(ext, h) {
  const dir = GLib.getenv('D2DA_PILE_APPS_DIR');
  if (!dir) return;
  const old = 'd2da-pile-oldapp.desktop';
  const path = GLib.build_filenamev([dir, old]);
  const [, bytes] = GLib.file_get_contents(path);
  await h.sleep(1500);
  GLib.unlink(path);
  const gone = await until(h, () => !ext.appGridPile.selection.recent.includes(old), 15);
  h.check(S, 'a launcher that is removed leaves the pile', gone);
  GLib.file_set_contents(path, new TextDecoder().decode(bytes) + '\n# upgraded\n');
  await h.sleep(8000);
  const recent = ext.appGridPile.selection.recent;
  h.check(
    S,
    'an upgraded launcher does not jump ahead of a newer install',
    recent.includes(old) && recent.indexOf('d2da-pile-newapp.desktop') < recent.indexOf(old),
    recent
  );
}

async function settingsFollow(d, dock, ext, h) {
  const settings = ext._settings;
  settings.set_boolean('app-grid-pile', false);
  await until(h, () => !ext.appGridPile.gicon, 5);
  await h.sleep(800);
  const off = iconState(dock);
  h.check(S, 'switched off: the nine dots are back', !(off.gicon instanceof Gio.BytesIcon) && off.name === 'view-app-grid-symbolic', off.name);
  await h.shot('appgrid-switched-off');
  await clickOpensGrid(d, dock, h, 'dots');
  settings.set_boolean('app-grid-pile', true);
  await pileDrawn(dock, ext, h);
  settings.set_int('app-grid-pile-recent', 0);
  await until(h, () => ext.appGridPile.selection.recent.length === 0, 10);
  h.check(S, 'recent count 0: only most used remain', ext.appGridPile.selection.recent.length === 0);
  settings.set_int('app-grid-pile-recent', 3);
  settings.set_int('app-grid-pile-frequent', 0);
  await until(h, () => ext.appGridPile.selection.frequent.length === 0, 10);
  h.check(S, 'frequent count 0: only recent installs remain', ext.appGridPile.selection.frequent.length === 0);
  settings.set_int('app-grid-pile-recent', 0);
  await until(h, () => !ext.appGridPile.gicon, 10);
  await h.sleep(800);
  const empty = iconState(dock);
  h.check(S, 'both counts 0: nothing to pile, the nine dots are back', !(empty.gicon instanceof Gio.BytesIcon) && empty.name === 'view-app-grid-symbolic', empty.name);
  settings.set_int('app-grid-pile-recent', 3);
  settings.set_int('app-grid-pile-frequent', 6);
  await pileDrawn(dock, ext, h);
}

async function everyPosition(ext, h) {
  for (const [index, name] of POSITIONS.entries()) {
    ext._settings.set_int('dock-location', index);
    await h.sleep(3500);
    const dock = ext.docks?.[0];
    const d = pointerFor(dock, h);
    await pileDrawn(dock, ext, h);
    await d.park();
    await h.sleep(800);
    await h.shot(`appgrid-${name}`);
    await clickOpensGrid(d, dock, h, name);
  }
  ext._settings.set_int('dock-location', 0);
  await h.sleep(3500);
}

export async function appGridPileScenario(ext, h) {
  const favorites = (GLib.getenv('D2DA_PILE_FAVORITES') ?? '').split(',').filter(Boolean);
  if (favorites.length) {
    new Gio.Settings({ schema_id: 'org.gnome.shell' }).set_strv('favorite-apps', favorites);
  }
  await h.closeOverview();
  await h.sleep(3000);
  const dock = ext.docks?.[0];
  if (!dock) return h.check(S, 'a dock exists', false);
  const d = pointerFor(dock, h);
  await pileDrawn(dock, ext, h);
  checkSelection(ext, h, 'start');
  await h.shot('appgrid-bottom');
  await clickOpensGrid(d, dock, h, 'bottom');
  await installFollows(ext, h);
  checkSelection(ext, h, 'after install');
  await upgradeKeepsOrder(ext, h);
  checkSelection(ext, h, 'after upgrade');
  await favoritesFollow(ext, h);
  checkSelection(ext, h, 'after pin');
  await settingsFollow(d, dock, ext, h);
  ext._settings.set_boolean('apps-icon-front', true);
  await h.sleep(3000);
  await h.shot('appgrid-front');
  ext._settings.set_boolean('apps-icon-front', false);
  await everyPosition(ext, h);
}
