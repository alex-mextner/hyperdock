// gjs -m tests/web_links_check.js - the web links a drag can carry (pure
// logic, no GNOME Shell): URL normalisation, the payload formats of Firefox
// and Chrome, prose, hostile input and the dock's list of links.
// Exits 1 on failure.
import { createChecker } from './harness.js';
import {
  addLink,
  decodeMozUrl,
  linkKey,
  linksFromPayloads,
  normalizeUrl,
  payloadTexts,
  removeLink,
  urlTitle,
} from '../webLinks.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const link = (url, title = '') => ({ url, title });

// UTF-16 bytes of `text` the way Firefox hands out text/x-moz-url
function utf16(text, { bom = false, odd = false, bigEndian = false } = {}) {
  const bytes = [];
  const push = (unit) =>
    bigEndian
      ? bytes.push(unit >> 8, unit & 0xff)
      : bytes.push(unit & 0xff, unit >> 8);
  if (bom) push(0xfeff);
  for (let i = 0; i < text.length; i += 1) push(text.charCodeAt(i));
  if (odd) bytes.push(0x41);
  return Uint8Array.from(bytes);
}
const utf8 = (text) => new TextEncoder().encode(text);
const timed = (fn) => {
  const start = Date.now();
  const value = fn();
  return { value, ms: Date.now() - start };
};

// ---- normalizeUrl: what is a link ------------------------------------------
const NORMAL = [
  [
    'https://example.com/a?b=1',
    'https://example.com/a?b=1',
    'a plain https URL stays as it is',
  ],
  [
    'HTTP://Example.COM:80/',
    'http://example.com/',
    'scheme and host are lower-cased and the default port 80 dropped, the path slash kept',
  ],
  [
    'https://example.com:443',
    'https://example.com',
    'the default port 443 goes and no slash is invented',
  ],
  [
    'https://example.com:8443/x',
    'https://example.com:8443/x',
    'another port stays',
  ],
  [
    'http://example.com:443/',
    'http://example.com:443/',
    '443 is not the default port of http',
  ],
  [
    'https://example.com:80/',
    'https://example.com:80/',
    '80 is not the default port of https',
  ],
  ['http://example.com:/x', 'http://example.com/x', 'an empty port goes'],
  [
    'example.com/path',
    'https://example.com/path',
    'a bare host and path get https://',
  ],
  ['example.com', 'https://example.com', 'a bare host gets https://'],
  [
    'Example.COM:8080/x',
    'https://example.com:8080/x',
    'a bare host with a port keeps the port',
  ],
  [
    'http://xn--e1afmkfd.xn--p1ai/',
    'http://xn--e1afmkfd.xn--p1ai/',
    'a punycode host stays',
  ],
  [
    'http://Пример.рф/Путь?к=в#я',
    'http://Пример.рф/Путь?к=в#я',
    'an internationalised host is left as given',
  ],
  [
    'HTTPS://Example.com/Path?Q=A#Frag',
    'https://example.com/Path?Q=A#Frag',
    'path, query and fragment keep their case',
  ],
  [
    '  https://example.org/ \n',
    'https://example.org/',
    'surrounding whitespace is trimmed',
  ],
  [
    'https://user:pw@Example.com/',
    'https://user:pw@example.com/',
    'user info is kept, the host lower-cased',
  ],
  [
    'http://[::1]:80/x',
    'http://[::1]/x',
    'an IPv6 host loses the default port',
  ],
  [
    'http://[::1]:8080/x',
    'http://[::1]:8080/x',
    'an IPv6 host keeps another port',
  ],
  [
    'http://example.com?x=1',
    'http://example.com?x=1',
    'a query without a path stays attached to the host',
  ],
  [
    'https://example.com/a%20b',
    'https://example.com/a%20b',
    'percent escapes are verbatim',
  ],
  ['http://192.168.0.1:80/', 'http://192.168.0.1/', 'an IPv4 host is a host'],
];
for (const [input, expected, why] of NORMAL) {
  check(normalizeUrl(input) === expected, `${why}: ${JSON.stringify(input)}`);
}

