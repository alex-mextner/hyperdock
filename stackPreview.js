'use strict';

// Quick Look for the stack dropdowns: the controller Space opens
// (StackInteraction's `preview` mode drives it through open / update / close;
// keys are handled there, this file only draws and talks to Sushi).
// Images and text files, and every type when Sushi is missing or switched off
// (setting stack-preview-sushi), are drawn by the built-in overlay named
// d2daStackPreview: the picture scaled to at most 90% of the work area, the
// first 4 KiB of a text file, or the thumbnail / type icon, with name, type,
// size and date underneath. Other types go to Sushi (stackSushi.js). The
// choice and the walk over the items are pure (stackPreviewModel.js).

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { StackSushi } from './stackSushi.js';
import { smoothScaling } from './textureFilters.js';
import {
  TEXT_PREVIEW_BYTES,
  clipText,
  exifOrientation,
  fitSize,
  orientedSize,
  previewKind,
  previewRoute,
  previewWalk,
  walkStep,
} from './stackPreviewModel.js';

const INFO_ATTRIBUTES = [
  'standard::size',
  'standard::icon',
  'standard::content-type',
  'standard::display-name',
  'time::modified',
  'thumbnail::path',
].join(',');
// an EXIF block sits in the first segments of a JPEG
const EXIF_HEAD_BYTES = 65536;
const WORK_AREA_SHARE = 0.9;
// room the title, the details line and the card padding take under the picture
const CHROME_HEIGHT = 120;
const CARD_PADDING = 20;
const CARD_STYLE = `background-color: rgba(28, 28, 30, 0.97); border-radius: 14px; padding: ${CARD_PADDING}px; spacing: 10px;`;
const ICON_SIZE = 192;
const TEXT_WIDTH = 720;

Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');
Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async', 'new_from_stream_finish');

function formatDate(seconds) {
  return GLib.DateTime.new_from_unix_local(seconds).format('%e %B %Y, %H:%M').trim();
}

export class StackPreview {
  // settings: the extension's Gio.Settings (stack-preview-sushi)
  // onFocus(number): Sushi's arrow keys moved the preview to another item
  // onSushiVisible(visible): the Sushi window appeared or went away, so the
  //   dropdown can give its modal grab back to the compositor and take it again
  // onDismissed(): the preview ended by itself (Esc inside the Sushi window)
  // monitorIndex: the monitor of the dropdown, where the overlay is drawn
  // busName: only a test replaces Sushi's own bus name
  constructor({ settings, monitorIndex, onFocus, onSushiVisible, onDismissed, busName }) {
    this._settings = settings;
    this._monitorIndex = monitorIndex;
    this._grabReleased = false;
    this._onFocus = onFocus;
    this._onSushiVisible = onSushiVisible;
    this._onDismissed = onDismissed;
    this._items = [];
    this._walk = null;
    this._route = null;
    this._generation = 0;
    this._actor = null;
    this._sushi = new StackSushi({
      onStep: (delta) => this._sushiStep(delta),
      onVisible: (visible) => this._sushiVisible(visible),
      busName,
    });
  }

  get isOpen() {
    return this._walk !== null;
  }

  // items: [{ number, uri, path, name, mime }]; Left/Right walk them by
  // ascending number, as StackInteraction steps them. counted: show "n of m"
  // (a multi-selection)
  open(items, focusNumber, counted = false) {
    this.close();
    this._items = items;
    this._counted = counted && items.length >= 2;
    this._walk = previewWalk(items, this._counted ? items.map((i) => i.number) : [], focusNumber);
    if (!this._walk) return;
    this._show();
  }

  // the preview moves to another item of the walk (Core handled the key)
  update(focusNumber) {
    if (!this._walk) return;
    const index = this._walk.numbers.indexOf(focusNumber);
    if (index < 0 || index === this._walk.index) return;
    this._walk = walkStep(this._walk, index - this._walk.index);
    this._show();
  }

  close() {
    this._end();
    this._sushi.close();
  }

  // the preview is over: whatever is still being loaded must not appear
  _end() {
    this._generation++;
    this._walk = null;
    this._route = null;
    this._hideOverlay();
  }

  destroy() {
    this.close();
    this._sushi.destroy();
  }

  _item() {
    return this._items.find((i) => i.number === this._walk.current);
  }

