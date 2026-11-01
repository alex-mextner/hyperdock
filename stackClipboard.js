'use strict';

// Clipboard and URI payloads of the stack dropdown: what Ctrl+C / Ctrl+X put on
// the clipboard and how a paste (or a drop) is read back. Pure text in, text out
// (no gi:// imports) so gjs checks can prove the formats against real GIO; the
// stack code that owns the St.Clipboard calls these.
//
// Choices where the design document is silent:
//  - fileUri encodes each path segment with encodeURIComponent and does not
//    resolve relative paths; callers pass absolute paths.
//  - parseCopiedFiles drops every trailing blank line (a sloppy producer may
//    end with several), but a blank line between URIs is a malformed payload.
//  - parseUriList also accepts a lone CR as a separator.

export const COPIED_FILES_MIME = 'x-special/gnome-copied-files';

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function fileUri(path) {
  return `file://${String(path).split('/').map(encodeURIComponent).join('/')}`;
}

export function buildCopiedFiles(uris, cut) {
  if (!Array.isArray(uris) || uris.length === 0) return null;
  return [cut ? 'cut' : 'copy', ...uris].join('\n');
}

function payloadLines(text) {
  const lines = text.replace(/\0+$/, '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function parseCopiedFiles(text) {
  if (typeof text !== 'string') return null;
  const [mode, ...uris] = payloadLines(text);
  if (mode !== 'cut' && mode !== 'copy') return null;
  if (uris.length === 0 || !uris.every((u) => SCHEME_RE.test(u))) return null;
  return { cut: mode === 'cut', uris };
}

export function parseUriList(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export function toUriList(uris) {
  return uris.map((uri) => `${uri}\r\n`).join('');
}

export function pathsText(paths) {
  return paths.join('\n');
}

export function pasteMode(parsed) {
  return parsed?.cut === true ? 'move' : 'copy';
}