const REFUSED = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  ' javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'FILE:///etc/passwd',
  'vbscript:msgbox(1)',
  'ftp://example.com/',
  'mailto:a@b.com',
  'a@b.com',
  '/relative/path',
  '../x',
  'foo',
  'localhost',
  'localhost:3000',
  '1.2.3',
  '',
  '   ',
  'http://',
  'http:///x',
  'http://@/',
  'http:example.com',
  '//example.com/x',
  'http://exa mple.com',
  'http://example.com/a b',
  'http://example.com/a\nb',
  'http://example.com/\u0000',
  'http://example.com:abc/',
  'https://example.com\r\nSet-Cookie: x',
];
for (const input of REFUSED) {
  check(
    normalizeUrl(input) === null,
    `not a web link: ${JSON.stringify(input)}`
  );
}
for (const input of [undefined, null, 42, {}, [], ['https://a.b']]) {
  check(
    normalizeUrl(input) === null,
    `a non-string is no link: ${JSON.stringify(input)}`
  );
}
{
  const url = `https://example.com/${'a'.repeat(100000)}`;
  const { value, ms } = timed(() => normalizeUrl(url));
  check(value === url && ms < 1000, `a 100 kB URL normalises in ${ms} ms`);
  const junk = timed(() => normalizeUrl('a'.repeat(100000)));
  check(
    junk.value === null && junk.ms < 1000,
    `100 kB of letters is no link (${junk.ms} ms)`
  );
  const dots = timed(() => normalizeUrl('a.'.repeat(50000)));
  check(
    dots.value === null && dots.ms < 1000,
    `100 kB of dotted labels is no link (${dots.ms} ms)`
  );
  const colons = timed(() => normalizeUrl(`http://${':1'.repeat(50000)}`));
  check(colons.ms < 1000, `a host of colons does not stall (${colons.ms} ms)`);
}

// ---- linkKey -----------------------------------------------------------------
check(
  linkKey('https://Example.com/a/#top') === 'https://example.com/a',
  'the key drops the fragment and a trailing slash'
);
check(
  linkKey('example.com') === linkKey('https://example.com/'),
  'a bare host and its https URL share a key'
);
check(
  linkKey('HTTPS://EXAMPLE.COM:443') === linkKey('https://example.com/'),
  'case and default port do not change the key'
);
check(
  linkKey('http://example.com') !== linkKey('https://example.com'),
  'http and https are different pages'
);
check(
  linkKey('https://example.com/a?x=1') !== linkKey('https://example.com/a?x=2'),
  'the query is part of the key'
);
check(
  linkKey('https://example.com/a#x') === linkKey('https://example.com/a#y'),
  'fragments are not part of the key'
);
check(linkKey('  zzz  ') === 'zzz', 'a key of garbage is the trimmed text');
check(
  linkKey(undefined) === '' && linkKey(42) === '',
  'a key of a non-string is empty'
);
check(
  linkKey(linkKey('https://Example.com/a/#top')) ===
    linkKey('https://Example.com/a/#top'),
  'the key of a key is itself'
);

// ---- urlTitle ------------------------------------------------------------------
check(
  urlTitle(link('https://example.com/', 'Example Domain')) === 'Example Domain',
  'the title is the label'
);
check(
  urlTitle(link('https://example.com/', '  Spaced \n\t out  ')) ===
    'Spaced out',
  'a title is trimmed and whitespace-collapsed'
);
check(
  urlTitle(link('https://www.example.com/a')) === 'example.com',
  'no title: the host without www.'
);
check(
  urlTitle(link('https://WWW.example.com/a', '   ')) === 'example.com',
  'a blank title counts as none'
);
check(
  urlTitle(link('https://user@www.example.com:8080/x?y')) === 'example.com',
  'user info and port are not part of the host label'
);
check(
  urlTitle(link('http://[::1]:8080/')) === '[::1]',
  'an IPv6 host is the label'
);
check(urlTitle(link('not a url')) === 'not a url', 'no host: the URL itself');
check(
  urlTitle(link('https://wwwexample.com/')) === 'wwwexample.com',
  'only a www. label is stripped'
);
check(
  urlTitle(undefined) === '' && urlTitle({}) === '',
  'a missing link has an empty label'
);
check(
  urlTitle(link('https://a.b/', 'Привет, мир 🌍')) === 'Привет, мир 🌍',
  'Cyrillic and emoji titles pass'
);
{
  const label = urlTitle(link('https://a.b/', 'я'.repeat(130)));
  check(
    label.length === 120,
    `a 130 character title is cut to 120 (${label.length})`
  );
  const emoji = urlTitle(link('https://a.b/', '😀'.repeat(130)));
  check(
    Array.from(emoji).length === 120 && !/[\uD800-\uDBFF]$/.test(emoji),
    'an emoji title is cut on a character, not in a surrogate pair'
  );
  const exact = urlTitle(link('https://a.b/', 'x'.repeat(120)));
  check(exact.length === 120, 'a 120 character title is kept whole');
  const huge = timed(() =>
    urlTitle(link('https://a.b/', 'word '.repeat(20000)))
  );
  check(
    huge.value.length <= 120 && huge.ms < 1000,
    `a 100 kB title is cut quickly (${huge.ms} ms)`
  );
}

