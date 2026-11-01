// gjs -m tests/stack_folder_check.js - listing a stack's folder asynchronously
// (real files in a temp dir, no GNOME Shell). Exits 1 on failure.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { createChecker } from './harness.js';
import { listFolder, stackFileEntry } from '../stackFolder.js';
import { STACK_MAX_FILES } from '../stackModel.js';

const { check, finish } = createChecker();

const dir = GLib.dir_make_tmp('d2da-stack-folder-XXXXXX');
const at = (name) => GLib.build_filenamev([dir, name]);
function make(name, mtime, text = 'x') {
  const file = Gio.File.new_for_path(at(name));
  file.replace_contents(new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.NONE, null);
  file.set_attribute_uint64('time::modified', mtime, Gio.FileQueryInfoFlags.NONE, null);
}

make('b.txt', 2000);
make('a10.png', 3000);
make('a9.png', 3000);
make('old.pdf', 1000);
make('.hidden', 9000);
const folder = Gio.File.new_for_path(at('Folder'));
folder.make_directory(null);
folder.set_attribute_uint64('time::modified', 500, Gio.FileQueryInfoFlags.NONE, null);

let looked = 0;
const iconOf = (names) => (looked++, names[0]);

let result = await listFolder(dir, { sort: 'date-modified', iconOf });
check(result.total === 5, 'every visible file is counted, the hidden one is not');
const names = result.files.map((f) => f.name);
check(names.join() === 'a9.png,a10.png,b.txt,old.pdf,Folder', `newest first, ties in natural name order (${names.join()})`);
check(result.files.every((f, i) => f.index === i), 'items are numbered in the stack order');
const png = result.files[0];
check(png.path === at('a9.png') && png.type === 'image/png' && png.date.tv_sec === 3000, 'an item carries its path, type and date');
check(png.thumb === null && png.thumbFailed === false, 'a file with no thumbnail says so');
check(typeof png.icon === 'string' && png.icon.length > 0, 'an item carries an icon name');
check(looked <= 4, `icons are looked up once per distinct icon, not per file (${looked} lookups)`);

result = await listFolder(dir, { sort: 'name', iconOf });
check(result.files.map((f) => f.name).join() === 'a9.png,a10.png,b.txt,Folder,old.pdf', 'sorted by name (natural order)');

// thumbnail markers as GIO reports them
function entryWith(valid, failed, path = null) {
  const info = new Gio.FileInfo();
  info.set_name('a.png');
  info.set_content_type('image/png');
  info.set_icon(new Gio.ThemedIcon({ name: 'image-x-generic' }));
  info.set_attribute_uint64('time::modified', 2);
  info.set_attribute_boolean(Gio.FILE_ATTRIBUTE_THUMBNAIL_IS_VALID, valid);
  info.set_attribute_boolean(Gio.FILE_ATTRIBUTE_THUMBNAILING_FAILED, failed);
  if (path) info.set_attribute_byte_string(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH, path);
  return stackFileEntry('/tmp', info, (names) => names[0]);
}
check(entryWith(true, false, '/cache/t.png').thumb === '/cache/t.png', 'a current thumbnail is kept');
check(entryWith(false, false, '/cache/t.png').thumb === null, 'an outdated thumbnail is not used');
check(entryWith(true, true).thumbFailed === true, 'a current failure marker means: do not try again');
check(entryWith(false, true).thumbFailed === false, 'an outdated failure marker (the file changed) means: try again');
check(entryWith(false, false).thumbFailed === false, 'no marker, no failure');

// a lot of files: a cap on the list, the whole count
const big = GLib.dir_make_tmp('d2da-stack-folder-big-XXXXXX');
for (let i = 0; i < STACK_MAX_FILES + 25; i++) {
  GLib.file_set_contents(GLib.build_filenamev([big, `f${i}.txt`]), 'x');
}
result = await listFolder(big, { sort: 'name', iconOf });
check(result.files.length === STACK_MAX_FILES && result.total === STACK_MAX_FILES + 25, 'the list is capped, the total is not');

// the loop keeps running while a big folder is listed
let ticks = 0;
const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => (ticks++, GLib.SOURCE_CONTINUE));
await listFolder(big, { sort: 'name', iconOf });
GLib.source_remove(id);
check(ticks > 0, `the main loop ran during the listing (${ticks} ticks)`);

// cancelled, and a missing folder
const cancellable = new Gio.Cancellable();
const pending = listFolder(big, { sort: 'name', iconOf, cancellable }).then(
  () => 'finished',
  (e) => (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ? 'cancelled' : `failed: ${e.message}`)
);
cancellable.cancel();
check((await pending) === 'cancelled', 'a cancelled listing rejects as cancelled');
const missing = await listFolder(at('nope'), { sort: 'name', iconOf }).then(() => 'listed', () => 'rejected');
check(missing === 'rejected', 'a missing folder rejects');

GLib.spawn_command_line_sync(`rm -rf ${dir} ${big}`);
finish();
