// gjs -m tests/stack_preview_model_check.js - the decisions behind Quick Look (pure
// logic, no GNOME Shell): which viewer a type gets, which items Left/Right walk,
// how big the picture is drawn, how much of a text file is read, what Sushi's
// arrow events mean. Exits 1 on failure.
import { createChecker } from './harness.js';
import {
  TEXT_PREVIEW_BYTES,
  clipText,
  exifOrientation,
  orientedSize,
  fitSize,
  isSushiAvailable,
  previewKind,
  previewRoute,
  previewWalk,
  sushiStep,
  walkStep,
} from '../stackPreviewModel.js';

const { check: harnessCheck, finish } = createChecker();
// the checks below read `check(what, result, detail)`; the detail is printed to explain a failure
const check = (what, result, detail) => harnessCheck(result, detail === undefined ? what : `${what}: ${JSON.stringify(detail)}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = (s) => new TextEncoder().encode(s);
const on = { sushiAvailable: true, sushiEnabled: true };

// previewKind: only image/* and text/* have a built-in viewer
check('image/png is an image', previewKind('image/png') === 'image');
check('image/svg+xml is an image', previewKind('image/svg+xml') === 'image');
check('text/plain is text', previewKind('text/plain') === 'text');
check('text/x-python is text', previewKind('text/x-python') === 'text');
check('text/markdown is text', previewKind('text/markdown') === 'text');
check('application/pdf is other', previewKind('application/pdf') === 'other');
check('video/mp4 is other', previewKind('video/mp4') === 'other');
check('application/json is other: the rule is image/* and text/* only', previewKind('application/json') === 'other');
check('inode/directory is other', previewKind('inode/directory') === 'other');
check('a missing type is other', previewKind(undefined) === 'other' && previewKind(null) === 'other' && previewKind('') === 'other');
check('the media type is matched case-insensitively', previewKind('IMAGE/PNG') === 'image' && previewKind('Text/Plain') === 'text');
check('a type that merely contains "image/" is other', previewKind('application/x-image/foo') === 'other');
check('parameters after the type are ignored', previewKind('text/plain; charset=utf-8') === 'text');

// previewRoute: images and text always use the overlay, the rest Sushi when it can
check('an image uses the overlay with Sushi on', previewRoute('image/png', on) === 'overlay');
check('text uses the overlay with Sushi on', previewRoute('text/plain', on) === 'overlay');
check('a PDF uses Sushi when available and enabled', previewRoute('application/pdf', on) === 'sushi');
check('a video uses Sushi when available and enabled', previewRoute('video/webm', on) === 'sushi');
check('a PDF falls back to the overlay card without the service', previewRoute('application/pdf', { sushiAvailable: false, sushiEnabled: true }) === 'overlay');
check('a PDF falls back to the overlay card when the setting is off', previewRoute('application/pdf', { sushiAvailable: true, sushiEnabled: false }) === 'overlay');
check('a PDF uses the overlay card with neither', previewRoute('application/pdf', { sushiAvailable: false, sushiEnabled: false }) === 'overlay');
check('an image never goes to Sushi even when it is the only viewer', previewRoute('image/png', { sushiAvailable: true, sushiEnabled: true }) !== 'sushi');
check('a folder never goes to Sushi', previewRoute('inode/directory', on, { isDir: true }) === 'overlay');
check('an item without a uri never goes to Sushi', previewRoute('application/pdf', on, { hasUri: false }) === 'overlay');
check('options default to the overlay when omitted', previewRoute('application/pdf') === 'overlay');
check('only a literal true enables Sushi', previewRoute('application/pdf', { sushiAvailable: 1, sushiEnabled: 'yes' }) === 'overlay');

// isSushiAvailable: activatable names or a current owner
const SUSHI = 'org.gnome.NautilusPreviewer';
check('activatable names list Sushi', isSushiAvailable(['org.a.B', SUSHI], false) === true);
check('a running owner counts even without a service file', isSushiAvailable([], true) === true);
check('neither: not available', isSushiAvailable(['org.a.B'], false) === false);
check('the Devel name is not Sushi', isSushiAvailable(['org.gnome.NautilusPreviewerDevel'], false) === false);
check('a name that starts with the Sushi name is not Sushi', isSushiAvailable([SUSHI + 'X'], false) === false);
check('another service name can be asked for', isSushiAvailable(['org.test.Previewer'], false, 'org.test.Previewer') === true && isSushiAvailable([SUSHI], false, 'org.test.Previewer') === false);
check('garbage input is not available', isSushiAvailable(null, false) === false && isSushiAvailable(undefined, undefined) === false);

// previewWalk
const items = (n) => Array.from({ length: n }, (_, i) => ({ number: i, name: `f${i}` }));
{
  const w = previewWalk(items(6), [1, 3, 4], 3);
  check('a multi-selection walks the selected items only', same(w.numbers, [1, 3, 4]), w);
  check('it starts at the focus', w.index === 1 && w.current === 3, w);
  check('it says "n of m"', w.label === '2 of 3', w);
}
{
  const w = previewWalk(items(6), [1, 3, 4], 0);
  check('a focus outside the selection starts at the first selected item', w.index === 0 && w.current === 1 && w.label === '1 of 3', w);
}
{
  const w = previewWalk(items(6), [4, 1, 3], 4);
  check('an unsorted selection is walked in reading order', same(w.numbers, [1, 3, 4]) && w.current === 4 && w.label === '3 of 3', w);
}
{
  const w = previewWalk(items(6), [2, 2, 5], 5);
  check('duplicate selected numbers are walked once', same(w.numbers, [2, 5]) && w.label === '2 of 2', w);
}
{
  const w = previewWalk(items(5), [2], 2);
  check('a single selected item walks the neighbours of the focus', same(w.numbers, [0, 1, 2, 3, 4]) && w.current === 2 && w.index === 2, w);
  check('a single selected item shows no "n of m"', w.label === '', w);
}
{
  const w = previewWalk(items(5), [], 3);
  check('nothing selected walks the neighbours of the focus', w.current === 3 && w.label === '', w);
}
{
  const w = previewWalk(items(5), [], -1);
  check('no focus and no selection starts at the first item', w.current === 0, w);
}
{
  const w = previewWalk([], [], -1);
  check('an empty stack has nothing to preview', w === null);
}
{
  const w = previewWalk(items(3), [7, 9], 7);
  check('selected numbers that are not items are ignored', w.numbers.length > 0 && w.numbers.every((n) => n < 3), w);
}
{
  const sparse = [{ number: 10 }, { number: 12 }, { number: 15 }];
  const w = previewWalk(sparse, [12], 12);
  check('item numbers need not be contiguous', same(w.numbers, [10, 12, 15]) && w.current === 12 && w.index === 1, w);
}

// walkStep: no wrap-around, the same object when nothing moves
{
  const w = previewWalk(items(6), [1, 3, 4], 3);
  const next = walkStep(w, 1);
  check('next moves to the next selected item', next.current === 4 && next.label === '3 of 3', next);
  check('the input walk is not mutated', w.current === 3 && w.index === 1);
  check('next at the end stays', walkStep(next, 1) === next);
  const prev = walkStep(w, -1);
  check('previous moves to the previous selected item', prev.current === 1 && prev.label === '1 of 3', prev);
  check('previous at the start stays', walkStep(prev, -1) === prev);
  check('a step of 0 stays', walkStep(w, 0) === w);
  check('a big step is clamped', walkStep(w, 10).current === 4 && walkStep(w, -10).current === 1);
}

// fitSize: scaled down to fit, never up, aspect kept
check('a picture that fits keeps its size', same(fitSize(800, 600, 1000, 1000), [800, 600]));
check('a wide picture is scaled to the width', same(fitSize(2000, 1000, 1000, 1000), [1000, 500]));
check('a tall picture is scaled to the height', same(fitSize(1000, 4000, 1000, 1000), [250, 1000]));
check('the scale is the smaller of the two ratios', same(fitSize(2560, 1440, 1080, 720), [1080, 608]));
check('a 1x1 picture stays 1x1', same(fitSize(1, 1, 500, 500), [1, 1]));
check('an extreme aspect never rounds to 0', same(fitSize(10000, 1, 100, 100), [100, 1]));
check('a zero size gives a zero-free fallback of the box', same(fitSize(0, 0, 300, 200), [300, 200]));
check('a NaN size gives the box', same(fitSize(NaN, 10, 300, 200), [300, 200]));
check('results are integers', fitSize(1001, 333, 500, 500).every(Number.isInteger));

// clipText: the first 4 KiB, never half a character
check('the preview reads 4 KiB', TEXT_PREVIEW_BYTES === 4096);
{
  const r = clipText(bytes('hello\nworld\n'));
  check('a short text is returned whole', r.text === 'hello\nworld\n' && r.truncated === false, r);
}
{
  const r = clipText(bytes('a'.repeat(5000)));
  check('a long text is cut to 4096 characters', r.text.length === 4096 && r.truncated === true, { len: r.text.length, truncated: r.truncated });
}
{
  const r = clipText(bytes('я'.repeat(3000)));
  check('a multibyte text is cut on a character boundary', r.truncated === true && /^я+$/.test(r.text) && r.text.length === 2048, { len: r.text.length });
}
{
  // 4095 ASCII bytes then a 2-byte character straddling the limit
  const r = clipText(bytes('a'.repeat(4095) + 'я'));
  check('a character straddling the limit is dropped, not broken', r.text === 'a'.repeat(4095) && r.truncated === true && !r.text.includes('\uFFFD'), { len: r.text.length });
}
{
  const r = clipText(bytes('x'.repeat(4096)));
  check('exactly the limit is not truncated when the buffer ends there', r.truncated === false && r.text.length === 4096);
}
{
  const r = clipText(bytes('a\0b\0c'));
  check('NUL bytes are removed', r.text === 'abc', r);
}
{
  const r = clipText(bytes('line1\r\nline2\ttabbed'));
  check('CR, LF and tab survive', r.text === 'line1\r\nline2\ttabbed', r);
}
{
  const r = clipText(new Uint8Array([0x66, 0xff, 0xfe, 0x6f]));
  check('invalid UTF-8 becomes replacement characters, not an exception', r.text === 'f\uFFFD\uFFFDo', r);
}
{
  const r = clipText(bytes('abcdef'), 3);
  check('a custom limit applies', r.text === 'abc' && r.truncated === true, r);
}
{
  const r = clipText(new Uint8Array(0));
  check('an empty file is empty and not truncated', r.text === '' && r.truncated === false);
}
{
  const r = clipText(bytes('\uFEFFbom'));
  check('a leading byte order mark is kept out of the text', r.text === 'bom', r);
}
{
  const big = bytes('b'.repeat(4096));
  check('clipText says truncated when told the file is longer than the buffer', clipText(big, 4096, 10000).truncated === true);
}

// sushiStep: SelectionEvent carries a GtkDirectionType (UP 2, DOWN 3, LEFT 4, RIGHT 5)
check('Left is previous', sushiStep(4) === -1);
check('Up is previous', sushiStep(2) === -1);
check('Right is next', sushiStep(5) === 1);
check('Down is next', sushiStep(3) === 1);
check('Tab directions mean nothing', sushiStep(0) === 0 && sushiStep(1) === 0);
check('an unknown direction means nothing', sushiStep(99) === 0 && sushiStep(undefined) === 0 && sushiStep(null) === 0);

// exifOrientation: read from the head of a JPEG
const jpegWith = (order, value, extra = []) => {
  const big = order === 'MM';
  const u16 = (n) => (big ? [n >> 8, n & 255] : [n & 255, n >> 8]);
  const u32 = (n) => (big ? [0, 0, n >> 8, n & 255] : [n & 255, n >> 8, 0, 0]);
  const tiff = [...bytes(order), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0, 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  return new Uint8Array([0xff, 0xd8, ...extra, ...app1, 0xff, 0xda, 0, 2]);
};
check('big-endian orientation 6 is read', exifOrientation(jpegWith('MM', 6)) === 6);
check('little-endian orientation 8 is read', exifOrientation(jpegWith('II', 8)) === 8);
check('an APP0 before the EXIF block is skipped', exifOrientation(jpegWith('MM', 3, [0xff, 0xe0, 0, 4, 0x4a, 0x46])) === 3);
check('orientation 9 is not valid and means 1', exifOrientation(jpegWith('MM', 9)) === 1);
check('a JPEG without EXIF is upright', exifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])) === 1);
check('a PNG is upright', exifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])) === 1);
check('a cut-off EXIF block is upright, not an exception', exifOrientation(jpegWith('MM', 6).subarray(0, 20)) === 1);
check('an empty buffer is upright', exifOrientation(new Uint8Array(0)) === 1);
check('orientations 5 to 8 swap the size', same(orientedSize(2000, 1000, 6), [1000, 2000]) && same(orientedSize(2000, 1000, 5), [1000, 2000]) && same(orientedSize(2000, 1000, 8), [1000, 2000]));
check('orientations 1 to 4 keep the size', [1, 2, 3, 4].every((o) => same(orientedSize(2000, 1000, o), [2000, 1000])));

finish();
