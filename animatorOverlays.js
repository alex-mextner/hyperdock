// The per-icon overlays the animator refreshes every frame after the renderer is
// placed: the notification badge/counter/progress pill and the running-state dots.
// Both are pooled like the renderers (one per slot) and hidden until an icon has
// something to show. No Shell imports: the overlays are passed in.

// What the badge shows for `icon` (written into `out`): the notification count,
// the LauncherEntry progress (-1: none) and the configured style.
function badgeContent(dock, icon, out) {
  const ext = dock.extension;
  const services = ext.services;
  const appId = icon._appwell?.app.get_id();
  let noticesCount = (appId && services._appNotices?.[appId]?.count) || 0;
  // LauncherEntry count wins when the app shows one: apps like Telegram
  // know their unread total better than the sum of their banners, and
  // adding both would count each message twice.
  const entry = appId ? services.launcherEntry(appId) : null;
  if (entry?.countVisible) noticesCount = entry.count;
  let progress = entry?.progressVisible ? entry.progress : -1;
  const style =
    ext.notification_badge_style_options[ext.notification_badge_style] || 'default';
  // 'default' is the "None" style: the user asked for nothing drawn on
  // the icons, so neither the count nor the LauncherEntry progress pill
  if (style == 'default') {
    noticesCount = 0;
    progress = -1;
  }
  out.noticesCount = noticesCount;
  out.progress = progress;
  out.style = style;
  out.extension = ext;
  out.dock = dock;
}

/** Scratch for updateBadge: what the badge is drawn from. */
export function newBadgeData() {
  return { noticesCount: 0, progress: -1, style: 'default', extension: null, dock: null };
}

/** Scratch for updateDots. */
export function newDotsData() {
  return { appCount: 0, position: '', vertical: false, extension: null, dock: null };
}

//! ***badge location at scaling is messed up***
export function updateBadge(badge, icon, dock, data) {
  badge.hide();
  if (icon == dock._dragged) return;
  badgeContent(dock, icon, data);
  if (!(data.noticesCount > 0 || data.progress >= 0)) return;

  badge.update(icon, data);
  const renderer = icon._renderer;
  badge.width = renderer.width * renderer.scaleX;
  badge.height = badge.width;
  badge.x = renderer.x;
  badge.y = renderer.y;
  badge.set_scale(icon._scale, icon._scale);
  badge.show();
}

// windows the app of `icon` has open on this dock
function openWindows(dock, icon) {
  const app = icon._appwell?.app;
  if (!app || !app.get_n_windows) return 0;
  return dock.getAppWindowsFiltered(app).length;
}

//! ***dot requires a little more aligning at dock position other than bottom***
export function updateDots(dots, icon, dock, vertical, data) {
  dots.hide();
  if (icon == dock._dragged) return;
  const appCount = openWindows(dock, icon);
  if (!(appCount > 0 && icon._slotSize > 0)) return;

  data.appCount = appCount;
  data.position = dock._position;
  data.vertical = vertical;
  data.extension = dock.extension;
  data.dock = dock;
  dots.update(icon, data);
  dots.show();
}
