// gjs -m tests/stack_selection_check.js - the selection model and keyboard
// navigation of a stack dropdown (no GNOME Shell). Exits 1 on failure.
import { createChecker } from './harness.js';
import {
  EMPTY_SELECTION,
  actTargets,
  applyNav,
  clickSelect,
  hoverSelect,
  initialSelection,
  reconcile,
  rowsOf,
  selectAll,
  toggleFocus,
  typeSelect,
} from '../stackSelection.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sel = (focus, anchor, selected) => ({ focus, anchor, selected });
const one = (n) => sel(n, n, [n]);
const nav = (s, key, shape, mods = {}) => applyNav(s, key, mods, shape);
const walk = (start, keys, shape) => keys.reduce((s, k) => nav(s, k, shape), start);

// 15 items in three batches of 7, 3 and 5 on 5 columns:
//   r0: 0 1 2 3 4   r1: 5 6   (batch 0)   r2: 7 8 9   (batch 1)   r3: 10..14   (batch 2)
const GRID = { view: 'grid', count: 15, columns: 5, groupSizes: [7, 3, 5] };
const LIST = { view: 'list', count: 4 };
// the fan draws item 2 nearest the dock, then 0, 1, 3
const FAN = { view: 'fan', count: 4, visual: [2, 0, 1, 3] };

// ---- rowsOf -----------------------------------------------------------------
check(
  same(rowsOf(GRID), [[0, 1, 2, 3, 4], [5, 6], [7, 8, 9], [10, 11, 12, 13, 14]]),
  'every batch starts a new row: 7 items on 5 columns make rows of 5 and 2, then 3, then 5',
);
check(
  same(rowsOf({ view: 'grid', count: 7, columns: 3 }), [[0, 1, 2], [3, 4, 5], [6]]),
  'a grid without groupSizes is one batch',
);
check(
  same(rowsOf({ view: 'grid', count: 5, columns: 3, groupSizes: [2] }), [[0, 1], [2, 3, 4]]),
  'groupSizes that do not add up to count never hide items',
);
check(
  same(rowsOf({ view: 'grid', count: 3, columns: 3, groupSizes: [10] }), [[0, 1, 2]]),
  'a batch larger than the remaining items is cut at count',
);
check(
  same(rowsOf({ view: 'grid', count: 3, columns: 3, groupSizes: [0, 3, 0] }), [[0, 1, 2]]),
  'empty batches make no rows',
);
check(
  same(rowsOf({ view: 'grid', count: 3, columns: 0 }), [[0], [1], [2]]),
  'columns 0 is treated as 1',
);
check(same(rowsOf({ view: 'grid', count: 0, columns: 5 }), []), 'an empty grid has no rows');
check(same(rowsOf(LIST), [[0], [1], [2], [3]]), 'a list has one item per row');
check(
  same(rowsOf({ view: 'list', count: 3, groupSizes: [1, 2] }), [[0], [1], [2]]),
  'a list ignores groupSizes',
);
check(same(rowsOf(FAN), [[2], [0], [1], [3]]), 'a fan has one step per item, nearest the dock first');
check(same(rowsOf({ view: 'fan', count: 0, visual: [] }), []), 'an empty fan has no steps');
check(
  rowsOf({ view: 'grid', count: 100000, columns: 7 }).length === Math.ceil(100000 / 7),
  'a huge grid is laid out in the right number of rows',
);

// ---- initialSelection (rule 1) ---------------------------------------------
check(same(initialSelection({ view: 'grid', count: 0, columns: 5 }), EMPTY_SELECTION), 'an empty grid opens with nothing selected');
check(same(initialSelection({ view: 'list', count: 0 }), EMPTY_SELECTION), 'an empty list opens with nothing selected');
check(same(initialSelection({ view: 'fan', count: 0, visual: [] }), EMPTY_SELECTION), 'an empty fan opens with nothing selected');
check(same(initialSelection(GRID), one(0)), 'a grid opens with item 0 selected, focused and anchored');
check(same(initialSelection(LIST), one(0)), 'a list opens with item 0 selected');
check(same(initialSelection(FAN), one(2)), 'a fan opens with the item nearest the dock, not item 0');
check(same(EMPTY_SELECTION, sel(-1, -1, [])), 'EMPTY_SELECTION is focus -1, anchor -1, nothing selected');

