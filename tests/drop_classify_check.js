// gjs -m tests/drop_classify_check.js - what was dropped on the dock and what
// the dock does with it (pure logic, no GNOME Shell): payload kinds, file
// kinds and the whole decision table. Exits 1 on failure.
import { createChecker } from './harness.js';
import {
  classifyFile,
  classifyPayload,
  dropActionFor,
} from '../dropClassify.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const utf8 = (text) => new TextEncoder().encode(text);
const utf16 = (text) => {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    bytes.push(text.charCodeAt(i) & 0xff, text.charCodeAt(i) >> 8);
  }
  return Uint8Array.from(bytes);
};
const link = (url, title = '') => ({ url, title });

// ---- dropActionFor: the table of the design document, as data --------------
const TARGETS = ['stack', 'trash', 'app', 'dock'];
const TABLE = {
  folder: ['move-or-copy', 'trash', 'open-with', 'add-folder'],
  file: ['move-or-copy', 'trash', 'open-with', 'add-file'],
  image: ['move-or-copy', 'trash', 'open-with', 'add-file'],
  app: ['move-or-copy', 'trash', 'open-with', 'add-favorite'],
  remote: ['move-or-copy', 'refuse', 'open-with', 'refuse'],
  url: ['refuse', 'refuse', 'open-with', 'add-link'],
  'text-url': ['refuse', 'refuse', 'open-with', 'add-link'],
  text: ['refuse', 'refuse', 'refuse', 'refuse'],
  'image-data': ['refuse', 'refuse', 'refuse', 'refuse'],
  none: ['refuse', 'refuse', 'refuse', 'refuse'],
};
for (const [kind, actions] of Object.entries(TABLE)) {
  TARGETS.forEach((target, i) => {
    check(
      dropActionFor(kind, target) === actions[i],
      `a ${kind} dropped on ${target} is ${actions[i]}`
    );
  });
  check(
    dropActionFor(kind, 'mount') === dropActionFor(kind, 'stack'),
    `a ${kind} dropped on a mounted volume acts as on a stack`
  );
}
check(
  Object.keys(TABLE).length === 10,
  'the table has the ten kinds of the document'
);
for (const target of [
  '',
  'nowhere',
  undefined,
  null,
  42,
  'constructor',
  '__proto__',
  'toString',
  'STACK',
]) {
  check(
    dropActionFor('folder', target) === 'refuse',
    `an unknown target ${JSON.stringify(String(target))} is refused`
  );
}
for (const kind of [
  '',
  'files',
  'bogus',
  undefined,
  null,
  42,
  'constructor',
  '__proto__',
  'hasOwnProperty',
  'Folder',
]) {
  for (const target of [...TARGETS, 'mount']) {
    check(
      dropActionFor(kind, target) === 'refuse',
      `an unknown kind ${JSON.stringify(String(kind))} on ${target} is refused`
    );
  }
}
check(
  dropActionFor('remote', 'trash') === 'refuse' &&
    dropActionFor('remote', 'dock') === 'refuse',
  'a remote file is never trashed nor pinned'
);

