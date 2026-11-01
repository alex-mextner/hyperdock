'use strict';

// Web links dropped onto the dock, as pure functions (no gi:// imports) so
// tests/web_links_check.js runs them under plain gjs. dropClassify.js decides
// WHAT was dropped from the payloads of a drag; this module reads the links
// out of those payloads, normalises them and keeps the list of dock links.
//
// Payload sources, in order of preference (a link found twice keeps its first
// position and adopts the first non-empty title):
//   text/x-moz-url   Firefox: UTF-16LE 'url\ntitle[\nurl\ntitle...]'
//   _NETSCAPE_URL    'url\ntitle' (UTF-8)
//   text/uri-list    one http(s) URL per line (file: lines are not links)
//   text/plain       every http(s) URL found in the text
//   text/html        the href of every <a>, then URLs in the visible text
// The anchors of text/html are sources like the others, so a title that only
// the page's <a href> gives is adopted by the link the other sources found.
//
// Choices where the contract is silent:
//   * Only an explicit http:// or https:// is a link inside prose, a uri-list
//     or an href; normalizeUrl alone also accepts a bare 'host.tld/path'.
//   * A URL found inside prose loses trailing . , ; : ! ? ' ] } and a
//     trailing ) that closes no ( inside the URL ('(see https://a.b/c).'
//     gives https://a.b/c, 'https://a.b/x_(y)' stays whole).
//   * Input with whitespace, control characters or a backslash inside is not a URL; an
//     empty host, a bad port or a non-http(s) scheme gives null.
//   * 'http://Example.COM:80/' keeps its slash ('/' is a path, kept
//     verbatim) but 'https://example.com:443' gets none; only ASCII letters of
//     the scheme and host are lower-cased, internationalised hosts stay as
//     given. A bare host needs a dot and a last label that starts with a
//     letter, so 'file.txt' passes but '1.2.3', 'localhost' and 'a@b.com' do not.
//   * addLink and removeLink always return a new array.
//   * A title that is already set is never replaced by a later one.

import { parseUriList } from './stackClipboard.js';

