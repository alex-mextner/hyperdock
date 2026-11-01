// gjs -m tests/stack_hotkeys_check.js - the layout-independent hotkey map of a
// stack dropdown (no GNOME Shell). Exits 1 on failure.
import { createChecker } from './harness.js';
import { commandFor, latinKey } from '../stackHotkeys.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const press = (key, keycode, mods = {}, text = '') => ({
  key,
  keycode,
  ctrl: false,
  shift: false,
  alt: false,
  super: false,
  text,
  ...mods,
});
const CTRL = { ctrl: true };

const FOLDER = { kind: 'folder', writable: true };
const READ_ONLY = { kind: 'folder', writable: false };
const RECENTS = { kind: 'recents', writable: false };
const ctxOf = (over = {}) => ({
  mode: 'browse',
  stack: FOLDER,
  hasSelection: true,
  clipboardHasFiles: true,
  ...over,
});

// ---- latinKey ---------------------------------------------------------------
const LETTERS = {
  24: 'q', 25: 'w', 26: 'e', 27: 'r', 28: 't', 29: 'y', 30: 'u', 31: 'i', 32: 'o', 33: 'p',
  38: 'a', 39: 's', 40: 'd', 41: 'f', 42: 'g', 43: 'h', 44: 'j', 45: 'k', 46: 'l',
  52: 'z', 53: 'x', 54: 'c', 55: 'v', 56: 'b', 57: 'n', 58: 'm',
};
for (const [code, letter] of Object.entries(LETTERS)) {
  check(latinKey(Number(code), 'Cyrillic_zhe') === letter, `keycode ${code} is the ${letter} key whatever the layout says`);
}
check(Object.keys(LETTERS).length === 26, 'the table holds all 26 letters');
check(latinKey(54, 'C') === 'c', 'an upper-case key on a letter keycode still gives the lower-case letter');
check(latinKey(36, 'Return') === 'return', 'a non-letter keycode returns the lower-cased key');
check(latinKey(119, 'Delete') === 'delete', 'Delete stays Delete');
check(latinKey(68, 'F2') === 'f2', 'F2 stays F2');
check(latinKey(65, 'space') === 'space', 'space stays space');
check(latinKey(34, 'Cyrillic_ha') === 'cyrillic_ha', 'a keycode outside the letter rows is not remapped');
check(latinKey(undefined, 'Escape') === 'escape', 'an undefined keycode falls back to the key');
check(latinKey(54, undefined) === 'c', 'an undefined key with a letter keycode is that letter');
check(latinKey(10, undefined) === '', 'an undefined key on a non-letter keycode is the empty string');
check(latinKey(37, 'Control_L') === 'control_l', 'a modifier keysym is only lower-cased');
check(latinKey(23, 'Ä') === 'ä', 'non-ASCII keys are lower-cased');
check(latinKey(59, ',') === ',', 'keycode 59 (comma) is not a letter');

