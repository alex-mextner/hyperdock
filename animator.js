'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Compat from './compat.js';
import St from 'gi://St';
import Graphene from 'gi://Graphene';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
const Point = Graphene.Point;

import { Dot } from './apps/dot.js';
import { DockPosition } from './dock.js';
import { Vector } from './vector.js';
import { DockLayout } from './dockLayout.js';

import { smoothScaling } from './textureFilters.js';
import { IconNormalizer } from './iconNormalizer.js';
import { IDENTITY_NORMALIZATION, snapToPixel } from './iconGeometry.js';
import { DockItemDotsOverlay, DockItemBadgeOverlay } from './dockItems.js';
import { live } from './probe.js';
import {
  Bounce,
  Linear,
} from './effects/easing.js';
import {
  isInRect,
  isOverlapRect,
} from './utils.js';

const ANIM_POSITION_PER_SEC = 550 / 1000;
const ANIM_SIZE_PER_SEC = 250 / 1000;
const ANIM_ICON_RAISE = 0.5;
const ANIM_ICON_SCALE = 1.5;
const ANIMATE_CACHE_LOOKUP = 4;

const DOT_CANVAS_SIZE = 96;

// an icon the dock has not seen before opens its slot by this share of the
// remaining way per 16.6 ms frame, and counts as open from PRESENCE_DONE on
const PRESENCE_RATE = 0.2;
const PRESENCE_DONE = 0.995;
// frames go on while an icon is further than this (px) from where it is going
const SETTLE_EPSILON = 0.25;

// 35% of the remaining distance per frame; snaps once it is imperceptible
function easeToward(current, target) {
  return Math.abs(target - current) < 0.001
    ? target
    : current + (target - current) * 0.35;
}

