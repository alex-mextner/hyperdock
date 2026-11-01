'use strict';

// stackHotkeys.js - the layout-independent hotkey map of a stack dropdown
// (contract 11.2 of docs/STACK_INTERACTIONS.md).
//
// Turns one key press (already read from the Clutter event by the glue) and
// the state of the dropdown into a command name, or null when the event must
// travel on to the Shell untouched. Letters are identified by the layout's own
// ASCII letter, or by their xkb keycode when the layout has none, so Ctrl+C
// works on the Russian layout (where the key reads 'Cyrillic_es'). It takes plain data only, so it has no `gi://` imports and
// runs under plain `gjs -m` in tests/stack_hotkeys_check.js.
//
// Choices where the contract is silent:
// - `nav` carries the key in the vocabulary of stackSelection.applyNav
//   ('PageUp', 'PageDown'), not the keysym names Page_Up / Page_Down.
// - Preview and rename mode match the key alone; their modifiers are ignored.
// - Text made only of whitespace is not "printable" for type-to-select, so
//   Shift+space is null rather than a typed space.
// - A missing ctx.stack counts as neither a folder nor a recents stack.

const LETTER_KEYCODES = new Map([
  [24, 'q'], [25, 'w'], [26, 'e'], [27, 'r'], [28, 't'], [29, 'y'], [30, 'u'], [31, 'i'],
  [32, 'o'], [33, 'p'], [38, 'a'], [39, 's'], [40, 'd'], [41, 'f'], [42, 'g'], [43, 'h'],
  [44, 'j'], [45, 'k'], [46, 'l'], [52, 'z'], [53, 'x'], [54, 'c'], [55, 'v'], [56, 'b'],
  [57, 'n'], [58, 'm'],
]);

// Lower-cased keysym names; a tap of any of these must reach the Shell.
const MODIFIER_KEYS = new Set([
  'shift_l', 'shift_r', 'control_l', 'control_r', 'alt_l', 'alt_r', 'meta_l', 'meta_r',
  'super_l', 'super_r', 'iso_level3_shift', 'iso_level5_shift', 'iso_next_group',
  'iso_prev_group', 'mode_switch', 'caps_lock', 'num_lock', 'scroll_lock', 'hyper_l',
  'hyper_r',
]);

// GTK's rule: a layout that itself produces an ASCII letter (Dvorak, Colemak)
// keeps its printed letter; only a layout without one (Cyrillic, Greek, ...)
// falls back to the letter at that physical keycode.
const isAsciiLetter = (key) => typeof key === 'string' && /^[A-Za-z]$/.test(key);

export function latinKey(keycode, key) {
  if (isAsciiLetter(key)) return key.toLowerCase();
  return LETTER_KEYCODES.get(keycode) ?? String(key ?? '').toLowerCase();
}

// ---- conditions -----------------------------------------------------------

const isFolder = (ctx) => ctx.stack?.kind === 'folder';
const isRecents = (ctx) => ctx.stack?.kind === 'recents';
const isWritable = (ctx) => isFolder(ctx) && Boolean(ctx.stack.writable);
const always = () => true;
const hasSelection = (ctx) => Boolean(ctx.hasSelection);
const folderWithSelection = (ctx) => isFolder(ctx) && hasSelection(ctx);
const writableWithSelection = (ctx) => isWritable(ctx) && hasSelection(ctx);

const removeCommand = (ctx) => (isRecents(ctx) ? 'removeFromRecents' : 'trash');
const canRemove = (ctx) => hasSelection(ctx) && (isRecents(ctx) || isWritable(ctx));

// ---- the browse table -----------------------------------------------------

// key: modifiers in the order ctrl, shift, alt, then the latin key, all lower case.
// `command` is a name or a function of ctx; `when` says if it may run now.
const rule = (command, when = always) => ({ command, when });

const NAV_KEYS = new Map([
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['home', 'Home'],
  ['end', 'End'],
  ['page_up', 'PageUp'],
  ['page_down', 'PageDown'],
]);