// ---- layout independence (the Russian layout) ------------------------------------
const RU = (key, keycode, mods, text) => press(key, keycode, { ctrl: true, ...mods }, text);
const BROWSE = ctxOf();
check(same(commandFor(RU('Cyrillic_es', 54), BROWSE), { command: 'copy' }), 'Ctrl+C on the Russian layout copies');
check(same(commandFor(RU('Cyrillic_che', 53), BROWSE), { command: 'cut' }), 'Ctrl+X on the Russian layout cuts');
check(same(commandFor(RU('Cyrillic_em', 55), BROWSE), { command: 'paste' }), 'Ctrl+V on the Russian layout pastes');
check(same(commandFor(RU('Cyrillic_ef', 38), BROWSE), { command: 'selectAll' }), 'Ctrl+A on the Russian layout selects all');
check(same(commandFor(RU('Cyrillic_ya', 52), BROWSE), { command: 'undo' }), 'Ctrl+Z on the Russian layout undoes');
check(same(commandFor(RU('Cyrillic_TE', 57, { shift: true }), BROWSE), { command: 'newFolder' }), 'Ctrl+Shift+N on the Russian layout makes a new folder');
check(same(commandFor(RU('Cyrillic_en', 29), BROWSE), { command: 'redo' }), 'Ctrl+Y on the Russian layout redoes');
check(same(commandFor(RU('Cyrillic_sha', 31), BROWSE), { command: 'properties' }), 'Ctrl+I on the Russian layout shows properties');
check(same(commandFor(RU('Cyrillic_ES', 54, { shift: true }), BROWSE), { command: 'copyPath' }), 'Ctrl+Shift+C on the Russian layout copies the path');
check(same(commandFor(RU('Cyrillic_YA', 52, { shift: true }), BROWSE), { command: 'redo' }), 'Ctrl+Shift+Z on the Russian layout redoes');
check(same(commandFor(RU('Cyrillic_ka', 27), BROWSE), { command: 'showInFiles' }), 'Ctrl+R on the Russian layout shows in Files');
check(same(commandFor(RU('Cyrillic_shcha', 32), BROWSE), { command: 'open' }), 'Ctrl+O on the Russian layout opens');
check(same(commandFor(RU('c', 31), BROWSE), { command: 'copy' }), 'Dvorak: a "c" on keycode 31 is Ctrl+C and copies');
check(!same(commandFor(RU('j', 54), BROWSE), { command: 'copy' }), 'Dvorak: a "j" on the physical C keycode is not copy');
check(latinKey(31, 'c') === 'c' && latinKey(54, 'j') === 'j' && latinKey(54, 'J') === 'j', 'a layout that produces an ASCII letter keeps its own letter');
check(same(commandFor(RU('Cyrillic_es', 54), ctxOf({ stack: READ_ONLY })), { command: 'copy' }), 'Ctrl+C in Russian also works on a read-only folder');
check(same(commandFor(RU('Cyrillic_che', 53), ctxOf({ stack: READ_ONLY })), { command: 'nop' }), 'Ctrl+X in Russian on a read-only folder is consumed, not typed');

