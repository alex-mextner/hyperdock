// Drawing one dock icon on its pooled renderer: which image it shows (with the
// user's icon overrides), the opaque-bbox size correction, the size it eases to
// and the pixel-snapped slot it is placed in.
//
// The dock draws every icon on a pooled St.Icon "renderer" actor, by position:
// the item behind an index may change between frames, so the functions here
// rebind a renderer to whatever icon it is handed (bindRenderer). No Shell
// imports; `frame` is the animator's per-frame state (see Animator._beginRun).
import { zeroTranslation } from './animatorBounce.js';
import { easeToward, sizeStep, slotOffsets } from './animatorMath.js';
import { IDENTITY_NORMALIZATION, snapToPixel } from './iconGeometry.js';

// image an icon shows: `name` is an icon name, `gicon` a Gio icon override
export function newIconSource() {
  return { name: null, gicon: null };
}

// override via icon name: a cached gicon wins, else a replacement name
function mapByIconName(ext, source) {
  if (ext.icon_map_cache && ext.icon_map_cache[source.name]) {
    source.gicon = ext.icon_map_cache[source.name];
  }
  if (!source.gicon && ext.icon_map && ext.icon_map[source.name]) {
    source.name = ext.icon_map[source.name];
  }
}

// override via app name
function mapByAppName(ext, source, appName) {
  if (!appName) return;
  if (ext.app_map_cache && ext.app_map_cache[appName]) {
    source.gicon = ext.app_map_cache[appName];
  }
  if (!source.gicon && ext.app_map && ext.app_map[appName]) {
    source.name = ext.app_map[appName];
  }
}

/** Fills `source` with the image `icon` should show, user overrides applied. */
export function resolveSource(dock, icon, source) {
  source.name = icon._icon.icon_name;
  source.gicon = null;
  const ext = dock.extension;
  if (!ext.icon_map && !ext.app_map) return;
  mapByIconName(ext, source);
  mapByAppName(
    ext,
    source,
    icon._appwell?.app?.app_info?.get_id()?.replace('.desktop', '') ?? null
  );
}

/**
 * Hands `renderer` to `icon`. Renderers are pooled by position: when an item is
 * removed, the ones after it take over their neighbour's renderer. St.Icon keeps
 * showing the old image until the new one has loaded (a frame or more for file
 * icons, e.g. the glass Trash), so it is dropped first.
 *
 * A renderer comes to rest here unless `icon` is bouncing: a bounce that was cut off
 * must not leave its offset (either axis) on the renderer, which the badge, the
 * counter and the running dots follow. While `icon` bounces its renderer shows the
 * icon's offset, whatever that renderer was doing before (a rebound one, or a hidden
 * one that still carries the icon it drew last).
 */
export function bindRenderer(renderer, icon) {
  const rebound = renderer._icon !== icon._icon;
  if (renderer._icon && rebound) {
    renderer.gicon = null;
  }
  renderer._icon = icon._icon;
  renderer.set_style_class_name('');

  const appwell = icon._appwell;
  if (!appwell?._bounce) {
    zeroTranslation(renderer);
    return;
  }
  appwell._bounce = false;
  renderer.translationX = appwell.translationX;
  renderer.translationY = appwell.translationY;
}

/** Shows `source` on `renderer`. */
export function applySource(renderer, icon, source) {
  const { name, gicon } = source;
  if (gicon) {
    renderer.gicon = gicon;
    // replace PNG with override SVG
    if (icon._icon.gicon && icon._icon.gicon.file) {
      icon._icon.gicon = gicon;
    }
  } else if (name) {
    renderer.icon_name = name;
  } else if (icon._icon.gicon) {
    // Directly assign the icon's gicon to the renderer (fixed in #issue 188)
    renderer.gicon = icon._icon.gicon;
  }
}

/**
 * Size correction: the opaque bbox of the image is measured once per icon
 * (the normalizer) and eased in, since a measurement lands a few frames after
 * the icon appears; a renderer rebound to another icon starts at that icon's
 * correction. Returns the eased scale correction `k`; the eased offsets
 * stay on the renderer (`_appliedDx`, `_appliedDy`).
 */
