'use strict';

import * as Compat from './compat.js';
import St from 'gi://St';

import { Dot } from './apps/dot.js';
import { DockPosition } from './dock.js';
import { DockLayout } from './dockLayout.js';

import { smoothScaling } from './textureFilters.js';
import { IconNormalizer } from './iconNormalizer.js';
import { DockItemDotsOverlay, DockItemBadgeOverlay } from './dockItems.js';
import { live } from './probe.js';
import { outward } from './iconGeometry.js';
import { animatedEdgeDistance } from './indicatorSpacing.js';
import {
  advancePresence,
  easedOffset,
  isSettling,
  positionEase,
  presenceOpenStep,
  textureBaseSize,
} from './animatorMath.js';
import { BounceRun, bounceTravel, zeroTranslation } from './animatorBounce.js';
import { fadeDockIn, resolvePointer, slideDash, updateBackground } from './animatorDash.js';
import { LabelDwell, labelShown, updateLabel } from './animatorLabel.js';
import {
  applySource,
  bindRenderer,
  easeNormalization,
  newIconSource,
  placeRenderer,
  resolveSource,
  sizeRenderer,
} from './animatorIcon.js';
import { newBadgeData, newDotsData, updateBadge, updateDots } from './animatorOverlays.js';

const ANIM_ICON_RAISE = 0.5;
const ANIM_ICON_SCALE = 1.5;

const DOT_CANVAS_SIZE = 96;

