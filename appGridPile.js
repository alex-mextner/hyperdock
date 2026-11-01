'use strict';

// The app-grid icon (the nine dots) as a pile of app icons on a translucent
// rounded plate: the most used apps and the newest installed ones that are not
// in the dock. The rules live in appGridPileSelection.js / appGridPileLayout.js
// (pure, unit tested); this class gathers the Shell's data, has apps/stack-pile.js
// draw the picture in a separate process (see stackPile.js for the cost model)
// and puts it on the dock's Show Apps item. Clicking the item is the Shell's own
// Show Apps button, untouched.
//
// Cost model: nothing runs per frame except applyTo(), two compares. The data is
// gathered when the apps, favorites or settings change, debounced; the installed
// list (a stat per launcher) only after the Shell reports installed-changed.
// When an app was first seen is kept in $XDG_DATA_HOME/hyperdock/app-first-seen.json
// (appFirstSeen.js says why the launcher's own time is not enough).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Fav from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Compat from './compat.js';
import { StackPile } from './stackPile.js';
import { iconFileOf } from './stackSources.js';
import { appKeys, dockKeys } from './appGridPileDock.js';
import { selectPileApps } from './appGridPileSelection.js';
import {
  mergeFirstSeen,
  parseFirstSeen,
  serializeFirstSeen,
} from './appFirstSeen.js';
import { runningApps } from './windowsView.js';
import { layoutPile, PLATE } from './appGridPileLayout.js';

const REFRESH_DELAY = 1500;
// drawn once, sharp up to the largest magnified dock icon
const PICTURE_SIZE = 384;
const ICON_LOOKUP_SIZE = 128;
// what the Shell's Show Apps item shows without the pile
const SHOW_APPS_ICON = 'view-app-grid-symbolic';

// The launcher file's own time: its inode change time (a package manager writes
// it when it unpacks the file, an upgrade too) or the modification time.
function launcherTime(path) {
  try {
    const info = Gio.File.new_for_path(path).query_info(
      'time::changed,time::modified',
      Gio.FileQueryInfoFlags.NONE,
      null
    );
    return Math.max(
      info.get_attribute_uint64('time::changed'),
      info.get_attribute_uint64('time::modified')
    );
  } catch {
    return 0;
  }
}

const FIRST_SEEN_FILE = GLib.build_filenamev([
  GLib.get_user_data_dir(),
  'hyperdock',
  'app-first-seen.json',
]);

function loadFirstSeen() {
  try {
    const [, bytes] = GLib.file_get_contents(FIRST_SEEN_FILE);
    return parseFirstSeen(new TextDecoder().decode(bytes));
  } catch {
    return parseFirstSeen('');
  }
}

function saveFirstSeen(state) {
  try {
    GLib.mkdir_with_parents(GLib.path_get_dirname(FIRST_SEEN_FILE), 0o755);
    GLib.file_set_contents(FIRST_SEEN_FILE, serializeFirstSeen(state));
  } catch (e) {
    console.error('d2da: app first seen', e);
  }
}

export class AppGridPile {
  constructor(extension) {
    this.extension = extension;
    this._pile = null;
    this._installed = null;
    this._seen = null;
    this._signature = null;
    this._shown = [];
    this._seq = null;
    // what the last refresh picked: {frequent, recent, order}
    this.selection = { frequent: [], recent: [], order: [] };
  }

  // the picture to show on the Show Apps item, or null for the stock icon
  get gicon() {
    return this._shown.length ? (this._pile?.gicon ?? null) : null;
  }

  _enabled() {
    return !!(this.extension.app_grid_pile && this.extension.apps_icon);
  }

  // enable, or a setting changed: start over from what the settings say
  setup() {
    // null: no signature, not even the empty pile's, so refresh() acts
    this._signature = null;
    if (!this._enabled()) {
      this._teardown();
    } else {
      this._watchUsage();
      this.refresh();
    }
    this.extension.animate?.({ refresh: true });
  }

  // The Shell's AppUsage has no change signal and scores apps by focus, so a
  // focus change is when the most used order can move.
  _watchUsage() {
    global.display.disconnectObject(this);
    global.display.connectObject(
      'notify::focus-window',
      () => this.scheduleRefresh(),
      this
    );
  }

  // the Shell's list of installed apps changed: rescan on the next refresh
  onInstalledChanged() {
    this._installed = null;
    this.scheduleRefresh();
  }

  scheduleRefresh() {
    const timer = this.extension._loTimer;
    if (!timer || !this._enabled()) return;
    if (!this._seq) {
      this._seq = timer.runDebounced(
        () => {
          this._seq = null;
          this.refresh();
        },
        REFRESH_DELAY,
        'appGridPile'
      );
    } else {
      timer.runDebounced(this._seq);
    }
  }

  _teardown() {
    global.display.disconnectObject(this);
    this.extension._loTimer?.cancel(this._seq);
    this._seq = null;
    this._pile?.destroy();
    this._pile = null;
    this._shown = [];
  }