export function easeNormalization(normalizer, renderer, icon, source, baseSize) {
  const normSrc = source.gicon || source.name || icon._icon.gicon;
  if (
    renderer._normSrc !== normSrc ||
    renderer._normBase !== baseSize ||
    renderer._normVersion !== normalizer.version
  ) {
    const swapped = renderer._normSrc !== normSrc;
    renderer._normSrc = normSrc;
    renderer._normBase = baseSize;
    renderer._normVersion = normalizer.version;
    renderer._norm = normalizer.get(normSrc, baseSize);
    // a pooled renderer showing another icon starts from that icon's value:
    // easing from the previous icon's lets its art enter the indicator band
    if (swapped) {
      const start = renderer._norm || IDENTITY_NORMALIZATION;
      renderer._appliedK = start.k;
      renderer._appliedDx = start.dx;
      renderer._appliedDy = start.dy;
    }
  }
  const norm = renderer._norm || IDENTITY_NORMALIZATION;
  const appliedK = easeToward(renderer._appliedK ?? 1, norm.k);
  renderer._appliedDx = easeToward(renderer._appliedDx ?? 0, norm.dx);
  renderer._appliedDy = easeToward(renderer._appliedDy ?? 0, norm.dy);
  return appliedK;
}

/**
 * Eases the renderer's size toward the one `icon` wants and scales it there.
 * Returns the slot size this frame (before the size correction).
 */
export function sizeRenderer(frame, icon, renderer, unscaledIconSize, baseSize, appliedK) {
  // slot size the renderer showed last frame, without the correction
  const currentSize =
    (renderer.icon_size * renderer.scaleX) / (renderer._appliedK || 1);
  const step = sizeStep(
    currentSize,
    unscaledIconSize * icon._targetScale,
    frame.slowDown,
    frame.dt
  );
  const targetSize = currentSize + step;
  icon._deltaSize = step;
  icon._targetSize = targetSize;
  icon._scale = targetSize / unscaledIconSize;

  if (renderer.icon_size != baseSize) {
    renderer.set_size(baseSize, baseSize);
    renderer.set_icon_size(baseSize);
  }
  renderer._appliedK = appliedK;
  const scaleToTarget = (targetSize * appliedK) / baseSize;
  renderer.set_scale(scaleToTarget, scaleToTarget);
  return targetSize;
}

// moves the renderer into its slot, on the physical pixel grid: a fractional
// phase shimmers while scaling
function commitPosition(frame, icon, renderer, iconContainer, p, adjust, targetSize, appliedK) {
  const { renderOffset, pixelScale, vertical } = frame;
  if (vertical) {
    iconContainer.translationX = adjust.x / 2;
  } else {
    iconContainer.translationY = adjust.y / 2;
  }

  const slotX = snapToPixel(
    p[0] + adjust.x + icon._icon.translationX,
    pixelScale
  ) - renderOffset[0];
  const slotY = snapToPixel(
    p[1] + adjust.y + icon._icon.translationY,
    pixelScale
  ) - renderOffset[1];
  icon._slotX = slotX;
  icon._slotY = slotY;
  icon._slotSize = targetSize;
  const inset = (targetSize - targetSize * appliedK) / 2;
  renderer.set_position(
    snapToPixel(
      slotX + renderOffset[0] + inset + renderer._appliedDx * targetSize,
      pixelScale
    ) - renderOffset[0],
    snapToPixel(
      slotY + renderOffset[1] + inset + renderer._appliedDy * targetSize,
      pixelScale
    ) - renderOffset[1]
  );
  renderer.visible = true;
}

/** Puts the renderer in the slot of `icon` (the dash item) and notes where it is. */
export function placeRenderer(frame, icon, renderer, targetSize, appliedK) {
  const p = icon.get_transformed_position();
  if (isNaN(p[0]) || isNaN(p[1])) return;

  const adjust = frame.adjust;
  slotOffsets(adjust, icon, targetSize, frame.vertical, frame.edge.left, frame.edge.bottom);
  // iconContainer can be null when dragging icons
  const iconContainer = icon._icon.get_parent();
  if (iconContainer) {
    commitPosition(frame, icon, renderer, iconContainer, p, adjust, targetSize, appliedK);
  }
  icon._px = p[0] - frame.renderOffset[0];
  icon._py = p[1] - frame.renderOffset[1];
}
