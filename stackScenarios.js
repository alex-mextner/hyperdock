'use strict';

// Stack dropdown scenario for the nested smoke shell (D2DA_PROBE=1,
// D2DA_PROBE_SCENARIO=stacks, driven by tools/stacks-shell.sh). Everything
// goes through the real input path: a virtual pointer moves onto a stack's
// dock item, clicks it, then clicks a file (or an app) in the dropdown that
// opens. A stub `xdg-open` and stub app launchers append to a file
// (D2DA_STACKS_OPENED), which proves the click reached the file; no handler is
// called directly. `h` carries probeScenarios.js's helpers: check, say,
// sleep, shot, closeOverview.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { clusterOrder } from './stackModel.js';

const S = 'stacks';
const VIEWS = { fan: 0, grid: 1, list: 2 };

function collect(actor, type, out = []) {
  if (actor instanceof type) out.push(actor);
  actor.get_children().forEach((c) => collect(c, type, out));
  return out;
}

// the virtual pointer and the dock it drives
export function pointerFor(dock, h) {
  const seat = global.stage.context.get_backend().get_default_seat();
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  const frame = () => h.sleep(24);
  const centreOf = (actor) => {
    const [x, y] = actor.get_transformed_position();
    const [w, ht] = actor.get_transformed_size();
    return [x + w / 2, y + ht / 2];
  };
  const moveTo = async (x, y) => {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    for (let i = 0; i < 12; i++) {
      dock.animate?.(16);
      await frame();
    }
  };
  const click = async () => {
    const now = () => GLib.get_monotonic_time();
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await frame();
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await h.sleep(400);
  };
  // the dock magnifies under the pointer: chase the icon
  const clickOn = async (actor) => {
    for (let i = 0; i < 3; i++) await moveTo(...centreOf(actor));
    await click();
  };
  const park = () => moveTo(global.stage.width / 2, global.stage.height / 3);
  return { centreOf, moveTo, click, clickOn, park };
}

// what the stub launchers wrote
function openedLog(path) {
  return {
    read() {
      try {
        return new TextDecoder().decode(Gio.File.new_for_path(path).load_contents(null)[1]).trim();
      } catch {
        return '';
      }
    },
    reset() {
      try {
        Gio.File.new_for_path(path).delete(null);
      } catch {
        // nothing was written yet
      }
    },
  };
}

// the first thing to click in the open dropdown: a file's icon in the fan
// (never "More...", which opens Files), a cell or row in the panel
function firstTarget(dock, view) {
  if (view === 'fan') {
    const box = dock._list?._box;
    const entry = box?.get_children().find((c) => c._icon?.first_child && c._label?.text !== 'More...');
    return entry?._icon ?? null;
  }
  return dock._stackPanel ? collect(dock._stackPanel._scroll, St.Button)[0] ?? null : null;
}

async function closeDropdown(dock, h) {
  dock._destroyList?.();
  dock._stackPanel?.close();
  await h.sleep(500);
}

// Click the stack's dock item, then the first entry of its dropdown.
async function clickThrough(d, dock, h, label, item, view, log) {
  log.reset();
  await d.clickOn(item._renderer ?? item);
  if (view === 'fan') await h.sleep(1500);
  const target = firstTarget(dock, view);
  h.check(S, `${label}: clicking the dock item opens the dropdown`, !!target, { files: item._folderStack?.total });
  if (!target) return null;
  await h.sleep(500);
  await h.shot(`stacks-${label.replace(/\W+/g, '-')}-open`);
  await d.clickOn(target);
  await h.sleep(600);
  const opened = log.read();
  h.check(S, `${label}: clicking an entry in the dropdown opens it`, opened.length > 0, { opened });
  return opened;
}

async function downloadsViews(d, dock, ext, h, log) {
  for (const [name, view] of Object.entries(VIEWS)) {
    ext._settings.set_int('downloads-stack-view', view);
    await h.sleep(2500);
    const item = dock._folderIcons?.get('downloads');
    if (!item) {
      h.check(S, `Downloads ${name}: the stack item exists`, false);
      continue;
    }
    await clickThrough(d, dock, h, `Downloads ${name}`, item, name, log);
    await d.park();
    await closeDropdown(dock, h);
  }
}