// ---- grid navigation (rule 3) -----------------------------------------------
check(nav(one(3), 'Down', GRID).focus === 6, 'Down from column 3 into a 2-item row goes to that row\'s last item');
check(nav(one(6), 'Down', GRID).focus === 8, 'Down from the short row lands in column 1 of the next batch\'s first row');
check(nav(one(2), 'Down', GRID).focus === 6, 'Down from column 2 into the 2-item row clamps to its last item');
check(nav(one(0), 'Down', GRID).focus === 5, 'Down from column 0 goes to column 0 of the next row');
check(nav(one(8), 'Down', GRID).focus === 11, 'Down from column 1 of batch 1 lands in column 1 of batch 2');
check(nav(one(9), 'Down', GRID).focus === 12, 'Down from column 2 of a 3-item row into the next batch keeps column 2');
check(same(nav(one(13), 'Down', GRID), one(13)), 'Down on the last row leaves the selection unchanged');
check(nav(one(11), 'Up', GRID).focus === 8, 'Up from batch 2 goes back into batch 1\'s last row');
check(nav(one(8), 'Up', GRID).focus === 6, 'Up from batch 1 goes to column 1 of batch 0\'s last row');
check(nav(one(9), 'Up', GRID).focus === 6, 'Up from column 2 into the 2-item row goes to its last item');
check(nav(one(6), 'Up', GRID).focus === 1, 'Up from the short row goes to column 1 of the first row');
check(same(nav(one(1), 'Up', GRID), one(1)), 'Up on the first row leaves the selection unchanged');
check(
  same(walk(one(3), ['Down', 'Down', 'Down'], GRID), one(11)),
  'Down x3 from column 3 follows the batches: 6, 8, 11',
);
check(
  same(walk(one(11), ['Up', 'Up', 'Up', 'Up'], GRID), one(1)),
  'Up x4 from 11 retraces 8, 6, 1 and stops',
);
check(nav(one(6), 'Right', GRID).focus === 7, 'Right at the end of a batch continues into the next batch\'s first item');
check(nav(one(4), 'Right', GRID).focus === 5, 'Right at a row end goes to the next row\'s first item');
check(nav(one(9), 'Right', GRID).focus === 10, 'Right at the end of batch 1 enters batch 2');
check(nav(one(7), 'Left', GRID).focus === 6, 'Left at the start of a batch goes back to the previous batch\'s last item');
check(nav(one(5), 'Left', GRID).focus === 4, 'Left at a row start goes to the previous row\'s last item');
check(same(nav(one(14), 'Right', GRID), one(14)), 'Right at the last item does not wrap');
check(same(nav(one(0), 'Left', GRID), one(0)), 'Left at the first item does not wrap');
check(nav(one(9), 'Home', GRID).focus === 0, 'Home goes to the first item');
check(nav(one(2), 'End', GRID).focus === 14, 'End goes to the last item');

// ---- paging (rule 2) ----------------------------------------------------------
const PAGE2 = { ...GRID, pageRows: 2 };
check(nav(one(3), 'PageDown', PAGE2).focus === 9, 'PageDown moves 2 rows keeping the column, clamped to the row length');
check(nav(one(8), 'PageUp', PAGE2).focus === 1, 'PageUp moves 2 rows up keeping the column');
check(nav(one(14), 'PageUp', PAGE2).focus === 6, 'PageUp from the last row lands on the short row\'s last item');
check(nav(one(3), 'PageDown', GRID).focus === 14, 'PageDown with the default of 4 rows past the end goes to the last item');
check(nav(one(5), 'PageUp', GRID).focus === 0, 'PageUp past the start goes to the first item');
check(same(nav(one(0), 'PageUp', GRID), one(0)), 'PageUp on the first item keeps it');
check(nav(one(0), 'PageDown', { ...GRID, pageRows: 3 }).focus === 10, 'pageRows 3 from row 0 reaches row 3');
check(nav(one(0), 'PageDown', LIST).focus === 3, 'the default page of a 4-item list clamps to the last item');
check(nav(one(3), 'PageUp', { ...LIST, pageRows: 1 }).focus === 2, 'a one-row page in a list is one step');