// ---- decodeMozUrl (Firefox text/x-moz-url) -----------------------------------
const MOZ = 'https://example.com/a?b=1\nExample Domain';
check(
  same(decodeMozUrl(utf16(MOZ)), [
    link('https://example.com/a?b=1', 'Example Domain'),
  ]),
  'UTF-16LE url and title decode'
);
check(
  same(decodeMozUrl(utf16(MOZ, { bom: true })), [
    link('https://example.com/a?b=1', 'Example Domain'),
  ]),
  'a BOM is ignored'
);
check(
  same(decodeMozUrl(utf16(MOZ, { odd: true })), [
    link('https://example.com/a?b=1', 'Example Domain'),
  ]),
  'an odd trailing byte is ignored'
);
check(
  same(decodeMozUrl(utf16(MOZ, { bom: true, odd: true })), [
    link('https://example.com/a?b=1', 'Example Domain'),
  ]),
  'a BOM and an odd byte together'
);
check(
  same(decodeMozUrl(utf16(MOZ, { bom: true, bigEndian: true })), [
    link('https://example.com/a?b=1', 'Example Domain'),
  ]),
  'a big-endian BOM switches the byte order'
);
check(
  same(decodeMozUrl(utf16('https://example.com/\n')), [
    link('https://example.com/', ''),
  ]),
  'an empty title stays empty'
);
check(
  same(decodeMozUrl(utf16('https://example.com/')), [
    link('https://example.com/', ''),
  ]),
  'a missing title line stays empty'
);
check(
  same(
    decodeMozUrl(
      utf16('https://a.example/x\nFirst\nhttps://b.example/y\nSecond')
    ),
    [
      link('https://a.example/x', 'First'),
      link('https://b.example/y', 'Second'),
    ]
  ),
  'two url/title pairs'
);
check(
  same(
    decodeMozUrl(utf16('https://a.example/x\n\nhttps://b.example/y\nSecond')),
    [link('https://a.example/x', ''), link('https://b.example/y', 'Second')]
  ),
  'an empty title in the first of two pairs'
);
check(
  same(
    decodeMozUrl(
      utf16('https://a.example/x\r\nFirst\r\nhttps://b.example/y\r\nSecond\r\n')
    ),
    [
      link('https://a.example/x', 'First'),
      link('https://b.example/y', 'Second'),
    ]
  ),
  'CRLF line ends and a trailing newline'
);
check(
  same(decodeMozUrl(utf16('https://a.example/x\nПривет 🌍 мир')), [
    link('https://a.example/x', 'Привет 🌍 мир'),
  ]),
  'a Cyrillic title with an emoji'
);
check(
  same(decodeMozUrl(utf16('https://a.example/x\n  Spaced \t out \n')), [
    link('https://a.example/x', 'Spaced out'),
  ]),
  'titles are collapsed'
);
check(
  same(
    decodeMozUrl(utf16('javascript:alert(1)\nEvil\nhttps://ok.example/\nOk')),
    [link('https://ok.example/', 'Ok')]
  ),
  'a pair with a hostile URL is skipped'
);
check(
  same(decodeMozUrl(utf16(`https://a.example/x\n${'t'.repeat(500)}`)), [
    link('https://a.example/x', 't'.repeat(120)),
  ]),
  'a long title is capped'
);
check(
  same(decodeMozUrl(utf16('HTTP://A.example:80/x\nT')), [
    link('http://a.example/x', 'T'),
  ]),
  'the URL of a pair is normalised'
);
check(same(decodeMozUrl(new Uint8Array(0)), []), 'no bytes: no links');
check(
  same(decodeMozUrl(new Uint8Array([0x41])), []),
  'a single byte: no links'
);
check(
  same(decodeMozUrl(null), []) &&
    same(decodeMozUrl(undefined), []) &&
    same(decodeMozUrl(42), []),
  'not bytes: no links'
);
check(
  same(decodeMozUrl('https://a.example/x\nT'), [
    link('https://a.example/x', 'T'),
  ]),
  'already decoded text is accepted'
);
check(
  same(decodeMozUrl(utf16('https://a.example/x\nT\0\0')), [
    link('https://a.example/x', 'T'),
  ]),
  'trailing NULs are dropped'
);
{
  const big = utf16(`https://a.example/\n${'x'.repeat(100000)}`);
  const { value, ms } = timed(() => decodeMozUrl(big));
  check(
    value.length === 1 && value[0].title.length === 120 && ms < 1000,
    `a 200 kB moz-url decodes fast (${ms} ms)`
  );
}