// ---- classifyFile ---------------------------------------------------------------
const LOCAL = { isDir: false, contentType: 'text/plain', isLocal: true };
check(
  classifyFile('file:///home/u/d', {
    ...LOCAL,
    isDir: true,
    contentType: 'inode/directory',
  }) === 'folder',
  'a directory is a folder'
);
check(
  classifyFile('file:///home/u/a.desktop', { ...LOCAL, isDir: true }) ===
    'folder',
  'a directory named .desktop is still a folder'
);
check(
  classifyFile('smb://nas/share', { isDir: true, isLocal: false }) === 'remote',
  'a remote directory is remote (the locality check comes first)'
);
check(
  classifyFile('file:///x/foo', {
    ...LOCAL,
    contentType: 'application/x-desktop',
  }) === 'app',
  'the desktop content type is an app'
);
check(
  classifyFile('file:///x/foo.desktop', LOCAL) === 'app',
  'a name ending .desktop is an app'
);
check(
  classifyFile('file:///x/FOO.DESKTOP', LOCAL) === 'app',
  'the .desktop suffix is case-insensitive'
);
check(
  classifyFile('file:///x/foo.desktop.txt', LOCAL) === 'file',
  '.desktop in the middle of a name is a plain file'
);
check(
  classifyFile('file:///x/a.png', { ...LOCAL, contentType: 'image/png' }) ===
    'image',
  'image/* is an image'
);
check(
  classifyFile('file:///x/a.svg', {
    ...LOCAL,
    contentType: 'image/svg+xml',
  }) === 'image',
  'image/svg+xml is an image'
);
check(
  classifyFile('file:///x/a.desktop', {
    ...LOCAL,
    contentType: 'image/png',
  }) === 'app',
  'the .desktop name beats an image content type'
);
check(
  classifyFile('smb://nas/a.png', {
    isDir: false,
    contentType: 'image/png',
    isLocal: false,
  }) === 'remote',
  'a remote image is remote (the locality check comes first)'
);
check(
  classifyFile('smb://nas/a.txt', {
    isDir: false,
    contentType: 'text/plain',
    isLocal: false,
  }) === 'remote',
  'a non-local file is remote'
);
check(
  classifyFile('file:///x/a.txt', LOCAL) === 'file',
  'a local text file is a file'
);
check(
  classifyFile('file:///x/a', {
    isDir: false,
    contentType: '',
    isLocal: true,
  }) === 'file',
  'an empty content type is a file'
);
check(
  classifyFile('file:///x/a', {}) === 'file',
  'an info without fields is a local file'
);
check(
  classifyFile('file:///x/a', undefined) === 'file' &&
    classifyFile('file:///x/a', null) === 'file',
  'a missing info is a local file'
);
check(
  classifyFile('file:///x/a', {
    isDir: false,
    contentType: 5,
    isLocal: true,
  }) === 'file',
  'a content type that is no string is a file'
);
check(
  classifyFile(undefined, undefined) === 'file' &&
    classifyFile(null, LOCAL) === 'file',
  'a missing URI does not throw'
);
check(
  classifyFile('file:///x/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82.png', {
    ...LOCAL,
    contentType: 'image/png',
  }) === 'image',
  'an escaped Cyrillic name'
);