// ---- list navigation (rule 4) --------------------------------------------------
check(nav(one(1), 'Down', LIST).focus === 2, 'a list steps down one');
check(nav(one(1), 'Up', LIST).focus === 0, 'a list steps up one');
check(same(nav(one(3), 'Down', LIST), one(3)), 'a list does not wrap at the bottom');
check(same(nav(one(0), 'Up', LIST), one(0)), 'a list does not wrap at the top');
check(same(nav(one(1), 'Left', LIST), one(1)), 'Left does nothing in a list');
check(same(nav(one(1), 'Right', LIST), one(1)), 'Right does nothing in a list');
check(nav(sel(-1, -1, []), 'Left', LIST).focus === 3, 'but with no focus even Left selects the last item (rule 10)');

// ---- fan navigation -------------------------------------------------------------
check(nav(one(2), 'Up', FAN).focus === 0, 'in the fan Up moves one step away from the dock: 2 -> 0');
check(walk(one(2), ['Up', 'Up'], FAN).focus === 1, 'Up again: 0 -> 1');
check(walk(one(2), ['Up', 'Up', 'Up'], FAN).focus === 3, 'Up again: 1 -> 3, the farthest');
check(same(walk(one(2), ['Up', 'Up', 'Up', 'Up'], FAN), one(3)), 'Up at the farthest item stays');
check(nav(one(0), 'Down', FAN).focus === 2, 'Down moves one step toward the dock');
check(same(nav(one(2), 'Down', FAN), one(2)), 'Down at the nearest item stays');
check(nav(one(2), 'Right', FAN).focus === 0, 'Right moves like Up');
check(nav(one(0), 'Left', FAN).focus === 2, 'Left moves like Down');
check(same(nav(one(2), 'Left', FAN), one(2)), 'Left at the nearest item stays');
check(same(nav(one(3), 'Right', FAN), one(3)), 'Right at the farthest item stays');
check(nav(one(1), 'Home', FAN).focus === 2, 'Home in the fan is visual[0]');
check(nav(one(1), 'End', FAN).focus === 3, 'End in the fan is the last visual item');
check(nav(one(2), 'PageUp', FAN).focus === 3, 'PageUp in the fan moves pageRows steps away from the dock, clamped');
check(nav(one(2), 'PageUp', { ...FAN, pageRows: 2 }).focus === 1, 'PageUp with pageRows 2: step 0 -> step 2');
check(nav(one(3), 'PageDown', { ...FAN, pageRows: 2 }).focus === 0, 'PageDown with pageRows 2 moves toward the dock: step 3 -> step 1');
check(nav(one(1), 'PageDown', FAN).focus === 2, 'PageDown past the dock end clamps to visual[0]');
check(
  same(walk(one(2), ['Up', 'Up'], FAN), one(1)) && !same(nav(one(0), 'Down', FAN), one(1)),
  'the fan follows the visual order, not the item numbers',
);
check(
  same(walk(sel(-1, -1, []), ['Down'], FAN), one(2)),
  'no focus + Down selects visual[0] in the fan',
);
check(
  same(nav(sel(-1, -1, []), 'Up', FAN), one(3)),
  'no focus + Up selects the last fan item',
);

