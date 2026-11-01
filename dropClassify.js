'use strict';

// What was dropped on the dock and what the dock does with it, as pure
// functions (no gi:// imports) so tests/drop_classify_check.js runs them under
// plain gjs. The glue reads the payloads of a drag (and the GIO info of each
// file) and asks this module three questions:
//   classifyPayload  what is in the payloads (files, a web link, text, ...)
//   classifyFile     what one dropped file is (folder, app, image, ...)
//   dropActionFor    what to do with that kind at the place where the
//                    pointer let go (the decision table of the design doc)
// Web links themselves are parsed by webLinks.js.
//
// Choices where the contract is silent:
//   * Payload mime types are compared without parameters and in lower case
//     ('Text/Plain;charset=utf-8' is 'text/plain').
//   * `files` takes the first of text/uri-list and
//     x-special/gnome-copied-files whose lines are ALL file:// URIs (the glue
//     passes a Gdk.FileList as text/uri-list). A text/plain of file URIs is
//     only `text`: a web page controls text/plain and must not gain authority
//     over trash or move.
//   * `url` needs a text/x-moz-url or _NETSCAPE_URL with a link, or a
//     text/uri-list or text/plain made only of http(s) URLs; any other
//     payload with a URL inside (including a uri-list that mixes a file and
//     a link) is `text-url`.
//   * `image` needs every non-empty payload to be image/*; an image next to
//     other text is `text`.
//   * `text` holds the text/plain payload, else the visible text of
//     text/html, else any other text payload; blank text is `none`.
//   * classifyFile treats an `isLocal` that is missing as local; only an
//     explicit false is `remote`, and that is checked before directory,
//     .desktop and image, so every non-local file is `remote`.
//   * The target `mount` (a mounted volume) acts like `stack`, as the table
//     of the design document lists mounted volumes under the stack column.

import { parseCopiedFiles, parseUriList } from './stackClipboard.js';
import {
  baseMime,
  htmlText,
  linksFromTexts,
  normalizeUrl,
  parseUrlPairs,
  payloadTexts,
} from './webLinks.js';

const FILE_URI_RE = /^file:\/\//i;
const HTTP_URL_RE = /^https?:\/\//i;
const FILE_MIMES = ['text/uri-list', 'x-special/gnome-copied-files'];
const URL_PAIR_MIMES = ['text/x-moz-url', '_netscape_url'];
const URL_LINE_MIMES = ['text/uri-list', 'text/plain'];

// ---- what the payloads of a drag carry ------------------------------------

function linesOf(mime, text) {
  if (mime === 'x-special/gnome-copied-files') {
    return parseCopiedFiles(text)?.uris ?? [];
  }
  return parseUriList(text);
}

const allMatch = (lines, test) => lines.length > 0 && lines.every(test);
const isFileLine = (line) => FILE_URI_RE.test(line);
const isLinkLine = (line) =>
  HTTP_URL_RE.test(line) && normalizeUrl(line) !== null;

function fileUris(texts) {
  for (const mime of FILE_MIMES) {
    if (!texts.has(mime)) continue;
    const lines = linesOf(mime, texts.get(mime));
    if (allMatch(lines, isFileLine)) return [...new Set(lines)];
  }
  return null;
}

function isUrlPayload(texts) {
  if (
    URL_PAIR_MIMES.some((mime) => parseUrlPairs(texts.get(mime)).length > 0)
  ) {
    return true;
  }
  return URL_LINE_MIMES.some((mime) =>
    allMatch(parseUriList(texts.get(mime)), isLinkLine)
  );
}

const isBlank = (text) => typeof text !== 'string' || text.trim() === '';

function plainText(texts) {
  const plain = texts.get('text/plain');
  if (!isBlank(plain)) return plain;
  const html = htmlText(texts.get('text/html') ?? '');
  if (!isBlank(html)) return html.replace(/\s+/g, ' ').trim();
  for (const text of texts.values()) {
    if (!isBlank(text)) return text;
  }
  return '';
}

function isImageOnly(payloads) {
  if (payloads === null || typeof payloads !== 'object') return false;
  const mimes = Object.entries(payloads)
    .filter(
      ([, value]) => value !== null && value !== undefined && value.length > 0
    )
    .map(([name]) => baseMime(name));
  return mimes.length > 0 && mimes.every((mime) => mime.startsWith('image/'));
}

const result = (kind, parts = {}) => ({
  kind,
  uris: [],
  links: [],
  text: '',
  ...parts,
});

// payloads: { [mimetype]: string | Uint8Array }
// -> { kind: 'files' | 'url' | 'text-url' | 'image' | 'text' | 'none',
//      uris, links, text }
export function classifyPayload(payloads) {
  const texts = payloadTexts(payloads);
  const text = plainText(texts);
  const uris = fileUris(texts);
  if (uris !== null) return result('files', { uris, text });
  const links = linksFromTexts(texts);
  if (links.length > 0) {
    return result(isUrlPayload(texts) ? 'url' : 'text-url', { links, text });
  }
  if (isImageOnly(payloads)) return result('image');
  return result(text === '' ? 'none' : 'text', { text });
}

// ---- what one dropped file is -----------------------------------------------

// info: { isDir, contentType, isLocal } from the file's GIO info
export function classifyFile(uri, info) {
  const { isDir, contentType, isLocal } = info ?? {};
  if (isLocal === false) return 'remote';
  if (isDir) return 'folder';
  if (
    contentType === 'application/x-desktop' ||
    /\.desktop$/i.test(String(uri))
  ) {
    return 'app';
  }
  if (typeof contentType === 'string' && contentType.startsWith('image/')) {
    return 'image';
  }
  return 'file';
}

// ---- what to do with it -----------------------------------------------------

const ON_STACK = 'move-or-copy';
const FILE_ACTIONS = { stack: ON_STACK, trash: 'trash', app: 'open-with' };

// kind -> target -> action; a pair that is not listed is 'refuse'
const DROP_TABLE = {
  folder: { ...FILE_ACTIONS, dock: 'add-folder' },
  file: { ...FILE_ACTIONS, dock: 'add-file' },
  image: { ...FILE_ACTIONS, dock: 'add-file' },
  app: { ...FILE_ACTIONS, dock: 'add-favorite' },
  remote: { stack: ON_STACK, app: 'open-with' },
  url: { app: 'open-with', dock: 'add-link' },
  'text-url': { app: 'open-with', dock: 'add-link' },
};

const TARGET_ALIASES = { mount: 'stack' };

// kind: a classifyFile result, or a classifyPayload kind that is not `files`
//   (the glue calls an `image` payload without a file `image-data`, which
//   no target takes);
// target: 'stack' | 'trash' | 'app' | 'dock' | 'mount'
// -> 'move-or-copy' | 'trash' | 'open-with' | 'add-folder' | 'add-favorite'
//    | 'add-link' | 'add-file' | 'refuse'
export function dropActionFor(kind, target) {
  if (!Object.hasOwn(DROP_TABLE, kind)) return 'refuse';
  const row = DROP_TABLE[kind];
  const column = TARGET_ALIASES[target] ?? target;
  return Object.hasOwn(row, column) ? row[column] : 'refuse';
}