// ---- the table: each row allowed here, refused there ---------------------------------
const NAV_FREE = { stack: RECENTS, hasSelection: false, clipboardHasFiles: false };
// [label, press, allowed ctx overrides, refused ctx overrides[], command]
const ROWS = [
  ['Return', press('Return', 36), {}, [{ hasSelection: false }], 'open'],
  ['KP_Enter', press('KP_Enter', 104), {}, [{ hasSelection: false }], 'open'],
  ['Return on a recents stack', press('Return', 36), { stack: RECENTS }, [{ stack: RECENTS, hasSelection: false }], 'open'],
  ['Ctrl+O', press('o', 32, CTRL), {}, [{ hasSelection: false }], 'open'],
  ['Alt+Return', press('Return', 36, { alt: true }), {}, [{ hasSelection: false }, { stack: RECENTS }], 'properties'],
  ['Ctrl+I', press('i', 31, CTRL), {}, [{ hasSelection: false }, { stack: RECENTS }], 'properties'],
  ['Alt+Return on a read-only folder', press('Return', 36, { alt: true }), { stack: READ_ONLY }, [], 'properties'],
  ['space', press('space', 65, {}, ' '), {}, [{ hasSelection: false }], 'quickLook'],
  ['Ctrl+space', press('space', 65, CTRL, ' '), {}, [], 'toggleFocus'],
  ['Escape', press('Escape', 9), {}, [], 'close'],
  ['Ctrl+A', press('a', 38, CTRL, 'a'), {}, [], 'selectAll'],
  ['Ctrl+C', press('c', 54, CTRL, 'c'), {}, [{ hasSelection: false }, { stack: RECENTS }], 'copy'],
  ['Ctrl+X', press('x', 53, CTRL, 'x'), {}, [{ hasSelection: false }, { stack: READ_ONLY }, { stack: RECENTS }], 'cut'],
  ['Ctrl+V', press('v', 55, CTRL, 'v'), {}, [{ clipboardHasFiles: false }, { stack: READ_ONLY }, { stack: RECENTS }], 'paste'],
  ['Ctrl+V needs no selection', press('v', 55, CTRL, 'v'), { hasSelection: false }, [], 'paste'],
  ['Delete', press('Delete', 119), {}, [{ hasSelection: false }, { stack: READ_ONLY }], 'trash'],
  ['KP_Delete', press('KP_Delete', 91), {}, [{ hasSelection: false }, { stack: READ_ONLY }], 'trash'],
  ['Ctrl+BackSpace', press('BackSpace', 22, CTRL), {}, [{ hasSelection: false }, { stack: READ_ONLY }], 'trash'],
  ['Delete on recents', press('Delete', 119), { stack: RECENTS }, [{ stack: RECENTS, hasSelection: false }], 'removeFromRecents'],
  ['KP_Delete on recents', press('KP_Delete', 91), { stack: RECENTS }, [{ stack: RECENTS, hasSelection: false }], 'removeFromRecents'],
  ['Ctrl+BackSpace on recents', press('BackSpace', 22, CTRL), { stack: RECENTS }, [{ stack: RECENTS, hasSelection: false }], 'removeFromRecents'],
  ['Shift+Delete', press('Delete', 119, { shift: true }), {}, [{ hasSelection: false }, { stack: READ_ONLY }, { stack: RECENTS }], 'deletePermanently'],
  ['F2', press('F2', 68), {}, [{ hasSelection: false }, { stack: READ_ONLY }, { stack: RECENTS }], 'rename'],
  ['Ctrl+Z', press('z', 52, CTRL, 'z'), {}, [], 'undo'],
  ['Ctrl+Shift+Z', press('Z', 52, { ctrl: true, shift: true }, 'Z'), {}, [], 'redo'],
  ['Ctrl+Y', press('y', 29, CTRL, 'y'), {}, [], 'redo'],
  ['Ctrl+Shift+N', press('N', 57, { ctrl: true, shift: true }, 'N'), {}, [{ stack: READ_ONLY }, { stack: RECENTS }], 'newFolder'],
  ['Ctrl+Shift+N needs no selection', press('N', 57, { ctrl: true, shift: true }, 'N'), { hasSelection: false }, [], 'newFolder'],
  ['Ctrl+Shift+C', press('C', 54, { ctrl: true, shift: true }, 'C'), {}, [{ hasSelection: false }, { stack: RECENTS }], 'copyPath'],
  ['Ctrl+R', press('r', 27, CTRL, 'r'), {}, [{ hasSelection: false }, { stack: RECENTS }], 'showInFiles'],
];
for (const [label, p, allowed, refused, command] of ROWS) {
  check(same(commandFor(p, ctxOf(allowed)), { command }), `${label}: ${command} where it is allowed`);
  for (const [i, over] of refused.entries()) {
    check(
      same(commandFor(p, ctxOf(over)), { command: 'nop' }),
      `${label}: consumed and ignored when refused (case ${i + 1}: ${JSON.stringify(over)})`,
    );
  }
}
for (const [label, p] of [
  ['Tab', press('Tab', 23, {}, '\t')],
  ['Shift+Tab', press('ISO_Left_Tab', 23, { shift: true })],
  ['ISO_Left_Tab alone', press('ISO_Left_Tab', 23)],
  ['Shift+Tab as Tab', press('Tab', 23, { shift: true })],
]) {
  for (const over of [{}, NAV_FREE, { stack: READ_ONLY }]) {
    check(same(commandFor(p, ctxOf(over)), { command: 'nop' }), `${label} is consumed so focus never leaves the dropdown`);
  }
}

