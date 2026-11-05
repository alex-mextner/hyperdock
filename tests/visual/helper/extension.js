// Test-only extension driven by tools/visual-shell.sh (never shipped, see publish.sh).
//
// On enable it pins the favorites to D2DA_SHOT_FAVORITES (comma separated .desktop ids),
// waits D2DA_SHOT_DELAY_MS so the dock under test has built and settled, then saves the
// whole stage to $D2DA_SHOT_DIR/frame.png and logs `d2da-shot: saved <path>` (or an error).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class VisualHelper extends Extension {
  enable() {
    const dir = GLib.getenv('D2DA_SHOT_DIR');
    if (!dir) {
      console.error('d2da-shot: D2DA_SHOT_DIR is not set');
      return;
    }
    const favorites = (GLib.getenv('D2DA_SHOT_FAVORITES') ?? '').split(',').filter(Boolean);
    if (favorites.length) {
      new Gio.Settings({ schema_id: 'org.gnome.shell' }).set_strv('favorite-apps', favorites);
    }
    // D2DA_SHOT_SCALE: logical scale of the (virtual) monitor, e.g. 1.5 (fractional)
    const scale = Number(GLib.getenv('D2DA_SHOT_SCALE') ?? 0);
    if (scale > 0) this._applyScale(scale);
    // D2DA_SHOT_NO_OVERVIEW=1: the shell starts in the overview; the windows are the shot's subject
    if (GLib.getenv('D2DA_SHOT_NO_OVERVIEW') === '1') {
      this._overviewTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        this._overviewTimer = 0;
        Main.overview.hide();
        return GLib.SOURCE_REMOVE;
      });
    }
    // D2DA_SHOT_COLOR_SCHEME: 'prefer-light' | 'prefer-dark' | 'default' (this shell's in-memory GSettings)
    const scheme = GLib.getenv('D2DA_SHOT_COLOR_SCHEME');
    if (scheme) new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' }).set_string('color-scheme', scheme);
    const delay = Number(GLib.getenv('D2DA_SHOT_DELAY_MS') ?? 8000);
    // D2DA_SHOT_BOUNCE=1: bounce the first dock icon so the shot is taken mid-bounce
    if (GLib.getenv('D2DA_SHOT_BOUNCE') === '1') {
      this._bounceTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay - 450, () => {
        this._bounceTimer = 0;
        this._bounce();
        return GLib.SOURCE_REMOVE;
      });
    }
    this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this._timer = 0;
      this._capture(GLib.build_filenamev([dir, 'frame.png']));
      return GLib.SOURCE_REMOVE;
    });
  }

  disable() {
    if (this._timer) GLib.source_remove(this._timer);
    this._timer = 0;
    if (this._overviewTimer) GLib.source_remove(this._overviewTimer);
    this._overviewTimer = 0;
    if (this._bounceTimer) GLib.source_remove(this._bounceTimer);
    this._bounceTimer = 0;
  }

  _bounce() {
    try {
      const dock = Main.extensionManager.lookup('hyperdock@alex-mextner.github.com').stateObj.docks[0];
      dock.animator.bounceIcon(dock._icons[0]._appwell, 3);
    } catch (e) {
      console.error('d2da-shot: bounce failed', e);
    }
  }

  // Puts the first monitor on the supported scale nearest to `scale` through the
  // shell's own DisplayConfig (the nested shell's private bus), as the user's
  // fractional scaling does. The experimental feature is set in this shell's
  // in-memory GSettings only.
  _applyScale(scale) {
    try {
      new Gio.Settings({ schema_id: 'org.gnome.mutter' }).set_strv('experimental-features', [
        'scale-monitor-framebuffer',
      ]);
      // the shell serves DisplayConfig itself: a synchronous call would wait for its own main loop
      Gio.DBusProxy.new_for_bus(
        Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
        'org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
        'org.gnome.Mutter.DisplayConfig', null,
        (_source, proxyRes) => {
          try {
            this._applyScaleOn(Gio.DBusProxy.new_for_bus_finish(proxyRes), scale);
          } catch (e) {
            console.error('d2da-shot: scale failed', e);
          }
        }
      );
    } catch (e) {
      console.error('d2da-shot: scale failed', e);
    }
  }

  _applyScaleOn(proxy, scale) {
    proxy.call('GetCurrentState', null, Gio.DBusCallFlags.NONE, -1, null, (_p, res) => {
      try {
        const [serial, monitors] = proxy.call_finish(res).deepUnpack();
        const [[connector], modes] = monitors[0];
        const mode = modes.find((m) => m[6]['is-current']?.unpack()) ?? modes[0];
        const supported = mode[5];
        const best = supported.reduce((x, y) => (Math.abs(y - scale) < Math.abs(x - scale) ? y : x));
        const config = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
          serial, 1, [[0, 0, best, 0, true, [[connector, mode[0], {}]]]], {},
        ]);
        proxy.call('ApplyMonitorsConfig', config, Gio.DBusCallFlags.NONE, -1, null, (_q, applied) => {
          try {
            proxy.call_finish(applied);
            console.log(`d2da-shot: scale ${best} (asked ${scale}, supported ${supported.join(',')})`);
          } catch (e) {
            console.error('d2da-shot: scale failed', e);
          }
        });
      } catch (e) {
        console.error('d2da-shot: scale failed', e);
      }
    });
  }

  _capture(path) {
    try {
      const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
      const shot = new Shell.Screenshot();
      shot.screenshot(false, stream, (_obj, res) => {
        try {
          shot.screenshot_finish(res);
          stream.close(null);
          console.log(`d2da-shot: saved ${path}`);
        } catch (e) {
          console.error('d2da-shot: screenshot failed', e);
        }
      });
    } catch (e) {
      console.error('d2da-shot: capture failed', e);
    }
  }
}