// ---- linksFromPayloads: Firefox -------------------------------------------------
{
  const links = linksFromPayloads({
    'text/x-moz-url': utf16('https://example.com/a?b=1\nExample Domain', {
      bom: true,
    }),
    'text/x-moz-url-data': utf16('https://example.com/a?b=1'),
    'text/plain': utf8('https://example.com/a?b=1'),
    'text/html': utf8('<a href="https://example.com/a?b=1">Example Domain</a>'),
  });
  check(
    same(links, [link('https://example.com/a?b=1', 'Example Domain')]),
    'Firefox: one link, title from the moz-url line'
  );
}
{
  const links = linksFromPayloads({
    'text/x-moz-url': utf16(
      'https://a.example/\nFirst\nhttps://b.example/\nSecond'
    ),
  });
  check(
    same(links, [
      link('https://a.example/', 'First'),
      link('https://b.example/', 'Second'),
    ]),
    'Firefox: two dragged links keep their order'
  );
}
{
  const links = linksFromPayloads({
    'text/x-moz-url': utf16('https://example.com/p\n'),
    'text/html': utf8(
      '<p>x</p><a class="k" href="https://example.com/p">Page   title</a>'
    ),
  });
  check(
    same(links, [link('https://example.com/p', 'Page title')]),
    'an empty moz-url title is filled from the matching <a>'
  );
}

// ---- linksFromPayloads: Chrome -----------------------------------------------------
{
  const links = linksFromPayloads({
    'text/uri-list': utf8('https://example.com/x'),
    'text/plain': utf8('https://example.com/x'),
    'text/html': utf8(
      '<meta charset="utf-8"><a href="https://example.com/x">The  \n Title</a>'
    ),
  });
  check(
    same(links, [link('https://example.com/x', 'The Title')]),
    'Chrome: the three payloads give one link titled from the <a>'
  );
}
{
  const links = linksFromPayloads({
    'text/uri-list':
      'https://a.example/1\r\n# comment\r\nhttps://b.example/2\r\n',
  });
  check(
    same(links, [link('https://a.example/1'), link('https://b.example/2')]),
    'a uri-list with several URLs gives several links, comments skipped'
  );
}
{
  const links = linksFromPayloads({
    'text/uri-list': 'file:///home/u/a.txt\r\nhttps://b.example/2\r\n',
  });
  check(
    same(links, [link('https://b.example/2')]),
    'file: lines of a uri-list are not links'
  );
}
{
  const links = linksFromPayloads({
    'text/html':
      '<a href="https://example.com/x?a=1&amp;b=2" title="t">A &amp; B <b>bold</b></a><a href="/relative">no</a><a href="javascript:alert(1)">bad</a>',
  });
  check(
    same(links, [link('https://example.com/x?a=1&b=2', 'A & B bold')]),
    'html: entities decoded, tags stripped, relative and javascript: hrefs skipped'
  );
}
{
  const links = linksFromPayloads({
    'text/html':
      "<a href='https://s.example/q'>single</a> <A HREF=https://u.example/r>unquoted</A>",
  });
  check(
    same(links, [
      link('https://s.example/q', 'single'),
      link('https://u.example/r', 'unquoted'),
    ]),
    'html: single-quoted, unquoted and upper-case anchors'
  );
}
{
  const links = linksFromPayloads({
    'text/html': '<p>visit https://example.com/in-text now</p>',
  });
  check(
    same(links, [link('https://example.com/in-text')]),
    'html: a URL in the visible text is a link'
  );
}
{
  const links = linksFromPayloads({
    'text/uri-list': 'https://example.com/x',
    'text/html':
      '<a href="https://example.com/x"></a><a href="https://example.com/x">Second anchor</a>',
  });
  check(
    same(links, [link('https://example.com/x', 'Second anchor')]),
    'the first <a> with a title supplies it'
  );
}
check(
  same(
    linksFromPayloads({
      _NETSCAPE_URL: utf8('https://n.example/p\nNetscape Title'),
    }),
    [link('https://n.example/p', 'Netscape Title')]
  ),
  '_NETSCAPE_URL: url and title'
);
check(
  same(linksFromPayloads({ _NETSCAPE_URL: 'https://n.example/p' }), [
    link('https://n.example/p'),
  ]),
  '_NETSCAPE_URL without a title'
);
check(
  same(
    linksFromPayloads({ 'Text/Plain;charset=UTF-8': 'https://p.example/' }),
    [link('https://p.example/')]
  ),
  'mime parameters and case are ignored'
);

