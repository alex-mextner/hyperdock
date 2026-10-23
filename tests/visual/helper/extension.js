// Test-only extension driven by tools/visual-shell.sh (never shipped, see publish.sh).
//
// On enable it pins the favorites to D2DA_SHOT_FAVORITES (comma separated .desktop ids),
// waits D2DA_SHOT_DELAY_MS so the dock under test has built and settled, then saves the
// whole stage to $D2DA_SHOT_DIR/frame.png and logs `d2da-shot: saved <path>` (or an error).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
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
    const delay = Number(GLib.getenv('D2DA_SHOT_DELAY_MS') ?? 8000);
    this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this._timer = 0;
      this._capture(GLib.build_filenamev([dir, 'frame.png']));
      return GLib.SOURCE_REMOVE;
    });
  }

  disable() {
    if (this._timer) GLib.source_remove(this._timer);
    this._timer = 0;
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