// ---- navigation keys ---------------------------------------------------------------
const NAV = [
  ['Up', 111, 'Up'],
  ['Down', 116, 'Down'],
  ['Left', 113, 'Left'],
  ['Right', 114, 'Right'],
  ['Home', 110, 'Home'],
  ['End', 115, 'End'],
  ['Page_Up', 112, 'PageUp'],
  ['Page_Down', 117, 'PageDown'],
];
for (const [key, code, name] of NAV) {
  for (const over of [{}, NAV_FREE]) {
    check(
      same(commandFor(press(key, code), ctxOf(over)), { command: 'nav', key: name, shift: false, ctrl: false }),
      `${key} navigates as ${name}, with or without a selection`,
    );
  }
  check(
    same(commandFor(press(key, code, { shift: true }), BROWSE), { command: 'nav', key: name, shift: true, ctrl: false }),
    `Shift+${key} extends the selection`,
  );
  check(
    same(commandFor(press(key, code, CTRL), BROWSE), { command: 'nav', key: name, shift: false, ctrl: true }),
    `Ctrl+${key} moves the cursor only`,
  );
  check(commandFor(press(key, code, { alt: true }), BROWSE) === null, `Alt+${key} is left to the Shell`);
  check(commandFor(press(key, code, { ctrl: true, shift: true }), BROWSE) === null, `Ctrl+Shift+${key} is not mapped`);
  check(commandFor(press(key, code, { super: true }), BROWSE) === null, `Super+${key} is left to the Shell`);
}

// ---- type to select ---------------------------------------------------------------
check(same(commandFor(press('a', 38, {}, 'a'), BROWSE), { command: 'typeSelect', text: 'a' }), 'typing a selects by name');
check(
  same(commandFor(press('Cyrillic_ef', 38, {}, 'ф'), BROWSE), { command: 'typeSelect', text: 'ф' }),
  'typing a Russian letter passes its character on',
);
check(
  same(commandFor(press('Cyrillic_EF', 38, { shift: true }, 'Ф'), BROWSE), { command: 'typeSelect', text: 'Ф' }),
  'Shift+letter passes the capital on',
);
check(same(commandFor(press('A', 38, { shift: true }, 'A'), BROWSE), { command: 'typeSelect', text: 'A' }), 'Shift+a types a capital');
check(same(commandFor(press('1', 10, {}, '1'), BROWSE), { command: 'typeSelect', text: '1' }), 'digits type');
check(same(commandFor(press('period', 60, {}, '.'), BROWSE), { command: 'typeSelect', text: '.' }), 'a dot types');
check(same(commandFor(press('x', 53, {}, '😀'), BROWSE), { command: 'typeSelect', text: '😀' }), 'an astral character types');
check(same(commandFor(press('a', 38, CTRL, 'a'), BROWSE), { command: 'selectAll' }), 'Ctrl+a is selectAll, not type-to-select');
check(same(commandFor(press('space', 65, {}, ' '), BROWSE), { command: 'quickLook' }), 'a bare space is Quick Look, not a typed space');
check(same(commandFor(press('space', 65, {}, ' '), ctxOf({ hasSelection: false })), { command: 'nop' }), 'a bare space with nothing selected is consumed, not typed');
check(same(commandFor(press('x', 53, {}, 'x'), ctxOf({ stack: READ_ONLY })), { command: 'typeSelect', text: 'x' }), 'typing x on a read-only folder still selects by name');
check(same(commandFor(press('a', 38, {}, 'a'), ctxOf({ stack: RECENTS, hasSelection: false })), { command: 'typeSelect', text: 'a' }), 'type-to-select works with nothing selected');
check(commandFor(press('k', 45, CTRL, 'k'), BROWSE) === null, 'Ctrl+K is not a typed letter');
check(commandFor(press('x', 53, { alt: true }, 'x'), BROWSE) === null, 'Alt+x, not in the table, is null');
check(commandFor(press('Return', 36, { alt: true, shift: true }), BROWSE) === null, 'Alt+Shift+Return is not in the table');
check(commandFor(press('space', 65, { shift: true }, ' '), BROWSE) === null, 'Shift+space is not a typed space');
check(commandFor(press('F5', 71), BROWSE) === null, 'F5 is not mapped');
check(commandFor(press('Delete', 119, CTRL), BROWSE) === null, 'Ctrl+Delete is not in the table');
check(commandFor(press('Delete', 119, { ctrl: true, shift: true }), BROWSE) === null, 'Ctrl+Shift+Delete is not in the table');
check(commandFor(press('Return', 36, CTRL), BROWSE) === null, 'Ctrl+Return is not in the table');
check(commandFor(press('c', 54, { ctrl: true, alt: true }, 'c'), BROWSE) === null, 'Ctrl+Alt+C is not Ctrl+C');
check(commandFor(press('c', 54, { shift: true }, 'C'), BROWSE).command === 'typeSelect', 'Shift+C without ctrl types a capital C');
check(commandFor(press('Print', 107), BROWSE) === null, 'a key with no text and no row is null');
check(commandFor(press(undefined, undefined), BROWSE) === null, 'a press with nothing in it is null');
check(commandFor({ key: 'F5', keycode: 71 }, BROWSE) === null, 'a press missing its modifier fields and text is null');
check(same(commandFor({ key: 'Escape', keycode: 9 }, BROWSE), { command: 'close' }), 'a press missing its modifier fields still works');
check(commandFor(press('a', 38, {}, '   '), BROWSE) === null, 'whitespace-only text is not a typed character');

