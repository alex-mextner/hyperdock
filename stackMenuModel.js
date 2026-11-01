'use strict';

// What the context menus of a stack dropdown hold, as pure functions (no gi://
// imports) so tests/stack_menu_model_check.js runs them under plain gjs.
// stackPanel.js turns the entries into St widgets and runs the command named
// by `id` through the same dispatcher as the hotkeys of stackHotkeys.js.
//
// An entry is { id, label, enabled, accel?, children? } or the string '-' (a
// separator). `id` is a command name of stackHotkeys.js, or 'openWith',
// 'sort', 'group', 'view' for a submenu and 'openWith:<appId>',
// 'sort:<value>', 'group:<value>', 'view:<value>', 'wallpaper' for its
// choices. `accel` is the text of the hotkey, only on entries that have one.
// A child of Sort by / Group by / View as carries `checked`, true on the
// current choice.
//
// Menus are lists of groups joined by separators. Every group holds at least
// one entry whatever the context (a missing Open With or Set as Wallpaper
// only thins a group), so a separator never leads, trails or doubles.
//
// Choices where the contract (and the not yet written section 4.7) is silent:
//   * Disabled commands stay in the menu, greyed; an Open With is left out
//     without any app and unless exactly one item is chosen (count 1).
//   * itemMenu ignores ctx.kind (a folder and a file open the same way).
//   * Set as Wallpaper is for one image (enabled when count is 1).
//   * In the Trash (ctx.inTrash) Move to Trash becomes Delete Permanently.
//   * Redo has no menu entry (its hotkey is Ctrl+Shift+Z); Open in Files of
//     the background menu is the showInFiles command without an accelerator,
//     because the hotkey needs a selection.

import {
  GROUP_LABELS,
  STACK_SORT_LABELS,
  STACK_VIEW_LABELS,
} from './stackModel.js';

const SEPARATOR = '-';

function entry(id, label, enabled, accel) {
  return accel === undefined
    ? { id, label, enabled }
    : { id, label, enabled, accel };
}

function submenu(id, label, children) {
  return { id, label, enabled: true, children };
}

// groups of entries -> one flat menu, a separator between the groups
function assemble(groups) {
  return groups.flatMap((group, i) =>
    i === 0 ? group : [SEPARATOR, ...group]
  );
}

// ---- item menu -------------------------------------------------------------

function openWithMenu(ctx) {
  const apps = ctx.openWith;
  if (ctx.count !== 1 || !Array.isArray(apps) || apps.length === 0) return [];
  const children = apps.map(({ id, name }) =>
    entry(`openWith:${id}`, name, true)
  );
  return [submenu('openWith', 'Open With', children)];
}

function wallpaperEntry(ctx) {
  return ctx.isImage
    ? [entry('wallpaper', 'Set as Wallpaper', ctx.count === 1)]
    : [];
}

function removalEntry(ctx, writable) {
  return ctx.inTrash
    ? entry('deletePermanently', 'Delete Permanently', writable, 'Shift+Delete')
    : entry('trash', 'Move to Trash', writable, 'Delete');
}

function recentsItemMenu() {
  return assemble([
    [entry('open', 'Open', true, 'Return')],
    [entry('removeFromRecents', 'Remove from Recents', true, 'Delete')],
  ]);
}

// ctx: { kind, count, isImage, stack: { kind, writable }, clipboardHasFiles,
// openWith: [{ id, name }], inTrash }
export function itemMenu(ctx = {}) {
  if (ctx.stack?.kind === 'recents') return recentsItemMenu();
  const writable = ctx.stack?.writable === true;
  return assemble([
    [
      entry('open', 'Open', true, 'Return'),
      ...openWithMenu(ctx),
      ...wallpaperEntry(ctx),
    ],
    [entry('quickLook', 'Quick Look', true, 'Space')],
    [
      entry('copy', 'Copy', true, 'Ctrl+C'),
      entry('cut', 'Cut', writable, 'Ctrl+X'),
    ],
    [
      entry('rename', 'Rename', writable && ctx.count === 1, 'F2'),
      removalEntry(ctx, writable),
    ],
    [
      entry('copyPath', 'Copy Path', true, 'Ctrl+Shift+C'),
      entry('showInFiles', 'Show in Files', true, 'Ctrl+R'),
      entry('properties', 'Properties', true, 'Alt+Return'),
    ],
  ]);
}

// ---- background menu -------------------------------------------------------

// the choices of a Sort by / Group by / View as submenu; `labels` is in menu
// order
function choiceMenu(id, label, labels, current) {
  const children = Object.entries(labels).map(([value, name]) => ({
    ...entry(`${id}:${value}`, name, true),
    checked: value === current,
  }));
  return submenu(id, label, children);
}

// Recents holds no folder to paste into or sort: Clear Recents and the view.
function recentsBackgroundMenu(stack) {
  return assemble([
    [entry('clearRecents', 'Clear Recents', true)],
    [choiceMenu('view', 'View as', STACK_VIEW_LABELS, stack.view)],
  ]);
}

// ctx: { stack: { kind, writable, view, sort, group }, clipboardHasFiles,
// canUndo }
export function backgroundMenu(ctx = {}) {
  const stack = ctx.stack ?? {};
  if (stack.kind === 'recents') return recentsBackgroundMenu(stack);
  const writable = stack.writable === true;
  return assemble([
    [
      entry(
        'paste',
        'Paste',
        writable && ctx.clipboardHasFiles === true,
        'Ctrl+V'
      ),
      entry('newFolder', 'New Folder', writable, 'Ctrl+Shift+N'),
      entry('undo', 'Undo', ctx.canUndo === true, 'Ctrl+Z'),
    ],
    [entry('selectAll', 'Select All', true, 'Ctrl+A')],
    [
      choiceMenu('sort', 'Sort by', STACK_SORT_LABELS, stack.sort),
      choiceMenu('group', 'Group by', GROUP_LABELS, stack.group),
      choiceMenu('view', 'View as', STACK_VIEW_LABELS, stack.view),
    ],
    [entry('showInFiles', 'Open in Files', true)],
  ]);
}