export let Animator = class {
  constructor() {
    live('animator', 1);
    this._layout = new DockLayout();
    this._seen = false;
    // refilled every frame: the layout takes it as is
    this._frame = {
      iconSize: 0,
      padding: 0,
      separatorSize: 0,
      pointerPrimary: 0,
      pointerSecondary: 0,
      threshold: 0,
      scaleAtMax: 1,
      curveType: 0,
      noAnimation: false,
      suppressHover: false,
    };
  }

  // the layout of the last frame: separator slots, measured spans
  get layout() {
    return this._layout;
  }

  enable() {
    if (!this._renderers) {
      this._renderers = [];
      this._dots = [];
      this._badges = [];
    }
    this._computed = null;
    this._normalizer ??= new IconNormalizer();
    this._normalizer.onChange = () => this.dock?._beginAnimation('icon-normalized');
  }

  disable() {
    this._normalizer?.destroy();
    this._normalizer = null;
    this._destroyPool();
    // only non-pool children are left (services' clock/calendar); they are
    // just unparented until R-7b destroys them with their item
    this._target?.remove_all_children();
    this._target = null;
    this._computed = null;
    this._layout.clear();
    this._seen = false;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    live('animator', -1);
    this.disable();
    this.dock = null;
    this.extension = null;
  }

  _destroyPool() {
    [this._renderers, this._dots, this._badges].forEach((pool) => {
      (pool || []).forEach((actor) => actor?.destroy());
    });
    this._renderers = [];
    this._dots = [];
    this._badges = [];
  }

  _precreateResources(dock) {
    if (!dock._icons) {
      return false;
    }

    let count = dock._icons.length;
    if (dock.renderArea.get_children().length == 0) {
      this._destroyPool();
    }
    this._target = dock.renderArea;

    while (this._renderers.length < count) {
      // renderer
      let target = dock.renderArea;
      let renderer = new St.Icon({
        icon_name: 'file',
        name: 'd2daIcon',
        reactive: true,
        icon_size: 24,
      });
      renderer.visible = false;
      // St.Icon draws through an inner texture actor that Shell swaps on every
      // icon change: mipmapped minification keeps magnified icons from
      // shimmering while their scale changes
      renderer.get_children().forEach(smoothScaling);
      renderer.connect('child-added', (_, child) => smoothScaling(child));
      target.add_child(renderer);
      this._renderers.push(renderer);

      // dot
      let dots = new DockItemDotsOverlay(new Dot(DOT_CANVAS_SIZE), {
        name: 'd2daDotsOverlay',
      });
      dots.visible = false;
      target.add_child(dots);
      this._dots.push(dots);

      // badges
      let badge = new DockItemBadgeOverlay(new Dot(DOT_CANVAS_SIZE), {
        name: 'd2daBadgeOverlay',
      });
      badge.visible = false;
      target.add_child(badge);
      this._badges.push(badge);
    }

    for (let i = dock._icons.length; i < this._renderers.length; i++) {
      this._renderers[i].visible = false;
      this._dots[i].visible = false;
      this._badges[i].visible = false;
    }

    return true;
  }

  // Separators sit in the gap between the icons as they are drawn this
  // frame (renderer rects, in the same space as the slots kept for hit
  // testing): dockLayout.js explains why that gap is theirs by construction.
  // A separator that cannot take part (no icon on a side, hidden, unmapped)
  // is made transparent instead of hidden so it is measured again next frame.
  _placeSeparators(dock, thickness, vertical, crossSize, renderOffset) {
    let layout = this._layout;
    if (thickness <= 0) {
      dock._separators.forEach((actor) => {
        actor.visible = false;
      });
      return;
    }

    let offset = renderOffset[vertical ? 1 : 0];
    layout.icons.forEach((icon, k) => {
      let r = icon._renderer;
      let start = (vertical ? r.y : r.x) + offset;
      let size = vertical ? r.height * r.scaleY : r.width * r.scaleX;
      layout.iconShownStart[k] = start;
      layout.iconShownEnd[k] = start + size;
    });
    layout.fitSeparators(thickness + 0.5);

    layout.sepActors.forEach((actor, j) => {
      let size = layout.sepFitSize[j];
      // across the dock the line stays centred on the platter (its CENTER
      // alignment in the dash slot, see Dock._inspectIcon)
      let shift = layout.sepFitCenter[j] - layout.sepRest[j];
      if (vertical) {
        actor.translationX = 0;
        actor.translationY = shift;
        actor.width = crossSize;
        actor.height = size;
      } else {
        actor.translationX = shift;
        actor.translationY = 0;
        actor.width = size;
        actor.height = crossSize;
      }
      actor.opacity = size > 0 ? 255 : 0;
    });
    dock._separators.forEach((actor) => {
      if (!layout.sepActors.includes(actor)) {
        actor.opacity = 0;
      }
    });
  }

  // Index of the separator slot under `p` (stage coordinate along the dock),
  // or -1. Slots are those of the last frame the animator ran.
  separatorSlotAt(p) {
    return this._layout.slotAt(p);
  }

  //! begin optimization
  animate(dt) {
    try {
      this._animate(dt);
    } catch (err) {
      console.error('d2da: animator animate', err);
    }
  }

  _animate(dt) {
    let dock = this.dock;
    if (!dock || !this._normalizer) return;

    if (dock._hoveredIcon) {
      dock._lastHoveredIcon = dock._hoveredIcon;
    }

    let simulation = false;

    if (dock._needsLayout) {
      if (!dock.relayout()) {
        return;
      }
    }

    dock._snapToContainerEdge(dock, dock.dash, true);

    if (!dock._icons || !dock._icons.length) {
      return;
    }

    if (!dock.renderArea?.has_allocation()) {
      return;
    }

    if (!this._precreateResources(dock)) {
      return;
    }

    // opacity
    let didFadeIn = false;
    if (dock.opacity < 255) {
      let opacityPerSecond = 255 / 500;
      didFadeIn = true;
      let dst = 255 - dock.opacity;
      let mag = Math.abs(dst);
      let dir = Math.sign(dst);
      if (opacityPerSecond > mag / dt) {
        opacityPerSecond = mag / dt;
      }
      dock.opacity += Math.floor(opacityPerSecond * dt * dir);
      if (dock.renderArea.opacity < 255 && dock.opacity > 50) {
        dock.renderArea.opacity = dock.opacity;
      }
    }

    let m = dock.getMonitor();
    let pointer = global.get_pointer();

    // simulated or transformed pointers
    if (dock.extension.simulated_pointer) {
      pointer = [...dock.extension.simulated_pointer];
      simulation = true;
    }
    if (dock.simulated_pointer) {
      pointer = [...dock.simulated_pointer];
      simulation = true;
    }
    // disable icon scale animation upon hovering an item
    if (
      dock._list &&
      dock._list.visible &&
      dock._list._box &&
      dock._lastHoveredIcon == dock._list._target
    ) {
      pointer[1] -= dock._iconSize * dock._scaleFactor;
    }

    let [px, py] = pointer;

    let vertical = dock.isVertical();
    let isWithin = dock._isWithinDash([px, py]);

    if (m.inFullscreen) {
      isWithin = false;
    }

    let animated = isWithin;
    dock.animated = animated;

    let iconSize = dock._iconSizeScaledDown;
    let scaleFactor = dock._scaleFactor;
    let thickness = dock.extension.separator_thickness || 0;

    // Only the items measurable NOW take part in this frame; nothing is read
    // from an earlier one (dockLayout.js).
    // (A separator hidden for thickness 0 needs no restoring here: changing
    // the thickness recreates the docks, see extension.js.)
    const layout = this._layout;
    const measured = layout.measure(dock._dashItems, vertical, thickness > 0);
    // unmeasured icons have no renderer this frame
    for (let i = measured; i < dock._icons.length; i++) {
      this._renderers[i].visible = false;
      this._dots[i].visible = false;
      this._badges[i].visible = false;
    }
    if (!measured) {
      return;
    }
    let animateIcons = layout.icons;

    let nearestIcon = null;
    let largestIcon = null;
    let largestSize = -1;

    // An icon the dock has not seen before opens its slot over time (the dock
    // widens as it does); what is there at startup is open at once.
    const snap = !this._seen;
    const openStep = 1 - Math.pow(1 - PRESENCE_RATE, dt > 0 ? dt / 16.6 : 1);
    let opening = false;
    animateIcons.forEach((icon, idx) => {
      if (icon._found && !icon._handled) {
        icon._handled = true;
        dock._maybeBounce(icon, true);
      }

      icon._targetScale = 1;
      icon._idx = idx;

      if (icon._presence === undefined) {
        icon._presence = snap ? 1 : 0;
        // the pooled renderer still has another icon's size
        if (!snap) this._renderers[idx].set_scale(0, 0);
      }
      if (icon._presence < 1) {
        icon._presence += (1 - icon._presence) * openStep;
        if (icon._presence > PRESENCE_DONE) icon._presence = 1;
        opening = true;
      }
      layout.iconPresence[idx] = icon._presence;
    });
    this._seen = true;

    let noAnimation = !dock.extension.animate_icons_unmute;
    if (dock._dragging) {
      noAnimation = true;
      isWithin = true;
    }

    let didBounce = false;
    let settling = opening;

    //------------------------
    // animation behavior
    //------------------------
    let edge_distance = dock._edge_distance;
    let rise = dock.extension.animation_rise * ANIM_ICON_RAISE;
    let magnify = dock.extension.animation_magnify * ANIM_ICON_SCALE;
    let spread = dock.extension.animation_spread;

    // Keep magnification independent from spread
    let threshold = (iconSize + 10) * 2.5 * scaleFactor;
    if (animated && edge_distance < 0) {
      edge_distance = 0;
    }

    const scaleAtMax = 1.0 + magnify;

    // --- Steps 2-5: pack the icons and separators (see dockLayout.js) ---
    const frame = this._frame;
    frame.iconSize = iconSize * scaleFactor;
    // base resting padding between items
    const spacingMargin = 8.0 * (dock.extension.icon_spacing || 0.0);
    frame.padding = 2.0 * spacingMargin + 2.0;
    frame.separatorSize = thickness + 0.5;
    frame.pointerPrimary = vertical ? py : px;
    frame.pointerSecondary = vertical ? px : py;
    frame.threshold = threshold;
    frame.scaleAtMax = scaleAtMax;
    frame.curveType = dock.extension.animation_rise_curve ?? 0;
    frame.noAnimation = noAnimation;
    // an open stack panel's pointer aims at the icon at rest; magnifying
    // under the panel would also push icons into it
    frame.suppressHover = m.inFullscreen || !!dock._stackPanel;
    layout.compute(frame);

    isWithin = layout.isWithin;
    animated = isWithin;
    dock.animated = animated;

    nearestIcon = layout.peak >= 0 ? animateIcons[layout.peak] : null;
    dock._nearestIcon = nearestIcon;
    dock._hoveredIcon = nearestIcon;

    let didScale = nearestIcon !== null;
    let hoveredIcon = nearestIcon;

    animateIcons.forEach((icon, idx) => {
      // Position the Clutter actor along the dock relative to its resting slot
      icon._translate = layout.iconDelta[idx];

      // The Dash re-lays itself out when an item comes or goes: what is drawn
      // stays where it was and the easing below glides it to the new layout,
      // so the dock width animates instead of jumping.
      const drift = layout.iconDrift[idx];
      if (drift) {
        if (vertical) {
          icon._icon.translationY += drift;
        } else {
          icon._icon.translationX += drift;
        }
      }

      // Assign unadjusted original scale to the actor properties
      const originalScale = layout.iconScale[idx];
      const presence = icon._presence;
      icon._scale = originalScale * presence;
      icon._targetScale = originalScale * presence;

      // Compute secondary axis rise offset (elevation)
      const sz = iconSize * (originalScale - 1) * scaleFactor;
      icon._translateRise = sz * rise * presence;

      // Apply scale directly to the icon image texture
      if (
        icon._icon.gicon &&
        icon._icon.gicon.file != null &&
        !icon._icon.gicon.file?.get_path()?.toLowerCase().endsWith('svg')
      ) {
        // skip scaling non-SVG image files for performance
      } else {
        icon._icon.set_scale(originalScale, originalScale);
      }
    });

    dock._hoveredIcon = nearestIcon;

    //-------------------
    // interpolation / animation
    //-------------------
    let renderOffset = dock.renderArea.get_transformed_position();
    const pixelScale = dock._monitor?.geometry_scale || 1;
    if (!renderOffset || isNaN(renderOffset[0]) || isNaN(renderOffset[1])) {
      return;
    }

    let first = animateIcons[0];
    let last = animateIcons[animateIcons.length - 1];

    let slowDown = dock.extension._config.speed_up || 1;
    if (!didScale) {
      slowDown = 0.5;
    }

    largestIcon = null;
    largestSize = -1;

    animateIcons.forEach((icon) => {
      if (!icon._icon) return;

      icon._scale = icon._targetScale;

      if (largestSize == -1 || largestSize < icon._scale) {
        largestIcon = icon;
        largestSize = icon._scale;
      }

      const isTopOrLeft =
        dock._position === DockPosition.TOP ||
        dock._position === DockPosition.LEFT;
      const riseDirection = isTopOrLeft ? 1 : -1;

      let translationX;
      let translationY;
      if (vertical) {
        translationX = icon._translateRise * riseDirection;
        translationY = icon._translate;
      } else {
        translationX = icon._translate;
        translationY = icon._translateRise * riseDirection;
      }

      //-------------------
      // animate position
      //-------------------
      // High-performance Exponential Easing (LERP) for buttery-smooth and snappy transitions
      {
        let baseLerpFactor = 0.42 * slowDown; // 42% distance closed per 16.6ms frame (blazing fast!)
        let factor = 1.0 - Math.pow(1.0 - baseLerpFactor, dt / 16.6);

        // Handle edge boundary cases where dt is massive or invalid
        if (isNaN(factor) || factor > 1.0) factor = 1.0;
        if (factor < 0.0) factor = 0.0;
        // the very first frame puts everything where it belongs
        if (snap) factor = 1.0;

        let goalX = translationX;
        let goalY = translationY;
        translationX = icon._icon.translationX + (translationX - icon._icon.translationX) * factor;
        translationY = icon._icon.translationY + (translationY - icon._icon.translationY) * factor;
        // frames keep coming until every icon has arrived
        if (Math.abs(goalX - translationX) > SETTLE_EPSILON || Math.abs(goalY - translationY) > SETTLE_EPSILON) {
          settling = true;
        }
      }

      if (dock.extension.animation_fps > 0) {
        icon._icon.translationX = translationX;
        icon._icon.translationY = translationY;
      } else {
        //! retain this for smoothness at high fps
        icon._icon.translationX =
          (icon._icon.translationX + translationX * 3) / 4;
        icon._icon.translationY =
          (icon._icon.translationY + translationY * 3) / 4;
      }

      // A running bounce sets _bounce on each of its frames, before or after
      // this one depending on which timer subscriber came first; only once
      // none has run since the last frame is its offset cleared. The flag is
      // consumed below, after the renderer has seen it.
      if (icon._appwell) {
        didBounce = icon._appwell._bounce;
        if (!didBounce) icon._appwell.translationY = 0;
      }
    });

    if (largestIcon && nearestIcon) {
      hoveredIcon = largestIcon;
      dock._hoveredIcon = hoveredIcon;
      dock._nearestIcon = hoveredIcon;
    }

    //--------------
    // renderer
    //--------------
    animateIcons.forEach((icon) => {
      if (!icon._icon) return;
      // dock.renderArea.opacity = 100;
      {
        let icon_name = icon._icon.icon_name;
        let app_name =
          icon._appwell?.app?.app_info?.get_id()?.replace('.desktop', '') ??
          null;
        let gicon = null;

        // override icons here
        if (dock.extension.icon_map || dock.extension.app_map) {
          // override via icon name
          if (
            dock.extension.icon_map_cache &&
            dock.extension.icon_map_cache[icon_name]
          ) {
            gicon = dock.extension.icon_map_cache[icon_name];
          }
          if (
            !gicon &&
            dock.extension.icon_map &&
            dock.extension.icon_map[icon_name]
          ) {
            icon_name = dock.extension.icon_map[icon_name];
          }

          // override via app name
          if (
            app_name &&
            dock.extension.app_map_cache &&
            dock.extension.app_map_cache[app_name]
          ) {
            gicon = dock.extension.app_map_cache[app_name];
          }
          if (
            !gicon &&
            dock.extension.app_map &&
            app_name &&
            dock.extension.app_map[app_name]
          ) {
            icon_name = dock.extension.app_map[app_name];
          }
        }

        icon._renderer = this._renderers[icon._idx];
        // Renderers are pooled by position: when an item is removed, the
        // ones after it take over their neighbour's renderer. St.Icon keeps
        // showing the old image until the new one has loaded (a frame or more
        // for file icons, e.g. the glass Trash), so drop it first.
        if (icon._renderer._icon && icon._renderer._icon !== icon._icon) {
          icon._renderer.gicon = null;
        }
        icon._renderer._icon = icon._icon;
        icon._renderer.set_style_class_name('');

        if (icon._appwell?._bounce) {
          icon._appwell._bounce = false;
        } else {
          icon._renderer.translationY = 0;
        }

        let renderer = icon._renderer;
        if (gicon) {
          // apply override
          renderer.gicon = gicon;

          // replace PNG with override SVG
          if (icon._icon.gicon && icon._icon.gicon.file && gicon) {
            icon._icon.gicon = gicon;
          }
        } else {
          if (icon_name) {
            renderer.icon_name = icon_name;
          } else {
            if (icon._icon.gicon) {
              // Directly assign the icon's gicon to the renderer (fixed in #issue 188)
              renderer.gicon = icon._icon.gicon;
            }
          }
        }

        //-------------------
        // size correction: opaque bbox measured once per icon (normalizer)
        //-------------------
        let unscaledIconSize = dock._iconSizeScaledDown * scaleFactor;
        // texture is sampled down only: it covers the largest magnified size
        // in steps of 16 so a small layout change does not reload every texture
        let baseSize = Math.max(
          32 * (dock.extension.icon_quality || 1),
          Math.ceil((unscaledIconSize * scaleAtMax) / 16) * 16
        );
        let normSrc = gicon || icon_name || icon._icon.gicon;
        if (
          renderer._normSrc !== normSrc ||
          renderer._normBase !== baseSize ||
          renderer._normVersion !== this._normalizer.version
        ) {
          renderer._normSrc = normSrc;
          renderer._normBase = baseSize;
          renderer._normVersion = this._normalizer.version;
          renderer._norm = this._normalizer.get(normSrc, baseSize);
        }
        // eased in: a measurement lands a few frames after the icon appears
        let norm = renderer._norm || IDENTITY_NORMALIZATION;
        let appliedK = easeToward(renderer._appliedK ?? 1, norm.k);
        let appliedDx = easeToward(renderer._appliedDx ?? 0, norm.dx);
        let appliedDy = easeToward(renderer._appliedDy ?? 0, norm.dy);
        renderer._appliedDx = appliedDx;
        renderer._appliedDy = appliedDy;
        icon._contentFill = easeToward(icon._contentFill ?? 1, norm.fill);

        //-------------------
        // animate scaling at renderer
        //-------------------
        let targetSize = unscaledIconSize * icon._targetScale;
        // slot size the renderer showed last frame, without the correction
        let currentSize =
          (renderer.icon_size * renderer.scaleX) / (renderer._appliedK || 1);
        {
          let dst = targetSize - currentSize;
          let mag = Math.abs(dst);
          let dir = Math.sign(dst);
          let accel = 0;
          let pixelOverTime = ANIM_SIZE_PER_SEC * slowDown;
          let deltaSize = pixelOverTime * dir * dt;
          let appliedSize = deltaSize;
          appliedSize += accel;
          if (Math.abs(appliedSize) > mag) {
            appliedSize = dst * 0.5;
          }
          targetSize = currentSize + appliedSize;
          icon._deltaSize = appliedSize;
          icon._targetSize = targetSize;
        }
        // compute icon scale based on size
        icon._scale = targetSize / unscaledIconSize;

        if (renderer.icon_size != baseSize) {
          renderer.set_size(baseSize, baseSize);
          renderer.set_icon_size(baseSize);
        }
        renderer._appliedK = appliedK;
        let scaleToTarget = (targetSize * appliedK) / baseSize;
        renderer.set_scale(scaleToTarget, scaleToTarget);

        let p = icon.get_transformed_position();
        let adjustX = icon.width / 2 - targetSize / 2;
        let adjustY = icon.height / 2 - targetSize / 2;

        if (targetSize > icon.height) {
          let rise = (targetSize - icon.height) * 0.5;
          if (vertical) {
            adjustX += rise * (dock._position == 'left' ? 1 : -1);
          } else {
            adjustY += rise * (dock._position == 'bottom' ? -1 : 1);
          }
        }

        //-------------------
        // commit position
        //-------------------
        if (!isNaN(p[0]) && !isNaN(p[1])) {
          let iconContainer = icon._icon.get_parent();
          // iconContainer can be null when dragging icons
          if (iconContainer) {
            if (vertical) {
              iconContainer.translationX = adjustX / 2;
            } else {
              iconContainer.translationY = adjustY / 2;
            }

            // physical pixel grid: a fractional phase shimmers while scaling
            let slotX = snapToPixel(
              p[0] + adjustX + icon._icon.translationX,
              pixelScale
            ) - renderOffset[0];
            let slotY = snapToPixel(
              p[1] + adjustY + icon._icon.translationY,
              pixelScale
            ) - renderOffset[1];
            icon._slotX = slotX;
            icon._slotY = slotY;
            icon._slotSize = targetSize;
            renderer.set_position(
              snapToPixel(
                slotX + renderOffset[0] + (targetSize - targetSize * appliedK) / 2 + appliedDx * targetSize,
                pixelScale
              ) - renderOffset[0],
              snapToPixel(
                slotY + renderOffset[1] + (targetSize - targetSize * appliedK) / 2 + appliedDy * targetSize,
                pixelScale
              ) - renderOffset[1]
            );

            // renderer.ease({
            //   x: p[0] + adjustX + icon._icon.translationX - renderOffset[0],
            //   y: ry,
            //   duration: 100,
            //   mode: Clutter.AnimationMode.LINEAR,
            // });

            // renderer.ease({
            //   width: baseSize,
            //   height: baseSize,
            //   icon_size: baseSize,
            //   duration: 200,
            //   mode: Clutter.AnimationMode.LINEAR,
            // });

            renderer.visible = true;
          }
          icon._px = p[0] - renderOffset[0];
          icon._py = p[1] - renderOffset[1];
        }

        let hideLabel = true;

        // label
        if (
          icon === hoveredIcon &&
          // an open stack panel sits where the label would show
          !dock._stackPanel &&
          icon._label &&
          icon._label.text &&
          icon._label.text.length
        ) {
          let tSize = renderer.get_transformed_size();
          // let tPos = icon._icon.get_transformed_position();
          let tPos = renderer.get_transformed_position();
          if (isNaN(tPos[0]) || isNaN(tPos[1])) {
            tPos[0] = 0;
            tPos[1] = 0;
          }
          let sw = !isNaN(tSize[0]) ? tSize[0] : 0;
          let sh = !isNaN(tSize[1]) ? tSize[1] : 0;

          if (this._dwellIcon === icon) {
            this._dwellTick += dt;
            if (this._dwellTick > 450 && icon._targetScale > 1) {
              try {
                hideLabel = false;
                if (icon._label.opacity < 255 - 25) {
                  icon._label.opacity += 25;
                } else {
                  icon._label.opacity = 255;
                }
              } catch (err) {
                // label not ready?
              }
            }
          } else {
            this._dwellTick = 0;
          }
          this._dwellIcon = icon;

          // icon._label.style = 'font-size: 32pt';
          // icon._label.set_scale(0.5, 0.5);
          let lsz = icon._label.get_transformed_size();
          if (!isNaN(lsz[0]) && !isNaN(lsz[1])) {
            icon._label.x = tPos[0] + sw / 2 - lsz[0] / 2;
            icon._label.y = tPos[1] + sh / 2 - lsz[1] / 2;
            if (vertical) {
              if (dock._position == DockPosition.LEFT) {
                icon._label.x += sh / 1.5 + icon._label.width / 2;
              } else {
                icon._label.x -= sh / 1.5 + icon._label.width / 2;
              }
              icon._label.y += 2 * (m.geometry_scale || 1);
            } else {
              if (magnify == 0 || dock._iconSize <= 4) {
                sh *= 1.5;
              }
              if (dock._position == DockPosition.BOTTOM) {
                icon._label.y -= sh / 1.25;
              } else {
                icon._label.y += sh / 1.25;
              }
              icon._label.x += 2 * (m.geometry_scale || 1);
            }
          }
        }

        if (hideLabel && icon._label) {
          icon._label.opacity = 0;
        }

        //! todo... add placeholder opacity when dragging
        renderer.opacity =
          icon._icon == dock._dragged && dock._dragging ? 75 : 255;
      }



      // badges
      //! ***badge location at scaling is messed up***
      let badge = this._badges[icon._idx];
      badge.hide();
      if (icon != dock._dragged) {
        let services = dock.extension.services;
        let appId = icon._appwell?.app.get_id();
        let noticesCount = (appId && services._appNotices?.[appId]?.count) || 0;
        // LauncherEntry count wins when the app shows one: apps like Telegram
        // know their unread total better than the sum of their banners, and
        // adding both would count each message twice.
        let entry = appId ? services.launcherEntry(appId) : null;
        if (entry?.countVisible) noticesCount = entry.count;
        let progress = entry?.progressVisible ? entry.progress : -1;
        let style =
          dock.extension.notification_badge_style_options[
            dock.extension.notification_badge_style
          ] || 'default';
        // 'default' is the "None" style: the user asked for nothing drawn on
        // the icons, so neither the count nor the LauncherEntry progress pill
        if (style == 'default') {
          noticesCount = 0;
          progress = -1;
        }
        if (badge && (noticesCount > 0 || progress >= 0)) {
          badge.update(icon, {
            noticesCount,
            progress,
            style,
            extension: dock.extension,
            dock,
          });

          badge.width = icon._renderer.width * icon._renderer.scaleX;
          badge.height = badge.width;
          badge.x = icon._renderer.x;
          badge.y = icon._renderer.y;

          badge.set_scale(icon._scale, icon._scale);
          badge.show();
        }
      }

      // dots
      //! ***dot requires a little more aligning at dock position other than bottom***
      let dots = this._dots[icon._idx];
      dots.hide();
      if (
        icon != dock._dragged &&
        icon._appwell &&
        icon._appwell.app &&
        icon._appwell.app.get_n_windows
      ) {
        let appCount = dock.getAppWindowsFiltered(icon._appwell.app).length;
        // appCount = 1;
        if (dots && appCount > 0 && icon._slotSize > 0) {
          dots.update(icon, {
            appCount,
            position: dock._position,
            vertical,
            extension: dock.extension,
            dock,
          });
          dots.show();
        }
      }

      // custom icons
      if (dock.extension.services) {
        dock.extension.services.updateIcon(icon, {
          scaleFactor,
          iconSize,
          dock,
        });
      }

      // minimized-window tiles draw a window clone over the renderer
      icon._minimizedTile?.sync(icon);
    });

    this._placeSeparators(dock, thickness, vertical, iconSize * 0.75 * scaleFactor, renderOffset);

    let targetX = 0;
    let targetY = 0;
    if (dock._hidden && dock.extension.autohide_dash) {
      if (isWithin) {
        dock.slideIn();
      }
    }

    const edgeDirectionMultiplier =
      dock._position == DockPosition.BOTTOM ||
      dock._position == DockPosition.RIGHT
        ? 1
        : -1;

    // if (!animated && !dock._hidden && dock.extension.peek_hidden_icons) {
    //   edge_distance = -dock._iconSizeScaledDown * scaleFactor / 1.5;
    // }

    //-------------------
    // animate slide in slide out
    //-------------------
    if (dock._hidden) {
      if (vertical) {
        if (dock._position == DockPosition.LEFT) {
          targetX =
            -(dock._background.width + edge_distance * -edgeDirectionMultiplier * 2) * scaleFactor;
        } else {
          targetX =
            (dock._background.width - edge_distance * -edgeDirectionMultiplier * 2) * scaleFactor;
        }
      } else {
        if (dock._position == DockPosition.BOTTOM) {
          targetY =
            (dock._background.height - edge_distance * -edgeDirectionMultiplier * 2) * scaleFactor;
        } else {
          targetY =
            -(dock._background.height + edge_distance * -edgeDirectionMultiplier * 2) * scaleFactor;
        }
      }
    }

    // edge
    if (vertical) {
      targetX += edge_distance * -edgeDirectionMultiplier;
    } else {
      targetY += edge_distance * -edgeDirectionMultiplier;
    }

    // dock translation
    {
      let autohide_slowDown = 1;
      let translationX = targetX;
      let translationY = targetY;
      let speed =
        ((150 + 300 * dock.extension.autohide_speed * scaleFactor) / 1000) *
        autohide_slowDown;

      let v1 = new Vector([targetX, targetY, 0]);
      let v2 = new Vector([dock.dash.translationX, dock.dash.translationY, 0]);
      let dst = v1.subtract(v2);
      let mag = dst.magnitude();
      if (mag > 0) {
        // let ndst = dst.normalize();
        let v3 = v2.add(dst.multiplyScalar(speed));
        translationX = v3.x;
        translationY = v3.y;
      }

      dock.dash.translationX = translationX;
      dock.dash.translationY = translationY;
    }

    // background
    {
      dock._background.style = dock.extension._backgroundStyle;
      dock._background.update({
        first,
        last,
        iconSize: dock._iconSizeScaledDown,
        scaleFactor,
        position: dock._position,
        vertical: vertical,
        panel_mode: dock.extension.panel_mode,
        dock,
      });

      // allied areas
      //! this should be at the layout -- make independent of background
      // struts
      if (vertical) {
        dock.struts.width =
          dock._background.width +
          iconSize * 0.2 * scaleFactor +
          edge_distance -
          dock._background._padding * scaleFactor;
        dock.struts.height = dock.height;

        if (dock.extension.autohide_dash) {
          dock.struts.y = dock._background.y + dock._monitor.y;
          dock.struts.height = dock._background.height;
          // X11 .. click through fix ..
          // dock.struts.width *= 1.25;
        }

        // dock.struts.y = dock.y;
        if (dock._position == DockPosition.RIGHT) {
          dock.struts.x = dock.x + dock.width - dock.struts.width;
        } else {
          dock.struts.x = dock.x;
        }
      } else {
        dock.struts.width = dock.width;
        dock.struts.height =
          dock._background.height +
          iconSize * 0.2 * scaleFactor +
          edge_distance -
          dock._background._padding * scaleFactor;

        if (dock.extension.autohide_dash) {
          dock.struts.x = dock._background.x + dock._monitor.x;
          dock.struts.width = dock._background.width;
          // X11 .. click through fix ..
          // dock.struts.height *= 1.25;
        }

        // dock.struts.x = dock.x;
        if (dock._position == DockPosition.BOTTOM) {
          dock.struts.y = dock.y + dock.height - dock.struts.height;
        } else {
          dock.struts.y = dock.y;
        }
      }

      dock._updateTransparenies();
      dock._syncGlass();
    }

    dock.struts.visible = !dock._hidden;
    dock.dash.opacity = 255;

    //---------------------
    // animate the list
    //---------------------
    if (dock._list && dock._list.visible && dock._list._target) {
      dock._list.animate(dt);
      didScale = true;
    }

    if (didFadeIn || didScale || dock._dragging || didBounce || settling) {
      dock.autohider._debounceCheckHide();
      dock._debounceEndAnimation();
    }

    dock.extension.integrations.bms_update_size(this);
  }

  // hops: number of bounces; defaults to the animation-bounce-frequency pick
  bounceIcon(appwell, hops = null) {
    let dock = this.dock;
    let app_id = Compat.getAppId(appwell);
    // lets other triggers for the same launch (dock click, then the app's
    // STARTING state) tell that a bounce is already under way
    appwell._bounceAt = Date.now();

    // let scaleFactor = dock.getMonitor().geometry_scale;
    //! why not scaleFactor?
    let travel =
      (dock._iconSize / 3) *
      ((0.25 + dock.extension.animation_bounce_height) * 1.5);
    // * scaleFactor;
    appwell.translation_y = 0;

    const getTarget = (app_id) => {
      // disabled: the pool is destroyed and container._renderer is stale
      if (!this._target) return [null, null];
      if (dock._dragging) return [null, null];
      let icons = dock._findIcons();
      let icon = icons.find((icon) => {
        return icon._appwell && Compat.getAppId(icon._appwell) === app_id;
      });
      if (!icon || !icon._appwell) {
        return [null, null];
      }
      return [icon._appwell.get_parent(), icon._appwell];
    };

    const translateDecor = (container, appwell) => {
      try {
        if (!container._icon) return;
        if (container._renderer) {
          container._renderer.translationY = appwell.translationY;
        }
        if (container._image) {
          container._image.translationY = appwell.translationY;
        }
        if (container._badge) {
          container._badge.translationY = appwell.translationY;
        }
        if (container._label) {
          container._label.opacity = 0;
        }
      } catch (err) {
        console.log(err);
      }
    };

    let t = 250;
    let _frames = [
      {
        _duration: t,
        _func: (f, s) => {
          let res = Linear.easeNone(f._time, 0, travel, f._duration);
          let [container, appwell] = getTarget(app_id);
          if (!appwell) return;
          try {
            appwell._bounce = true;
            if (dock.isVertical()) {
              appwell.translation_x =
                dock._position == DockPosition.LEFT ? res : -res;
              if (container._renderer) {
                container._renderer.translationX = appwell.translationX;
              }
            } else {
              appwell.translation_y =
                dock._position == DockPosition.BOTTOM ? -res : res;
              if (container._renderer) {
                container._renderer.translationY = appwell.translationY;
              }
            }
          } catch (err) {
            console.log(err);
          }
          translateDecor(container, appwell);
        },
      },
      {
        _duration: t * 3,
        _func: (f, s) => {
          let res = Bounce.easeOut(f._time, travel, -travel, f._duration);
          let [container, appwell] = getTarget(app_id);
          if (!appwell) return;
          try {
            appwell._bounce = true;
            if (dock.isVertical()) {
              appwell.translation_x = appwell.translation_x =
                dock._position == DockPosition.LEFT ? res : -res;
              if (container._renderer) {
                container._renderer.translationX = appwell.translationX;
              }
            } else {
              appwell.translation_y =
                dock._position == DockPosition.BOTTOM ? -res : res;
              if (container._renderer) {
                container._renderer.translationY = appwell.translationY;
              }
            }
          } catch (err) {
            console.log(err);
          }
          translateDecor(container, appwell);
        },
      },
    ];

    let frames = [];
    let count =
      hops ?? [3, 1, 2, 3][dock.extension.animation_bounce_frequency || 0];
    for (let i = 0; i < count; i++) {
      _frames.forEach((b) => {
        frames.push({
          ...b,
        });
      });
    }

    const bounce = dock.extension._hiTimer.runAnimation([
      ...frames,
      {
        _duration: 10,
        _func: (f, s) => {
          let [container, appwell] = getTarget(app_id);
          if (!appwell) return;
          try {
            appwell._bounce = true;
            appwell.translation_x = 0;
            appwell.translation_y = 0;
            if (container._renderer) {
              container._renderer.translationX = 0;
            }
          } catch (err) {
            console.log(err);
          }
          translateDecor(container, appwell);
        },
      },
      {
        _duration: 10,
        _func: (f, s) => {
          let [container, appwell] = getTarget(app_id);
          if (!appwell) return;
          try {
            appwell._bounce = false;
          } catch (err) {
            console.log(err);
          }
        },
      },
    ]);
    // only finished ones leave the timer on their own
    this._bounces ??= new Set();
    this._bounces.forEach((b) => {
      if (b._time >= b._duration) this._bounces.delete(b);
    });
    this._bounces.add(bounce);
  }

  // for the dock's _cancelTimers(): a bounce drives the dock's icons
  cancelBounces() {
    this._bounces?.forEach((b) => b._timer?.cancel(b));
    this._bounces?.clear();
  }
};
