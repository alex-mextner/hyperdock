#!/usr/bin/env -S gjs -m
'use strict';

// Makes freedesktop thumbnails for the files named on the command line, one
// after the other, and reports each as it is done: one JSON line on stdout,
//   {"path": "/abs/file.png", "thumb": "/home/u/.cache/thumbnails/large/<md5>.png", "mtime": 1793551264}
// "mtime" is the modification time (seconds) of the file the thumbnail was made from,
// so the shell can tell a thumbnail of an older version from a current one.
// "thumb" is null when the file cannot have a thumbnail (not a picture the
// thumbnailers know, or one that failed before). The thumbnails are the
// shared ones (the same cache the file manager fills), so a file thumbnailed
// here shows in Files as well and the other way round, and GIO reports them
// as `thumbnail::path`.
//
// Why a separate process: decoding a screenshot takes tens of milliseconds and
// gnome-shell's main loop must never wait for it. The shell (stackThumbs.js)
// starts this for the files a dropdown shows or is about to show.
//
// usage: gjs -m thumbnailer.js <file>...

import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GioUnix from 'gi://GioUnix';
import GnomeDesktop from 'gi://GnomeDesktop?version=4.0';

// the `large` size of the freedesktop thumbnail cache
const THUMBNAIL_PX = 256;
const factory = GnomeDesktop.DesktopThumbnailFactory.new(GnomeDesktop.DesktopThumbnailSize.LARGE);
const out = new GioUnix.OutputStream({ fd: 1, close_fd: false });

function report(path, thumb, mtime) {
  const line = `${JSON.stringify({ path, thumb, mtime })}\n`;
  out.write_all(new TextEncoder().encode(line), null);
}

// The thumbnail picture. Images are scaled while they are decoded (a JPEG is
// decoded at 1/2, 1/4 or 1/8 size, 2-3 times faster than through the
// factory's sandboxed thumbnailer); everything else goes through the factory.
function render(path, uri, type) {
  if (type.startsWith('image/')) {
    try {
      const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(path, THUMBNAIL_PX, THUMBNAIL_PX);
      return pixbuf.apply_embedded_orientation() ?? pixbuf;
    } catch (e) {
      printerr(`thumbnailer: ${path}: ${e.message}`);
    }
  }
  return factory.generate_thumbnail(uri, type, null);
}

function thumbnailOf(path) {
  const file = Gio.File.new_for_path(path);
  const info = file.query_info('time::modified,standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
  const uri = file.get_uri();
  const mtime = info.get_attribute_uint64('time::modified');
  const type = info.get_content_type();
  return { mtime, thumb: thumbnailAt(path, uri, type, mtime) };
}

// the thumbnail of the file as it was at `mtime`, made if there is none
function thumbnailAt(path, uri, type, mtime) {
  const known = factory.lookup(uri, mtime);
  if (known) return known;
  if (factory.has_valid_failed_thumbnail(uri, mtime) || !factory.can_thumbnail(uri, type, mtime)) return null;
  const pixbuf = render(path, uri, type);
  if (!pixbuf) {
    factory.create_failed_thumbnail(uri, mtime, null);
    return null;
  }
  factory.save_thumbnail(pixbuf, uri, mtime, null);
  return factory.lookup(uri, mtime);
}

for (const path of ARGV) {
  let result = { thumb: null, mtime: null };
  try {
    result = thumbnailOf(path);
  } catch (e) {
    printerr(`thumbnailer: ${path}: ${e.message}`);
  }
  report(path, result.thumb, result.mtime);
}