// ---- linksFromPayloads: text ---------------------------------------------------------
check(
  same(
    linksFromPayloads({ 'text/plain': 'see https://example.com/x, then more' }),
    [link('https://example.com/x')]
  ),
  'a trailing comma is not part of a URL inside prose'
);
const PROSE = [
  ['https://example.com/x.', 'a trailing full stop'],
  ['https://example.com/x;', 'a trailing semicolon'],
  ['https://example.com/x)', 'a closing parenthesis that opens nothing'],
  ['https://example.com/x:', 'a trailing colon'],
  ['https://example.com/x!?', 'trailing ! and ?'],
  ['https://example.com/x,.;', 'several trailing marks'],
  ["https://example.com/x'", 'a trailing quote'],
];
for (const [text, why] of PROSE) {
  check(
    same(linksFromPayloads({ 'text/plain': `go to ${text} ok` }), [
      link('https://example.com/x'),
    ]),
    `prose: ${why} is stripped`
  );
}
check(
  same(linksFromPayloads({ 'text/plain': '(see https://example.com/x).' }), [
    link('https://example.com/x'),
  ]),
  'prose: a URL in parentheses at the end of a sentence'
);
check(
  same(
    linksFromPayloads({
      'text/plain': 'https://en.wikipedia.org/wiki/Foo_(bar)',
    }),
    [link('https://en.wikipedia.org/wiki/Foo_(bar)')]
  ),
  'prose: a balanced parenthesis belongs to the URL'
);
check(
  same(
    linksFromPayloads({
      'text/plain': 'https://en.wikipedia.org/wiki/Foo_(bar).',
    }),
    [link('https://en.wikipedia.org/wiki/Foo_(bar)')]
  ),
  'prose: a balanced parenthesis stays, the full stop after it goes'
);
check(
  same(
    linksFromPayloads({ 'text/plain': 'https://example.com/a?x=1&y=2#frag' }),
    [link('https://example.com/a?x=1&y=2#frag')]
  ),
  'prose: query and fragment stay'
);
check(
  same(
    linksFromPayloads({
      'text/plain': 'a http://one.example/ b\nc https://two.example/x.',
    }),
    [link('http://one.example/'), link('https://two.example/x')]
  ),
  'prose: several URLs on several lines'
);
check(
  same(
    linksFromPayloads({
      'text/plain': 'https://one.example/ https://ONE.example',
    }),
    [link('https://one.example/')]
  ),
  'prose: the same URL twice is one link'
);
check(
  same(
    linksFromPayloads({
      'text/plain': 'ссылка: https://example.com/путь — готово',
    }),
    [link('https://example.com/путь')]
  ),
  'prose: a Cyrillic sentence around a URL'
);
check(
  same(linksFromPayloads({ 'text/plain': 'https://example.com/x\nнет' }), [
    link('https://example.com/x'),
  ]),
  'prose: a URL line followed by text'
);

