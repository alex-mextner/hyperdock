// Per-dock cache of icon size corrections. The opaque bbox of each gicon is
// measured once per (icon, size bucket) off the animation path: an idle
// callback queues the lookup and GdkPixbuf loads asynchronously. The animator
// only does a Map read when an actor's icon changes.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {
  IDENTITY_NORMALIZATION,
  normalization,
  opaqueBBox,
} from './iconGeometry.js';

const SIZE_BUCKETS = [64, 128, 256];

function bucketFor(size) {
  for (let b of SIZE_BUCKETS) {
    if (size <= b) return b;
  }
  return SIZE_BUCKETS[SIZE_BUCKETS.length - 1];
}

export class IconNormalizer {
  constructor() {
    this._theme = new St.IconTheme();
    this._cache = new Map();
    // another theme means other padding: measure everything again
    this._themeChangedId = St.TextureCache.get_default().connect(
      'icon-theme-changed',
      () => this._themeChanged()
    );
    this._queue = [];
    this._idleId = 0;
    this._cancellable = new Gio.Cancellable();
    // bumped whenever a measurement lands; actors re-read when it differs
    this.version = 0;
    this.onChange = null;
  }

  /**
   * @param {Gio.Icon|string|null} source gicon or themed icon name
   * @param {number} size renderer texture size, picks the lookup bucket
   * @returns {{k:number,dx:number,dy:number,fill:number}} identity until measured
   */
  get(source, size) {
    if (!source) {
      return IDENTITY_NORMALIZATION;
    }
    let gicon = typeof source === 'string' ? new Gio.ThemedIcon({ name: source }) : source;
    let id = typeof source === 'string' ? `name:${source}` : gicon.to_string();
    if (!id) {
      return IDENTITY_NORMALIZATION;
    }
    let bucket = bucketFor(size);
    let key = `${id}@${bucket}`;
    let hit = this._cache.get(key);
    if (hit) {
      return hit;
    }
    // reserve the slot so the same icon is not queued twice
    this._cache.set(key, IDENTITY_NORMALIZATION);
    this._queue.push({ key, gicon, bucket });
    if (!this._idleId) {
      this._idleId = GLib.idle_add(GLib.PRIORITY_LOW, () => this._drain());
    }
    return IDENTITY_NORMALIZATION;
  }

  _themeChanged() {
    // loads still in flight measured the old theme: drop their results
    this._cancellable.cancel();
    this._cancellable = new Gio.Cancellable();
    this._theme = new St.IconTheme();
    this._cache.clear();
    this._queue = [];
    this.version++;
    this.onChange?.();
  }

  _drain() {
    let job = this._queue.shift();
    if (!job) {
      this._idleId = 0;
      return GLib.SOURCE_REMOVE;
    }
    try {
      let info = this._theme.lookup_by_gicon(job.gicon, job.bucket, 0);
      if (!info) {
        return GLib.SOURCE_CONTINUE;
      }
      let cancellable = this._cancellable;
      info.load_icon_async(cancellable, (obj, res) => {
        if (!cancellable.is_cancelled()) this._loaded(job, obj, res);
      });
    } catch (e) {
      console.error(`d2da: icon lookup ${job.key}`, e);
    }
    return GLib.SOURCE_CONTINUE;
  }

  _loaded(job, info, res) {
    if (!this._theme) return;
    try {
      let pixbuf = info.load_icon_finish(res);
      let w = pixbuf.get_width();
      let h = pixbuf.get_height();
      let bbox = opaqueBBox(
        pixbuf.get_pixels(),
        w,
        h,
        pixbuf.get_rowstride(),
        pixbuf.get_has_alpha() ? pixbuf.get_n_channels() : 3
      );
      this._cache.set(job.key, Object.freeze(normalization(bbox, w, h)));
      this.version++;
      this.onChange?.();
    } catch (e) {
      if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        console.error(`d2da: icon measure ${job.key}`, e);
      }
    }
  }

  destroy() {
    if (this._themeChangedId) {
      St.TextureCache.get_default().disconnect(this._themeChangedId);
      this._themeChangedId = 0;
    }
    if (this._idleId) {
      GLib.source_remove(this._idleId);
      this._idleId = 0;
    }
    this._cancellable.cancel();
    this._queue = [];
    this._cache.clear();
    this.onChange = null;
    this._theme = null;
  }
}
