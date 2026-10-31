'use strict';

// What a stack shows and where it goes in the dock, as pure functions (no
// gi:// imports) so tests/stack_model_check.js runs them under plain gjs.
//
// A "stack" is the dock's pile for a folder (Downloads, Screenshots, ...) or
// for the recent apps. The user asked for "стопки ... чтобы было видно что это
// не один элемент а несколько ... состоять из того что там на самом деле":
//   * pileItems / pileLayout  - the dock icon is a visible pile of the newest
//     real items, not one picture;
//   * groupItems              - the dropdown lists the items in batches (Today,
//     Yesterday, ... or by kind) under headers;
//   * clusterRank             - Recents, Downloads, Screenshots and the Trash
//     sit together behind one separator.

export const GROUP_MODES = ['none', 'date', 'kind'];
export const GROUP_LABELS = {
  none: 'None',
  date: 'Date',
  kind: 'Kind',
};

// index order = the int value of the downloads-stack-* settings; index 0 is the
// upstream behaviour
export const STACK_VIEWS = ['fan', 'grid', 'list', 'automatic'];
export const STACK_SORTS = [
  'date-modified',
  'name',
  'date-added',
  'date-created',
  'kind',
];
export const STACK_DISPLAYS = ['folder', 'stack'];
// index order = the int value of downloads-stack-group
export const STACK_GROUPS = GROUP_MODES;

export const STACK_VIEW_LABELS = {
  fan: 'Fan',
  grid: 'Grid',
  list: 'List',
  automatic: 'Automatic',
};
export const STACK_SORT_LABELS = {
  name: 'Name',
  'date-added': 'Date Added',
  'date-modified': 'Date Modified',
  'date-created': 'Date Created',
  kind: 'Kind',
};
export const STACK_DISPLAY_LABELS = { folder: 'Folder', stack: 'Stack' };
export const STACK_GROUP_LABELS = GROUP_LABELS;

export function pick(value, choices) {
  return choices.includes(value) ? value : choices[0];
}

// most layers a pile icon draws
export const PILE_MAX = 3;

// Layers of a pile icon, back to front, for `count` items (1..PILE_MAX):
// offsets as a fraction of the icon size from the centre (x right, y down),
// rotation in degrees, scale of the picture. The front layer is the newest
// item and sits almost square; those behind peek out on alternating sides.
const PILE_LAYOUTS = [
  [{ x: 0, y: 0, angle: 0, scale: 1 }],
  [
    { x: -0.07, y: -0.05, angle: -9, scale: 0.92 },
    { x: 0.03, y: 0.03, angle: 3, scale: 1 },
  ],
  [
    { x: -0.09, y: -0.06, angle: -13, scale: 0.88 },
    { x: 0.08, y: -0.03, angle: 10, scale: 0.92 },
    { x: 0, y: 0.04, angle: -2, scale: 1 },
  ],
];

export function pileLayout(count) {
  const n = Math.max(0, Math.min(count, PILE_MAX));
  return n === 0 ? [] : PILE_LAYOUTS[n - 1].map((layer) => ({ ...layer }));
}

// The items a pile draws, back to front: the first PILE_MAX of `items` (the
// stack's own order, newest first by default) reversed so the newest is last.
export function pileItems(items) {
  return items.slice(0, PILE_MAX).reverse();
}

// The JSON layers apps/stack-pile.js draws for a stack's `items`, back to
// front: the pile layout plus what each layer shows. `iconFor(item)` gives an
// app item's icon file (null for files).
export function pileLayers(items, iconFor = () => null) {
  const picked = pileItems(items);
  const layout = pileLayout(picked.length);
  return picked.map((item, i) => ({
    ...layout[i],
    file: item.path ?? null,
    type: item.type ?? null,
    name: item.name ?? '',
    icon: iconFor(item) ?? null,
  }));
}

// ---- grouping (batches) ----------------------------------------------

const DAY = 24 * 60 * 60;

export const DATE_BUCKETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'Previous 7 Days'],
  ['month', 'Previous 30 Days'],
  ['older', 'Earlier'],
];

// Start of the local calendar day containing `now` (a Date), in seconds.
function startOfDay(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
}

// The bucket of a timestamp (seconds). Calendar days, as in macOS: "Today"
// since this midnight, "Yesterday" the day before, then the 7 and 30 days
// before today. A time in the future counts as today.
export function dateBucket(seconds, now) {
  const today = startOfDay(now);
  if (seconds >= today) return 'today';
  if (seconds >= today - DAY) return 'yesterday';
  if (seconds >= today - 7 * DAY) return 'week';
  if (seconds >= today - 30 * DAY) return 'month';
  return 'older';
}

export const KIND_BUCKETS = [
  ['folders', 'Folders'],
  ['images', 'Images'],
  ['video', 'Movies'],
  ['audio', 'Music'],
  ['documents', 'Documents'],
  ['archives', 'Archives'],
  ['apps', 'Applications'],
  ['other', 'Other'],
];