// ---- classifyPayload: files ------------------------------------------------------
{
  const got = classifyPayload({
    'text/uri-list': 'file:///home/u/a.txt\r\nfile:///home/u/b%20c.txt\r\n',
  });
  check(
    got.kind === 'files' &&
      same(got.uris, ['file:///home/u/a.txt', 'file:///home/u/b%20c.txt']),
    'a uri-list of files is files with both URIs'
  );
  check(same(got.links, []), 'files carry no links');
}
{
  const got = classifyPayload({
    'text/uri-list': 'file:///home/u/a.txt\r\n',
    'text/plain': '/home/u/a.txt',
  });
  check(
    got.kind === 'files' && same(got.uris, ['file:///home/u/a.txt']),
    'a uri-list plus the same path as text/plain is still files'
  );
  check(got.text === '/home/u/a.txt', 'the plain text is reported');
}
{
  const got = classifyPayload({
    'text/uri-list': utf8('file:///home/u/a.txt\n'),
    'text/plain': utf8('file:///home/u/a.txt'),
    'text/html': utf8('<a href="https://example.com/">x</a>'),
  });
  check(
    got.kind === 'files',
    'file payloads beat a link in the html (bytes decode too)'
  );
}
check(
  same(
    classifyPayload({
      'x-special/gnome-copied-files': 'copy\nfile:///a\nfile:///b',
    }).uris,
    ['file:///a', 'file:///b']
  ),
  'copied-files lists its URIs'
);
check(
  classifyPayload({ 'x-special/gnome-copied-files': 'cut\nfile:///a' }).kind ===
    'files',
  'cut copied-files are files'
);
check(
  classifyPayload({ 'x-special/gnome-copied-files': 'bogus\nfile:///a' })
    .kind !== 'files',
  'copied-files with a wrong first line are not files'
);
check(
  classifyPayload({ 'text/plain': 'file:///a\nfile:///b' }).kind === 'text',
  'a text/plain made only of file URIs is text, never files'
);
check(
  classifyPayload({
    'text/uri-list': 'file:///a\n',
    'text/plain': 'file:///a',
  }).kind === 'files',
  'with a uri-list present the same drop is files'
);
{
  const remote = [
    classifyFile('smb://nas/a.png', { isDir: false, contentType: 'image/png', isLocal: false }),
    classifyFile('smb://nas/dir', { isDir: true, isLocal: false }),
    classifyFile('smb://nas/a.desktop', { isDir: false, contentType: 'application/x-desktop', isLocal: false }),
  ];
  check(
    remote.every((kind) => dropActionFor(kind, 'trash') === 'refuse' && dropActionFor(kind, 'dock') === 'refuse'),
    'real classifyFile results for remote image, folder and .desktop are refused by trash and dock'
  );
  check(
    remote.every((kind) => dropActionFor(kind, 'stack') === 'move-or-copy' && dropActionFor(kind, 'app') === 'open-with'),
    'real remote classifyFile results move-or-copy onto a stack and open-with an app'
  );
}
check(
  classifyPayload({ 'text/plain': 'file:///a\nnot a uri' }).kind === 'text',
  'a text/plain with a non-URI line is text'
);
check(
  classifyPayload({ 'text/plain': '/home/u/a.txt' }).kind === 'text',
  'a bare path is text'
);
check(
  same(classifyPayload({ 'text/uri-list': 'file:///a\nfile:///a\n' }).uris, [
    'file:///a',
  ]),
  'repeated URIs are listed once'
);
check(
  same(
    classifyPayload({ 'text/uri-list': '# a comment\nfile:///a\n\n' }).uris,
    ['file:///a']
  ),
  'comments and blank lines of a uri-list are skipped'
);
check(
  classifyPayload({ 'text/uri-list': 'FILE:///a' }).kind === 'files',
  'the file scheme is case-insensitive'
);
check(
  classifyPayload({ 'text/uri-list': 'file://nas/share/a' }).kind === 'files',
  'a file URI with a host is files (classifyFile decides remote)'
);
check(
  same(
    classifyPayload({
      'text/uri-list': 'file:///%D0%BF%D1%80.png\nfile:///a%20b',
    }).uris,
    ['file:///%D0%BF%D1%80.png', 'file:///a%20b']
  ),
  'escaped names are kept verbatim'
);
check(
  classifyPayload({ 'text/uri-list;charset=utf-8': 'file:///a' }).kind ===
    'files',
  'a mime type with parameters is understood'
);
check(
  classifyPayload({ 'TEXT/URI-LIST': 'file:///a' }).kind === 'files',
  'a mime type in capitals is understood'
);
check(
  classifyPayload({ 'text/uri-list': 'file:///a\nhttps://example.com/' })
    .kind === 'text-url',
  'a uri-list of a file and a link is not files; the link makes it text-url'
);
check(
  classifyPayload({
    'text/uri-list': 'file:///a',
    'text/plain': 'https://example.com/',
  }).kind === 'files',
  'the uri-list decides before the plain text'
);
{
  const big = Array.from(
    { length: 20000 },
    (_, i) => `file:///home/u/f${i}`
  ).join('\r\n');
  const start = Date.now();
  const got = classifyPayload({ 'text/uri-list': big });
  check(
    got.kind === 'files' &&
      got.uris.length === 20000 &&
      Date.now() - start < 2000,
    '20000 dropped files classify fast'
  );
}

