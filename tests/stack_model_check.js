// gjs -m tests/stack_model_check.js - the stacks' pure rules (no GNOME Shell):
// the pile a stack icon draws, the batches a dropdown lists, and the order of
// the Recents / Downloads / Screenshots / Trash group. Exits 1 on failure.
import { createChecker } from './harness.js';
import {
  clusterOrder,
  dateBucket,
  groupItems,
  itemTime,
  kindBucket,
  pileItems,
  pileLayout,
  PANEL,
  pileLayers,
  contentSize,
} from '../stackModel.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Fri 2026-10-30 15:30 local; `at(n)` is the start of the local day n days before
const NOW = new Date(2026, 9, 30, 15, 30);
const at = (days, extra = 0) => new Date(2026, 9, 30 - days).getTime() / 1000 + extra;
const DAY = 86400;

// ---- date buckets -----------------------------------------------------
check(dateBucket(at(0, 1), NOW) === 'today', 'a file from this morning is Today');
check(dateBucket(at(0), NOW) === 'today', 'midnight sharp is Today');
check(dateBucket(at(0, DAY * 3), NOW) === 'today', 'a time in the future counts as Today');
check(dateBucket(at(0, -1), NOW) === 'yesterday', 'one second before midnight is Yesterday');
check(dateBucket(at(1), NOW) === 'yesterday', 'the start of yesterday is Yesterday');
check(dateBucket(at(1, -1), NOW) === 'week', 'the day before yesterday is Previous 7 Days');
check(dateBucket(at(7), NOW) === 'week', 'exactly 7 days back is still Previous 7 Days');
check(dateBucket(at(7, -1), NOW) === 'month', 'older than 7 days is Previous 30 Days');
check(dateBucket(at(30), NOW) === 'month', 'exactly 30 days back is still Previous 30 Days');
check(dateBucket(at(30, -1), NOW) === 'older', 'older than 30 days is Earlier');
check(dateBucket(0, NOW) === 'older', 'epoch is Earlier');

// a day with a daylight-saving change is not 86400 s long: dates built from
// calendar fields, whatever the machine's time zone
const dst = new Date(2026, 9, 26, 12);
const secs = (y, m, d, h, min) => new Date(y, m, d, h, min).getTime() / 1000;
check(dateBucket(secs(2026, 9, 25, 0, 30), dst) === 'yesterday', 'the early hours of yesterday are Yesterday');
check(dateBucket(secs(2026, 9, 24, 23, 30), dst) === 'week', 'the evening before yesterday is Previous 7 Days');
check(dateBucket(secs(2026, 9, 19, 0, 30), dst) === 'week', 'seven calendar days back is Previous 7 Days');
check(dateBucket(secs(2026, 9, 18, 23, 30), dst) === 'month', 'older than seven calendar days is Previous 30 Days');
const spring = new Date(2026, 2, 30, 12);
check(dateBucket(secs(2026, 2, 29, 0, 30), spring) === 'yesterday', 'a short day (spring forward) still has its early hours in Yesterday');

// ---- kind buckets -----------------------------------------------------
const kinds = {
  'inode/directory': 'folders',
  'image/png': 'images',
  'image/svg+xml': 'images',
  'video/mp4': 'video',
  'audio/mpeg': 'audio',
  'application/pdf': 'documents',
  'text/plain': 'documents',
  'application/vnd.oasis.opendocument.text': 'documents',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'documents',
  'application/zip': 'archives',
  'application/gzip': 'archives',
  'application/x-compressed-tar': 'archives',
  'application/x-7z-compressed': 'archives',
  'application/vnd.debian.binary-package': 'apps',
  'application/x-shellscript': 'apps',
  'application/octet-stream': 'other',
  '': 'other',
};
for (const [type, bucket] of Object.entries(kinds)) {
  check(kindBucket(type) === bucket, `${type || '(empty)'} is ${bucket}`);
}
check(kindBucket(null) === 'other' && kindBucket(undefined) === 'other', 'a missing content type is Other');

// ---- itemTime ---------------------------------------------------------
const file = { created: 100, date: { tv_sec: 50 } };
check(itemTime(file, 'date-added') === 100, 'Date Added is dated by arrival');
check(itemTime(file, 'name') === 100, 'any other sort is dated by arrival');
check(itemTime(file, 'date-modified') === 50, 'Date Modified is dated by modification');
check(itemTime({ date: { tv_sec: 7 } }, 'date-added') === 7, 'no btime falls back to modification');
check(itemTime({}, 'date-added') === 0, 'no time at all is the epoch');