// ---- modifiers (rule 5) -----------------------------------------------------
{
  const s1 = nav(one(3), 'Down', GRID, { shift: true });
  check(same(s1, sel(6, 3, [3, 4, 5, 6])), 'Shift+Down selects the range from the anchor to the new focus in reading order');
  const s2 = nav(s1, 'Down', GRID, { shift: true });
  check(same(s2, sel(8, 3, [3, 4, 5, 6, 7, 8])), 'Shift+Down again extends across the batch boundary and keeps the anchor');
  const s3 = nav(s2, 'Up', GRID, { shift: true });
  check(same(s3, sel(6, 3, [3, 4, 5, 6])), 'Shift+Up shrinks the range again');
  const s4 = nav(nav(s3, 'Up', GRID, { shift: true }), 'Left', GRID, { shift: true });
  check(same(s4, sel(0, 3, [0, 1, 2, 3])), 'a Shift range may cross the anchor: Shift+Up then Shift+Left gives 0..3');
  check(
    same(nav(one(6), 'Right', GRID, { shift: true }), sel(7, 6, [6, 7])),
    'Shift+Right across a batch boundary selects the item on both sides',
  );
  check(
    same(nav(one(0), 'End', GRID, { shift: true }), sel(14, 0, Array.from({ length: 15 }, (_, i) => i))),
    'Shift+End selects everything from the anchor to the last item',
  );
  check(
    same(nav(one(9), 'Home', GRID, { shift: true }), sel(0, 9, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
    'Shift+Home selects back to the first item',
  );
  check(
    same(nav(one(3), 'PageDown', PAGE2, { shift: true }), sel(9, 3, [3, 4, 5, 6, 7, 8, 9])),
    'Shift+PageDown selects the range to the page target',
  );
  check(
    same(nav(one(4), 'Down', GRID, { shift: true, ctrl: true }), sel(6, 4, [4, 5, 6])),
    'Shift beats ctrl when both are held',
  );
}
{
  const start = sel(2, 2, [2]);
  const moved = nav(start, 'Right', GRID, { ctrl: true });
  check(same(moved, sel(3, 2, [2])), 'Ctrl+Right moves only the focus; anchor and selection stay');
  check(moved.selected !== start.selected, 'the moved selection does not share its array with the old one');
  const toggled = toggleFocus(moved);
  check(same(toggled, sel(3, 3, [2, 3])), 'Ctrl+Space after a Ctrl move adds the focused item and anchors on it');
  const again = toggleFocus(nav(toggled, 'Right', GRID, { ctrl: true }));
  check(same(again, sel(4, 4, [2, 3, 4])), 'Ctrl+Right then Ctrl+Space keeps building the set');
  check(same(toggleFocus(toggleFocus(moved)), sel(3, 3, [2])), 'toggling the focused item twice removes it again');
  check(
    same(nav(sel(3, 2, [1, 2, 5]), 'Down', GRID, { ctrl: true }), sel(6, 2, [1, 2, 5])),
    'a Ctrl move keeps a scattered selection as it is',
  );
  check(
    same(nav(sel(3, 2, [1, 2, 5]), 'Down', GRID), one(6)),
    'a plain move collapses a multi-selection onto the target',
  );
  check(same(nav(moved, 'Up', GRID, { ctrl: true }), moved), 'a blocked Ctrl move changes nothing');
}
check(
  same(toggleFocus(sel(-1, -1, [])), sel(-1, -1, [])),
  'toggleFocus with no focus does nothing',
);
check(
  same(toggleFocus(sel(5, 1, [1, 5, 9])), sel(5, 5, [1, 9])),
  'toggleFocus removes a focused selected item, keeps the sort and anchors on it',
);
check(
  same(toggleFocus(sel(0, 4, [4, 9])), sel(0, 0, [0, 4, 9])),
  'toggleFocus inserts a lower number in sorted position',
);

// ---- no focus / empty / odd shapes (rule 10) ---------------------------------------
{
  const none = sel(-1, -1, []);
  check(nav(none, 'Down', GRID).focus === 0, 'no focus: Down selects the first item');
  check(nav(none, 'Right', GRID).focus === 0, 'no focus: Right selects the first item');
  check(nav(none, 'Home', GRID).focus === 0, 'no focus: Home selects the first item');
  check(nav(none, 'PageDown', GRID).focus === 0, 'no focus: PageDown selects the first item');
  check(nav(none, 'Up', GRID).focus === 14, 'no focus: Up selects the last item');
  check(nav(none, 'Left', GRID).focus === 14, 'no focus: Left selects the last item');
  check(nav(none, 'End', GRID).focus === 14, 'no focus: End selects the last item');
  check(nav(none, 'PageUp', GRID).focus === 14, 'no focus: PageUp selects the last item');
  check(
    same(nav(none, 'Down', GRID, { shift: true }), sel(0, 0, [0])),
    'no focus: Shift+Down selects the first item and anchors on it',
  );
  check(
    same(nav(none, 'Down', GRID, { ctrl: true }), sel(0, -1, [])),
    'no focus: Ctrl+Down moves the cursor without selecting',
  );
  check(nav(sel(99, 99, [99]), 'Down', GRID).focus === 0, 'a focus past the end is treated as no focus');
}
{
  const zero = { view: 'grid', count: 0, columns: 5 };
  for (const key of ['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown']) {
    check(same(nav(EMPTY_SELECTION, key, zero), EMPTY_SELECTION), `${key} on an empty grid does not throw and selects nothing`);
  }
  check(same(nav(EMPTY_SELECTION, 'Down', { view: 'list', count: 0 }), EMPTY_SELECTION), 'Down on an empty list is harmless');
  check(
    same(nav(EMPTY_SELECTION, 'Down', { view: 'fan', count: 0, visual: [] }), EMPTY_SELECTION),
    'Down on an empty fan is harmless',
  );
  check(same(nav(EMPTY_SELECTION, 'Down', { view: 'fan', count: 3 }), EMPTY_SELECTION), 'a fan without visual is harmless');
}
{
  const narrow = { view: 'grid', count: 3, columns: 0 };
  check(nav(one(0), 'Down', narrow).focus === 1, 'columns 0 behaves as one column: Down steps one');
  check(nav(one(0), 'Right', narrow).focus === 1, 'columns 0: Right steps one');
  check(nav(one(2), 'Up', narrow).focus === 1, 'columns 0: Up steps one');
}
check(
  nav(one(0), 'Right', { view: 'grid', count: 3, columns: 5 }).focus === 1,
  'a single row grid walks along the row',
);
check(
  same(nav(one(0), 'Down', { view: 'grid', count: 3, columns: 5 }), one(0)),
  'a single row grid has no Down',
);
check(nav(one(0), 'Down', { view: 'grid', count: 1e6, columns: 1000 }).focus === 1000, 'a million items navigate');
check(same(nav(one(0), 'Bogus', GRID), one(0)), 'an unknown key changes nothing');
check(nav(one(0), 'Down', GRID, undefined).focus === 5, 'missing mods mean no modifiers');

// ---- selectAll -------------------------------------------------------------------
check(
  same(selectAll({ view: 'grid', count: 4, columns: 2 }), sel(3, 0, [0, 1, 2, 3])),
  'selectAll selects every item, anchor first and focus last',
);
check(same(selectAll(FAN), sel(3, 2, [0, 1, 2, 3])), 'selectAll in the fan returns sorted numbers with visual-order anchor and focus');
check(same(selectAll({ view: 'list', count: 0 }), EMPTY_SELECTION), 'selectAll of nothing is empty');
check(selectAll(GRID).selected.length === 15, 'selectAll of the three-batch grid selects 15 items');

// ---- clickSelect (rule 7) -----------------------------------------------------------
{
  const r = clickSelect(sel(2, 2, [2, 3]), 5, {}, GRID);
  check(same(r, { selection: one(5), open: true }), 'a plain click selects only that item and opens');
  check(clickSelect(EMPTY_SELECTION, 0, undefined, GRID).open === true, 'missing mods count as a plain click');
}
{
  const r = clickSelect(one(2), 5, { ctrl: true }, GRID);
  check(same(r, { selection: sel(5, 5, [2, 5]), open: false }), 'Ctrl+click adds an item, focuses and anchors it, does not open');
  const r2 = clickSelect(r.selection, 2, { ctrl: true }, GRID);
  check(same(r2, { selection: sel(2, 2, [5]), open: false }), 'Ctrl+click on a selected item removes it');
  const r3 = clickSelect(one(9), 1, { ctrl: true }, GRID);
  check(same(r3.selection.selected, [1, 9]), 'Ctrl+click keeps the numbers sorted');
  check(
    same(clickSelect(one(5), 5, { ctrl: true }, GRID).selection, sel(5, 5, [])),
    'Ctrl+click on the only selected item leaves nothing selected but keeps the focus',
  );
}
{
  const r = clickSelect(sel(8, 3, [3, 8]), 8, { shift: true }, GRID);
  check(same(r, { selection: sel(8, 3, [3, 4, 5, 6, 7, 8]), open: false }), 'Shift+click selects from the anchor to the item across batches, anchor unchanged');
  check(
    same(clickSelect(one(3), 1, { shift: true }, GRID).selection, sel(1, 3, [1, 2, 3])),
    'Shift+click below the anchor selects the range backwards',
  );
  check(
    same(clickSelect(EMPTY_SELECTION, 4, { shift: true }, GRID).selection, sel(4, -1, [0, 1, 2, 3, 4])),
    'Shift+click without an anchor ranges from item 0 and leaves the anchor unset',
  );
  check(clickSelect(one(3), 4, { shift: true, ctrl: true }, GRID).selection.selected.length === 2, 'Shift beats Ctrl on a click too');
  check(
    same(clickSelect(one(2), 1, { shift: true }, FAN).selection, sel(1, 2, [0, 1, 2])),
    'Shift+click in the fan ranges over the visual order',
  );
}
check(
  same(clickSelect(one(2), 99, {}, GRID), { selection: one(2), open: false }),
  'a click on a number that is not on screen changes nothing and opens nothing',
);
check(same(clickSelect(one(2), -1, { ctrl: true }, GRID).selection, one(2)), 'Ctrl+click on -1 changes nothing');
check(same(clickSelect(EMPTY_SELECTION, 0, {}, { view: 'list', count: 0 }), { selection: EMPTY_SELECTION, open: false }), 'clicking in an empty list is harmless');

// ---- hoverSelect (rule 8) -----------------------------------------------------------
check(same(hoverSelect(one(2), 5), one(5)), 'hovering a new item makes it the only selected one');
check(same(hoverSelect(EMPTY_SELECTION, 3), one(3)), 'hovering selects when nothing was selected');
check(same(hoverSelect(one(5), 5), one(5)), 'hovering the selected item changes nothing');
{
  const multi = sel(8, 3, [3, 4, 8]);
  check(hoverSelect(multi, 0) === multi, 'the pointer passing over items does not destroy a multi-selection');
  check(same(hoverSelect(multi, 8), multi), 'hovering inside a multi-selection keeps it');
}
check(same(hoverSelect(sel(3, 3, [4]), 3), one(3)), 'hovering the focus when the selection is a different item selects the hovered one');
{
  const sel15 = one(2);
  check(hoverSelect(sel15, 99, { count: 15 }) === sel15, 'hovering a number past the shape count leaves the selection unchanged');
  check(same(hoverSelect(sel15, 14, { count: 15 }), one(14)), 'hovering the last item of the shape selects it');
}
check(same(hoverSelect(one(2), -1), one(2)), 'hovering nothing (-1) keeps the selection');
check(same(hoverSelect(one(2), 0), one(0)), 'hovering the first item (0) selects it');
check(
  same(hoverSelect(sel(3, 1, [3]), 3), sel(3, 1, [3])),
  'hovering the item that is already the only selected one keeps the anchor as it was',
);
check(same(hoverSelect(one(2), 1.5), one(2)), 'a fractional number is ignored');
check(same(hoverSelect(one(2), undefined), one(2)), 'an undefined number is ignored');

// ---- typeSelect (rule 9) -------------------------------------------------------------
const NAMES = ['Apple', 'apricot', 'Banana', '.bashrc', 'berry', 'Яблоко', 'яма'];
check(typeSelect(NAMES, 'a', 0) === 0, 'a prefix match at the start position stays on it');
check(typeSelect(NAMES, 'a', 1) === 1, 'the search starts at `from`, inclusive');
check(typeSelect(NAMES, 'ap', 2) === 0, 'the search wraps once past the end');
check(typeSelect(NAMES, 'apr', 0) === 1, 'a longer prefix skips items that match only the shorter one');
check(typeSelect(NAMES, 'APR', 0) === 1, 'matching is case-insensitive for the buffer');
check(typeSelect(NAMES, 'b', 0) === 2, 'b finds Banana first');
check(typeSelect(NAMES, 'be', 0) === 4, 'be finds berry');
check(typeSelect(NAMES, 'bas', 0) === 3, 'a leading dot of a name is ignored: bas finds .bashrc');
check(typeSelect(NAMES, '.b', 0) === 3, 'a typed dot still finds the dotfile');
check(typeSelect(NAMES, 'Я', 0) === 5, 'Cyrillic upper case matches Cyrillic names');
check(typeSelect(NAMES, 'ям', 0) === 6, 'a Cyrillic prefix finds the later name');
check(typeSelect(NAMES, 'zebra', 0) === -1, 'no match gives -1');
check(typeSelect(NAMES, '', 0) === -1, 'an empty buffer gives -1');
check(typeSelect([], 'a', 0) === -1, 'no names give -1');
check(typeSelect(NAMES, 'a', -1) === 0, 'from -1 starts at the top');
check(typeSelect(NAMES, 'a', 100) === 0, 'from past the end wraps to the top');
check(typeSelect(['ax', 'b', 'ay'], 'a', 4) === 0 && typeSelect(['ax', 'b', 'ay'], 'a', -1) === 0, 'a from outside the list starts at 0, not by modulo (from 4 of 3 names would be 1)');
check(typeSelect(NAMES, 'a', undefined) === 0, 'an undefined from starts at the top');
check(typeSelect(NAMES, 'aa', 0) === 1, 'a repeated character cycles to the next match after `from`');
check(typeSelect(NAMES, 'aa', 1) === 0, 'cycling wraps from the last match to the first');
check(typeSelect(NAMES, 'aaa', 1) === 0, 'any repeat count cycles');
check(typeSelect(NAMES, 'bb', 2) === 3, 'cycling b goes Banana -> .bashrc (leading dot ignored)');
check(typeSelect(NAMES, 'bb', 3) === 4, 'cycling b goes .bashrc -> berry');
check(typeSelect(NAMES, 'bb', 4) === 2, 'cycling b goes berry -> Banana');
check(typeSelect(NAMES, 'яя', 5) === 6, 'cycling works for Cyrillic');
check(typeSelect(NAMES, 'яя', 6) === 5, 'Cyrillic cycling wraps');
check(typeSelect(['x', 'y'], 'xx', 0) === 0, 'cycling with a single match stays on it');
check(typeSelect(['x', 'y'], 'zz', 0) === -1, 'cycling without a match gives -1');
check(typeSelect(NAMES, 'ab', 0) === -1, 'a mixed buffer is a prefix, not a cycle');
check(typeSelect(['.'], '.', 0) === 0, 'a lone dot name matches a typed dot');
check(typeSelect(['😀 smile', 'x'], '😀', 1) === 0, 'astral characters match by prefix and wrap');
check(typeSelect(['😀', '😀b'], '😀😀', 0) === 1, 'astral characters cycle as one character');
check(typeSelect(['a', undefined, 'b'], 'b', 0) === 2, 'a missing name does not throw');

// ---- actTargets (rule 11) ---------------------------------------------------------------
check(same(actTargets(sel(5, 1, [1, 5])), [1, 5]), 'a command acts on the whole selection');
check(same(actTargets(sel(5, 5, [])), [5]), 'with an empty selection it acts on the focus');
check(same(actTargets(sel(0, 0, [])), [0]), 'with an empty selection and focus 0 it acts on item 0');
check(same(actTargets(EMPTY_SELECTION), []), 'with neither it acts on nothing');
{
  const s = sel(1, 1, [1]);
  check(actTargets(s) !== s.selected, 'the targets are a copy the caller may change');
}

// ---- reconcile (rule 12) ------------------------------------------------------------------
check(same(reconcile(sel(3, 1, [1, 3]), { view: 'list', count: 5 }), sel(3, 1, [1, 3])), 'a selection that still fits is unchanged');
check(
  same(reconcile(sel(9, 1, [1, 3, 9]), { view: 'list', count: 5 }), sel(3, 3, [1, 3])),
  'a dropped focus moves to the last remaining selected item',
);
check(
  same(reconcile(sel(1, 9, [1, 9]), { view: 'list', count: 5 }), sel(1, 1, [1])),
  'a dropped anchor falls back to the focus',
);
check(
  same(reconcile(sel(8, 8, [7, 8]), GRID), sel(8, 8, [7, 8])),
  'the numbers are compared with the shape\'s count (GRID has 15)',
);
check(
  same(reconcile(sel(8, 7, [7, 8]), { view: 'grid', count: 5, columns: 3 }), one(0)),
  'when every selected number is gone the dropdown\'s initial selection returns',
);
check(
  same(reconcile(sel(8, 7, [7, 8]), { view: 'fan', count: 3, visual: [1, 2, 0] }), one(1)),
  'the initial selection of a fan is its nearest item',
);
check(same(reconcile(sel(2, 2, [2]), { view: 'list', count: 0 }), EMPTY_SELECTION), 'a stack that became empty reconciles to nothing');
check(same(reconcile(EMPTY_SELECTION, { view: 'list', count: 3 }), EMPTY_SELECTION), 'an empty selection stays empty while items remain');
check(same(reconcile(sel(4, 4, [4]), { view: 'list', count: 5 }), one(4)), 'the last valid number is kept (count - 1)');
check(same(reconcile(sel(5, 5, [5]), { view: 'list', count: 5 }), one(0)), 'number == count is dropped');
check(
  same(reconcile(sel(1, 5, [1]), { view: 'list', count: 5 }), sel(1, 1, [1])),
  'an anchor equal to count is off screen and falls back to the focus',
);
check(
  same(reconcile(sel(1, 4, [1]), { view: 'list', count: 5 }), sel(1, 4, [1])),
  'an anchor at count - 1 is kept',
);

finish();