// ---- hostile payloads --------------------------------------------------------------------
const HOSTILE = [
  ['text/plain', 'javascript:alert(1)'],
  ['text/plain', 'data:text/html,<script>alert(1)</script>'],
  ['text/plain', 'file:///etc/passwd'],
  ['text/uri-list', 'file:///etc/passwd'],
  ['text/uri-list', 'javascript:alert(1)'],
  ['text/plain', 'example.com/path'],
  ['text/plain', ''],
  ['text/html', ''],
  ['text/html', '<a href="javascript:alert(1)">x</a>'],
  ['text/html', '<a href="https://example.com/x">unclosed'],
  ['text/html', '<a href='],
  ['text/html', '<a <a <a <a'],
  ['text/x-moz-url', 'garbage'],
  ['image/png', 'https://example.com/looks-like-a-link'],
];
for (const [mime, text] of HOSTILE) {
  check(
    same(linksFromPayloads({ [mime]: text }), []),
    `no link in ${mime}: ${JSON.stringify(text)}`
  );
}
check(
  same(linksFromPayloads({ 'text/plain': 'a' }), []) &&
    same(linksFromPayloads({}), []),
  'no link in a trivial payload'
);
check(
  same(linksFromPayloads(null), []) &&
    same(linksFromPayloads(undefined), []) &&
    same(linksFromPayloads('x'), []) &&
    same(linksFromPayloads(42), []),
  'payloads that are no object give no links'
);
check(
  same(
    linksFromPayloads({
      'text/plain': 42,
      'text/uri-list': null,
      'text/html': undefined,
    }),
    []
  ),
  'payload values of the wrong type are ignored'
);
{
  const text = `${'x'.repeat(50000)} https://example.com/ok ${'y'.repeat(50000)}`;
  const { value, ms } = timed(() => linksFromPayloads({ 'text/plain': text }));
  check(
    same(value, [link('https://example.com/ok')]) && ms < 1000,
    `a URL in 100 kB of prose (${ms} ms)`
  );
  const many = timed(() =>
    linksFromPayloads({ 'text/plain': 'http://a.example/\n'.repeat(5500) })
  );
  check(
    many.value.length === 1 && many.ms < 1000,
    `5500 repeats of one URL collapse to one link (${many.ms} ms)`
  );
  const distinct = Array.from(
    { length: 4000 },
    (_, i) => `http://a.example/${i}`
  ).join('\n');
  const dist = timed(() => linksFromPayloads({ 'text/plain': distinct }));
  check(
    dist.value.length === 4000 && dist.ms < 2000,
    `4000 distinct URLs in order (${dist.ms} ms)`
  );
  const brackets = timed(() =>
    linksFromPayloads({
      'text/plain': `https://a.example/${')'.repeat(100000)}`,
    })
  );
  check(
    brackets.value.length === 1 && brackets.ms < 1000,
    `100 kB of closing parentheses (${brackets.ms} ms)`
  );
  const tags = timed(() =>
    linksFromPayloads({ 'text/html': '<'.repeat(100000) })
  );
  check(
    tags.value.length === 0 && tags.ms < 1000,
    `100 kB of '<' (${tags.ms} ms)`
  );
  const anchors = timed(() =>
    linksFromPayloads({ 'text/html': '<a '.repeat(33000) })
  );
  check(
    anchors.value.length === 0 && anchors.ms < 1000,
    `33000 unclosed anchors (${anchors.ms} ms)`
  );
  const html = timed(() =>
    linksFromPayloads({
      'text/html': '<a href="https://a.example/">x</a>'.repeat(3000),
    })
  );
  check(
    html.value.length === 1 && html.ms < 1000,
    `3000 anchors to one page (${html.ms} ms)`
  );
  const title = timed(() =>
    linksFromPayloads({
      'text/x-moz-url': utf16(`https://a.example/\n${'é'.repeat(100000)}`),
    })
  );
  check(
    title.value[0].title.length === 120 && title.ms < 2000,
    `a 100 kB title (${title.ms} ms)`
  );
}

// ---- addLink / removeLink ---------------------------------------------------------------
{
  const start = [link('https://a.example/', 'A')];
  const frozen = Object.freeze([Object.freeze({ ...start[0] })]);
  const added = addLink(frozen, link('https://b.example/', 'B'));
  check(
    same(added, [
      link('https://a.example/', 'A'),
      link('https://b.example/', 'B'),
    ]),
    'a new link is appended'
  );
  check(
    added !== frozen && frozen.length === 1,
    'addLink returns a new array and leaves the input alone'
  );
  const again = addLink(start, link('HTTPS://A.example', 'Other'));
  check(
    same(again, [link('https://a.example/', 'A')]),
    'the same key keeps its place and its title'
  );
  check(
    again !== start,
    'addLink returns a new array even when nothing is added'
  );
  const filled = addLink(
    [link('https://a.example/', ''), link('https://b.example/', 'B')],
    link('https://a.example/#top', 'Late title')
  );
  check(
    same(filled, [
      link('https://a.example/', 'Late title'),
      link('https://b.example/', 'B'),
    ]),
    'an empty title adopts a better one, keeping the position'
  );
  check(
    same(
      addLink([link('https://a.example/', '')], link('https://a.example/', '')),
      [link('https://a.example/', '')]
    ),
    'an empty title stays empty when nothing better comes'
  );
  check(
    same(addLink([], link('example.com/x', '  A   B ')), [
      link('https://example.com/x', 'A B'),
    ]),
    'the added link is normalised and its title cleaned'
  );
  check(
    same(addLink([], link('javascript:alert(1)', 'x')), []),
    'a hostile link is not added'
  );
  check(
    same(addLink([], undefined), []) && same(addLink([], {}), []),
    'a missing link is not added'
  );
  check(
    same(addLink(undefined, link('https://a.example/')), [
      link('https://a.example/'),
    ]),
    'a missing list starts a new one'
  );
  check(
    same(addLink([null, 7], link('https://a.example/')), [
      null,
      7,
      link('https://a.example/'),
    ]),
    'garbage already in the list is left alone'
  );
  let list = [];
  for (let i = 0; i < 50; i += 1)
    list = addLink(list, link(`https://a.example/${i % 10}`));
  check(list.length === 10, 'fifty additions of ten pages leave ten links');
}
{
  const list = Object.freeze([
    link('https://a.example/', 'A'),
    link('https://b.example/x/', 'B'),
    link('https://c.example/', 'C'),
  ]);
  const removed = removeLink(list, linkKey('https://b.example/x'));
  check(
    same(removed, [
      link('https://a.example/', 'A'),
      link('https://c.example/', 'C'),
    ]),
    'removeLink removes by key'
  );
  check(
    removed !== list && list.length === 3,
    'removeLink returns a new array and leaves the input alone'
  );
  check(
    same(removeLink(list, 'https://B.example/x#frag'), [
      link('https://a.example/', 'A'),
      link('https://c.example/', 'C'),
    ]),
    'a URL works as the key too'
  );
  check(
    same(removeLink(list, 'https://zzz.example/'), list) &&
      removeLink(list, 'x') !== list,
    'an unknown key removes nothing, still a new array'
  );
  check(
    same(removeLink(undefined, 'x'), []) &&
      same(
        removeLink([null, link('https://a.example/')], 'https://a.example/'),
        [null]
      ),
    'garbage input does not throw'
  );
  check(
    same(
      removeLink(
        [link('https://a.example/'), link('https://a.example/#x')],
        'https://a.example/'
      ),
      []
    ),
    'every link with that key goes'
  );
}

