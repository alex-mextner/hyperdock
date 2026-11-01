'use strict';

// Collision-safe file names for pastes, drops and duplicates in the stack
// dropdown. Pure string logic (no gi:// imports); the file-operation glue
// passes the names already present in the target folder.
//
// Series rule: a name that already ends in the style's own suffix continues
// that series (`a 2.png` -> `a 3.png`, `a copy.png` -> `a copy 2.png`). A
// numeric suffix of 1 is not a series marker ("a 1" is just a name). When
// 10000 candidates are all taken the result is the deterministic fallback
// candidate number 10001 (`a 10001.png`), so the loop always ends.
//
// A trailing number of more than 15 digits is not a safe integer (Number would
// round it and the series could land on a taken name), so it is plain stem
// text, never a series marker.
//
// A generated name is at most NAME_MAX_BYTES (255, the limit of ext4, btrfs,
// xfs...) bytes of UTF-8: the stem gives way, cut on a code point boundary;
// the extension only when it leaves no room for one stem character. A name
// that is not taken is returned as given, whatever its length.

const MAX_CANDIDATES = 10000;
const NAME_MAX_BYTES = 255;
const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const KEEP_BOTH_RE = /^(.+) (\d{1,15})$/;
const COPY_RE = /^(.*) copy(?: (\d{1,15}))?$/;

export function splitName(name) {
  const match = EXT_RE.exec(name);
  if (!match || match.index === 0) return { stem: name, ext: '' };
  let stem = name.slice(0, match.index);
  let ext = match[0];
  if (stem.length > 4 && stem.endsWith('.tar')) {
    stem = stem.slice(0, -4);
    ext = `.tar${ext}`;
  }
  return { stem, ext };
}

function keepBothSeries(stem) {
  const match = KEEP_BOTH_RE.exec(stem);
  if (match && Number(match[2]) >= 2) {
    return { base: match[1], next: Number(match[2]) + 1 };
  }
  return { base: stem, next: 2 };
}

function copySeries(stem) {
  const match = COPY_RE.exec(stem);
  if (!match) return { base: stem, next: 1 };
  return { base: match[1], next: match[2] ? Number(match[2]) + 1 : 2 };
}

function suffix(style, n) {
  if (style === 'copy') return n === 1 ? ' copy' : ` copy ${n}`;
  return ` ${n}`;
}

const encoder = new TextEncoder();
const byteLength = (text) => encoder.encode(text).length;

// The longest prefix of `text` of at most `max` UTF-8 bytes; for...of walks
// code points, so a multi-byte character or surrogate pair is never split.
function truncateToBytes(text, max) {
  let used = 0;
  let kept = '';
  for (const char of text) {
    used += byteLength(char);
    if (used > max) break;
    kept += char;
  }
  return kept;
}

// stem + suffix + ext within NAME_MAX_BYTES (see the header).
export function fitName(stem, suffix, ext) {
  const whole = `${stem}${suffix}${ext}`;
  if (byteLength(whole) <= NAME_MAX_BYTES) return whole;
  const room = NAME_MAX_BYTES - byteLength(suffix);
  const first = stem === '' ? '' : String.fromCodePoint(stem.codePointAt(0));
  const extRoom = Math.max(0, room - byteLength(first) - 1);
  const fittedExt = ext === '' ? '' : `.${truncateToBytes(ext.slice(1), extRoom)}`;
  const fittedStem = truncateToBytes(stem, room - byteLength(fittedExt));
  return `${fittedStem}${suffix}${fittedExt}`;
}

function isTakenIn(taken) {
  return typeof taken === 'function' ? taken : (name) => taken.has(name);
}

export function uniqueName(name, taken, style = 'keep-both') {
  const isTaken = isTakenIn(taken);
  if (!isTaken(name)) return name;
  const { stem, ext } = splitName(name);
  const series = style === 'copy' ? copySeries(stem) : keepBothSeries(stem);
  const candidate = (n) => fitName(series.base, suffix(style, n), ext);
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const found = candidate(series.next + i);
    if (!isTaken(found)) return found;
  }
  return candidate(MAX_CANDIDATES + 1);
}
