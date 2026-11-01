'use strict';

// The pure part of the thumbnails of stack dropdowns (no gi:// imports, so
// tests/thumb_queue_check.js runs it under plain gjs): which files get a
// picture, the order they are made in, and the sizes pictures are shown at.
//
// Why thumbnails are made in another process (stackThumbs.js, apps/thumbnailer.js):
// decoding a screenshot takes tens of milliseconds (a 2560x1440 PNG: 20-40 ms
// just to read its size with gdk-pixbuf 2.44), the compositor's main loop must
// never wait for that. A file that already has a freedesktop thumbnail (GIO
// reports it as `thumbnail::path`) needs no worker at all.

// What a worker can make a picture of. Everything else keeps its type icon;
// already cached thumbnails of any type are used as they are.
export function thumbnailable(contentType) {
  const type = contentType ?? '';
  return type.startsWith('image/') || type === 'application/pdf';
}

// The order thumbnails are made in, and who wants which picture. `urgent`
// requests (what the open dropdown shows) go before everything waiting, the
// newest request first; the rest (warming the first page of a stack) queue
// behind. A path is queued once however many items and listeners ask for it:
// the listing of a folder replaces its item objects, and every object that was
// asked for gets the picture, the one an open dropdown shows included.
export class ThumbQueue {
  constructor(batchSize = 6) {
    this._batchSize = batchSize;
    this._waiting = [];
    this._making = new Set();
    this._wanted = new Map(); // path -> {items: Set, listeners: Set, kept: boolean}
  }

  get size() {
    return this._waiting.length;
  }

  has(path) {
    return this._waiting.includes(path) || this._making.has(path);
  }

  _want(path) {
    if (!this._wanted.has(path)) this._wanted.set(path, { items: new Set(), listeners: new Set(), kept: false });
    return this._wanted.get(path);
  }

  // Asks for the pictures of `items` ({path}, in the order given). `onReady`
  // (null: nobody waits, the picture is only made ahead) runs when a path is
  // finished. Returns the function that withdraws this request: a path nobody
  // else wants is taken off the queue.
  request(items, onReady = null, urgent = false) {
    const paths = items.map((item) => item.path);
    items.forEach((item) => {
      const want = this._want(item.path);
      want.items.add(item);
      if (onReady) want.listeners.add(onReady);
      else want.kept = true;
    });
    this.add(paths, urgent);
    return () => {
      const dropped = [];
      paths.forEach((path) => {
        const want = this._wanted.get(path);
        if (!want) return;
        want.listeners.delete(onReady);
        if (want.listeners.size === 0 && !want.kept) dropped.push(path);
      });
      this.remove(dropped);
      dropped.forEach((path) => this._wanted.delete(path));
    };
  }

  // `paths` keep their order among themselves
  add(paths, urgent = false) {
    const fresh = paths.filter((p) => !this._making.has(p));
    if (urgent) {
      this._waiting = [...fresh, ...this._waiting.filter((p) => !fresh.includes(p))];
    } else {
      this._waiting.push(...fresh.filter((p) => !this._waiting.includes(p)));
    }
  }

  remove(paths) {
    this._waiting = this._waiting.filter((p) => !paths.includes(p));
  }

  // up to batchSize paths to make now; they count as being made until finish()
  take() {
    const batch = this._waiting.splice(0, this._batchSize);
    batch.forEach((p) => this._making.add(p));
    return batch;
  }

  // `path` is done: `thumb` is its thumbnail file, or null when it cannot have
  // one, made from the file as it was at `mtime` (seconds; null: not known).
  // Every item that asked, and is that version of the file, gets `thumb` (or
  // `thumbFailed`); an item for a file that changed while the worker was at it
  // (the folder was listed again meanwhile) is asked for again; an item older
  // than the file that was read is dropped, its newer replacement has asked.
  // Returns the listeners to tell.
  finish(path, thumb, mtime = null) {
    this._making.delete(path);
    const want = this._wanted.get(path);
    if (!want) return [];
    const stale = new Set();
    want.items.forEach((item) => {
      const seen = item.date?.tv_sec;
      if (mtime !== null && seen !== undefined && seen > mtime) {
        // listed after the version that was made: ask again
        stale.add(item);
      } else if (mtime !== null && seen !== undefined && seen < mtime) {
        // an older listing than the file the worker read: superseded, its
        // successor (a newer item for this path) has been asked for
      } else if (thumb) {
        item.thumb = thumb;
      } else {
        item.thumbFailed = true;
      }
    });
    const listeners = [...want.listeners];
    if (stale.size === 0) {
      this._wanted.delete(path);
    } else {
      want.items = stale;
      this.add([path], true);
    }
    return listeners;
  }

  // a worker that died with paths unfinished: they may be asked for again
  abandon() {
    this._making.clear();
  }
}

// The size a picture of w x h is shown at inside a box x box square: the longer
// side is the box, the aspect is kept, nothing is enlarged past `max` times.
export function fitSize(w, h, box) {
  if (!(w > 0) || !(h > 0)) return { w: box, h: box };
  const k = box / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// The size of a PNG from its first 24 bytes (signature + IHDR), or null. Every
// freedesktop thumbnail is a PNG, and reading 24 bytes costs microseconds where
// gdk-pixbuf's get_file_info costs tens of milliseconds.
export function pngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return null;
  const word = (at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  if (word(12) !== 0x49484452) return null; // "IHDR"
  const w = word(16);
  const h = word(20);
  return w > 0 && h > 0 ? { w, h } : null;
}