const BROWSE = new Map([
  ['return', rule('open', hasSelection)],
  ['kp_enter', rule('open', hasSelection)],
  ['ctrl+o', rule('open', hasSelection)],
  ['alt+return', rule('properties', folderWithSelection)],
  ['ctrl+i', rule('properties', folderWithSelection)],
  ['space', rule('quickLook', hasSelection)],
  ['ctrl+space', rule('toggleFocus')],
  ['escape', rule('close')],
  ['ctrl+a', rule('selectAll')],
  ['ctrl+c', rule('copy', folderWithSelection)],
  ['ctrl+x', rule('cut', writableWithSelection)],
  ['ctrl+v', rule('paste', (ctx) => isWritable(ctx) && Boolean(ctx.clipboardHasFiles))],
  ['delete', rule(removeCommand, canRemove)],
  ['kp_delete', rule(removeCommand, canRemove)],
  ['ctrl+backspace', rule(removeCommand, canRemove)],
  ['shift+delete', rule('deletePermanently', writableWithSelection)],
  ['f2', rule('rename', writableWithSelection)],
  ['ctrl+z', rule('undo')],
  ['ctrl+shift+z', rule('redo')],
  ['ctrl+y', rule('redo')],
  ['ctrl+shift+n', rule('newFolder', isWritable)],
  ['ctrl+shift+c', rule('copyPath', folderWithSelection)],
  ['ctrl+r', rule('showInFiles', folderWithSelection)],
  ['tab', rule('nop')],
  ['shift+tab', rule('nop')],
  ['iso_left_tab', rule('nop')],
  ['shift+iso_left_tab', rule('nop')],
]);

const PREVIEW = new Map([
  ['escape', 'closePreview'],
  ['space', 'closePreview'],
  ['left', 'previewPrev'],
  ['up', 'previewPrev'],
  ['right', 'previewNext'],
  ['down', 'previewNext'],
  ['return', 'open'],
  ['kp_enter', 'open'],
]);

const RENAME = new Map([
  ['return', 'commitRename'],
  ['kp_enter', 'commitRename'],
  ['escape', 'cancelRename'],
]);

// ---- lookup ---------------------------------------------------------------

function modifierPrefix(press) {
  return `${press.ctrl ? 'ctrl+' : ''}${press.shift ? 'shift+' : ''}${press.alt ? 'alt+' : ''}`;
}

function navCommand(press, latin) {
  const key = NAV_KEYS.get(latin);
  if (key === undefined || press.alt) return null;
  if (press.shift && press.ctrl) return null;
  return { command: 'nav', key, shift: Boolean(press.shift), ctrl: Boolean(press.ctrl) };
}

function tableCommand(press, latin, ctx) {
  const entry = BROWSE.get(modifierPrefix(press) + latin);
  if (!entry) return null;
  if (!entry.when(ctx)) return { command: 'nop' };
  const command = typeof entry.command === 'function' ? entry.command(ctx) : entry.command;
  return { command };
}

function isPrintable(press) {
  return !press.ctrl && !press.alt && typeof press.text === 'string' && press.text.trim() !== '';
}

function browseCommand(press, latin, ctx) {
  return (
    navCommand(press, latin) ??
    tableCommand(press, latin, ctx) ??
    (isPrintable(press) ? { command: 'typeSelect', text: press.text } : null)
  );
}

function modeCommand(table, latin) {
  const command = table.get(latin);
  return command === undefined ? null : { command };
}

export function commandFor(press, ctx) {
  const mode = ctx.mode ?? 'browse';
  if (press.super || mode === 'menu') return null;
  if (MODIFIER_KEYS.has(String(press.key ?? '').toLowerCase())) return null;
  const latin = latinKey(press.keycode, press.key);
  if (mode === 'preview') return modeCommand(PREVIEW, latin);
  if (mode === 'rename') return modeCommand(RENAME, latin);
  return browseCommand(press, latin, ctx);
}
