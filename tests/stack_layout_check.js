// gjs -m tests/stack_layout_check.js - where the cells, rows and headers of a
// stack dropdown stand (no GNOME Shell). Exits 1 on failure.
import { createChecker } from './harness.js';
import {
  PANEL,
  cellName,
  gridColumns,
  layoutFor,
  layoutGrid,
  layoutList,
  scrollToReveal,
  viewportSize,
  visibleSlice,
} from '../stackLayout.js';

const { check, finish } = createChecker();

const g = (title, n) => ({ key: title ?? 'all', title, items: new Array(n).fill({}) });
const C = PANEL.GRID_CELL;
const R = PANEL.GRID_ROW;

// ---- columns ---------------------------------------------------------------
check(gridColumns(2560) === PANEL.GRID_COLUMNS, 'a wide screen gets the full grid');
check(gridColumns(1200) === PANEL.GRID_COLUMNS, 'a 1200 px screen still fits five columns');
check(gridColumns(600) === 3, 'a narrow screen gets fewer columns (60% of 600 = 360 px = 3 cells)');
check(gridColumns(100) === PANEL.MIN_COLUMNS, 'never fewer than the minimum');
check(gridColumns(2560, 3) === 3, 'never more columns than files');
check(gridColumns(2560, 0) === 1, 'an empty stack still has one column');

// ---- the grid: one column grid for all batches ------------------------------
const two = layoutGrid([g('Today', 1), g('Yesterday', 2)], 5);
check(two.cells.length === 3, 'every file has a cell');
check(two.cells[0].x === 0, 'a batch of one starts in the first column, not the middle');
check(two.cells[1].x === 0 && two.cells[2].x === C, 'the next batch starts in the first column again');
check(two.cells.every((c) => c.x % C === 0 && c.w === C && c.h === R), 'every cell is one grid cell');
check(two.headers.length === 2 && two.headers.every((h) => h.x === 0 && h.w === 5 * C), 'headers span the full width');
check(two.headers[0].y === 0 && two.cells[0].y === PANEL.HEADER, 'a header sits right above its first row');
check(
  two.headers[1].y === PANEL.HEADER + R && two.cells[1].y === 2 * PANEL.HEADER + R,
  'a batch starts a new row, below the previous one and its own header'
);
check(two.height === 2 * PANEL.HEADER + 2 * R, 'height is the headers plus one row per batch');

const many = layoutGrid([g(null, 12)], 5);
check(many.cells.map((c) => c.x / C).join() === '0,1,2,3,4,0,1,2,3,4,0,1', 'files fill the columns row by row');
check(many.cells[10].y === 2 * R && many.height === 3 * R, 'the last row is partial but whole in height');
check(many.cells.map((c) => c.number).join() === [...many.cells.keys()].join(), 'cells are numbered across the grid');
check(many.cells[7].index === 7 && layoutGrid([g('A', 6), g('B', 6)], 5).cells[11].index === 5, '`index` counts inside the batch');
check(layoutGrid([g(null, 3)], 3).width === 3 * C, 'the grid is as wide as its columns');
check(layoutGrid([], 5).height === 0 && layoutGrid([], 5).cells.length === 0, 'an empty stack has nothing');
check(layoutGrid([g(null, 4)], 2).cells[3].x === C && layoutGrid([g(null, 4)], 2).cells[3].y === R, 'two columns wrap after two files');

// ---- columns follow the screen and the count --------------------------------
check(layoutFor([g(null, 40)], 'grid', 2560).columns === 5, 'layoutFor picks the columns for the screen');
check(layoutFor([g(null, 40)], 'grid', 600).columns === 3, 'a narrow screen gives a narrower grid');
check(layoutFor([g(null, 2)], 'grid', 2560).width === 2 * C, 'two files are two columns wide');

// ---- the list ------------------------------------------------------------------
const list = layoutList([g('Today', 2), g('Earlier', 1)]);
check(list.cells.map((c) => c.y).join() === [PANEL.HEADER, PANEL.HEADER + PANEL.LIST_ROW, 2 * PANEL.HEADER + 2 * PANEL.LIST_ROW].join(), 'list rows stack under their headers');
check(list.cells.every((c) => c.x === 0 && c.w === PANEL.LIST_WIDTH), 'list rows are full width');
check(list.height === 2 * PANEL.HEADER + 3 * PANEL.LIST_ROW, 'list height is headers plus rows');

// ---- the visible size (same numbers the old contentSize gave) --------------------
check(viewportSize(layoutGrid([g(null, 5)], 5)).height === R, 'five files are one row');
check(viewportSize(layoutGrid([g(null, 6)], 5)).height === 2 * R, 'six files are two rows');
check(
  viewportSize(layoutGrid([g('Today', 1), g('Yesterday', 1)], 5)).height === 2 * R + 2 * PANEL.HEADER,
  'every batch adds its header and starts a new row'
);
const big = viewportSize(layoutGrid([g(null, 500)], 5));
check(big.height === PANEL.MAX_GRID_ROWS * R + PANEL.HEADER && big.scrolls, 'a long grid is capped and scrolls');
check(big.width === 5 * C + PANEL.SCROLL_LANE, 'a scrolling grid keeps a lane for the scrollbar');
check(viewportSize(layoutGrid([g(null, 3)], 3)).width === 3 * C, 'a short grid has no lane');
check(viewportSize(layoutList([g(null, 4)])).height === 4 * PANEL.LIST_ROW, 'a list is one row per file');
check(viewportSize(layoutList([g('Today', 4)])).height === 4 * PANEL.LIST_ROW + PANEL.HEADER, 'a list batch adds its header');
check(
  viewportSize(layoutList([g(null, 400)])).height === PANEL.MAX_LIST_ROWS * PANEL.LIST_ROW + PANEL.HEADER,
  'a long list is capped and scrolls'
);
check(viewportSize(layoutGrid([], 5)).height === 0 && viewportSize(layoutList([])).width === 0, 'an empty stack has no area');

