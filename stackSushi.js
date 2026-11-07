'use strict';

// Client of GNOME Sushi, the previewer Files opens on Space
// (org.gnome.NautilusPreviewer2 on the session bus), for the file types the
// built-in Quick Look overlay (stackPreview.js) cannot draw. It asks the bus
// whether Sushi can be started, shows a file, closes it, reports arrow keys
// pressed inside the Sushi window (SelectionEvent) and reports when the
// window appears or goes away (the Visible property), which the dropdown
// needs to give its modal grab back to the compositor while Sushi is up.
// Which types go here is decided in stackPreviewModel.js.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { SUSHI_NAME, isSushiAvailable, sushiStep } from './stackPreviewModel.js';

const INTERFACE = 'org.gnome.NautilusPreviewer2';
const PROPERTIES = 'org.freedesktop.DBus.Properties';
const CALL_TIMEOUT_MS = 5000;

const bus = () => Gio.DBus.session;

function dbusCall(name, path, iface, method, parameters, replyType) {
  return new Promise((resolve, reject) => {
    bus().call(
      name,
      path,
      iface,
      method,
      parameters,
      replyType,
      Gio.DBusCallFlags.NONE,
      CALL_TIMEOUT_MS,
      null,
      (conn, res) => {
        try {
          resolve(conn.call_finish(res));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

export class StackSushi {
  // onStep(delta): an arrow key in the Sushi window, -1 previous / 1 next
  // onVisible(visible): the Sushi window appeared or went away
  // busName: the service to talk to; only a test replaces Sushi's own name
  constructor({ onStep, onVisible, busName = SUSHI_NAME }) {
    this._busName = busName;
    this._path = `/${busName.replaceAll('.', '/')}`;
    this._onStep = onStep;
    this._onVisible = onVisible;
    this._visible = false;
    // a ShowFile went out and no Close followed: Sushi may still be starting
    // up, so `visible` alone cannot tell whether a Close is due
    this._requested = false;
    this._subscriptions = [];
    this._available = false;
  }

  get visible() {
    return this._visible;
  }

  // Whether Sushi can be started or already runs. A "yes" is kept; a "no"
  // is asked again next time, so installing gnome-sushi takes effect without
  // restarting the shell.
  async available() {
    if (this._available) return true;
    try {
      this._available = await this._askBus();
    } catch (e) {
      console.warn('d2da: Sushi availability check failed', e.message);
    }
    return this._available;
  }

  async _askBus() {
    const [activatable] = (
      await dbusCall(
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus',
        'ListActivatableNames',
        null,
        new GLib.VariantType('(as)')
      )
    ).deepUnpack();
    const [owned] = (
      await dbusCall(
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus',
        'NameHasOwner',
        new GLib.Variant('(s)', [this._busName]),
        new GLib.VariantType('(b)')
      )
    ).deepUnpack();
    return isSushiAvailable(activatable, owned, this._busName);
  }

  // Show `uri` in the Sushi window (starts Sushi on the first call). Resolves
  // true when Sushi accepted the file.
  async show(uri) {
    this._subscribe();
    this._requested = true;
    try {
      await dbusCall(
        this._busName,
        this._path,
        INTERFACE,
        'ShowFile',
        new GLib.Variant('(ssbs)', [uri, '', false, '']),
        null
      );
    } catch (e) {
      console.warn('d2da: Sushi ShowFile failed', e.message);
      return false;
    }
    // a window Files already had open only swaps its file: no
    // PropertiesChanged comes, so read the property once
    await this._readVisible();
    return true;
  }

  // Close the window this client asked for, also while it is still starting
  // up: D-Bus delivers Close after the ShowFile that came before it.
  async close() {
    if (!this._requested && !this._visible) return;
    this._requested = false;
    try {
      await dbusCall(this._busName, this._path, INTERFACE, 'Close', null, null);
    } catch (e) {
      console.warn('d2da: Sushi Close failed', e.message);
    }
  }

  async _readVisible() {
    try {
      const reply = await dbusCall(
        this._busName,
        this._path,
        PROPERTIES,
        'Get',
        new GLib.Variant('(ss)', [INTERFACE, 'Visible']),
        new GLib.VariantType('(v)')
      );
      this._setVisible(reply.deepUnpack()[0].unpack() === true);
    } catch (e) {
      console.warn('d2da: Sushi Visible could not be read', e.message);
    }
  }

  _setVisible(visible) {
    if (visible === this._visible) return;
    this._visible = visible;
    this._onVisible(visible);
  }

  _subscribe() {
    if (this._subscriptions.length) return;
    this._subscriptions.push(
      bus().signal_subscribe(
        this._busName,
        INTERFACE,
        'SelectionEvent',
        this._path,
        null,
        Gio.DBusSignalFlags.NONE,
        (_conn, _sender, _path, _iface, _signal, params) => {
          const [direction] = params.deepUnpack();
          const delta = sushiStep(direction);
          if (delta !== 0) this._onStep(delta);
        }
      ),
      bus().signal_subscribe(
        this._busName,
        PROPERTIES,
        'PropertiesChanged',
        this._path,
        INTERFACE,
        Gio.DBusSignalFlags.NONE,
        (_conn, _sender, _path, _iface, _signal, params) => {
          const [, changed] = params.deepUnpack();
          if (!('Visible' in changed)) return;
          this._setVisible(changed.Visible.unpack() === true);
        }
      )
    );
  }

  destroy() {
    this._subscriptions.forEach((id) => bus().signal_unsubscribe(id));
    this._subscriptions = [];
    this._visible = false;
    this._requested = false;
  }
}
