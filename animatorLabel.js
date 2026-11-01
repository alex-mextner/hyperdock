// The hover label of the icon under the pointer: it fades in once the pointer has
// dwelt on a magnified icon and sits next to the renderer on the side away from
// the docked edge. No Shell imports: the animator passes the actors in.

// the pointer must rest this long (ms) on a magnified icon before its label shows
const DWELL_MS = 450;
const FADE_STEP = 25;

/** Which icon the pointer is dwelling on, and for how long. */
export class LabelDwell {
  constructor() {
    this.icon = null;
    this.ms = 0;
  }
}

/** Whether `icon` is the hovered one and has a label with text to show. */
export function labelShown(dock, icon, hoveredIcon) {
  return (
    icon === hoveredIcon &&
    // an open stack panel sits where the label would show
    !dock._stackPanel &&
    !!icon._label &&
    !!icon._label.text &&
    icon._label.text.length > 0
  );
}

// Counts the dwell on `icon` and fades its label in once it is long enough.
// Returns true while the label stays hidden.
function dwellHidesLabel(dwell, icon, dt) {
  let hide = true;
  if (dwell.icon === icon) {
    dwell.ms += dt;
    if (dwell.ms > DWELL_MS && icon._targetScale > 1) {
      try {
        hide = false;
        const label = icon._label;
        label.opacity = label.opacity < 255 - FADE_STEP ? label.opacity + FADE_STEP : 255;
      } catch {
        // label not ready?
      }
    }
  } else {
    dwell.ms = 0;
  }
  dwell.icon = icon;
  return hide;
}

// moves the label beside the renderer, on the side away from the docked edge
function placeLabel(label, tPos, sw, sh, dock, frame) {
  const { edge, magnify } = frame;
  const geometryScale = frame.m.geometry_scale || 1;
  const lsz = label.get_transformed_size();
  if (isNaN(lsz[0]) || isNaN(lsz[1])) return;
  label.x = tPos[0] + sw / 2 - lsz[0] / 2;
  label.y = tPos[1] + sh / 2 - lsz[1] / 2;
  if (edge.vertical) {
    const gap = sh / 1.5 + label.width / 2;
    label.x += edge.left ? gap : -gap;
    label.y += 2 * geometryScale;
    return;
  }
  const lift = magnify == 0 || dock._iconSize <= 4 ? sh * 1.5 : sh;
  label.y += edge.bottom ? -(lift / 1.25) : lift / 1.25;
  label.x += 2 * geometryScale;
}

/**
 * Updates the label of the hovered `icon`, drawn by `renderer`. Returns true when
 * the label is to be hidden.
 */
export function updateLabel(dwell, dock, icon, renderer, frame) {
  const tSize = renderer.get_transformed_size();
  const tPos = renderer.get_transformed_position();
  if (isNaN(tPos[0]) || isNaN(tPos[1])) {
    tPos[0] = 0;
    tPos[1] = 0;
  }
  const sw = !isNaN(tSize[0]) ? tSize[0] : 0;
  const sh = !isNaN(tSize[1]) ? tSize[1] : 0;
  const hide = dwellHidesLabel(dwell, icon, frame.dt);
  placeLabel(icon._label, tPos, sw, sh, dock, frame);
  return hide;
}
