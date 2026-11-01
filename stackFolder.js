'use strict';

// The files of a folder stack, listed without blocking the main loop: the
// directory is enumerated asynchronously in chunks (the compositor draws
// between them), and the entries carry what the dropdown needs so that opening
// it asks the file system nothing more: type, dates, icon and the path of the
// freedesktop thumbnail GIO already knows (`thumbnail::path`).
//
// Before this, the listing was one synchronous enumerate_children/next_file loop
// on the main loop (and an icon theme lookup for every file), run on every
// change of the folder.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { STACK_MAX_FILES, sortStackItems } from './stackModel.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

const ATTRIBUTES = [
  Gio.FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
  Gio.FILE_ATTRIBUTE_STANDARD_NAME,
  Gio.FILE_ATTRIBUTE_STANDARD_ICON,
  Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
  Gio.FILE_ATTRIBUTE_TIME_CREATED,
  Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
  Gio.FILE_ATTRIBUTE_STANDARD_IS_HIDDEN,
  Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH,
  Gio.FILE_ATTRIBUTE_THUMBNAIL_IS_VALID,
  Gio.FILE_ATTRIBUTE_THUMBNAILING_FAILED,
].join(',');

// entries per next_files_async round trip
const CHUNK = 128;

// One stack item from its Gio.FileInfo. `iconName(names)` maps the icon's
// theme names to the one the theme has (it is memoized by the caller).
export function stackFileEntry(dir, info, iconName) {
  const name = info.get_name();
  const modified = info.get_modification_time();
  const names = info.get_icon()?.names;
  const valid = info.get_attribute_boolean(Gio.FILE_ATTRIBUTE_THUMBNAIL_IS_VALID);
  return {
    index: 0,
    name,
    display: name,
    icon: (names && iconName(names)) ?? 'file',
    type: info.get_content_type(),
    path: GLib.build_filenamev([dir, name]),
    date: modified ?? { tv_sec: 0 },
    // btime; GLib has no "date added", and moving a file in keeps its
    // btime on the same filesystem, so creation stands in for it.
    // Filesystems without btime fall back to the modification time.
    created: info.has_attribute(Gio.FILE_ATTRIBUTE_TIME_CREATED)
      ? info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_CREATED)
      : (modified?.tv_sec ?? 0),
    // the freedesktop thumbnail GIO found current for this file, if any; a
    // file the thumbnailers gave up on is not tried again
    thumb: valid ? info.get_attribute_byte_string(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH) : null,
    // GIO sets is-valid for a failure marker too: one older than the file
    // (it was repaired or replaced) does not count, the file is tried again
    thumbFailed: valid && info.get_attribute_boolean(Gio.FILE_ATTRIBUTE_THUMBNAILING_FAILED),
    fileInfo: info,
  };
}

// Lists `path` in the order `sort` names: {files, total}, `files` the first
// STACK_MAX_FILES, `total` all the visible files of the folder. Rejects with
// G_IO_ERROR_CANCELLED when `cancellable` is cancelled (the caller drops it).
// `iconOf(names)` resolves a themed icon name list (see stackFileEntry).
export async function listFolder(path, { sort, cancellable = null, iconOf }) {
  const icons = new Map();
  const iconName = (names) => {
    const key = names.join('\0');
    if (!icons.has(key)) icons.set(key, iconOf(names));
    return icons.get(key);
  };
  const directory = Gio.File.new_for_path(path);
  const enumerator = await directory.enumerate_children_async(
    ATTRIBUTES,
    Gio.FileQueryInfoFlags.NONE,
    GLib.PRIORITY_LOW,
    cancellable
  );
  const files = [];
  try {
    for (;;) {
      const infos = await enumerator.next_files_async(CHUNK, GLib.PRIORITY_LOW, cancellable);
      if (infos.length === 0) break;
      // hidden files stay out of the stack, as in Finder
      for (const info of infos) {
        if (!info.get_is_hidden()) files.push(stackFileEntry(path, info, iconName));
      }
    }
  } finally {
    enumerator.close_async(GLib.PRIORITY_LOW, null).catch(() => {});
  }
  const total = files.length;
  sortStackItems(files, sort);
  files.splice(STACK_MAX_FILES);
  return { files, total };
}