const TITLE_MAX = 120;
// A backslash is hostile: browsers read it as '/', so 'https://evil\@good/'
// goes to evil while the title would show good.
const HOSTILE_CHAR_RE = /[\s\p{Cc}\\]/u;
const SCHEME_URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i;
const BARE_HOST_RE = /^(?:[\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]*(?::\d+)?$/u;
const EXPLICIT_URL_RE = /^https?:\/\//i;
const PROSE_URL_RE = /https?:\/\/[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = ".,;:!?')]}";
const DEFAULT_PORTS = { http: 80, https: 443 };
const MAX_HOST_LENGTH = 253;

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'",
};

const lowerAscii = (text) => text.replace(/[A-Z]+/g, (s) => s.toLowerCase());

// A title as a dock label: whitespace collapsed, trimmed, at most TITLE_MAX
// characters (code points, so an emoji is never cut in half).
function cleanTitle(text) {
  if (typeof text !== 'string') return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  // 2 UTF-16 units per code point at most, so the slice holds enough
  return Array.from(collapsed.slice(0, TITLE_MAX * 2))
    .slice(0, TITLE_MAX)
    .join('')
    .trim();
}

function splitPort(hostPort) {
  const colon = hostPort.lastIndexOf(':');
  if (colon < 0 || colon < hostPort.lastIndexOf(']')) {
    return { host: hostPort, port: '' };
  }
  return { host: hostPort.slice(0, colon), port: hostPort.slice(colon + 1) };
}

function urlFromParts(scheme, authority, rest) {
  const lowerScheme = scheme.toLowerCase();
  if (lowerScheme !== 'http' && lowerScheme !== 'https') return null;
  const at = authority.lastIndexOf('@');
  const userinfo = authority.slice(0, at + 1);
  const { host, port } = splitPort(authority.slice(at + 1));
  if (host === '' || !/^\d*$/.test(port)) return null;
  const keepPort = port !== '' && Number(port) !== DEFAULT_PORTS[lowerScheme];
  return `${lowerScheme}://${userinfo}${lowerAscii(host)}${keepPort ? `:${port}` : ''}${rest}`;
}

function bareUrl(text) {
  const end = text.search(/[/?#]/);
  const hostPort = end < 0 ? text : text.slice(0, end);
  if (hostPort.length > MAX_HOST_LENGTH || !BARE_HOST_RE.test(hostPort)) {
    return null;
  }
  return urlFromParts('https', hostPort, end < 0 ? '' : text.slice(end));
}

// The http(s) URL `input` stands for, normalised, or null.
export function normalizeUrl(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text === '' || HOSTILE_CHAR_RE.test(text)) return null;
  const match = SCHEME_URL_RE.exec(text);
  if (match) return urlFromParts(match[1], match[2], match[3]);
  return bareUrl(text);
}

// What identifies a link in the list: two spellings of the same page share it.
// The fragment and the trailing slashes of the path go; the query stays
// verbatim, since '?path=/' and '?path=' are different pages.
export function linkKey(url) {
  const text = typeof url === 'string' ? url.trim() : '';
  const normal = normalizeUrl(text) ?? text;
  const hash = normal.indexOf('#');
  const noFragment = hash < 0 ? normal : normal.slice(0, hash);
  const query = noFragment.indexOf('?');
  if (query < 0) return noFragment.replace(/\/+$/, '');
  return noFragment.slice(0, query).replace(/\/+$/, '') + noFragment.slice(query);
}

// The label of a dock link: its title, else its host without 'www.', else the
// URL itself.
export function urlTitle(link) {
  const title = cleanTitle(link?.title);
  if (title !== '') return title;
  const url = typeof link?.url === 'string' ? link.url : '';
  const match = /^https?:\/\/(?:[^/?#@]*@)?(\[[^\]]*\]|[^/?#:]*)/i.exec(url);
  const host = match ? match[1].replace(/^www\./i, '') : '';
  return host === '' ? url : host;
}

// ---- payload text ------------------------------------------------------

function decodeUtf16(bytes) {
  if (typeof bytes === 'string') return bytes;
  if (!(bytes instanceof Uint8Array)) return '';
  // a stray odd byte would decode as U+FFFD
  const even = bytes.subarray(0, bytes.length - (bytes.length % 2));
  const bigEndian = even[0] === 0xfe && even[1] === 0xff;
  return new TextDecoder(bigEndian ? 'utf-16be' : 'utf-16le').decode(even);
}

const cleanPayloadText = (text) =>
  text.replace(/^\uFEFF/, '').replace(/\0+$/, '');

// 'url\ntitle[\nurl\ntitle...]' (text/x-moz-url, _NETSCAPE_URL) as
// [{ url, title }]; pairs whose URL is not an
// http(s) URL are skipped.
export function parseUrlPairs(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    const url = normalizeUrl(lines[i]);
    if (url !== null) pairs.push({ url, title: cleanTitle(lines[i + 1]) });
  }
  return pairs;
}

// The links of a Firefox text/x-moz-url payload (UTF-16LE bytes, a BOM and an
// odd trailing byte tolerated).
export function decodeMozUrl(bytes) {
  return parseUrlPairs(cleanPayloadText(decodeUtf16(bytes)));
}

// The mime type without parameters, lower-cased: 'Text/Plain;charset=UTF-8'
// is 'text/plain'.
export function baseMime(mime) {
  return String(mime).split(';')[0].trim().toLowerCase();
}

const isTextMime = (mime) =>
  mime.startsWith('text/') ||
  mime === '_netscape_url' ||
  mime === 'x-special/gnome-copied-files';

function decodeText(mime, value) {
  if (typeof value === 'string') return cleanPayloadText(value);
  if (!(value instanceof Uint8Array)) return null;
  const text =
    mime === 'text/x-moz-url'
      ? decodeUtf16(value)
      : new TextDecoder().decode(value);
  return cleanPayloadText(text);
}

// Map base mime type -> decoded text for the text-like payloads of a drag (the
// first of several spellings of one type wins). Binary payloads (image/*) are
// left alone: decoding a photo as text is slow and meaningless.
export function payloadTexts(payloads) {
  const texts = new Map();
  if (payloads === null || typeof payloads !== 'object') return texts;
  for (const [name, value] of Object.entries(payloads)) {
    const mime = baseMime(name);
    if (!isTextMime(mime) || texts.has(mime)) continue;
    const text = decodeText(mime, value);
    if (text !== null) texts.set(mime, text);
  }
  return texts;
}

// ---- HTML ----------------------------------------------------------------

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    const key = name.toLowerCase();
    return Object.hasOwn(ENTITIES, key) ? ENTITIES[key] : whole;
  });
}

