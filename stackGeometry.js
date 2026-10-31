'use strict';

// Where a stack's popover stands, as pure functions (no gi:// imports) so
// tests/stack_geometry_check.js runs them under plain gjs. stackPanel.js feeds
// them the dock's background rect, the monitor's work area and the icon, all
// in stage pixels.

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(v, hi));
}

export function isVertical(position) {
  return position === 'left' || position === 'right';
}

// The pointer's tip line (a stage coordinate across the dock's axis) and the
// room between the pointer's base and the far screen edge, for a dock at
// `position`. `bg` is the dock background's {x, y, w, h}, `wa` the work area.
export function anchorFor(position, bg, wa, { gap, depth, margin }) {
  switch (position) {
    case 'top': {
      const tip = bg.y + bg.h + gap;
      return { tip, room: wa.y + wa.height - margin - (tip + depth) };
    }
    case 'left':
      return { tip: bg.x + bg.w + gap, room: wa.height - 2 * margin };
    case 'right':
      return { tip: bg.x - gap, room: wa.height - 2 * margin };
    default: {
      const tip = bg.y - gap;
      return { tip, room: tip - depth - (wa.y + margin) };
    }
  }
}

// The popover's top-left corner: on the screen side of the tip, centred on
// the icon centre (cx, cy) but kept on the work area / monitor. `size` is
// {w, h}.
export function originFor(position, { tip, depth, size, icon, wa, monitor, margin }) {
  if (isVertical(position)) {
    return {
      x: position === 'left' ? tip + depth : tip - depth - size.w,
      y: clamp(icon.y - size.h / 2, wa.y + margin, wa.y + wa.height - margin - size.h),
    };
  }
  return {
    x: clamp(icon.x - size.w / 2, monitor.x + margin, monitor.x + monitor.width - margin - size.w),
    y: position === 'top' ? tip + depth : tip - depth - size.h,
  };
}

// Unit direction from the pointer's tip into the panel.
export function directionFor(position) {
  return {
    dx: position === 'left' ? 1 : position === 'right' ? -1 : 0,
    dy: position === 'top' ? 1 : position === 'bottom' ? -1 : 0,
  };
}