  async _show() {
    const generation = ++this._generation;
    const item = this._item();
    const candidate = previewKind(item.mime) === 'other' && this._settings.get_boolean('stack-preview-sushi');
    const sushiAvailable = candidate && (await this._sushi.available());
    if (generation !== this._generation) return;
    this._route = previewRoute(
      item.mime,
      { sushiAvailable, sushiEnabled: this._settings.get_boolean('stack-preview-sushi') },
      { isDir: item.mime === 'inode/directory', hasUri: !!item.uri }
    );
    if (this._route === 'sushi') {
      const shown = await this._sushi.show(item.uri);
      if (generation !== this._generation) {
        // the preview moved on while Sushi was starting: it must not stay
        if (shown && this._route !== 'sushi') this._sushi.close();
        return;
      }
      if (shown) {
        this._hideOverlay();
        return;
      }
      if (generation !== this._generation) return;
      this._route = 'overlay';
    }
    this._sushi.close();
    await this._drawOverlay(item, generation);
  }

  _sushiStep(delta) {
    if (!this._walk || this._route !== 'sushi') return;
    const next = walkStep(this._walk, delta);
    if (next === this._walk) return;
    this._walk = next;
    this._onFocus(next.current);
    this._show();
  }

  // Only our own window concerns the dropdown: a Sushi that Files opened, or
  // one we asked to close, must not make it drop or take back its grab.
  _sushiVisible(visible) {
    const ours = this._walk !== null && this._route === 'sushi';
    if (visible) {
      if (!ours) return;
      this._grabReleased = true;
      this._onSushiVisible(true);
      return;
    }
    if (this._grabReleased) {
      this._grabReleased = false;
      this._onSushiVisible(false);
    }
    if (ours) {
      this._end();
      this._onDismissed();
    }
  }

  _monitorBox() {
    const index = this._monitorIndex;
    const area = Main.layoutManager.getWorkAreaForMonitor(index);
    return { area, scale: global.display.get_monitor_scale(index) };
  }

