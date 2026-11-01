// gjs -m tests/removed_settings_check.js
//
// Settings that were removed must stay gone from the schema, the key table,
// the prefs UI and the runtime. Exits 1 on failure.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { createChecker } from './harness.js';

const ROOT = GLib.path_get_dirname(
  GLib.path_get_dirname(import.meta.url.replace(/^file:\/\//, ''))
);
const REMOVED = [
  // #13: dead toggle that only re-hooked the Magic Lamp extension
  /lamp[-_]app[-_]animation/,
  /hookCompiz|releaseCompiz|compiz_getIcon/,
  // #14: never drew anything, its row was hidden
  /calendar-style/,
];
const SKIP_DIRS = new Set([
  'node_modules',
  'build',
  '.git',
  '.worktrees',
  'tests',
  'tools',
  'agents',
  'docs',
  'ci',
]);
const EXTS = /\.(js|ui|xml)$/;
const decoder = new TextDecoder();

function* walk(dir) {
  const enumerator = Gio.File.new_for_path(dir).enumerate_children(
    'standard::name,standard::type',
    Gio.FileQueryInfoFlags.NONE,
    null
  );
  for (const info of enumerator) {
    const name = info.get_name();
    const path = GLib.build_filenamev([dir, name]);
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
      if (!SKIP_DIRS.has(name)) yield* walk(path);
    } else if (EXTS.test(name)) {
      yield path;
    }
  }
}

const { check, finish } = createChecker();
let scanned = 0;
for (const file of walk(ROOT)) {
  scanned++;
  const [, bytes] = GLib.file_get_contents(file);
  const text = decoder.decode(bytes);
  for (const re of REMOVED) {
    check(!re.test(text), `${file.slice(ROOT.length + 1)} does not match ${re}`);
  }
}
check(scanned > 20, `scanned ${scanned} shipped files`);
finish();
