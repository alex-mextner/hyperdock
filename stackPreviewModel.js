'use strict';

// What Quick Look (stackPreview.js, stackSushi.js) decides, as pure functions
// so tests/stack_preview_model_check.js can run them under plain gjs: which
// viewer a type gets, which items Left/Right walk, how large the picture is
// drawn, how much of a text file is read, what a Sushi arrow event means.
// Nothing here imports gi://, the Shell or a sibling module.

export const TEXT_PREVIEW_BYTES = 4096;

export const SUSHI_NAME = 'org.gnome.NautilusPreviewer';
const DIRECTORY = 'inode/directory';

// 'image', 'text' or 'other': only image/* and text/* have a built-in viewer
export function previewKind(contentType) {
  if (typeof contentType !== 'string') return 'other';
  const media = contentType.split(';')[0].trim().toLowerCase();
  if (media.startsWith('image/')) return 'image';
  if (media.startsWith('text/')) return 'text';
  return 'other';
}

// 'overlay' (the built-in picture, text or card) or 'sushi'. Images and text
// always stay in the overlay; any other file goes to Sushi only when the
// service can be reached and the setting allows it. `state` is
// { sushiAvailable, sushiEnabled }, both compared to the literal true;
// `item` is { isDir, hasUri } (a folder or an item without a uri has nothing
// Sushi could show).
export function previewRoute(contentType, state = {}, item = {}) {
  if (previewKind(contentType) !== 'other') return 'overlay';
  const media = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : '';
  if (item.isDir === true || media === DIRECTORY || item.hasUri === false) return 'overlay';
  return state.sushiAvailable === true && state.sushiEnabled === true ? 'sushi' : 'overlay';
}

// Sushi can be reached when its bus name is activatable (a service file
// exists) or already has an owner. `activatable` is ListActivatableNames;
// `name` is another service for tests that stand in for Sushi.
export function isSushiAvailable(activatable, owned, name = SUSHI_NAME) {
  return owned === true || (Array.isArray(activatable) && activatable.includes(name));
}

// The items Left/Right walk, starting at the focus. A selection of two or more
// walks the selected items only and shows "n of m"; one or no selected item
// walks the neighbours of the focus (every item) and shows no count. `items`
// are { number }; returns { numbers, index, current, count, label } or null
// when there is nothing to show.
export function previewWalk(items, selected, focus) {
  const all = [...new Set((items ?? []).map((i) => i.number))].sort((a, b) => a - b);
  if (all.length === 0) return null;
  const known = new Set(all);
  const picked = [...new Set(selected ?? [])].filter((n) => known.has(n)).sort((a, b) => a - b);
  const multi = picked.length >= 2;
  const numbers = multi ? picked : all;
  let index = numbers.indexOf(focus);
  if (index < 0 && picked.length === 1) index = numbers.indexOf(picked[0]);
  if (index < 0) index = 0;
  return walkAt(numbers, index, multi);
}

function walkAt(numbers, index, multi) {
  return {
    numbers,
    index,
    current: numbers[index],
    count: numbers.length,
    label: multi ? `${index + 1} of ${numbers.length}` : '',
  };
}

// The walk moved by `delta` items, clamped at both ends (no wrap-around, as in
// the dropdown's own navigation); the same object when it did not move.
export function walkStep(walk, delta) {
  const index = Math.max(0, Math.min(walk.count - 1, walk.index + delta));
  if (index === walk.index) return walk;
  return walkAt(walk.numbers, index, walk.label !== '');
}

// [w, h] scaled down to fit the box, aspect kept, never scaled up; an
// unmeasured size (0, NaN) takes the box.
export function fitSize(width, height, maxWidth, maxHeight) {
  if (!(width > 0) || !(height > 0)) return [maxWidth, maxHeight];
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

// The head of a text file for the overlay: at most `limit` bytes decoded as
// UTF-8, a character cut by the limit dropped rather than half shown, NULs
// removed, a byte order mark swallowed. `total` is the file's size when it is
// known to exceed what was read. -> { text, truncated }
export function clipText(bytes, limit = TEXT_PREVIEW_BYTES, total = bytes.length) {
  const truncated = bytes.length > limit || total > bytes.length;
  let end = Math.min(bytes.length, limit);
  if (truncated) end = completeEnd(bytes, end);
  const text = new TextDecoder().decode(bytes.subarray(0, end)).replace(/\0/g, '').replace(/^\uFEFF/, '');
  return { text, truncated };
}

// `end` moved back to before a UTF-8 sequence that `end` cuts in half
function completeEnd(bytes, end) {
  for (let i = end - 1; i >= Math.max(0, end - 4); i--) {
    const b = bytes[i];
    if ((b & 0xc0) === 0x80) continue;
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return i + need > end ? i : end;
  }
  return end;
}

// Sushi's SelectionEvent carries a GtkDirectionType: UP 2, DOWN 3, LEFT 4,
// RIGHT 5. -> -1 previous, 1 next, 0 nothing
export function sushiStep(direction) {
  if (direction === 2 || direction === 4) return -1;
  if (direction === 3 || direction === 5) return 1;
  return 0;
}

// The EXIF orientation (1 to 8, as the standard numbers them) of a JPEG from
// its first bytes, 1 when there is none or the data is not a JPEG. 5 to 8 mean
// the picture is stored on its side, so it shows with width and height swapped.
export function exifOrientation(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker === 0xe1 && isExif(bytes, at + 4)) return tiffOrientation(bytes, at + 10, at + 2 + length);
    at += 2 + length;
  }
  return 1;
}

function isExif(bytes, at) {
  return [0x45, 0x78, 0x69, 0x66, 0, 0].every((b, i) => bytes[at + i] === b);
}

// Orientation tag (0x0112) of the first IFD of the TIFF block at `tiff`
function tiffOrientation(bytes, tiff, end) {
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!big && !(bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49)) return 1;
  const u16 = (i) => (big ? (bytes[i] << 8) | bytes[i + 1] : (bytes[i + 1] << 8) | bytes[i]);
  const u32 = (i) => (big ? u16(i) * 65536 + u16(i + 2) : u16(i + 2) * 65536 + u16(i));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const entries = u16(ifd);
  for (let n = 0; n < entries; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) !== 0x0112) continue;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

// width and height as shown once the orientation is applied
export function orientedSize(width, height, orientation) {
  return orientation >= 5 ? [height, width] : [width, height];
}