  async _drawOverlay(item, generation) {
    const { area, scale } = this._monitorBox();
    const maxW = Math.floor(area.width * WORK_AREA_SHARE) - 2 * CARD_PADDING;
    const maxH = Math.floor(area.height * WORK_AREA_SHARE) - CHROME_HEIGHT - 2 * CARD_PADDING;
    const file = item.path ? Gio.File.new_for_path(item.path) : Gio.File.new_for_uri(item.uri);
    let info = null;
    try {
      info = await file.query_info_async(INFO_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
    } catch (e) {
      console.warn('d2da: Quick Look could not read', item.uri, e.message);
    }
    if (generation !== this._generation) return;
    const kind = previewKind(info?.get_content_type() ?? item.mime);
    const body = new St.Bin({ x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
    const content = await this._content(kind, file, info, { maxW, maxH, scale });
    if (generation !== this._generation) {
      content.destroy();
      body.destroy();
      return;
    }
    body.set_child(content);
    this._replaceOverlay(item, info, body, area);
  }

  async _content(kind, file, info, box) {
    if (kind === 'image' && file.get_path()) {
      const picture = await this._picture(file, box);
      if (picture) return picture;
    }
    if (kind === 'text') {
      const text = await this._text(file, info, box);
      if (text) return text;
    }
    const thumbnail = info?.get_attribute_byte_string('thumbnail::path');
    if (thumbnail) {
      const picture = await this._picture(Gio.File.new_for_path(thumbnail), box);
      if (picture) return picture;
    }
    return new St.Icon({ gicon: info?.get_icon() ?? new Gio.ThemedIcon({ name: 'text-x-generic' }), icon_size: ICON_SIZE });
  }

  // The picture scaled to fit the box, or null when no gdk-pixbuf loader knows
  // the type (RAW, PSD: the caller falls back to the thumbnail or the icon).
  // A JPEG stored on its side (EXIF orientation 5 to 8, or 2 to 4 mirrored or
  // upside down) goes through GdkPixbuf, because St.TextureCache ignores the
  // orientation; every other picture is decoded by the texture cache.
  async _picture(file, box) {
    const [format, width, height] = GdkPixbuf.Pixbuf.get_file_info(file.get_path());
    if (!format || !(width > 0) || !(height > 0)) return null;
    const orientation = format.get_name() === 'jpeg' ? await this._orientation(file) : 1;
    if (orientation > 1) {
      const upright = await this._uprightPicture(file, orientedSize(width, height, orientation), orientation, box);
      if (upright) return upright;
    }
    return this._cachedPicture(file, width, height, box);
  }

  async _orientation(file) {
    let stream = null;
    try {
      stream = await file.read_async(GLib.PRIORITY_DEFAULT, null);
      const bytes = await stream.read_bytes_async(EXIF_HEAD_BYTES, GLib.PRIORITY_DEFAULT, null);
      return exifOrientation(bytes.toArray());
    } catch (e) {
      console.warn('d2da: Quick Look cannot read the orientation of', file.get_uri(), e.message);
      return 1;
    } finally {
      stream?.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
    }
  }

  // only the longer side is bounded for the texture cache (bounding both
  // stretches it)
  _cachedPicture(file, width, height, { maxW, maxH, scale }) {
    const [w, h] = fitSize(width, height, maxW, maxH);
    const landscape = w >= h;
    const picture = St.TextureCache.get_default().load_file_async(
      file,
      landscape ? w : -1,
      landscape ? -1 : h,
      1,
      scale
    );
    smoothScaling(picture);
    picture.set_size(w, h);
    return picture;
  }

  // decoded scaled down to the box (as stored, so the box is turned back),
  // then turned upright by its EXIF orientation
  async _uprightPicture(file, [shownW, shownH], orientation, { maxW, maxH, scale }) {
    const [w, h] = fitSize(shownW, shownH, maxW, maxH);
    const sideways = orientation >= 5;
    let stream = null;
    try {
      stream = await file.read_async(GLib.PRIORITY_DEFAULT, null);
      const decoded = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
        stream,
        Math.round((sideways ? h : w) * scale),
        Math.round((sideways ? w : h) * scale),
        true,
        null
      );
      const upright = decoded.apply_embedded_orientation();
      const content = St.ImageContent.new_with_preferred_size(upright.get_width(), upright.get_height());
      content.set_bytes(
        global.stage.context.get_backend().get_cogl_context(),
        upright.read_pixel_bytes(),
        upright.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
        upright.get_width(),
        upright.get_height(),
        upright.get_rowstride()
      );
      return new Clutter.Actor({ content, width: w, height: h, content_gravity: Clutter.ContentGravity.RESIZE_ASPECT });
    } catch (e) {
      console.warn('d2da: Quick Look cannot turn', file.get_uri(), 'upright', e.message);
      return null;
    } finally {
      stream?.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
    }
  }

  async _text(file, info, { maxW, maxH }) {
    let stream = null;
    try {
      stream = await file.read_async(GLib.PRIORITY_DEFAULT, null);
      const bytes = await stream.read_bytes_async(TEXT_PREVIEW_BYTES, GLib.PRIORITY_DEFAULT, null);
      const { text, truncated } = clipText(bytes.toArray(), TEXT_PREVIEW_BYTES, info?.get_size() ?? 0);
      const label = new St.Label({
        text: truncated ? `${text}\n…` : text,
        style: `font-family: monospace; font-size: 11pt; color: #e6e6e6; max-width: ${Math.min(TEXT_WIDTH, maxW)}px; max-height: ${maxH}px;`,
      });
      label.clutter_text.line_wrap = true;
      label.clutter_text.line_wrap_mode = 2; // Pango.WrapMode.WORD_CHAR
      label.clip_to_allocation = true;
      return label;
    } catch (e) {
      console.warn('d2da: Quick Look could not read the text of', file.get_uri(), e.message);
      return null;
    } finally {
      stream?.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
    }
  }

  _details(item, info) {
    const mime = info?.get_content_type() ?? item.mime;
    const parts = [mime ? Gio.content_type_get_description(mime) : 'File'];
    if (info && mime !== 'inode/directory') parts.push(GLib.format_size(info.get_size()));
    const modified = info?.get_attribute_uint64('time::modified');
    if (modified) parts.push(formatDate(modified));
    return parts.join('  ·  ');
  }

  _replaceOverlay(item, info, body, area) {
    this._hideOverlay();
    const card = new St.BoxLayout({
      vertical: true,
      style: CARD_STYLE,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    card.add_child(body);
    const title = this._walk.label ? `${item.name}   (${this._walk.label})` : item.name;
    const titleLabel = new St.Label({
      name: 'd2daStackPreviewTitle',
      text: title,
      x_align: Clutter.ActorAlign.CENTER,
      style: 'font-weight: bold; font-size: 14pt; color: white;',
    });
    titleLabel.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
    card.add_child(titleLabel);
    card.add_child(
      new St.Label({
        name: 'd2daStackPreviewDetails',
        text: this._details(item, info),
        x_align: Clutter.ActorAlign.CENTER,
        style: 'font-size: 10pt; color: rgba(255, 255, 255, 0.6);',
      })
    );
    const overlay = new St.Widget({
      name: 'd2daStackPreview',
      layout_manager: new Clutter.BinLayout(),
      reactive: false,
      style: 'background-color: rgba(0, 0, 0, 0.45);',
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    });
    overlay.add_child(card);
    Main.uiGroup.add_child(overlay);
    Main.uiGroup.set_child_above_sibling(overlay, null);
    this._actor = overlay;
  }

  _hideOverlay() {
    this._actor?.destroy();
    this._actor = null;
  }
}
