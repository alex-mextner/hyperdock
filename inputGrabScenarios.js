'use strict';

// Input-grab scenario for the nested smoke shell (D2DA_PROBE=1,
// D2DA_PROBE_SCENARIO=inputgrab, driven by tools/input-grab-shell.sh). While a
// dock popover (the stack dropdown, an app icon's menu, the dock's own menu)
// is open, the keyboard layout shortcut must still switch the input source and
// a tap of Super must still close the popover and open the overview, as it does at rest. Both
// keys go through the real input path: a virtual keyboard sends the events
// and the shell's own keybinding machinery decides; no handler is called
// directly. `h` carries probeScenarios.js's helpers: check, say, sleep, shot,
// closeOverview.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import { pointerFor } from './stackScenarios.js';

const S = 'inputgrab';
const SOURCES = "[('xkb', 'us'), ('xkb', 'ru')]";

const centreOf = (actor) => {
  const [x, y] = actor.get_transformed_position();
  const [w, ht] = actor.get_transformed_size();
  return [x + w / 2, y + ht / 2];
};

// a virtual keyboard: chord([Super_L, space]) presses in order, releases in reverse
function keyboardFor(h) {
  const seat = global.stage.context.get_backend().get_default_seat();
  const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  const send = (keyval, state) =>
    keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, state);
  const chord = async (keys) => {
    for (const key of keys) {
      send(key, Clutter.KeyState.PRESSED);
      await h.sleep(40);
    }
    for (const key of [...keys].reverse()) {
      send(key, Clutter.KeyState.RELEASED);
      await h.sleep(40);
    }
    await h.sleep(500);
  };
  return { chord };
}

// a secondary-button click wherever the pointer already is
async function rightClick(h) {
  const seat = global.stage.context.get_backend().get_default_seat();
  const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
  await h.sleep(24);
  pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
}

// two layouts, so there is a source to switch to
function twoLayouts() {
  new Gio.Settings({ schema_id: 'org.gnome.desktop.input-sources' }).set_value(
    'sources',
    GLib.Variant.parse(null, SOURCES, null, null)
  );
}

const sourceId = () => Keyboard.getInputSourceManager().currentSource?.id ?? null;

// A popover to open, and how to look at it
function stackCase(dock, ext, d, h) {
  return {
    name: 'stack dropdown',
    async open() {
      ext._settings.set_int('downloads-stack-view', 1);
      await h.sleep(2500);
      const item = dock._folderIcons?.get('downloads');
      await d.clickOn(item._renderer ?? item);
      await h.sleep(800);
    },
    isOpen: () => !!dock._stackPanel,
    async close() {
      dock._stackPanel?.close();
      await h.sleep(500);
    },
  };
}

function appMenuCase(dock, d, h) {
  const icon = () => dock._icons.find((i) => i._appwell);
  return {
    name: 'app icon menu',
    async open() {
      const target = icon();
      await d.moveTo(...centreOf(target._renderer));
      await d.moveTo(...centreOf(target._renderer));
      await rightClick(h);
      await h.sleep(600);
    },
    isOpen: () => !!icon()?._appwell._menu?.isOpen,
    async close() {
      icon()?._appwell._menu?.close(false);
      await h.sleep(300);
    },
  };
}

function dockMenuCase(dock, h) {
  return {
    name: 'dock background menu',
    async open() {
      const [x, y] = centreOf(dock.dash);
      dock.interactions._openMenu(x, y, true);
      await h.sleep(600);
    },
    isOpen: () => !!dock.interactions?._menu?.isOpen,
    async close() {
      dock.interactions?._menu?.close(false);
      await h.sleep(300);
    },
  };
}

async function exercise(c, k, d, h) {
  const label = c.name;
  const KEY = Clutter;

  // the input-source shortcut
  await c.open();
  h.check(S, `${label}: opens`, c.isOpen());
  const before = sourceId();
  h.say({ scenario: S, case: label, actionMode: Main.actionMode, source: before });
  await k.chord([KEY.KEY_Super_L, KEY.KEY_space]);
  const after = sourceId();
  h.check(S, `${label}: Super+Space switches the input source while it is open`, after !== before, { before, after });
  h.check(S, `${label}: switching the input source leaves it open`, c.isOpen());
  await k.chord([KEY.KEY_Super_L, KEY.KEY_space]);
  h.check(S, `${label}: the shortcut switches back`, sourceId() === before, { now: sourceId(), before });

  // a tap of Super: the popover closes and the overview opens (what Super does at rest)
  h.check(S, `${label}: it is still open before Super is tapped`, c.isOpen());
  await k.chord([KEY.KEY_Super_L]);
  await h.sleep(1200);
  h.check(S, `${label}: a tap of Super opens the overview`, Main.overview.visible, { visible: Main.overview.visible });
  h.check(S, `${label}: a tap of Super closes it`, !c.isOpen());
  await h.shot(`inputgrab-${label.replace(/\W+/g, '-')}-super`);
  await h.closeOverview();
  await c.close();

  // Escape, typing and a click outside still behave
  await c.open();
  h.check(S, `${label}: opens again`, c.isOpen());
  await k.chord([KEY.KEY_a]);
  h.check(S, `${label}: typing does not close it`, c.isOpen());
  await k.chord([KEY.KEY_Escape]);
  h.check(S, `${label}: Escape closes it`, !c.isOpen());
  h.check(S, `${label}: Escape does not open the overview`, !Main.overview.visible);
  await c.close();

  await c.open();
  h.check(S, `${label}: opens a third time`, c.isOpen());
  await d.moveTo(global.stage.width - 40, global.stage.height / 2);
  await d.click();
  await h.sleep(500);
  h.check(S, `${label}: a click outside closes it`, !c.isOpen());
  await c.close();
  h.check(S, `${label}: the modal stack is empty afterwards`, Main.actionMode === Shell.ActionMode.NORMAL, { actionMode: Main.actionMode });
}

export async function inputGrabScenario(ext, h) {
  const dock = ext.docks?.[0];
  if (!dock) return h.check(S, 'a dock exists', false);
  const favorites = (GLib.getenv('D2DA_STACKS_FAVORITES') ?? '').split(',').filter(Boolean);
  if (favorites.length) {
    new Gio.Settings({ schema_id: 'org.gnome.shell' }).set_strv('favorite-apps', favorites);
  }
  twoLayouts();
  await h.closeOverview();
  await h.sleep(3000);
  const d = pointerFor(dock, h);
  const k = keyboardFor(h);
  h.check(S, 'two input sources are configured', Keyboard.getInputSourceManager().inputSources && Object.keys(Keyboard.getInputSourceManager().inputSources).length === 2, { source: sourceId() });

  // baseline: with nothing open the same keys work
  const first = sourceId();
  await k.chord([Clutter.KEY_Super_L, Clutter.KEY_space]);
  h.check(S, 'baseline: Super+Space switches the input source with nothing open', sourceId() !== first, { first, now: sourceId() });
  await k.chord([Clutter.KEY_Super_L, Clutter.KEY_space]);
  await k.chord([Clutter.KEY_Super_L]);
  await h.sleep(1200);
  h.check(S, 'baseline: a tap of Super opens the overview with nothing open', Main.overview.visible);
  await h.closeOverview();

  for (const c of [stackCase(dock, ext, d, h), appMenuCase(dock, d, h), dockMenuCase(dock, h)]) {
    await exercise(c, k, d, h);
    await d.park();
  }
}
