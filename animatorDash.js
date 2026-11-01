// What the animator does to the dock as a whole each frame, apart from its icons:
// the fade-in, the pointer it reacts to, the dash sliding in and out of its edge
// (autohide, edge distance), the platter behind the icons and the struts that
// reserve the screen space. No Shell imports: the dock is passed in.
import { Vector } from './vector.js';
import { fadeInStep } from './animatorMath.js';

/** Fades a newly shown dock in; returns whether it is still fading. */
export function fadeDockIn(dock, dt) {
  if (!(dock.opacity < 255)) return false;
  dock.opacity += fadeInStep(dock.opacity, dt);
  if (dock.renderArea.opacity < 255 && dock.opacity > 50) {
    dock.renderArea.opacity = dock.opacity;
  }
  return true;
}

// a stack list open on the hovered icon keeps the icons from animating under it
function listIsOpenOnHoveredIcon(dock) {
  return !!(
    dock._list &&
    dock._list.visible &&
    dock._list._box &&
    dock._lastHoveredIcon == dock._list._target
  );
}

/**
 * The pointer position the dock reacts to: `pointer` (a fresh [x, y]) unless a
 * simulated one (tests, the scenario driver) is set.
 */
export function resolvePointer(dock, pointer) {
  let result = pointer;
  if (dock.extension.simulated_pointer) result = [...dock.extension.simulated_pointer];
  if (dock.simulated_pointer) result = [...dock.simulated_pointer];
  // disable icon scale animation upon hovering an item
  if (listIsOpenOnHoveredIcon(dock)) {
    result[1] -= dock._iconSize * dock._scaleFactor;
  }
  return result;
}

// where a hidden dash rests: slid out past its own edge
function hiddenTarget(out, dock, run, direction) {
  const { vertical, edge, scaleFactor, edgeDistance } = run;
  const bg = dock._background;
  const away = edgeDistance * -direction * 2;
  if (vertical) {
    out.x = edge.left ? -(bg.width + away) * scaleFactor : (bg.width - away) * scaleFactor;
  } else {
    out.y = edge.bottom ? (bg.height - away) * scaleFactor : -(bg.height + away) * scaleFactor;
  }
}

// moves the dash a share of the way to (targetX, targetY)
function moveDash(dock, targetX, targetY, scaleFactor) {
  const speed = (150 + 300 * dock.extension.autohide_speed * scaleFactor) / 1000;
  let translationX = targetX;
  let translationY = targetY;

  const from = new Vector([dock.dash.translationX, dock.dash.translationY, 0]);
  const dst = new Vector([targetX, targetY, 0]).subtract(from);
  if (dst.magnitude() > 0) {
    const next = from.add(dst.multiplyScalar(speed));
    translationX = next.x;
    translationY = next.y;
  }

  dock.dash.translationX = translationX;
  dock.dash.translationY = translationY;
}

/** Slides the dash toward where it should be: shown, or hidden behind its edge. */
export function slideDash(dock, run) {
  if (dock._hidden && dock.extension.autohide_dash && run.isWithin) {
    dock.slideIn();
  }

  const direction = run.edge.bottom || run.edge.right ? 1 : -1;
  const target = run.dashTarget;
  target.x = 0;
  target.y = 0;
  if (dock._hidden) hiddenTarget(target, dock, run, direction);

  // edge
  if (run.vertical) {
    target.x += run.edgeDistance * -direction;
  } else {
    target.y += run.edgeDistance * -direction;
  }
  moveDash(dock, target.x, target.y, run.scaleFactor);
}

// the struts reserve the space the dock takes along the screen edge
function updateStruts(dock, run) {
  const { vertical, edge, iconSize, scaleFactor, edgeDistance } = run;
  const bg = dock._background;
  const struts = dock.struts;
  const grow = iconSize * 0.2 * scaleFactor;
  // the dash sits `edgeDistance` off the edge, the platter reaches the
  // lift further (dock._outerGrowth): it is the platter the struts follow
  const gap = edgeDistance - (dock._outerGrowth || 0);
  const autohide = dock.extension.autohide_dash;
  if (vertical) {
    struts.width = bg.width + grow + gap;
    struts.height = dock.height;
    if (autohide) {
      struts.y = bg.y + dock._monitor.y;
      struts.height = bg.height;
    }
    struts.x = edge.right ? dock.x + dock.width - struts.width : dock.x;
  } else {
    struts.width = dock.width;
    struts.height = bg.height + grow + gap;
    if (autohide) {
      struts.x = bg.x + dock._monitor.x;
      struts.width = bg.width;
    }
    struts.y = edge.bottom ? dock.y + dock.height - struts.height : dock.y;
  }
}

/** Redraws the platter behind the icons (from the first to the last) and the struts. */
export function updateBackground(dock, run, first, last) {
  dock._background.style = dock.extension._backgroundStyle;
  dock._background.update({
    first,
    last,
    iconSize: dock._iconSizeScaledDown,
    scaleFactor: run.scaleFactor,
    position: dock._position,
    vertical: run.vertical,
    panel_mode: dock.extension.panel_mode,
    dock,
  });

  updateStruts(dock, run);
  dock._updateTransparenies();
  dock._syncGlass();
}
