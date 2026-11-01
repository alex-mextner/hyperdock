// gjs -m tests/recents_check.js — the file list behind folder stacks / recents
// (services.js checkRecentFilesInFolder: sort orders, hidden files, counts) against a
// real scratch directory. Exits 1 on failure.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { importWithStubs, createChecker } from './harness.js';

const { check, finish } = createChecker();
const { module } = await importWithStubs('services.js');

const dir = GLib.dir_make_tmp('d2da-recents-XXXXXX');
const touch = (name, mtime) => {
  const path = GLib.build_filenamev([dir, name]);
  GLib.file_set_contents(path, name);
  const file = Gio.File.new_for_path(path);
  file.set_attribute_uint64('time::modified', mtime, Gio.FileQueryInfoFlags.NONE, null);
};
touch('old.txt', 1_000_000);
touch('newest.txt', 3_000_000);
touch('middle.txt', 2_000_000);
touch('.hidden', 4_000_000);
touch('Item 10.txt', 500_000);
touch('Item 2.txt', 500_000);

const services = Object.create(module.Services.prototype);
services.extension = { lookup_icon_from_names: (names) => names[0] };

const names = (files) => files.map((f) => f.name);
// console.log is read-only in gjs; swallow the services' own progress logging at the GLib
// log writer so the check output stays readable
let prefixedErrors = 0;
GLib.log_set_writer_func((level, fields) => {
  const message = new TextDecoder().decode(fields.MESSAGE ?? new Uint8Array());
  if (message.startsWith('d2da: services checkRecentFilesInFolder')) prefixedErrors++;
  else if (!message.startsWith('checking ')) print(`log: ${message}`);
  return GLib.LogWriterOutput.HANDLED;
});
try {
  const [byDate, total] = await services.checkRecentFilesInFolder(dir);
  check(total === 5, 'hidden files are not counted');
  check(!names(byDate).includes('.hidden'), 'hidden files stay out of the stack');
  check(
    names(byDate).slice(0, 3).join() === 'newest.txt,middle.txt,old.txt',
    'date-modified sort: newest first'
  );
  check(byDate.every((f, i) => f.index === i), 'each file carries its position');
  check(byDate[0].path === GLib.build_filenamev([dir, 'newest.txt']), 'path is the full file path');

  const [byName] = await services.checkRecentFilesInFolder(dir, 'name');
  check(
    names(byName).join() === 'Item 2.txt,Item 10.txt,middle.txt,newest.txt,old.txt',
    'name sort is natural (2 before 10)'
  );

  const [fallback] = await services.checkRecentFilesInFolder(dir, 'no-such-sort');
  check(names(fallback).join() === names(byDate).join(), 'an unknown sort falls back to date-modified');

  const [none, count] = await services.checkRecentFilesInFolder(GLib.build_filenamev([dir, 'missing']));
  check(none.length === 0 && count === 0, 'a missing folder yields an empty list instead of throwing');
  check(prefixedErrors === 1, 'the failure is logged once with the d2da: prefix');

  services.extension.max_recent_items = 1;
  check(services.maxFanItems() === 8, 'fan item limit follows the max_recent_items setting');
  services.extension.max_recent_items = 0;
  check(services.maxFanItems() === 5, 'fan item limit defaults to the first step');
} finally {
  ['old.txt', 'newest.txt', 'middle.txt', '.hidden', 'Item 10.txt', 'Item 2.txt'].forEach((n) =>
    Gio.File.new_for_path(GLib.build_filenamev([dir, n])).delete(null)
  );
  Gio.File.new_for_path(dir).delete(null);
}

finish();
