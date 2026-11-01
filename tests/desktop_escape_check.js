// gjs -m tests/desktop_escape_check.js — escaping of values written into generated
// .desktop files (services.js _escapeDesktopValue/_execArg/_toSafeFileName). A raw
// newline or backslash makes GDesktopAppInfo's loader throw; an unquoted path splits into
// several argv entries. Exits 1 on failure.
import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix';

import { importWithStubs, createChecker } from './harness.js';

const { check, finish } = createChecker();
const { module } = await importWithStubs('services.js');
const services = Object.create(module.Services.prototype);

check(services._escapeDesktopValue('a\\b') === 'a\\\\b', 'backslash is doubled');
check(services._escapeDesktopValue('a\nb') === 'a\\nb', 'newline becomes \\n');
check(services._escapeDesktopValue('a\rb') === 'a\\rb', 'carriage return becomes \\r');
check(services._escapeDesktopValue('a\tb') === 'a\\tb', 'tab becomes \\t');
check(services._escapeDesktopValue('Plain name') === 'Plain name', 'plain text is untouched');

check(services._toSafeFileName('  My Disk (USB) ') === 'my_disk_usb', 'file name: lowercased, symbols collapsed to _');
check(services._toSafeFileName('__a//b__') === 'a_b', 'file name: runs of _ collapse and the ends are trimmed');
check(services._toSafeFileName('Диск') === '', 'file name: non-ASCII only input yields an empty name');

// (`env` as the opener: GDesktopAppInfo refuses an entry whose Exec binary is not installed,
// and xdg-open is not in a minimal container.)
// Round trip through the real keyfile + shell parsers: whatever the path holds, the
// Exec= line must parse back to exactly [opener, path] (modulo the %% field-code escape).
const NASTY_PATHS = [
  '/media/user/plain',
  '/media/user/with space',
  "/media/user/it's",
  '/media/user/"double"',
  '/media/user/$HOME and `cmd`',
  '/media/user/100%',
  '/media/user/%f %U',
  '/media/user/back\\slash',
  '/media/user/new\nline',
  '/media/user/tab\there',
  '/media/user/Диск ☃',
];

for (const path of NASTY_PATHS) {
  const label = JSON.stringify(path);
  try {
    const data = `[Desktop Entry]\nType=Application\nName=${services._escapeDesktopValue(path)}\nExec=env ${services._execArg(path)}\n`;
    const keyfile = new GLib.KeyFile();
    keyfile.load_from_data(data, new TextEncoder().encode(data).length, GLib.KeyFileFlags.NONE);
    const info = GioUnix.DesktopAppInfo.new_from_keyfile(keyfile);
    const [, argv] = GLib.shell_parse_argv(info.get_commandline());
    check(
      argv.length === 2 && argv[0] === 'env' && argv[1].replace(/%%/g, '%') === path,
      `Exec= round-trips ${label}`
    );
    check(info.get_name() === path, `Name= round-trips ${label}`);
  } catch (e) {
    check(false, `${label} produced an invalid desktop file: ${e.message}`);
  }
}

finish();