// ---- which cells are on screen ------------------------------------------------
const long = layoutGrid([g('Today', 2000)], 5); // 400 rows
const [a, b] = visibleSlice(long.cells, 0, 4 * R, 0);
check(a === 0 && b === 20, 'at the top four rows fit under the header');
const win = visibleSlice(long.cells, 10 * R + PANEL.HEADER, 4 * R, 0);
check(win[0] === 50 && win[1] === 70, 'scrolled to row 10: rows 10..13');
const half = visibleSlice(long.cells, 10 * R + PANEL.HEADER + R / 2, 4 * R, 0);
check(half[0] === 50 && half[1] === 75, 'a half-scrolled row is still in, so is the one entering at the bottom');
const margin = visibleSlice(long.cells, 10 * R + PANEL.HEADER, 4 * R, 2 * R);
check(margin[0] === 40 && margin[1] === 80, 'the margin adds whole rows each way');
const end = visibleSlice(long.cells, long.height - 4 * R, 4 * R, 2 * R);
check(end[1] === 2000 && end[0] === 2000 - 5 * 6, 'at the end the slice stops at the last cell');
check(visibleSlice([], 0, 100, 10).join() === '0,0', 'nothing to show');
const first = visibleSlice(long.cells, -500, 300, 0);
check(first[0] === 0, 'a window above the content starts at the first cell');
let total = 0;
for (let top = 0; top < long.height; top += R / 3) {
  const [s, e] = visibleSlice(long.cells, top, 4 * R, R);
  total += e - s;
  for (let i = Math.max(0, s - 7); i < Math.min(2000, e + 7); i++) {
    const inside = long.cells[i].y + long.cells[i].h > top - R && long.cells[i].y < top + 5 * R;
    if (inside !== (i >= s && i < e)) {
      check(false, `slice agrees with brute force at top=${top}, cell ${i}`);
      top = Infinity;
      break;
    }
  }
}
check(total > 0, 'slices agree with a brute-force scan at every offset');

// ---- scrolling a cell into view -----------------------------------------------
const cell = { y: 500, h: R };
check(scrollToReveal(cell, 0, 4 * R) === 500 + R - 4 * R, 'a cell below the window scrolls up just enough');
check(scrollToReveal(cell, 900, 4 * R) === 500, 'a cell above the window scrolls down to it');
check(scrollToReveal(cell, 400, 4 * R) === 400, 'a cell in view does not scroll');

// ---- names ----------------------------------------------------------------------
check(cellName('notes.txt') === 'notes.txt', 'a short name stays');
check(cellName('a'.repeat(12)) === 'a'.repeat(12), 'a name of one line stays');
check(cellName('a'.repeat(24)) === 'a'.repeat(12) + '\n' + 'a'.repeat(12), 'a name of two lines with no separator breaks in the middle');
check(cellName('archive-0005.zip') === 'archive-0005\n.zip', 'a name breaks before its extension when that fits');
check(cellName('my vacation photo 2.jpg') === 'my vacation\nphoto 2.jpg', 'a name of two lines breaks at a space: ' + JSON.stringify(cellName('my vacation photo 2.jpg')));
check(cellName('IMG_0001.jpg') === 'IMG_0001.jpg', 'a name of exactly one line stays');
const shot = cellName('Screenshot From 2026-11-01 16-10-04.png');
check(shot === 'Screenshot…\n16-10-04.png', `a long screenshot name keeps its start and its end (${JSON.stringify(shot)})`);
const ru = cellName('Договор аренды помещения на Тверской улице подписанный скан.pdf');
check(ru.split('\n').length === 2 && ru.endsWith('ный скан.pdf'.slice(-12)) && ru.startsWith('Договор'), `Cyrillic names too (${JSON.stringify(ru)})`);
check(cellName('a'.repeat(60)).split('\n').every((l) => l.length <= 12), 'no line is longer than a line of the cell');
check(!/ …|… |\s\n|\n\s/.test(shot), 'no space is left next to the ellipsis or the break');
const emoji = cellName('aaaaaaaaaa' + '😀'.repeat(8) + '.png');
check(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(emoji), `no emoji is cut in half (${JSON.stringify(emoji)})`);
check(Array.from(cellName('😀'.repeat(20))).length <= 2 * 12 + 1, 'a name of wide characters is measured in characters, not code units');
check(cellName('x'.repeat(25)).includes('…'), 'one char past two lines is cut with an ellipsis');
check(cellName('x'.repeat(40)).split('\n').every((l) => l.length <= 12), 'every line of a two-line name is short enough');

finish();
