'use strict';

// The dock's group of stacks: Recents, Downloads, Screenshots (and the other
// folder stacks) and, after the minimized-window tiles, the Trash stand
// together behind one separator, as the user asked ("недавние ... пусть
// находятся слева от загрузок за тем же разделителем", "объединены в одну
// группу с загрузками, скриншотами и корзиной"). dock.js calls these from its
// extra-icons pass; the pure rules are in stackModel.js.

import { DockItemList } from './dockItemMenu.js';
import { setupStackItem } from './stackPanel.js';
import { clusterOrder } from './stackModel.js';

// the dock's cached icon list and layout are stale after an item came or went
function invalidate(dock) {
  dock._icons = null;
  dock._needsLayout = true;
}

// An open fan or panel showing `item` must close before the item goes
function releaseDropdown(dock, item) {
  if (dock._list?._target === item || dock._stackPanel?._target === item) {
    dock._destroyList();
  }
}

// A dock item for `stack`, opening the folder (or, for Recents, the app list)
// as a fan, grid or list.
function createStackItem(dock, services, stack) {
  let item = DockItemList.createItem(dock, {
    icon: `_folderStack:${stack.key}`,
    folder: stack.path ?? null,
    path: stack.app,
    stack,
    prepare: () => services.checkFolderStack(stack),
    files: () => stack.files,
    total: () => stack.total,
  });
  item._folderStack = stack;
  return item;
}

// Folder stacks: Downloads + the folder-stacks setting + Screenshots.
export function syncFolderStacks(dock) {
  let services = dock.extension.services;
  let stacks = (services?.folderStacks ?? []).filter(
    (s) => !s.isDownloads || dock.extension.downloads_icon
  );
  dock._folderIcons = dock._folderIcons ?? new Map();
  // services rebuilds stack objects on settings changes; drop stale items
  dock._folderIcons.forEach((item, key) => {
    if (stacks.includes(item._folderStack)) {
      return;
    }
    releaseDropdown(dock, item);
    item.destroy();
    dock._folderIcons.delete(key);
    invalidate(dock);
  });
  stacks.forEach((stack) => {
    if (dock._folderIcons.has(stack.key)) {
      return;
    }
    let item = createStackItem(dock, services, stack);
    // registered first: anything setup triggers that relayouts this dock
    // must find the item instead of creating it again
    dock._folderIcons.set(stack.key, item);
    setupStackItem(dock, item, stack);
    invalidate(dock);
  });
}

// The Recents stack: the recently closed apps. It is rebuilt with the stack
// object services makes when recent-apps-count or the view/display change.
export function syncRecentsStack(dock) {
  let services = dock.extension.services;
  let stack = dock.extension.recent_apps_count ? services?.recentsStack : null;
  let item = dock._recentsIcon;
  if (item && item._folderStack !== stack) {
    releaseDropdown(dock, item);
    item.destroy();
    dock._recentsIcon = null;
    invalidate(dock);
  }
  if (dock._recentsIcon || !stack) {
    return;
  }
  item = createStackItem(dock, services, stack);
  dock._recentsIcon = item;
  setupStackItem(dock, item, stack);
  invalidate(dock);
}

// Where an item of the extra-icons box stands in the group.
function roleOf(dock, item) {
  if (item === dock._separator) return 'separator';
  if (item === dock._recentsIcon) return 'recents';
  if (item === dock._trashIcon) return 'trash';
  if (item._folderStack) return item._folderStack.isDownloads ? 'downloads' : 'stack';
  if (item._minimizedTile) return 'tile';
  if (item._mountType) return 'mount';
  return 'stack';
}

// Puts the extra icons in group order (stackModel.clusterOrder) and tags each
// with its role; nothing moves when they already are in order.
export function orderExtraIcons(dock) {
  let box = dock._extraIcons;
  let children = box.get_children();
  let roles = children.map((child) => roleOf(dock, child));
  children.forEach((child, i) => (child._clusterRole = roles[i]));
  let order = clusterOrder(roles);
  if (order.every((from, to) => from === to)) {
    return;
  }
  order.forEach((from, to) => box.set_child_at_index(children[from], to));
  invalidate(dock);
}
