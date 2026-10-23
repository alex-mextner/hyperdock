'use strict';

let St = null;
try {
  St = (await import('gi://St')).default;
} catch {
  // St not available in standalone mock environments
}

/**
 * Resolve application IDs from the Shell's AppFavorites manager through its
 * public getFavorites() API (Shell.App instances).
 *
 * @param {object} favManager Shell AppFavorites instance
 * @returns {string[]} Array of app ID strings (e.g. ['org.gnome.Nautilus.desktop'])
 */
export function getFavoriteAppIds(favManager) {
  if (!favManager) return [];
  try {
    return favManager.getFavorites().map((a) => a.get_id());
  } catch (e) {
    console.error('d2da: compat getFavorites', e);
    return [];
  }
}

/**
 * Check whether an application ID is in favorites.
 *
 * @param {object} favManager Shell AppFavorites instance
 * @param {string} appId Desktop ID string
 * @returns {boolean}
 */
export function isFavoriteApp(favManager, appId) {
  if (!favManager || !appId) return false;
  if (typeof favManager.isFavorite === 'function') {
    try {
      return favManager.isFavorite(appId);
    } catch {
      // fallback to list check
    }
  }
  return getFavoriteAppIds(favManager).includes(appId);
}

/**
 * Resolve an application ID from an appwell (AppIcon).
 *
 * @param {object} appwell AppIcon actor/instance
 * @returns {string} Application ID string or empty string
 */
export function getAppId(appwell) {
  if (!appwell) return '';
  try {
    // `_id` is set by the dock's own custom icons (dockItems.js)
    return appwell.getId?.() || appwell.app?.get_id?.() || appwell._id || '';
  } catch {
    return '';
  }
}

/**
 * Extract the St.Icon from an AppIcon or ShowAppsIcon: its BaseIcon (`icon`)
 * owns the St.Icon as `.icon` once an icon size has been set, so an icon that
 * has not laid out yet is forced to create its texture.
 *
 * @param {object} appwell AppIcon or ShowAppsIcon
 * @returns {object|null} St.Icon instance or null
 */
export function getStIcon(appwell) {
  if (!appwell || !appwell.icon) return null;
  const baseIcon = appwell.icon;

  if (St?.Icon && baseIcon instanceof St.Icon) return baseIcon;
  if (baseIcon.isStIcon) return baseIcon;
  if (baseIcon.icon) return baseIcon.icon;

  try {
    if (typeof baseIcon.setIconSize === 'function') {
      const size =
        typeof baseIcon.iconSize === 'number' && baseIcon.iconSize > 0
          ? baseIcon.iconSize
          : 48;
      baseIcon._createIconTexture(size);
      if (baseIcon.icon) return baseIcon.icon;
    }
  } catch {
    // ignore initialization errors
  }

  return null;
}

/**
 * Safely toggle or open the overview applications page.
 * Uses public Main.overview methods instead of walking Main.uiGroup.
 *
 * @param {object} overview Main.overview instance
 */
export function showOverviewApps(overview) {
  if (!overview) return;
  try {
    if (overview.visible) {
      overview.toggle();
    } else if (typeof overview.showApps === 'function') {
      overview.showApps();
    } else if (typeof overview.toggle === 'function') {
      overview.toggle();
    }
  } catch (e) {
    console.error('d2da: compat showOverviewApps', e);
  }
}

/**
 * Maximize a window (Mutter 49+ takes no flags).
 *
 * @param {object} win Meta.Window instance
 */
export function maximizeWindow(win) {
  if (!win) return;
  try {
    win.maximize();
  } catch (e) {
    console.error('d2da: compat maximizeWindow', e);
  }
}

/**
 * Unmaximize a window.
 *
 * @param {object} win Meta.Window instance
 */
export function unmaximizeWindow(win) {
  if (!win) return;
  try {
    win.unmaximize();
  } catch (e) {
    console.error('d2da: compat unmaximizeWindow', e);
  }
}

/**
 * Safely retrieve the inner icons box of a Shell Dash actor.
 *
 * @param {object} dash Shell Dash instance
 * @returns {object|null}
 */
export function getDashBox(dash) {
  if (!dash) return null;
  return dash._box ?? null;
}