// headers of the batches in the open panel
function headersOf(dock) {
  const titles = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Earlier'];
  const kinds = ['Folders', 'Images', 'Movies', 'Music', 'Documents', 'Archives', 'Applications', 'Other'];
  return collect(dock._stackPanel._scroll, St.Label)
    .map((l) => l.text)
    .filter((t) => titles.includes(t) || kinds.includes(t));
}

async function downloadsBatches(d, dock, ext, h) {
  ext._settings.set_int('downloads-stack-view', VIEWS.grid);
  const item = () => dock._folderIcons?.get('downloads');
  const modes = { none: 0, date: 1, kind: 2 };
  const want = { none: 0, date: 4, kind: 3 };
  for (const [mode, value] of Object.entries(modes)) {
    ext._settings.set_int('downloads-stack-group', value);
    await h.sleep(2500);
    await d.clickOn(item()._renderer ?? item());
    await h.sleep(600);
    const headers = dock._stackPanel ? headersOf(dock) : [];
    h.check(S, `Downloads grouped by ${mode}: ${want[mode]} batch headers`, headers.length >= want[mode] && (mode !== 'none' || headers.length === 0), { headers });
    await h.shot(`stacks-grouped-${mode}`);
    await d.park();
    await closeDropdown(dock, h);
  }
}

// Recents, Downloads, Screenshots and the Trash stand together in one run
async function dockGroup(dock, h) {
  const extras = dock._extraIcons.get_children().filter((c) => c._clusterRole);
  const roles = extras.map((c) => c._clusterRole);
  const sorted = clusterOrder(roles).map((i) => roles[i]);
  // the fixture's Screenshots entry, plus this machine's own Screenshots folder
  // when it has one (the built-in stack): any number of stacks in the middle
  const shape = roles.filter((r) => r !== 'separator').map((r) => (r === 'stack' ? 'stack+' : r)).filter((r, i, a) => r !== a[i - 1]);
  h.check(S, 'the group is Recents, Downloads, Screenshots, Trash in that order', JSON.stringify(shape) === JSON.stringify(['recents', 'downloads', 'stack+', 'trash']), { roles });
  h.check(S, 'the group is already in dock order', JSON.stringify(roles) === JSON.stringify(sorted), { roles });
  const separators = dock._extraIcons.get_children().filter((c) => c.has_style_class_name?.('dash-separator'));
  h.check(S, 'one separator opens the group', separators.length === 1, { separators: separators.length });
  const inline = dock.dash._box?.get_children().some((c) => c.name === 'd2daRecentsSeparator');
  h.check(S, 'no recent app icons stand among the apps any more', !inline);
  await h.shot('stacks-group');
}

async function recentsStack(d, dock, ext, h, log) {
  ext._settings.set_int('recents-stack-view', VIEWS.grid);
  await h.sleep(2500);
  const item = dock._recentsIcon;
  if (!item) return h.check(S, 'the Recents stack item exists', false);
  const opened = await clickThrough(d, dock, h, 'Recents grid', item, 'grid', log);
  h.check(S, 'a recent app starts when clicked', /launched/.test(opened ?? ''), { opened });
  await d.park();
  await closeDropdown(dock, h);
}

export async function stacksScenario(ext, h) {
  const dock = ext.docks?.[0];
  if (!dock) return h.check(S, 'a dock exists', false);
  const log = openedLog(GLib.getenv('D2DA_STACKS_OPENED'));
  const favorites = (GLib.getenv('D2DA_STACKS_FAVORITES') ?? '').split(',').filter(Boolean);
  if (favorites.length) {
    new Gio.Settings({ schema_id: 'org.gnome.shell' }).set_strv('favorite-apps', favorites);
  }
  const recents = (GLib.getenv('D2DA_STACKS_RECENTS') ?? '').split(',').filter(Boolean);
  ext._settings.set_strv('recent-apps', recents);
  await h.closeOverview();
  await h.sleep(3000);
  const d = pointerFor(dock, h);
  const only = (GLib.getenv('D2DA_STACKS_ONLY') ?? '').split(',').filter(Boolean);
  const steps = {
    views: () => downloadsViews(d, dock, ext, h, log),
    batches: () => downloadsBatches(d, dock, ext, h),
    group: () => dockGroup(dock, h),
    recents: () => recentsStack(d, dock, ext, h, log),
  };
  for (const [name, step] of Object.entries(steps)) {
    if (!only.length || only.includes(name)) await step();
  }
}