// ---- context defaults ---------------------------------------------------------------
check(same(commandFor(press('Escape', 9), { stack: FOLDER }), { command: 'close' }), 'a missing mode is browse');
check(same(commandFor(press('c', 54, CTRL, 'c'), { hasSelection: true }), { command: 'nop' }), 'a missing stack is neither folder nor recents: Ctrl+C is consumed');
check(same(commandFor(press('Escape', 9), { hasSelection: false }), { command: 'close' }), 'a missing stack still closes');
check(same(commandFor(press('Delete', 119), ctxOf({ hasSelection: undefined })), { command: 'nop' }), 'an undefined hasSelection counts as false');
check(same(commandFor(press('v', 55, CTRL), ctxOf({ clipboardHasFiles: undefined })), { command: 'nop' }), 'an undefined clipboardHasFiles counts as false');
check(same(commandFor(press('x', 53, CTRL), ctxOf({ stack: { kind: 'folder' } })), { command: 'nop' }), 'an undefined writable counts as read-only');

// ---- modifier-only keys and Super (rules for every mode) ------------------------------
const MODIFIER_KEYS = [
  ['Shift_L', 50], ['Shift_R', 62], ['Control_L', 37], ['Control_R', 105], ['Alt_L', 64],
  ['Alt_R', 108], ['Meta_L', 156], ['Meta_R', 157], ['Super_L', 133], ['Super_R', 134],
  ['ISO_Level3_Shift', 92], ['ISO_Level5_Shift', 203], ['ISO_Next_Group', 255],
  ['ISO_Prev_Group', 254], ['Mode_switch', 203], ['Caps_Lock', 66], ['Num_Lock', 77],
  ['Scroll_Lock', 78], ['Hyper_L', 207], ['Hyper_R', 208],
];
const MODES = ['browse', 'preview', 'rename', 'menu'];
check(MODIFIER_KEYS.length === 20, 'the 20 modifier keys of the contract are all listed');
for (const mode of MODES) {
  for (const [key, code] of MODIFIER_KEYS) {
    for (const mods of [{}, { ctrl: true }, { shift: true }, { alt: true }, { ctrl: true, shift: true }]) {
      if (!same(commandFor(press(key, code, mods), ctxOf({ mode })), null)) {
        check(false, `${key} with ${JSON.stringify(mods)} in ${mode} mode must be null`);
      }
    }
    check(commandFor(press(key, code), ctxOf({ mode })) === null, `${key} alone is null in ${mode} mode`);
  }
}
for (const mode of MODES) {
  for (const [label, p] of [
    ['Super+space (layout switch)', press('space', 65, { super: true }, ' ')],
    ['Super+C', press('c', 54, { super: true, ctrl: true }, 'c')],
    ['Super+Escape', press('Escape', 9, { super: true })],
    ['Super+Return', press('Return', 36, { super: true })],
    ['Super+a', press('a', 38, { super: true }, 'a')],
    ['Super+Delete', press('Delete', 119, { super: true })],
    ['Super+Tab', press('Tab', 23, { super: true })],
    ['Super+Left', press('Left', 113, { super: true })],
  ]) {
    check(commandFor(p, ctxOf({ mode })) === null, `${label} is null in ${mode} mode`);
  }
}
check(commandFor(press('space', 65, { ctrl: true, shift: true }, ' '), BROWSE) === null, 'Ctrl+Shift+space (an input-method switch) is not mapped');
check(commandFor(press('ISO_Next_Group', 255, { alt: true, shift: true }), BROWSE) === null, 'Alt+Shift (layout switch) passes through');

