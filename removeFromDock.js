// "Remove from Dock" in the Shell AppMenu of an app icon (macOS Dock >
// Options > Remove from Dock), for the recent apps: they are not pinned, so
// Unpin does not apply, and not running, so neither does Quit.

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { appMenuAfterPinIndex } from './compat.js';

/**
 * Add (once) and refresh the item in an AppIcon's menu; called each time
 * the menu opens.
 *
 * @param {object} appwell Shell AppIcon with a menu
 * @param {Function} isRecent (app) => true while the dock shows app in its recents
 * @param {Function} onRemove (app) => void, takes the app out of the recents
 */
export function syncRemoveFromDockItem(appwell, isRecent, onRemove) {
  let menu = appwell?._menu;
  if (!menu) return;
  if (!menu._d2daRemoveFromDock) {
    let item = new PopupMenu.PopupMenuItem(_('Remove from Dock'));
    item.connect('activate', () => onRemove(appwell.app));
    menu.addMenuItem(item, appMenuAfterPinIndex(menu));
    menu._d2daRemoveFromDock = item;
  }
  menu._d2daRemoveFromDock.visible = isRecent(appwell.app);
}