  _iconFile(app) {
    const theme = this.extension.icon_theme;
    return iconFileOf(
      app.get_icon(),
      (name) =>
        theme?.lookup_icon(name, ICON_LOOKUP_SIZE, 0)?.get_filename?.() ?? null
    );
  }

  // every app with a visible launcher and when it was first seen installed.
  // The record covers hidden launchers too: an app hidden and shown again is
  // not a new install.
  _installedApps() {
    if (this._installed) return this._installed;
    const scanned = Gio.AppInfo.get_all()
      .map((info) => ({
        id: info.get_id(),
        time: launcherTime(info.get_filename?.() ?? ''),
        visible: info.should_show(),
      }))
      .filter((entry) => entry.id);
    this._seen ??= loadFirstSeen();
    const { state, changed } = mergeFirstSeen(
      this._seen,
      scanned,
      Math.floor(GLib.get_real_time() / 1e6)
    );
    this._seen = state;
    if (changed) saveFirstSeen(state);
    this._installed = scanned
      .filter((entry) => entry.visible)
      .map(({ id }) => ({ id, time: state.firstSeen[id] }));
    return this._installed;
  }

  // the running apps the dock lists: none with "favorites only", and with
  // "isolate workspaces" only those with a window on this workspace
  _runningApps() {
    if (this.extension.favorites_only) return [];
    return runningApps(this.extension.isolate_workspaces);
  }

  // The window class a launcher declares: how the Shell matches windows to the
  // app, so a second id of the same program shares it.
  _wmClassOf(app) {
    return app?.get_app_info()?.get_startup_wm_class?.() ?? '';
  }

  // Every app the dock shows as an item: the pinned ones, the running ones and
  // the stopped ones in the Recents stack (its icon and its popover list them).
  // The dock's own *-hyperdock.desktop entries are no apps (isHelperId).
  _dockApps() {
    const pinned = Fav.getAppFavorites().getFavorites();
    const recents = this.extension.recentDockApps?.() ?? [];
    return [...pinned, ...this._runningApps(), ...recents];
  }

  // the apps to draw and their icon files, in pile order, top first
  _select() {
    const appSystem = Shell.AppSystem.get_default();
    const iconFiles = new Map();
    const usable = (id) => {
      const app = appSystem.lookup_app(id);
      if (!app?.get_app_info()?.should_show()) return false;
      const file = this._iconFile(app);
      if (file) iconFiles.set(id, file);
      return !!file;
    };
    const keysOf = (id) => appKeys(id, this._wmClassOf(appSystem.lookup_app(id)));
    const inDock = dockKeys(
      this._dockApps().map((app) => ({
        id: app.get_id(),
        wmClass: this._wmClassOf(app),
      }))
    );
    const selection = selectPileApps({
      mostUsed: Shell.AppUsage.get_default()
        .get_most_used()
        .map((app) => app.get_id()),
      installed: this._installedApps(),
      dockKeys: inDock,
      usable,
      keysOf,
      frequentCount: this.extension.app_grid_pile_frequent,
      recentCount: this.extension.app_grid_pile_recent,
    });
    return { selection, iconFiles };
  }

  // gather, and draw again only when the pile would look different
  refresh() {
    if (!this._enabled()) return;
    const { selection, iconFiles } = this._select();
    const { order } = selection;
    this.selection = selection;
    const signature = order.map((id) => `${id}=${iconFiles.get(id)}`).join('\n');
    if (signature === this._signature) return;
    this._signature = signature;
    this._shown = order;
    if (!order.length) {
      this._pile?.destroy();
      this._pile = null;
      this.extension.animate?.({ refresh: true });
      return;
    }
    this._pile ??= new StackPile(
      this.extension.path,
      () => this.extension.animate?.({ refresh: true }),
      PICTURE_SIZE
    );
    this._pile.render(
      layoutPile(order).map((layer) => ({ ...layer, icon: iconFiles.get(layer.id) })),
      PLATE
    );
  }

  // Per frame, for each dock item (services.updateIcon): puts the pile on the
  // Show Apps item. True when the item shows the pile, so the caller stops.
  applyTo(item, icon, dock) {
    if (item !== Compat.getDashShowAppsIcon(dock.dash)) return false;
    const gicon = this.gicon;
    if (gicon) {
      // St.Icon is recreated on icon theme changes
      if (item._pileGicon !== gicon || item._pileIcon !== icon) {
        icon.gicon = gicon;
        item._pileGicon = gicon;
        item._pileIcon = icon;
      }
      return true;
    }
    if (item._pileGicon) {
      item._pileGicon = null;
      item._pileIcon = null;
      icon.icon_name = SHOW_APPS_ICON;
    }
    return false;
  }

  destroy() {
    this._teardown();
    this._installed = null;
    this.extension = null;
  }
}
