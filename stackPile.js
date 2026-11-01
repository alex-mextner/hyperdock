'use strict';

// Stack dock icon as a pile of the newest real items: apps/stack-pile.js draws
// it, this class is the shell-side wrapper, modelled on GlassTrash (apps/trash.js).
//
// Cost model, by design: the picture is redrawn only when a stack's newest
// items change, in a separate gjs process, so thumbnail decoding and Cairo never
// run on the compositor's main loop. It arrives as PNG bytes wrapped in a
// Gio.BytesIcon, which the dock shows like any other icon texture (a BytesIcon
// has no string form, so St's texture cache does not pin old pictures, and no
// temp files are left behind).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// drawn once at a size that stays sharp when the dock magnifies the icon
const PICTURE_SIZE = 256;

export class StackPile {
  constructor(extensionPath, onChanged, pictureSize = PICTURE_SIZE) {
    this._argv = [
      GLib.find_program_in_path('gjs') ?? '/usr/bin/gjs',
      '-m',
      GLib.build_filenamev([extensionPath, 'apps', 'stack-pile.js']),
      `${pictureSize}`,
    ];
    this._onChanged = onChanged;
    this._cancellable = new Gio.Cancellable();
    this._proc = null;
    this._pending = null;
    this.gicon = null;
  }

  // layers: [{x, y, angle, scale, file, type, name, icon}], back to front. A
  // request while a picture is being drawn is drawn once more afterwards, so
  // the last request always wins. `plate` (optional) puts the pile on a
  // translucent rounded square, see apps/stack-pile.js.
  render(layers, plate = null) {
    if (!this._cancellable) return;
    if (this._proc) {
      this._pending = { layers, plate };
      return;
    }
    this._pending = null;
    let input = JSON.stringify({ layers, plate });
    try {
      this._proc = Gio.Subprocess.new(
        this._argv,
        Gio.SubprocessFlags.STDIN_PIPE |
          Gio.SubprocessFlags.STDOUT_PIPE |
          Gio.SubprocessFlags.STDERR_SILENCE
      );
    } catch (e) {
      console.error('d2da: stack pile', e);
      return;
    }
    this._proc.communicate_async(
      GLib.Bytes.new(new TextEncoder().encode(input)),
      this._cancellable,
      (proc, res) => this._finished(proc, res)
    );
  }

  _finished(proc, res) {
    let png = null;
    try {
      let [, stdout] = proc.communicate_finish(res);
      if (proc.get_successful() && stdout && stdout.get_size() > 0) {
        png = stdout;
      }
    } catch (e) {
      if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        console.error('d2da: stack pile', e);
      }
    }
    if (this._proc === proc) this._proc = null;
    if (!this._cancellable) return;
    if (png) {
      this.gicon = Gio.BytesIcon.new(png);
      this._onChanged?.();
    }
    if (this._pending) this.render(this._pending.layers, this._pending.plate);
  }

  destroy() {
    this._cancellable?.cancel();
    this._cancellable = null;
    this._proc?.force_exit();
    this._proc = null;
    this._pending = null;
    this._onChanged = null;
    this.gicon = null;
  }
}