// ---- hardening: boundaries and rules the mutation run found unchecked --------------
check(
  normalizeUrl('http://:80/x') === null && normalizeUrl('https://:8080') === null,
  'an authority that starts with the port colon has no host and is no link'
);
{
  const label = 'a'.repeat(250);
  check(
    normalizeUrl(`${label}.co/x`) === `https://${label}.co/x`,
    'a bare host of exactly 253 characters is still a link'
  );
  check(
    normalizeUrl(`a${label}.co/x`) === null,
    'a bare host of 254 characters is no link'
  );
}
check(
  linkKey('#frag') === '' && linkKey('#') === '',
  'a key that starts with # is cut to nothing (the fragment is no part of a key)'
);
{
  const link1 = 'https://a.example/x';
  const pairs = (first) =>
    `${first}\nx\n${link1}\nTitle`;
  check(
    same(decodeMozUrl(utf16(pairs('\u00fe'))), [link(link1, 'Title')]),
    'UTF-16LE text whose first unit has the low byte 0xfe is not mistaken for a big-endian BOM'
  );
  check(
    same(decodeMozUrl(utf16(pairs('\uff21'))), [link(link1, 'Title')]),
    'UTF-16LE text whose first unit has the high byte 0xff is not mistaken for a big-endian BOM'
  );
}
{
  const texts = payloadTexts({
    'image/png': new Uint8Array([1, 2, 3]),
    'application/json': '{"a":1}',
    'x-special/gnome-copied-files': 'copy\nfile:///a',
    _NETSCAPE_URL: 'https://a.example/\nA',
    'Text/Plain;charset=utf-8': 'first',
    'text/plain': 'second',
  });
  check(
    same([...texts.keys()].sort(), ['_netscape_url', 'text/plain', 'x-special/gnome-copied-files']),
    'only text/*, _netscape_url and the copied-files payload are decoded; image and json payloads are left alone'
  );
  check(
    texts.get('text/plain') === 'first',
    'the first spelling of a mime type wins over a later one'
  );
}
check(
  same(
    linksFromPayloads({
      'text/html': '<a href="https://a.example/x">one &foo; &#65; &amp; two</a>',
    }),
    [link('https://a.example/x', 'one &foo; &#65; & two')]
  ),
  'an unknown or numeric entity stays as written in a title, a known one is decoded'
);
check(
  same(linksFromPayloads({ 'text/html': '<a href="https://a.example/x"></a>' }), [
    link('https://a.example/x'),
  ]),
  'an empty anchor (the close tag right after the open tag) is still a link'
);
check(
  same(linksFromPayloads({ 'text/html': '<a href="example.com/page">x</a>' }), []),
  'an anchor whose href has no http(s) scheme is no link, even if it is a bare host'
);
check(
  same(
    linksFromPayloads({
      'text/x-moz-url': utf16('https://a.example/\nFirst\nhttps://a.example/\nSecond'),
    }),
    [link('https://a.example/', 'First')]
  ),
  'a link found twice keeps the first title when it has one'
);
check(
  same(
    linksFromPayloads({
      'text/x-moz-url': utf16('https://a.example/\n\nhttps://a.example/\nSecond'),
    }),
    [link('https://a.example/', 'Second')]
  ),
  'a link found twice adopts the later title when its first one is empty'
);
check(
  same(
    linksFromPayloads({
      'text/plain': 'see https://a.example/x',
      'text/html':
        '<a href="https://a.example/x"></a><a href="https://a.example/x">Real</a><a href="https://a.example/x">Later</a>',
    }),
    [link('https://a.example/x', 'Real')]
  ),
  'a prose link takes the first non-empty title of the html anchors with its key'
);