// non-SVG image files are not scaled by the animator, for performance
function isRasterFileIcon(gicon) {
  return (
    !!gicon &&
    gicon.file != null &&
    !gicon.file?.get_path()?.toLowerCase().endsWith('svg')
  );
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
    // which edge the dock is on, see edge()
    this._edge = { vertical: false, left: false, right: false, top: false, bottom: false };
    // the state of the frame being drawn, refilled by _beginRun()
    this._run = {
      dock: null,
      dt: 0,
      m: null,
      px: 0,
      py: 0,
      vertical: false,
      edge: this._edge,
      scaleFactor: 1,
      iconSize: 0,
      thickness: 0,
      isWithin: false,
      animated: false,
      snap: false,
      settling: false,
      didBounce: false,
      didScale: false,
      edgeDistance: 0,
      magnify: 0,
      rise: 0,
      scaleAtMax: 1,
      slowDown: 1,
      pixelScale: 1,
      renderOffset: null,
      nearest: null,
      hovered: null,
      largest: null,
      largestSize: -1,
      adjust: { x: 0, y: 0 },
      dashTarget: { x: 0, y: 0 },
    };
    this._source = newIconSource();
    this._badgeData = newBadgeData();
    this._dotsData = newDotsData();
    this._dwell = new LabelDwell();
  }

  // the layout of the last frame: separator slots, measured spans
  get layout() {
    return this._layout;
  }

  /**
   * Which edge the dock is on (`vertical`, `left`, `right`, `top`, `bottom`).
   * One object, refilled on every call: read it, do not keep it.
   */
  edge() {
    const dock = this.dock;
    const edge = this._edge;
    edge.vertical = dock.isVertical();
    edge.left = dock._position === DockPosition.LEFT;
    edge.right = dock._position === DockPosition.RIGHT;
    edge.top = dock._position === DockPosition.TOP;
    edge.bottom = dock._position === DockPosition.BOTTOM;
    return edge;
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

  // hides the renderer, dots and badge of the slots in [from, to), at rest: the
  // overlays follow the renderer's translation, so a bounce cut short must not
  // leave its offset on a slot that is shown again later
  _hideSlots(from, to) {
    for (let i = from; i < to; i++) {
      this._renderers[i].visible = false;
      this._dots[i].visible = false;
      this._badges[i].visible = false;
      zeroTranslation(this._renderers[i]);
    }
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

    this._hideSlots(dock._icons.length, this._renderers.length);

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

    // the platter reaches deeper towards the screen edge than the dash does
    let [ox, oy] = outward(dock._position);
    let lean = dock._platterCentreShift || 0;
    layout.sepActors.forEach((actor, j) => {
      let size = layout.sepFitSize[j];
      // across the dock the line stays centred on the platter (its CENTER
      // alignment in the dash slot, see Dock._inspectIcon)
      let shift = layout.sepFitCenter[j] - layout.sepRest[j];
      if (vertical) {
        actor.translationX = ox * lean;
        actor.translationY = shift;
        actor.width = crossSize;
        actor.height = size;
      } else {
        actor.translationX = shift;
        actor.translationY = oy * lean;
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

    if (!this._readyToDraw(dock)) return;
    const didFadeIn = fadeDockIn(dock, dt);

    const run = this._beginRun(dock, dt);
    // Only the items measurable NOW take part in this frame; nothing is read
    // from an earlier one (dockLayout.js).
    // (A separator hidden for thickness 0 needs no restoring here: changing
    // the thickness recreates the docks, see extension.js.)
    const layout = this._layout;
    const measured = layout.measure(dock._dashItems, run.vertical, run.thickness > 0);
    // unmeasured icons have no renderer this frame
    this._hideSlots(measured, dock._icons.length);
    if (!measured) return;
    const icons = layout.icons;

    // An icon the dock has not seen before opens its slot over time (the dock
    // widens as it does); what is there at startup is open at once.
    run.snap = !this._seen;
    run.settling = this._openSlots(dock, icons, dt, run.snap);
    this._seen = true;

    this._arrangeIcons(run, icons);
    if (!this._measureRenderArea(run)) return;
    this._easeIcons(run, icons);
    this._renderIcons(run, icons);
    this._placeSeparators(
      dock, run.thickness, run.vertical, run.iconSize * 0.75 * run.scaleFactor, run.renderOffset
    );

    slideDash(dock, run);
    updateBackground(dock, run, icons[0], icons[icons.length - 1]);
    dock.struts.visible = !dock._hidden;
    dock.dash.opacity = 255;
    this._finishFrame(run, didFadeIn);
  }

  // The dock is laid out, has icons and a pool to draw them on.
  _readyToDraw(dock) {
    if (dock._needsLayout && !dock.relayout()) return false;

    dock._snapToContainerEdge(dock, dock.dash, true);

    if (!dock._icons || !dock._icons.length) return false;
    if (!dock.renderArea?.has_allocation()) return false;
    return this._precreateResources(dock);
  }

  // Refills the state of this frame: the pointer, the dock's edge and scale.
  _beginRun(dock, dt) {
    const run = this._run;
    run.dock = dock;
    run.dt = dt;
    run.m = dock.getMonitor();
    // simulated or transformed pointers
    [run.px, run.py] = resolvePointer(dock, global.get_pointer());
    run.vertical = dock.isVertical();
    run.edge = this.edge();

    let isWithin = dock._isWithinDash([run.px, run.py]);
    if (run.m.inFullscreen) {
      isWithin = false;
    }
    run.animated = isWithin;
    dock.animated = isWithin;
    run.isWithin = isWithin;

    run.iconSize = dock._iconSizeScaledDown;
    run.scaleFactor = dock._scaleFactor;
    run.thickness = dock.extension.separator_thickness || 0;
    run.settling = false;
    run.didBounce = false;
    run.didScale = false;
    return run;
  }

  // One slot of the dock opening; returns whether it still is.
  _openSlot(dock, icon, idx, openStep, snap) {
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
    let opening = false;
    if (icon._presence < 1) {
      icon._presence = advancePresence(icon._presence, openStep);
      opening = true;
    }
    this._layout.iconPresence[idx] = icon._presence;
    return opening;
  }

  // Opens the slots of icons the dock has not seen before; returns whether any is
  // still opening.
  _openSlots(dock, icons, dt, snap) {
    const openStep = presenceOpenStep(dt);
    let opening = false;
    for (let idx = 0; idx < icons.length; idx++) {
      if (this._openSlot(dock, icons[idx], idx, openStep, snap)) opening = true;
    }
    return opening;
  }

  // Fills the layout's frame input; `noAnimation` freezes the magnification.
  _fillFrame(run, noAnimation) {
    const { dock, m } = run;
    const ext = dock.extension;
    const frame = this._frame;
    frame.iconSize = run.iconSize * run.scaleFactor;
    // base resting padding between items
    const spacingMargin = 8.0 * (ext.icon_spacing || 0.0);
    frame.padding = 2.0 * spacingMargin + 2.0;
    frame.separatorSize = run.thickness + 0.5;
    frame.pointerPrimary = run.vertical ? run.py : run.px;
    frame.pointerSecondary = run.vertical ? run.px : run.py;
    // Keep magnification independent from spread
    frame.threshold = (run.iconSize + 10) * 2.5 * run.scaleFactor;
    frame.scaleAtMax = run.scaleAtMax;
    frame.curveType = ext.animation_rise_curve ?? 0;
    frame.noAnimation = noAnimation;
    // an open stack panel's pointer aims at the icon at rest; magnifying
    // under the panel would also push icons into it
    frame.suppressHover = m.inFullscreen || !!dock._stackPanel;
  }

  // Packs the icons and separators (dockLayout.js) around the pointer and gives
  // every icon its offset, scale and rise for this frame.
  _arrangeIcons(run, icons) {
    const { dock } = run;
    const ext = dock.extension;
    const layout = this._layout;

    run.edgeDistance = dock._edge_distance;
    run.rise = ext.animation_rise * ANIM_ICON_RAISE;
    run.magnify = ext.animation_magnify * ANIM_ICON_SCALE;
    if (run.animated) {
      run.edgeDistance = animatedEdgeDistance(run.edgeDistance, dock._outerGrowth);
    }
    run.scaleAtMax = 1.0 + run.magnify;

    // disables the magnification while dragging
    this._fillFrame(run, !ext.animate_icons_unmute || !!dock._dragging);
    layout.compute(this._frame);

    run.isWithin = layout.isWithin;
    dock.animated = run.isWithin;

    const nearest = layout.peak >= 0 ? icons[layout.peak] : null;
    dock._nearestIcon = nearest;
    dock._hoveredIcon = nearest;
    run.nearest = nearest;
    run.hovered = nearest;
    run.didScale = nearest !== null;

    icons.forEach((icon, idx) => this._arrangeIcon(run, icon, idx));
    dock._hoveredIcon = nearest;
  }

  _arrangeIcon(run, icon, idx) {
    const layout = this._layout;
    // Position the Clutter actor along the dock relative to its resting slot
    icon._translate = layout.iconDelta[idx];

    // The Dash re-lays itself out when an item comes or goes: what is drawn
    // stays where it was and the easing below glides it to the new layout,
    // so the dock width animates instead of jumping.
    const drift = layout.iconDrift[idx];
    if (drift) {
      if (run.vertical) {
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
    const sz = run.iconSize * (originalScale - 1) * run.scaleFactor;
    icon._translateRise = sz * run.rise * presence;

    // Apply scale directly to the icon image texture
    if (!isRasterFileIcon(icon._icon.gicon)) {
      icon._icon.set_scale(originalScale, originalScale);
    }
  }

  // Where the render area is on the stage; false while that is unknown.
  _measureRenderArea(run) {
    const { dock } = run;
    const renderOffset = dock.renderArea.get_transformed_position();
    run.pixelScale = dock._monitor?.geometry_scale || 1;
    if (!renderOffset || isNaN(renderOffset[0]) || isNaN(renderOffset[1])) {
      return false;
    }
    run.renderOffset = renderOffset;
    return true;
  }

  // Glides every icon toward the offset the layout gave it, and notes the largest.
  _easeIcons(run, icons) {
    const { dock } = run;
    run.slowDown = dock.extension._config.speed_up || 1;
    if (!run.didScale) {
      run.slowDown = 0.5;
    }

    run.largest = null;
    run.largestSize = -1;
    // High-performance exponential easing for smooth and snappy transitions
    const factor = positionEase(run.dt, run.slowDown, run.snap);
    icons.forEach((icon) => this._easeIcon(run, icon, factor));

    if (run.largest && run.nearest) {
      run.hovered = run.largest;
      dock._hoveredIcon = run.hovered;
      dock._nearestIcon = run.hovered;
    }
  }

  _easeIcon(run, icon, factor) {
    if (!icon._icon) return;

    icon._scale = icon._targetScale;

    if (run.largestSize == -1 || run.largestSize < icon._scale) {
      run.largest = icon;
      run.largestSize = icon._scale;
    }

    const riseDirection = run.edge.top || run.edge.left ? 1 : -1;
    const goalX = run.vertical ? icon._translateRise * riseDirection : icon._translate;
    const goalY = run.vertical ? icon._translate : icon._translateRise * riseDirection;
    const translationX = easedOffset(icon._icon.translationX, goalX, factor);
    const translationY = easedOffset(icon._icon.translationY, goalY, factor);
    // frames keep coming until every icon has arrived
    if (isSettling(goalX, goalY, translationX, translationY)) {
      run.settling = true;
    }

    if (run.dock.extension.animation_fps > 0) {
      icon._icon.translationX = translationX;
      icon._icon.translationY = translationY;
    } else {
      //! retain this for smoothness at high fps
      icon._icon.translationX = (icon._icon.translationX + translationX * 3) / 4;
      icon._icon.translationY = (icon._icon.translationY + translationY * 3) / 4;
    }

    // A running bounce sets _bounce on each of its frames, before or after
    // this one depending on which timer subscriber came first; only once
    // none has run since the last frame is its offset cleared. The flag is
    // consumed below, after the renderer has seen it.
    if (icon._appwell) {
      run.didBounce = icon._appwell._bounce;
      if (!run.didBounce) zeroTranslation(icon._appwell);
    }
  }

  // Draws every icon on its renderer, with its badge and dots.
  _renderIcons(run, icons) {
    icons.forEach((icon) => this._renderIcon(run, icon));
  }

  _renderIcon(run, icon) {
    if (!icon._icon) return;
    const { dock } = run;
    const slot = icon._idx;

    this._drawIcon(run, icon);
    updateBadge(this._badges[slot], icon, dock, this._badgeData);
    updateDots(this._dots[slot], icon, dock, run.vertical, this._dotsData);

    // custom icons
    if (dock.extension.services) {
      dock.extension.services.updateIcon(icon, {
        scaleFactor: run.scaleFactor,
        iconSize: run.iconSize,
        dock,
      });
    }

    // minimized-window tiles draw a window clone over the renderer
    icon._minimizedTile?.sync(icon);
  }

  // The renderer of `icon`: its image, size, slot and label.
  _drawIcon(run, icon) {
    const { dock } = run;
    const source = this._source;
    resolveSource(dock, icon, source);

    const renderer = this._renderers[icon._idx];
    icon._renderer = renderer;
    bindRenderer(renderer, icon);
    applySource(renderer, icon, source);

    const unscaledIconSize = dock._iconSizeScaledDown * run.scaleFactor;
    const baseSize = textureBaseSize(
      unscaledIconSize, run.scaleAtMax, dock.extension.icon_quality
    );
    const appliedK = easeNormalization(this._normalizer, renderer, icon, source, baseSize);
    const targetSize = sizeRenderer(run, icon, renderer, unscaledIconSize, baseSize, appliedK);
    placeRenderer(run, icon, renderer, targetSize, appliedK);

    let hideLabel = true;
    if (labelShown(dock, icon, run.hovered)) {
      hideLabel = updateLabel(this._dwell, dock, icon, renderer, run);
    }
    if (hideLabel && icon._label) {
      icon._label.opacity = 0;
    }

    //! todo... add placeholder opacity when dragging
    renderer.opacity = icon._icon == dock._dragged && dock._dragging ? 75 : 255;
  }

  // Keeps the dock drawing while anything is still moving.
  _finishFrame(run, didFadeIn) {
    const { dock } = run;
    //---------------------
    // animate the list
    //---------------------
    if (dock._list && dock._list.visible && dock._list._target) {
      dock._list.animate(run.dt);
      run.didScale = true;
    }

    if (didFadeIn || run.didScale || dock._dragging || run.didBounce || run.settling) {
      dock.autohider._debounceCheckHide();
      dock._debounceEndAnimation();
    }

    dock.extension.integrations.bms_update_size(this);
  }

  // hops: number of bounces; defaults to the animation-bounce-frequency pick
  bounceIcon(appwell, hops = null) {
    let dock = this.dock;
    const appId = Compat.getAppId(appwell);
    // lets other triggers for the same launch (dock click, then the app's
    // STARTING state) tell that a bounce is already under way
    appwell._bounceAt = Date.now();
    // a restart: the bounce under way gives way and leaves the icon at rest
    this._endBounces((run) => run.appId === appId);
    zeroTranslation(appwell);

    const count =
      hops ?? [3, 1, 2, 3][dock.extension.animation_bounce_frequency || 0];
    // no hop to run (a frequency outside the list): the timer would take an empty
    // frame list for a subscriber of its own and keep it for good
    if (!(count >= 1)) return;
    const run = new BounceRun(this, appId);
    const bounce = dock.extension._hiTimer.runAnimation(
      run.frames(bounceTravel(dock), count),
      run.settings()
    );
    // only finished ones leave the timer on their own
    this._bounces ??= new Map();
    for (const b of this._bounces.keys()) {
      if (b._time >= b._duration) this._bounces.delete(b);
    }
    this._bounces.set(bounce, run);
  }

  // takes the bounces `matches` picks off the timer and puts their icons at rest
  _endBounces(matches) {
    this._bounces?.forEach((run, bounce) => {
      if (!matches(run)) return;
      bounce._timer?.cancel(bounce);
      run.cancel();
      this._bounces.delete(bounce);
    });
  }

  // for the dock's _cancelTimers(): a bounce drives the dock's icons
  cancelBounces() {
    this._endBounces(() => true);
  }
};