// ---- grouping ---------------------------------------------------------
const f = (name, created, type = 'application/pdf') => ({ name, created, type, date: { tv_sec: created } });
const items = [
  f('today-b.pdf', at(0, 3600)),
  f('today-a.png', at(0, 60), 'image/png'),
  f('yesterday.zip', at(1, 60), 'application/zip'),
  f('old.pdf', at(90)),
  f('week.txt', at(4), 'text/plain'),
];
const byDate = groupItems(items, 'date', { now: NOW });
check(
  same(byDate.map((g) => g.title), ['Today', 'Yesterday', 'Previous 7 Days', 'Earlier']),
  'date batches come newest first, empty ones dropped'
);
check(
  same(byDate[0].items.map((i) => i.name), ['today-b.pdf', 'today-a.png']),
  'files keep the stack order inside a batch'
);
check(byDate.reduce((n, g) => n + g.items.length, 0) === items.length, 'no file is lost or doubled by grouping');
const byKind = groupItems(items, 'kind', { now: NOW });
check(
  same(byKind.map((g) => g.title), ['Images', 'Documents', 'Archives']),
  'kind batches come in the fixed kind order'
);
check(byKind[1].items.length === 3, 'PDFs and text files share Documents');
const none = groupItems(items, 'none', { now: NOW });
check(none.length === 1 && none[0].title === null && none[0].items.length === items.length, 'no grouping is one untitled batch');
check(groupItems(items, 'nonsense', { now: NOW }).length === 1, 'an unknown mode behaves as no grouping');
check(groupItems([], 'date', { now: NOW }).length === 0, 'an empty stack has no batches');
check(groupItems([], 'none', { now: NOW }).length === 0, 'an empty stack has no batches even ungrouped');
const modified = groupItems([{ name: 'm', created: at(40), date: { tv_sec: at(0, 5) }, type: 'text/plain' }], 'date', {
  now: NOW,
  sort: 'date-modified',
});
check(modified[0].title === 'Today', 'sorted by Date Modified, a file is dated by modification');
const input = [...items];
groupItems(items, 'date', { now: NOW });
check(same(items, input), 'grouping does not reorder or mutate the stack');

// ---- pile ---------------------------------------------------------------
check(pileLayout(0).length === 0, 'an empty stack draws no pile');
check(pileLayout(1).length === 1, 'one item is a single layer');
check(pileLayout(3).length === 3 && pileLayout(9).length === 3, 'a pile never has more than three layers');
const three = pileLayout(3);
check(three[2].scale === 1 && three[2].x === 0, 'the front layer is full size and centred horizontally');
check(three[0].scale < three[2].scale && three[1].scale < three[2].scale, 'layers behind are smaller');
check(three[0].angle !== three[1].angle && three[0].angle !== three[2].angle, 'layers are rotated differently so the pile shows');
check(three.every((l) => Math.abs(l.x) <= 0.1 && Math.abs(l.y) <= 0.1), 'offsets stay small enough to fit the icon');
pileLayout(3)[0].x = 99;
check(pileLayout(3)[0].x !== 99, 'layouts are copies, not shared state');
check(same(pileItems(['n', 'm', 'o', 'p']).join(''), 'omn'), 'the newest of the first three is drawn last (in front)');
check(pileItems(['only']).length === 1 && pileItems([]).length === 0, 'a small stack draws what it has');

const layers = pileLayers([
  { name: 'a.png', path: '/x/a.png', type: 'image/png' },
  { name: 'b.pdf', path: '/x/b.pdf', type: 'application/pdf' },
]);
check(layers.length === 2 && layers[1].name === 'a.png' && layers[1].file === '/x/a.png', 'the newest item is the front layer');
check(layers[0].angle === pileLayout(2)[0].angle && layers[0].icon === null, 'layers carry the pile layout and no icon for files');
check(pileLayers([{ name: 'App' }], () => '/i.svg')[0].icon === '/i.svg', 'an app layer carries its icon file');
check(pileLayers([]).length === 0, 'no items, no layers');

// ---- dock group -----------------------------------------------------------
const order = ['trash', 'stack', 'downloads', 'recents', 'mount', 'separator', 'tile', 'stack'];
check(
  same(clusterOrder(order).map((i) => order[i]), ['separator', 'mount', 'recents', 'downloads', 'stack', 'stack', 'tile', 'trash']),
  'dock order: separator, mounts, Recents, Downloads, other stacks, tiles, Trash'
);
check(same(clusterOrder(order).slice(4, 6), [1, 7]), 'stacks keep the order the folder-stacks setting gave them');
check(same(clusterOrder(['stack', 'mystery']), [0, 1]), 'an unknown role counts as a stack');
check(same(clusterOrder([]), []), 'nothing to order');

// ---- dropdown size ----------------------------------------------------------
const g = (title, n) => ({ title, items: new Array(n).fill({}) });
const grid = (groups) => contentSize(groups, 'grid');
check(grid([g(null, 3)]).width === 3 * PANEL.GRID_CELL, 'a small ungrouped grid is as wide as its files');
check(grid([g(null, 40)]).width === PANEL.GRID_COLUMNS * PANEL.GRID_CELL, 'a big grid is five columns wide');
check(grid([g(null, 5)]).height === PANEL.GRID_CELL + PANEL.GRID_ROW_GAP, 'five files are one row');
check(grid([g(null, 6)]).height === 2 * (PANEL.GRID_CELL + PANEL.GRID_ROW_GAP), 'six files are two rows');
check(
  grid([g('Today', 1), g('Yesterday', 1)]).height === 2 * (PANEL.GRID_CELL + PANEL.GRID_ROW_GAP) + 2 * PANEL.HEADER,
  'every batch adds its header and starts a new row'
);
check(
  grid([g(null, 500)]).height === PANEL.MAX_GRID_ROWS * (PANEL.GRID_CELL + PANEL.GRID_ROW_GAP) + PANEL.HEADER,
  'a long grid is capped and scrolls'
);
check(contentSize([g(null, 4)], 'list').height === 4 * PANEL.LIST_ROW, 'a list is one row per file');
check(contentSize([g('Today', 4)], 'list').height === 4 * PANEL.LIST_ROW + PANEL.HEADER, 'a list batch adds its header');
check(contentSize([g(null, 400)], 'list').height === PANEL.MAX_LIST_ROWS * PANEL.LIST_ROW + PANEL.HEADER, 'a long list is capped and scrolls');
check(contentSize([], 'grid').height === 0 && contentSize([], 'list').height === 0, 'an empty stack has no area');

finish();