// ---- host spoofing with a backslash ---------------------------------------
for (const [input, why] of [
  ['https://evil.example\\@good.example/', 'a backslash before an @ in the authority'],
  ['https://good.example\\evil/', 'a backslash right after the host'],
  ['https://a.example/p\\q', 'a backslash in the path'],
  ['https://a.example/p?q=\\x', 'a backslash in the query'],
  ['https://a.example/p#\\x', 'a backslash in the fragment'],
  ['example.com\\x', 'a backslash in a bare host'],
]) {
  check(normalizeUrl(input) === null, `a URL is rejected with ${why}`);
}
check(
  same(
    linksFromPayloads({
      'text/plain': 'go https://evil.example\\@good.example/ now',
      'text/uri-list': 'https://evil.example\\@good.example/',
    }),
    []
  ),
  'a backslash URL in prose or a uri-list is no link'
);
check(
  same(addLink([], link('https://evil.example\\@good.example/', 'x')), []),
  'addLink ignores a backslash URL'
);

// ---- scheme names that are members of Object.prototype ----------------------
for (const scheme of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
  const url = `${scheme}://example.com/x`;
  check(normalizeUrl(url) === null, `normalizeUrl rejects the scheme ${scheme}`);
  check(
    same(addLink([], link(url, 'x')), []),
    `addLink ignores the scheme ${scheme}`
  );
}
check(
  same(
    linksFromPayloads({
      'text/x-moz-url': utf16('constructor://example.com/x\nTitle'),
      _NETSCAPE_URL: 'constructor://example.com/x\nTitle',
    }),
    []
  ),
  'a prototype-named scheme in text/x-moz-url and _NETSCAPE_URL is no link'
);
check(
  same(
    linksFromPayloads({ 'text/html': '<a href="https://a.example/">&constructor; &__proto__; &toString;</a>' }),
    [link('https://a.example/', '&constructor; &__proto__; &toString;')]
  ),
  'an HTML entity named like an Object.prototype member stays as written'
);

// ---- linkKey keeps the query verbatim ------------------------------------------
check(
  linkKey('https://example.com/?path=/') !== linkKey('https://example.com/?path='),
  'URLs differing only in a trailing slash of the query have distinct keys'
);
check(
  linkKey('https://example.com/a/') === linkKey('https://example.com/a') &&
    linkKey('https://example.com/a//') === linkKey('https://example.com/a#frag'),
  'trailing slashes of the path and the fragment do not change the key'
);
check(
  linkKey('https://example.com/a/?q=1#f') === linkKey('https://example.com/a?q=1'),
  'a path slash before the query and a fragment after it do not change the key'
);
check(
  linkKey('https://example.com/a?q=1/#f') !== linkKey('https://example.com/a?q=1'),
  'a slash that ends the query is part of the key'
);
{
  const slash = 'https://example.com/?path=/';
  const bare = 'https://example.com/?path=';
  check(
    same(linksFromPayloads({ 'text/plain': `${slash} ${bare}` }), [link(slash), link(bare)]),
    'dedupe keeps both query variants'
  );
  const list = addLink(addLink([], link(slash, 'S')), link(bare, 'B'));
  check(list.length === 2, 'addLink keeps both query variants');
  check(
    same(removeLink(list, slash), [link(bare, 'B')]) &&
      same(removeLink(list, bare), [link(slash, 'S')]),
    'removeLink removes only the query variant it names'
  );
}

// ---- addLink adopts a title for a link without a usable one --------------------
check(
  same(addLink([{ url: 'https://a.example/' }], link('https://a.example/', 'New')), [
    link('https://a.example/', 'New'),
  ]),
  'a link with an omitted title adopts the supplied one'
);
check(
  same(addLink([link('https://a.example/', '   ')], link('https://a.example/', 'New')), [
    link('https://a.example/', 'New'),
  ]),
  'a link with a whitespace-only title adopts the supplied one'
);
check(
  same(addLink([link('https://a.example/', 'Old')], link('https://a.example/', 'New')), [
    link('https://a.example/', 'Old'),
  ]),
  'a link with a title keeps it'
);
check(
  same(addLink([{ url: 'https://a.example/' }], link('https://a.example/', '  ')), [
    { url: 'https://a.example/' },
  ]),
  'a blank supplied title changes nothing'
);

finish();
