// gjs -m tests/stack_clipboard_check.js - clipboard / URI payload rules, proved
// against real GIO and GLib URI validation. Exits 1 on failure.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { createChecker } from './harness.js';
import {
  COPIED_FILES_MIME,
  buildCopiedFiles,
  fileUri,
  parseCopiedFiles,
  parseUriList,
  pasteMode,
  pathsText,
  toUriList,
} from '../stackClipboard.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check(COPIED_FILES_MIME === 'x-special/gnome-copied-files', 'The MIME type is the GNOME copied-files one');

check(fileUri('/home/u/a b.png') === 'file:///home/u/a%20b.png', 'A space becomes %20');
check(fileUri('/') === 'file:///', 'The root is file:///');

const hostile = [
  '/home/u/a b.png',
  '/tmp/100%.txt',
  '/tmp/a#b?c.txt',
  "/tmp/it's \"q\" & co.txt",
  '/tmp/Скриншот от 2026-11-01 16-10-04.png',
  '/tmp/new\nline',
  '/',
  '/tmp/a+b=c;d,e@f$g.txt',
  '/tmp/(x)[y]{z}!~*.txt',
  '/tmp/日本語/😀.png',
  `/tmp/${'x'.repeat(200)}.bin`,
];
for (const p of hostile) {
  const uri = fileUri(p);
  check(Gio.File.new_for_uri(uri).get_path() === p, `GIO reads back ${JSON.stringify(p)}`);
  check(GLib.uri_is_valid(uri, GLib.UriFlags.NONE), `${JSON.stringify(uri)} is a valid URI`);
}

check(buildCopiedFiles([], false) === null, 'An empty list builds nothing');
check(buildCopiedFiles(undefined, true) === null, 'An undefined list builds nothing');
check(buildCopiedFiles(['file:///a', 'file:///b'], false) === 'copy\nfile:///a\nfile:///b', 'Copy payload has no trailing newline');
check(buildCopiedFiles(['file:///a'], true) === 'cut\nfile:///a', 'Cut payload starts with cut');
check(buildCopiedFiles(['file:///a'], undefined) === 'copy\nfile:///a', 'A missing cut flag means copy');

const uris = hostile.map(fileUri);
check(same(parseCopiedFiles(buildCopiedFiles(uris, true)), { cut: true, uris }), 'Round trip keeps uris and cut');
check(same(parseCopiedFiles(buildCopiedFiles(uris, false)), { cut: false, uris }), 'Round trip keeps uris and copy');

check(same(parseCopiedFiles('copy\nfile:///a\0'), { cut: false, uris: ['file:///a'] }), 'A trailing NUL is stripped');
check(same(parseCopiedFiles('cut\nfile:///a\n'), { cut: true, uris: ['file:///a'] }), 'A trailing newline is stripped');
check(same(parseCopiedFiles('cut\r\nfile:///a\r\nfile:///b\r\n'), { cut: true, uris: ['file:///a', 'file:///b'] }), 'CRLF separators are accepted');
check(same(parseCopiedFiles('copy\nfile:///a\n\n\n'), { cut: false, uris: ['file:///a'] }), 'Blank lines at the end are ignored');
check(same(parseCopiedFiles('copy\nfile:///a\n\0'), { cut: false, uris: ['file:///a'] }), 'NUL after a newline is tolerated');
check(parseCopiedFiles('paste\nfile:///a') === null, 'An unknown first line is rejected');
check(parseCopiedFiles('Copy\nfile:///a') === null, 'The mode is case-sensitive');
check(parseCopiedFiles('copy') === null, 'A mode without URIs is rejected');
check(parseCopiedFiles('copy\n') === null, 'A mode with only a newline is rejected');
check(parseCopiedFiles('') === null, 'Empty text is rejected');
check(parseCopiedFiles('copy\nfile:///a\n\nfile:///b') === null, 'A blank line between URIs is rejected');
check(parseCopiedFiles('copy\n/home/u/a') === null, 'A plain path is not a URI');
check(parseCopiedFiles('copy\n1abc:x') === null, 'A scheme must start with a letter');
check(parseCopiedFiles(null) === null, 'null is rejected');
check(parseCopiedFiles(undefined) === null, 'undefined is rejected');
check(parseCopiedFiles(42) === null, 'A number is rejected');
check(same(parseCopiedFiles('copy\ntrash:///x\nsmb://h/s'), { cut: false, uris: ['trash:///x', 'smb://h/s'] }), 'Other schemes pass');

check(same(parseUriList('file:///a\r\nfile:///b\r\n'), ['file:///a', 'file:///b']), 'CRLF URI list');
check(same(parseUriList('file:///a\nfile:///b'), ['file:///a', 'file:///b']), 'LF URI list');
check(same(parseUriList('# comment\nfile:///a\n  \n  file:///b  \n#x'), ['file:///a', 'file:///b']), 'Comments, blanks and spaces are dropped');
check(same(parseUriList(''), []), 'Empty text gives no URIs');
check(same(parseUriList(undefined), []), 'undefined gives no URIs');
check(same(parseUriList('\r\n\r\n'), []), 'Only blank lines give no URIs');
check(same(parseUriList('a\rb'), ['a', 'b']), 'A lone CR separates');

check(toUriList(['a', 'b']) === 'a\r\nb\r\n', 'toUriList ends every line with CRLF');
check(toUriList([]) === '', 'An empty list is an empty text');
check(same(parseUriList(toUriList(uris)), uris), 'toUriList round-trips through parseUriList');

check(pathsText(['/a', '/b']) === '/a\n/b', 'Paths are newline-joined');
check(pathsText(['/a']) === '/a', 'A single path has no newline');
check(pathsText([]) === '', 'No paths is empty text');

check(pasteMode({ cut: true }) === 'move', 'Cut pastes as a move');
check(pasteMode({ cut: false }) === 'copy', 'Copy pastes as a copy');
check(pasteMode(null) === 'copy', 'No parsed payload defaults to copy');
check(pasteMode({}) === 'copy', 'A missing cut flag defaults to copy');

finish();