const DOCUMENT_TYPES = /^(application\/(pdf|rtf|msword|vnd\.(ms-|openxmlformats|oasis\.opendocument)|x-abiword|epub)|text\/)/;
const ARCHIVE_TYPES = /^application\/(zip|gzip|x-(tar|bzip2?|xz|7z-compressed|rar|compressed|cpio|lzma|zstd|archive)|vnd\.rar|zstd)/;
const PACKAGE_TYPES = /^application\/(vnd\.debian\.binary-package|x-(rpm|deb|executable|shellscript|desktop|appimage)|vnd\.appimage|vnd\.flatpak)/;

export function kindBucket(contentType) {
  const type = contentType ?? '';
  const major = type.split('/')[0];
  if (type === 'inode/directory') return 'folders';
  if (major === 'image') return 'images';
  if (major === 'video') return 'video';
  if (major === 'audio') return 'audio';
  if (ARCHIVE_TYPES.test(type)) return 'archives';
  if (PACKAGE_TYPES.test(type)) return 'apps';
  if (DOCUMENT_TYPES.test(type)) return 'documents';
  return 'other';
}

// The timestamp a file is dated by: the day it arrived unless the stack is
// sorted by modification time. `created` and `date.tv_sec` are what
// services.js lists (seconds).
export function itemTime(item, sort) {
  if (sort === 'date-modified') return item.date?.tv_sec ?? 0;
  return item.created ?? item.date?.tv_sec ?? 0;
}

function bucketsOf(mode, items, { now, sort }) {
  if (mode === 'date') {
    return [DATE_BUCKETS, (item) => dateBucket(itemTime(item, sort), now)];
  }
  return [KIND_BUCKETS, (item) => kindBucket(item.type)];
}

// Splits `items` (already in the stack's order) into batches with a header:
// [{ key, title, items }], in the bucket order, empty batches dropped, items
// keeping their order inside a batch. Mode 'none' (or an unknown one) is a
// single untitled batch so callers need no special case. `now` is a Date.
export function groupItems(items, mode, { now = new Date(), sort = 'date-added' } = {}) {
  if (!GROUP_MODES.includes(mode) || mode === 'none') {
    return items.length ? [{ key: 'all', title: null, items: [...items] }] : [];
  }
  const [buckets, bucketOf] = bucketsOf(mode, items, { now, sort });
  const byKey = new Map(buckets.map(([key, title]) => [key, { key, title, items: [] }]));
  items.forEach((item) => byKey.get(bucketOf(item)).items.push(item));
  return [...byKey.values()].filter((group) => group.items.length > 0);
}

// ---- the dock group -------------------------------------------------------

// Roles of the dock items that follow the Shell's separator, in the order they
// stand: mounted volumes, then ONE group of Recents, Downloads, the other
// stacks (Screenshots, ...), minimized-window tiles and the Trash.
const CLUSTER_ROLES = ['separator', 'mount', 'recents', 'downloads', 'stack', 'tile', 'trash'];

export function clusterRank(role) {
  const rank = CLUSTER_ROLES.indexOf(role);
  return rank < 0 ? CLUSTER_ROLES.indexOf('stack') : rank;
}

// The indices of `roles` (one role per item, current order) in dock order.
// Stable: items of one role keep their relative order (the folder-stacks
// setting's order, mounts as they appeared).
export function clusterOrder(roles) {
  return roles
    .map((role, index) => ({ index, rank: clusterRank(role) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.index);
}

// ---- the dropdown's size --------------------------------------------------

// logical px
export const PANEL = {
  GRID_COLUMNS: 5,
  GRID_CELL: 96,
  GRID_THUMB: 64,
  GRID_ROW_GAP: 12,
  LIST_THUMB: 24,
  LIST_ROW: 36,
  LIST_WIDTH: 300,
  HEADER: 26,
  // a panel shows at most this many rows (plus one batch header) and scrolls
  // the rest
  MAX_GRID_ROWS: 4,
  MAX_LIST_ROWS: 12,
};

// Visible size of the file area for batches `groups` in `view` ('grid' or
// 'list'): every batch adds its header, a grid batch fills rows of
// GRID_COLUMNS, and the height is capped so a long stack scrolls.
export function contentSize(groups, view) {
  const items = groups.reduce((n, g) => n + g.items.length, 0);
  const headers = groups.filter((g) => g.title).length * PANEL.HEADER;
  if (view === 'list') {
    const full = items * PANEL.LIST_ROW + headers;
    const cap = PANEL.MAX_LIST_ROWS * PANEL.LIST_ROW + PANEL.HEADER;
    return { width: PANEL.LIST_WIDTH, height: Math.min(full, cap) };
  }
  const rowHeight = PANEL.GRID_CELL + PANEL.GRID_ROW_GAP;
  const rows = groups.reduce((n, g) => n + Math.ceil(g.items.length / PANEL.GRID_COLUMNS), 0);
  const cap = PANEL.MAX_GRID_ROWS * rowHeight + PANEL.HEADER;
  return {
    width: Math.min(items, PANEL.GRID_COLUMNS) * PANEL.GRID_CELL,
    height: Math.min(rows * rowHeight + headers, cap),
  };
}