// ---- the menu mode -----------------------------------------------------------------
{
  const menu = ctxOf({ mode: 'menu' });
  let allNull = true;
  for (const [, p] of ROWS) allNull = allNull && commandFor(p, menu) === null;
  check(allNull, 'in menu mode every row of the table is null');
  for (const [key, code] of NAV) check(commandFor(press(key, code), menu) === null, `${key} is null in menu mode`);
  check(commandFor(press('Escape', 9), menu) === null, 'Escape is null in menu mode');
  check(commandFor(press('a', 38, {}, 'a'), menu) === null, 'typing is null in menu mode');
  check(commandFor(press('Tab', 23), menu) === null, 'Tab is null in menu mode');
}

// ---- the preview mode -----------------------------------------------------------------
{
  const preview = ctxOf({ mode: 'preview' });
  const table = [
    ['Escape', 9, 'closePreview'],
    ['space', 65, 'closePreview'],
    ['Left', 113, 'previewPrev'],
    ['Up', 111, 'previewPrev'],
    ['Right', 114, 'previewNext'],
    ['Down', 116, 'previewNext'],
    ['Return', 36, 'open'],
    ['KP_Enter', 104, 'open'],
  ];
  for (const [key, code, command] of table) {
    check(same(commandFor(press(key, code, {}, key === 'space' ? ' ' : ''), preview), { command }), `${key} is ${command} while Quick Look is open`);
    check(
      same(commandFor(press(key, code), ctxOf({ mode: 'preview', hasSelection: false, stack: RECENTS })), { command }),
      `${key} is ${command} in a recents preview too`,
    );
  }
  for (const [label, p] of [
    ['a letter', press('a', 38, {}, 'a')],
    ['Ctrl+C', press('c', 54, CTRL, 'c')],
    ['Ctrl+Russian C', press('Cyrillic_es', 54, CTRL, 'с')],
    ['Delete', press('Delete', 119)],
    ['F2', press('F2', 68)],
    ['Tab', press('Tab', 23)],
    ['Home', press('Home', 110)],
    ['Page_Down', press('Page_Down', 117)],
  ]) {
    check(commandFor(p, preview) === null, `${label} is null in preview mode`);
  }
  check(
    same(commandFor(press('space', 65, CTRL, ' '), preview), { command: 'closePreview' }),
    'preview matches the key alone: Ctrl+space still closes it',
  );
  check(commandFor(press('Escape', 9, { super: true }), preview) === null, 'Super+Escape is null in preview mode');
  check(same(commandFor(press('Cyrillic_es', 54, CTRL, 'с'), preview), null), 'preview has no letter commands in any layout');
}

// ---- the rename mode -------------------------------------------------------------------
{
  const rename = ctxOf({ mode: 'rename' });
  check(same(commandFor(press('Return', 36), rename), { command: 'commitRename' }), 'Return commits a rename');
  check(same(commandFor(press('KP_Enter', 104), rename), { command: 'commitRename' }), 'KP_Enter commits a rename');
  check(same(commandFor(press('Escape', 9), rename), { command: 'cancelRename' }), 'Escape cancels a rename');
  for (const [label, p] of [
    ['a letter', press('a', 38, {}, 'a')],
    ['space', press('space', 65, {}, ' ')],
    ['Left', press('Left', 113)],
    ['Delete', press('Delete', 119)],
    ['Ctrl+C', press('c', 54, CTRL, 'c')],
    ['Ctrl+Z', press('z', 52, CTRL, 'z')],
    ['Tab', press('Tab', 23)],
    ['Home', press('Home', 110)],
  ]) {
    check(commandFor(p, rename) === null, `${label} is left to the entry in rename mode`);
  }
  check(commandFor(press('Return', 36, { super: true }), rename) === null, 'Super+Return is null in rename mode');
}

finish();