// ---- classifyPayload: url --------------------------------------------------------
{
  const got = classifyPayload({
    'text/x-moz-url': utf16('https://example.com/a?b=1\nExample Domain'),
    'text/plain': utf8('https://example.com/a?b=1'),
  });
  check(
    got.kind === 'url' &&
      same(got.links, [link('https://example.com/a?b=1', 'Example Domain')]),
    'a Firefox moz-url is url with its title'
  );
  check(
    got.text === 'https://example.com/a?b=1' && same(got.uris, []),
    'the plain text is reported and no files'
  );
}
check(
  classifyPayload({ _NETSCAPE_URL: 'https://n.example/\nT' }).kind === 'url',
  '_NETSCAPE_URL is url'
);
{
  const got = classifyPayload({
    'text/uri-list': 'https://example.com/x',
    'text/plain': 'https://example.com/x',
    'text/html': '<a href="https://example.com/x">The  \n Title</a>',
  });
  check(
    got.kind === 'url' &&
      same(got.links, [link('https://example.com/x', 'The Title')]),
    'Chrome: url with the title of the <a>'
  );
}
{
  const got = classifyPayload({
    'text/uri-list': 'https://a.example/1\r\nhttps://b.example/2',
  });
  check(
    got.kind === 'url' && got.links.length === 2,
    'a uri-list of several URLs is url with several links'
  );
}
check(
  classifyPayload({ 'text/plain': 'https://example.com/x' }).kind === 'url',
  'a text/plain that is one URL is url'
);
check(
  classifyPayload({
    'text/plain': '  https://example.com/x\n\nhttps://example.com/y \n',
  }).kind === 'url',
  'a text/plain of URL lines is url'
);
check(
  classifyPayload({ 'text/plain': 'example.com/path' }).kind === 'text',
  'a bare host is not a URL payload'
);
check(
  classifyPayload({ 'text/plain': 'javascript:alert(1)' }).kind === 'text',
  'javascript: is plain text'
);
check(
  classifyPayload({ 'text/x-moz-url': utf16('javascript:alert(1)\nx') })
    .kind === 'text',
  'a hostile moz-url is plain text, not a url'
);
check(
  same(
    classifyPayload({ 'text/x-moz-url': utf16('javascript:alert(1)\nx') })
      .links,
    []
  ),
  'a hostile moz-url yields no links'
);
check(
  classifyPayload({ 'text/uri-list': 'ftp://example.com/x' }).kind !== 'url',
  'an ftp URL is not a web link'
);

// ---- classifyPayload: text-url -----------------------------------------------------
{
  const got = classifyPayload({
    'text/plain': 'see https://example.com/x, then more',
  });
  check(
    got.kind === 'text-url' && same(got.links, [link('https://example.com/x')]),
    'a URL inside a sentence is text-url'
  );
  check(
    got.text === 'see https://example.com/x, then more',
    'the whole text is kept'
  );
}
check(
  classifyPayload({
    'text/html': '<p>go <a href="https://example.com/x">here</a></p>',
  }).kind === 'text-url',
  'html with a link is text-url'
);
check(
  same(
    classifyPayload({
      'text/html': '<p>go <a href="https://example.com/x">here</a></p>',
    }).links,
    [link('https://example.com/x', 'here')]
  ),
  'the html link carries its title'
);
for (const bad of ['http://', 'http://exa mple']) {
  const got = classifyPayload({
    'text/uri-list': bad,
    'text/html': '<a href="https://example.com/x">here</a>',
  });
  check(
    got.kind === 'text-url' && same(got.links, [link('https://example.com/x', 'here')]),
    `a uri-list line '${bad}' that only looks like http is no link, so the payload is text-url, not url`
  );
}
check(
  classifyPayload({ 'text/html': '<p>go https://example.com/x</p>' }).kind ===
    'text-url',
  'a URL in html text is text-url'
);
check(
  classifyPayload({
    'text/plain': 'a https://one.example/ b https://two.example/',
  }).links.length === 2,
  'two URLs in a sentence are two links'
);

