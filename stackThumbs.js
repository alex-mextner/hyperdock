'use strict';

// Pictures for the files of a stack dropdown (Grid, List and the fan), without
// ever decoding a big image inside gnome-shell:
//   * a file with a current freedesktop thumbnail (the model's `item.thumb`, from
//     GIO's thumbnail::path) shows it: a small PNG St's texture cache decodes off
//     the main loop;
//   * a picture without one is made by apps/thumbnailer.js in another process
//     (thumbQueue.js orders the work: what the open dropdown shows first) and
//     appears in place of the type icon when it is done;
//   * everything else keeps its type icon.
//
// What this replaces: for every picture the dropdown asked gdk-pixbuf for the
// size of the FILE ITSELF on the main loop (20-40 ms each for a screenshot: 3 s
// for 150 of them) and then decoded it whole when no thumbnail was found in
// the `large`/`normal` folders (the cache also has `x-large`).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { smoothScaling } from './textureFilters.js';
import { ThumbQueue, fitSize, pngSize, thumbnailable } from './thumbQueue.js';

Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async');

// workers run side by side, each making a few files per run
const WORKERS = 2;
const BATCH = 3;

// does a worker have to make this item's picture?
function needsThumbnail(item) {
  return !!item.path && !item.thumb && !item.thumbFailed && thumbnailable(item.type);
}

// Makes thumbnails for items in the background, a few files per worker run.
export class ThumbnailService {
  constructor(extensionPath) {
    this._argv = [
      GLib.find_program_in_path('gjs') ?? '/usr/bin/gjs',
      '-m',
      GLib.build_filenamev([extensionPath, 'apps', 'thumbnailer.js']),
    ];
    this._queue = new ThumbQueue(BATCH);
    this._procs = new Set();
    this._cancellable = new Gio.Cancellable();
  }

  // Asks for the pictures of `items` (those that have one already are skipped).
  // `onReady()` runs when an item's thumbnail exists (item.thumb is set on every
  // object asked for) or is known to be impossible (item.thumbFailed). `urgent`
  // puts them before everything waiting. Returns {cancel()}: the paths nobody
  // else waits for are dropped from the queue.
  request(items, onReady = null, urgent = true) {
    if (!this._cancellable) return { cancel() {} };
    const cancel = this._queue.request(items.filter(needsThumbnail), onReady, urgent);
    this._pump();
    return { cancel };
  }

  // nothing is waiting and no worker is running
  isIdle() {
    return this._procs.size === 0 && this._queue.size === 0;
  }

  _pump() {
    while (this._cancellable && this._procs.size < WORKERS && this._queue.size > 0) this._start(this._queue.take());
  }

  _start(batch) {
    let proc;
    try {
      proc = Gio.Subprocess.new(
        [...this._argv, ...batch],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
      );
    } catch (e) {
      console.error('d2da: thumbnailer', e);
      batch.forEach((path) => this._finish(path, null));
      return;
    }
    this._procs.add(proc);
    this._read(proc, batch).catch((e) => {
      if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) console.error('d2da: thumbnailer', e);
    });
  }

  async _read(proc, batch) {
    const lines = new Gio.DataInputStream({ base_stream: proc.get_stdout_pipe() });
    const reported = new Set();
    try {
      for (;;) {
        const [line] = await lines.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable);
        if (line === null) break;
        const { path, thumb, mtime } = JSON.parse(new TextDecoder().decode(line));
        reported.add(path);
        this._finish(path, thumb, mtime);
      }
    } finally {
      this._procs.delete(proc);
      // a worker that died leaves the rest of its batch without a picture
      batch.filter((path) => !reported.has(path)).forEach((path) => this._finish(path, null));
      this._pump();
    }
  }

  _finish(path, thumb, mtime = null) {
    this._queue.finish(path, thumb, mtime).forEach((callback) => {
      try {
        callback();
      } catch (e) {
        console.error('d2da: thumbnail callback', e);
      }
    });
  }

  destroy() {
    this._cancellable?.cancel();
    this._cancellable = null;
    this._procs.forEach((proc) => proc.force_exit());
    this._procs.clear();
    this._queue.abandon();
  }
}

// ---- showing a picture ------------------------------------------------------

// the first 24 bytes of a PNG file: its size (see thumbQueue.pngSize)
function readPngSize(path) {
  try {
    const stream = Gio.File.new_for_path(path).read(null);
    try {
      return pngSize(stream.read_bytes(24, null).toArray());
    } finally {
      stream.close(null);
    }
  } catch {
    return null;
  }
}

function typeIcon(item, size) {
  const gicon = item.gicon ?? item.fileInfo?.get_icon?.();
  return new St.Icon(gicon ? { gicon, icon_size: size } : { icon_name: item.icon || 'text-x-generic', icon_size: size });
}

// the thumbnail at `path` as a picture that fits a size x size box, or null
function pictureActor(path, size, scale, resourceScale) {
  const dims = readPngSize(path);
  if (!dims) return null;
  // both sides are given in the aspect of the picture, so nothing is stretched
  const fit = fitSize(dims.w, dims.h, size);
  const picture = St.TextureCache.get_default().load_file_async(
    Gio.File.new_for_path(path),
    fit.w,
    fit.h,
    scale,
    resourceScale
  );
  smoothScaling(picture);
  picture.x_align = Clutter.ActorAlign.CENTER;
  picture.y_align = Clutter.ActorAlign.CENTER;
  return picture;
}

// Puts a size x size (logical px) box showing `item` into `bin` (an St.Bin):
// its type icon at once, its picture as soon as there is one. `service` is the
// ThumbnailService that makes missing pictures (null: only cached ones show).
// `scale` is the paint scale of St's texture cache, `resourceScale` its resource
// scale; `urgent` (the cell is in view) makes its picture before those of cells
// that are only near the window.
export function fillThumbnail(bin, item, size, { scale, resourceScale = 1, service, urgent = true }) {
  bin.set_child(typeIcon(item, size));
  const show = () => {
    const picture = item.thumb ? pictureActor(item.thumb, size, scale, resourceScale) : null;
    if (picture) bin.set_child(picture);
    return !!picture;
  };
  if (item.thumb && show()) return;
  // a thumbnail that was removed or cannot be read is made again
  item.thumb = null;
  if (!service || !needsThumbnail(item)) return;
  const request = service.request([item], show, urgent);
  bin.connect('destroy', () => request.cancel());
  // the cell came into view: its picture jumps ahead of those near the window
  bin._promote = () => service.request([item], show, true);
}

// The picture a stack icon shows for its top item when no pile is drawn yet:
// the item's cached thumbnail, else its type icon. Never the file itself.
export function stackIconFor(item) {
  if (!item) return null;
  if (item.thumb) return new Gio.FileIcon({ file: Gio.File.new_for_path(item.thumb) });
  return item.gicon ?? item.fileInfo?.get_icon?.() ?? null;
}