/**
 * Safely retrieve the container holding the icons box and showApps button.
 *
 * @param {object} dash Shell Dash instance
 * @returns {object|null}
 */
export function getDashContainer(dash) {
  if (!dash) return null;
  return dash._dashContainer ?? null;
}

/**
 * Safely retrieve the showAppsIcon of a Shell Dash actor.
 *
 * @param {object} dash Shell Dash instance
 * @returns {object|null}
 */
export function getDashShowAppsIcon(dash) {
  if (!dash) return null;
  return dash._showAppsIcon ?? null;
}

/**
 * Safely retrieve the background actor of a Shell Dash actor.
 *
 * @param {object} dash Shell Dash instance
 * @returns {object|null}
 */
export function getDashBackground(dash) {
  if (!dash) return null;
  return dash._background ?? null;
}

/**
 * Configure a Shell Dash instance for proxy rendering by d2da.
 * Neutralizes internal icon resizing and makes real app items invisible.
 *
 * @param {object} dash Shell Dash instance
 */
export function setupDashProxy(dash) {
  if (!dash) return;
  try {
    dash._adjustIconSize = () => {};
    const origCreateAppItem = dash._createAppItem;
    if (typeof origCreateAppItem === 'function') {
      dash._createAppItem = function (app) {
        const item = origCreateAppItem.call(this, app);
        this.opacity = 0;
        if (item?.child) {
          item.child.visible = false;
        }
        return item;
      };
    }
  } catch (e) {
    console.error('d2da: compat setupDashProxy', e);
  }
}

/**
 * Safely update orientation on a Shell Dash's container and box.
 *
 * @param {object} dash Shell Dash instance
 * @param {number} orientation Clutter.Orientation or boolean
 */
export function setDashOrientation(dash, orientation) {
  if (!dash) return;
  try {
    let orient = orientation;
    if (typeof orientation === 'boolean') {
      orient = orientation ? 1 : 0;
    }
    const container = getDashContainer(dash);
    if (container?.layout_manager) {
      container.layout_manager.orientation = orient;
    }
    const box = getDashBox(dash);
    if (box?.layout_manager) {
      box.layout_manager.orientation = orient;
    }
  } catch (e) {
    console.error('d2da: compat setDashOrientation', e);
  }
}

/**
 * Safely update text direction on a Shell Dash's container and box.
 *
 * @param {object} dash Shell Dash instance
 * @param {boolean} isRtl
 */
export function setDashLayoutDirection(dash, isRtl) {
  if (!dash) return;
  try {
    const container = getDashContainer(dash);
    if (container) {
      container.text_direction = isRtl ? 2 : 1;
    }
    const box = getDashBox(dash);
    if (box) {
      box.text_direction = 1; // icons layout stays LTR
    }
  } catch (e) {
    console.error('d2da: compat setDashLayoutDirection', e);
  }
}

/**
 * Controls visibility and opacity of the stock overview dash.
 * Eliminates the legacy __box expando.
 *
 * @param {object} overviewDash Main.overview.dash instance
 * @param {boolean} show whether to show or hide the overview dash
 * @param {object|null} state reference to persistent state tracker { hiddenChild: null }
 */
export function setOverviewDashVisibility(overviewDash, show, state = null) {
  if (!overviewDash) return;
  try {
    overviewDash.opacity = show ? 255 : 0;
    const bg = getDashBackground(overviewDash);
    if (bg) {
      bg.style = show ? '' : 'background: transparent !important;';
    }

    const box = getDashBox(overviewDash);
    if (box && typeof box.get_children === 'function') {
      box.get_children().forEach((c) => {
        c.opacity = show ? 255 : 0;
        c.visible = show;
        if (c.child) {
          c.child.reactive = show;
          c.child.track_hover = show;
        }
      });
    }

    const showApps = getDashShowAppsIcon(overviewDash);
    if (showApps) {
      showApps.opacity = show ? 255 : 0;
      if (showApps.child) {
        showApps.child.reactive = show;
        showApps.child.track_hover = show;
      }
    }

    if (show && state && state.hiddenChild) {
      state.hiddenChild.visible = true;
      state.hiddenChild = null;
    }
  } catch (e) {
    console.error('d2da: compat setOverviewDashVisibility', e);
  }
}