// ---- classifyPayload: image, text, none --------------------------------------------
{
  const got = classifyPayload({
    'image/png': Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 255, 0, 128,
    ]),
  });
  check(
    got.kind === 'image' && got.text === '' && same(got.uris, []),
    'a lone image/png payload is image'
  );
}
check(
  classifyPayload({
    'image/png': new Uint8Array(1),
    'image/jpeg': new Uint8Array(1),
  }).kind === 'image',
  'several image payloads are image'
);
check(
  classifyPayload({ 'image/png': new Uint8Array(1), 'text/plain': 'hello' })
    .kind === 'text',
  'an image with other text is text'
);
check(
  classifyPayload({
    'image/png': new Uint8Array(1),
    'text/plain': 'https://example.com/x',
  }).kind === 'url',
  'an image with a URL is a url'
);
check(
  classifyPayload({ 'image/png': new Uint8Array(0) }).kind === 'none',
  'an empty image payload is none'
);
check(
  classifyPayload({ 'image/png': new Uint8Array(1), 'text/plain': '' }).kind ===
    'image',
  'an image with an empty text is still image'
);
check(
  classifyPayload({ 'image/png': new Uint8Array(3) }).kind === 'image' &&
    classifyPayload({ 'IMAGE/PNG': new Uint8Array(3) }).kind === 'image',
  'image mime types in capitals'
);
{
  const got = classifyPayload({ 'text/plain': 'just words' });
  check(
    got.kind === 'text' &&
      got.text === 'just words' &&
      same(got.links, []) &&
      same(got.uris, []),
    'plain words are text'
  );
}
check(
  classifyPayload({ 'text/plain': 'привет мир 🌍' }).text === 'привет мир 🌍',
  'Cyrillic and emoji text survive'
);
check(
  classifyPayload({ 'text/plain': utf8('привет мир 🌍') }).text ===
    'привет мир 🌍',
  'UTF-8 bytes decode to the text'
);
check(
  classifyPayload({ 'text/html': '<p>Hello &amp; <b>bye</b></p>' }).text ===
    'Hello & bye',
  'html alone gives its visible text'
);
check(
  classifyPayload({ 'text/html': '<p>Hello</p>', 'text/plain': 'Plain' })
    .text === 'Plain',
  'text/plain wins over html for the text'
);
check(
  classifyPayload({ 'text/html': '<p>Hello</p>' }).kind === 'text',
  'html without links is text'
);
check(
  classifyPayload({ 'text/x-custom': 'abc' }).kind === 'text',
  'any other text/* is text'
);
check(
  classifyPayload({ 'text/plain': '   \n\t ' }).kind === 'none',
  'blank text is none'
);
check(
  classifyPayload({ 'text/plain': '' }).kind === 'none' &&
    classifyPayload({}).kind === 'none',
  'an empty payload is none'
);
check(
  classifyPayload({ 'application/octet-stream': Uint8Array.from([1, 2, 3]) })
    .kind === 'none',
  'binary of an unknown type is none'
);
for (const payloads of [null, undefined, 'text', 42, [], true]) {
  const got = classifyPayload(payloads);
  check(
    got.kind === 'none' &&
      same(got.uris, []) &&
      same(got.links, []) &&
      got.text === '',
    `payloads ${JSON.stringify(payloads)} are none`
  );
}
check(
  classifyPayload({ 'text/plain': 7, 'text/uri-list': null, 'text/html': {} })
    .kind === 'none',
  'values of the wrong type are ignored'
);
check(
  classifyPayload({ 'text/plain': 'x\0' }).text === 'x',
  'a trailing NUL is dropped from the text'
);
{
  const huge = 'lorem ipsum '.repeat(10000);
  const start = Date.now();
  const got = classifyPayload({
    'text/plain': huge,
    'text/html': `<p>${huge}</p>`,
  });
  check(
    got.kind === 'text' && Date.now() - start < 1000,
    'a 120 kB text classifies fast'
  );
  const mixed = `${'x'.repeat(100000)} https://example.com/ok`;
  const m = classifyPayload({ 'text/plain': mixed });
  check(
    m.kind === 'text-url' && m.links.length === 1,
    'a URL at the end of 100 kB of text is found'
  );
}
{
  const got = classifyPayload({ 'text/plain': 'a' });
  check(
    same(Object.keys(got), ['kind', 'uris', 'links', 'text']),
    'every result has exactly kind, uris, links, text'
  );
}

finish();
