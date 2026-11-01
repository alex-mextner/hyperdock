// gjs -m tests/thumb_queue_check.js - the order thumbnails are made in and the
// sizes they are shown at (no GNOME Shell). Exits 1 on failure.
import { createChecker } from './harness.js';
import { ThumbQueue, fitSize, pngSize, thumbnailable } from '../thumbQueue.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- what gets a picture ----------------------------------------------------
check(thumbnailable('image/png') && thumbnailable('image/jpeg') && thumbnailable('image/svg+xml'), 'images get one');
check(thumbnailable('application/pdf'), 'PDFs get one');
check(!thumbnailable('text/plain') && !thumbnailable('application/zip') && !thumbnailable('inode/directory'), 'other files keep their icon');
check(!thumbnailable(null) && !thumbnailable(undefined) && !thumbnailable(''), 'no type, no picture');

// ---- the queue --------------------------------------------------------------
const q = new ThumbQueue(3);
q.add(['a', 'b', 'c', 'd']);
check(q.size === 4, 'paths queue up');
q.add(['b', 'e']);
check(q.size === 5, 'a queued path is not queued twice');
check(same(q.take(), ['a', 'b', 'c']), 'a batch is the first few in order');
check(q.size === 2 && q.has('a') && q.has('d'), 'a path being made still counts as known');
q.add(['a', 'z']);
check(q.size === 3, 'a path being made is not queued again, a new one is');
q.finish('a', null);
q.add(['a']);
check(q.size === 4, 'a finished path can be asked for again');

const u = new ThumbQueue(10);
u.add(['w1', 'w2']);
u.add(['v1', 'v2'], true);
check(same(u.take(), ['v1', 'v2', 'w1', 'w2']), 'urgent paths jump the queue, keeping their order');
u.add(['x', 'y']);
u.add(['y', 'x', 'q'], true);
check(same(u.take(), ['y', 'x', 'q']), 'an urgent request moves an already queued path to the front');

const r = new ThumbQueue(5);
r.add(['a', 'b', 'c']);
r.remove(['b', 'nope']);
check(same(r.take(), ['a', 'c']), 'a removed path is not made');
check(r.take().length === 0, 'an empty queue gives no batch');
const dead = new ThumbQueue(5);
dead.add(['a', 'b']);
dead.take();
dead.abandon();
dead.add(['a']);
check(dead.size === 1, 'after a worker dies its paths may be asked for again');

// ---- who gets the picture -----------------------------------------------------
const items = () => [{ path: '/a.png' }, { path: '/b.png' }];
const w = new ThumbQueue(10);
const [a1, b1] = items();
let told = 0;
w.request([a1, b1], () => told++, true);
const [a2] = items(); // the folder was listed again: a new object for the same file
w.request([a2], null, false);
check(w.size === 2, 'the same path asked for twice is queued once');
w.take();
const listeners = w.finish('/a.png', '/cache/a.png');
check(a1.thumb === '/cache/a.png' && a2.thumb === '/cache/a.png', 'every object asked for gets the picture, the old one an open dropdown shows too');
check(listeners.length === 1 && b1.thumb === undefined, 'only the finished path is touched');
listeners.forEach((l) => l());
check(told === 1, 'the waiting dropdown is told once');
w.finish('/b.png', null);
check(b1.thumbFailed === true && !b1.thumb, 'an impossible picture marks the item failed');
check(w.finish('/never-asked.png', '/x.png').length === 0, 'an unknown path is ignored');

const c = new ThumbQueue(10);
const cancelA = c.request([{ path: '/x.png' }, { path: '/y.png' }], () => {}, true);
c.request([{ path: '/y.png' }], null, false);
cancelA();
check(c.size === 1 && c.has('/y.png') && !c.has('/x.png'), 'withdrawing a request drops what nobody else wants and keeps what is made ahead');
const d = new ThumbQueue(10);
const one = () => {};
const cancelOne = d.request([{ path: '/z.png' }], one, true);
const cancelTwo = d.request([{ path: '/z.png' }], () => {}, true);
cancelOne();
check(d.has('/z.png'), 'another listener still wants it');
cancelTwo();
check(!d.has('/z.png'), 'nobody wants it any more');

// a file replaced while the worker made its picture
const v = new ThumbQueue(10);
const oldItem = { path: '/f.png', date: { tv_sec: 1 } };
v.request([oldItem], () => {}, true);
v.take();
const newItem = { path: '/f.png', date: { tv_sec: 2 } };
v.request([newItem], () => {}, true); // the folder was listed again
v.finish('/f.png', '/cache/old.png', 1);
check(oldItem.thumb === '/cache/old.png', 'the item for the version that was thumbnailed gets the picture');
check(newItem.thumb === undefined && v.has('/f.png') && v.size === 1, 'the item for the newer version does not, and is asked for again');
v.take();
v.finish('/f.png', '/cache/new.png', 2);
check(newItem.thumb === '/cache/new.png', 'the second run gives the newer item its picture');
// the worker already saw the newer version: the older item is retired, not retried
const r2 = new ThumbQueue(10);
const olderItem = { path: '/h.png', date: { tv_sec: 1 } };
r2.request([olderItem], null, false);
r2.take();
r2.finish('/h.png', '/cache/h2.png', 2);
check(r2.size === 0 && !r2.has('/h.png') && olderItem.thumb === undefined, 'an item older than the file that was read is dropped, not asked for again');
const unknown = { path: '/g.png' };
const u2 = new ThumbQueue(10);
u2.request([unknown], null, true);
u2.take();
u2.finish('/g.png', '/cache/g.png', 5);
check(unknown.thumb === '/cache/g.png', 'an item with no date takes whatever was made');

// what is on screen is made before what is only near it
const s1 = new ThumbQueue(10);
s1.request([{ path: '/v1' }, { path: '/v2' }], () => {}, true);
s1.request([{ path: '/m1' }, { path: '/m2' }], () => {}, false);
s1.request([{ path: '/v3' }], () => {}, true); // scrolled: new view
check(same(s1.take(), ['/v3', '/v1', '/v2', '/m1', '/m2']), 'prefetch for the margin stays behind every visible request');

// ---- sizes ----------------------------------------------------------------------
check(same(fitSize(256, 144, 64), { w: 64, h: 36 }), 'a landscape picture is bounded by its width');
check(same(fitSize(144, 256, 64), { w: 36, h: 64 }), 'a portrait picture is bounded by its height');
check(same(fitSize(100, 100, 64), { w: 64, h: 64 }), 'a square fills the box');
check(same(fitSize(0, 0, 64), { w: 64, h: 64 }) && same(fitSize(null, 5, 64), { w: 64, h: 64 }), 'unknown size fills the box');
check(same(fitSize(1000, 1, 64), { w: 64, h: 1 }), 'a thin picture keeps at least one pixel');

const png = (w, h) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
check(same(pngSize(png(256, 144)), { w: 256, h: 144 }), 'a PNG header gives the size');
check(same(pngSize(png(3840, 2160)), { w: 3840, h: 2160 }), 'sizes past 16 bits are read whole');
const bad = png(10, 10);
bad[1] = 0;
check(pngSize(bad) === null, 'not a PNG, no size');
check(pngSize(png(0, 5)) === null && pngSize(new Uint8Array(10)) === null && pngSize(null) === null, 'zero, short or missing data, no size');
const notIhdr = png(10, 10);
notIhdr[12] = 0x58;
check(pngSize(notIhdr) === null, 'the first chunk must be IHDR');

finish();