// '<[^<>]*>' (not '<[^>]*>') so a run of '<' without any '>' stays linear
const stripTags = (html) => html.replace(/<[^<>]*>/g, ' ');

// The visible text of an HTML payload.
export function htmlText(html) {
  return decodeEntities(stripTags(html));
}

function hrefOf(tag) {
  const match = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : null;
}

// [{ url, title }] of the <a href="http..."> elements of `html`, in order.
// The scan only moves forward (every regex continues where the last one
// stopped), so a page of unclosed tags costs one pass, not one per tag.
function anchorsOf(html) {
  const anchors = [];
  const open = /<a\s/gi;
  const close = /<\/a\s*>/gi;
  let match = open.exec(html);
  while (match !== null) {
    const tagEnd = html.indexOf('>', match.index);
    if (tagEnd < 0) break;
    close.lastIndex = tagEnd + 1;
    const end = close.exec(html);
    if (end === null) break;
    const href = hrefOf(html.slice(match.index, tagEnd));
    const url =
      href !== null && EXPLICIT_URL_RE.test(href) ? normalizeUrl(href) : null;
    if (url !== null) {
      anchors.push({
        url,
        title: cleanTitle(htmlText(html.slice(tagEnd + 1, end.index))),
      });
    }
    open.lastIndex = end.index + end[0].length;
    match = open.exec(html);
  }
  return anchors;
}

// ---- links in text -------------------------------------------------------

const countOf = (text, char) => text.split(char).length - 1;

function trimProseUrl(token) {
  let end = token.length;
  let opened = countOf(token, '(');
  let closed = countOf(token, ')');
  while (end > 0 && TRAILING_PUNCTUATION.includes(token[end - 1])) {
    if (token[end - 1] === ')') {
      if (closed <= opened) break;
      closed -= 1;
    }
    end -= 1;
  }
  return token.slice(0, end);
}

function proseLinks(text) {
  if (typeof text !== 'string') return [];
  const links = [];
  for (const [token] of text.matchAll(PROSE_URL_RE)) {
    const url = normalizeUrl(trimProseUrl(token));
    if (url !== null) links.push({ url, title: '' });
  }
  return links;
}

function uriListLinks(text) {
  const links = [];
  for (const line of parseUriList(text)) {
    const url = EXPLICIT_URL_RE.test(line) ? normalizeUrl(line) : null;
    if (url !== null) links.push({ url, title: '' });
  }
  return links;
}

// Same key keeps the first position; an empty title adopts a later one.
function dedupeLinks(found) {
  const byKey = new Map();
  for (const link of found) {
    const key = linkKey(link.url);
    const known = byKey.get(key);
    if (known === undefined) byKey.set(key, { ...link });
    else if (known.title === '') known.title = link.title;
  }
  return [...byKey.values()];
}

// The links of text-like payloads (see payloadTexts), best source first.
export function linksFromTexts(texts) {
  const html = texts.get('text/html') ?? '';
  const anchors = anchorsOf(html);
  const found = [
    ...parseUrlPairs(texts.get('text/x-moz-url')),
    ...parseUrlPairs(texts.get('_netscape_url')),
    ...uriListLinks(texts.get('text/uri-list')),
    ...proseLinks(texts.get('text/plain')),
    ...anchors,
    ...proseLinks(htmlText(html)),
  ];
  return dedupeLinks(found);
}

// The links a drag carries: payloads is { [mimetype]: string | Uint8Array }.
export function linksFromPayloads(payloads) {
  return linksFromTexts(payloadTexts(payloads));
}

// ---- the dock's list of links -------------------------------------------

// A new list with `link` added: a link whose key is already there keeps its
// place and only fills an empty (or blank) title. A link that is no http(s) URL changes
// nothing.
export function addLink(links, link) {
  const list = Array.isArray(links) ? [...links] : [];
  const url = normalizeUrl(link?.url);
  if (url === null) return list;
  const title = cleanTitle(link.title);
  const key = linkKey(url);
  const index = list.findIndex((known) => linkKey(known?.url) === key);
  if (index < 0) return [...list, { url, title }];
  if (cleanTitle(list[index].title) === '' && title !== '') {
    list[index] = { ...list[index], title };
  }
  return list;
}

export function removeLink(links, key) {
  const wanted = linkKey(key);
  return (Array.isArray(links) ? links : []).filter(
    (link) => linkKey(link?.url) !== wanted
  );
}
