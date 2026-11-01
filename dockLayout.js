'use strict';

// Pure 1-D dock layout: no Shell/Clutter imports, so tests/dock_layout_check.js
// runs it under node and gjs. The Animator hands it the dash items once per
// frame; it hands back where every measured icon and separator goes along
// the dock axis (x for a horizontal dock, y for a vertical one).
//
// The dock is a row of nodes. An icon is a node of `iconSize` (magnified by
// its proximity to the pointer); a separator is a node of its own thickness
// that is never magnified. NUM_GHOSTS full-size ghost icon nodes beyond both
// ends give the magnification bell room to fall off.
//
// INVARIANT (separators own a slot): every pair of neighbouring nodes is
// separated by `padding + share` where `share` is the dock-length correction
// (<= 0 or >= 0) clamped so the gap can never go negative. A separator is a
// node like any other, so its rect sits between its two neighbours' rects
// with gap >= 0 on both sides on every frame, whatever the magnification of
// the neighbours. Nothing is derived from the neighbours' translation or a
// tuned offset: the slot is part of the same packing that places the icons.
// Eased frames (icons chase their targets) are covered by fitSeparators().

export const NUM_GHOSTS = 4;
export const SEPARATOR_CLASS = 'dash-separator';

const ICON = 0;
const SEPARATOR = 1;

// a slot moving by more than this many item widths between two frames is a
// jump of the whole dock, not an item coming or going (see measure())
const MAX_DRIFT_ITEMS = 6;

export function getScale(u, xm, R, M, type = 0) {
  const dist = Math.abs(u - xm);
  if (dist >= R) {
    return 1.0;
  }
  const t = 1.0 - dist / R;
  let factor = t;

  if (type === 1) {
    // Linear Proximity: factor = t
  } else if (type === 2) {
    // Smoothstep Polynomial
    factor = t * t * (3 - 2 * t);
  } else {
    // 0: Cosine Bell (standard macOS bell curve)
    factor = Math.cos((dist / R) * (Math.PI / 2));
  }

  return 1.0 + (M - 1.0) * factor;
}

function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export class DockLayout {
  constructor() {
    // measured icons of the last measure(), in dock order
    this.icons = [];
    this.iconNode = [];
    // outputs of compute(), indexed like `icons`
    this.iconDelta = [];
    // how open each icon's slot is, 0..1 (input, 1 when unset)
    this.iconPresence = [];
    // how far each icon's resting slot moved since it was last measured,
    // opposite: add it to the icon's drawn offset and it stays where it was
    this.iconDrift = [];
    this.iconScale = [];
    // the icons as displayed this frame, written by the caller before
    // fitSeparators()
    this.iconShownStart = [];
    this.iconShownEnd = [];
    // kept separators, in dock order; sepPrev/sepNext index `icons`
    this.sepActors = [];
    this.sepNode = [];
    this.sepPrev = [];
    this.sepNext = [];
    this.sepRest = [];
    // outputs of fitSeparators(), indexed like `sepActors`
    this.sepFitCenter = [];
    this.sepFitSize = [];
    this.slotStart = [];
    this.slotEnd = [];
    // nodes (icons and kept separators) in dock order
    this.nodeKind = [];
    this.nodeRestStart = [];
    this.nodeRestEnd = [];
    this.nodeCenter = [];
    this.nodeSize = [];
    this.nodeScale = [];
    this.nodeDelta = [];

    this.iconCount = 0;
    this.sepCount = 0;
    this.nodeCount = 0;
    this.peak = -1;
    this.isWithin = false;
    this.spanStart = 0;
    this.spanEnd = 0;
    this.settled = false;

    this._firstSecondary = 0;
    // measure() candidates before separators are vetted
    this._cItem = [];
    this._cKind = [];
    this._cStart = [];
    this._cEnd = [];
    this._cSecondary = [];
    // compute() scratch, one entry per calculation node
    this._cell = [];
    this._base = [];
    this._iconLike = [];
    this._staticCenter = [];
    this._width = [];
    this._scale = [];
    this._pres = [];
    // resting centre of each icon when last measured (see iconDrift)
    this._lastRest = new WeakMap();
    this._lastVertical = null;
  }

  clear() {
    this.icons.length = 0;
    this.sepActors.length = 0;
    this._cItem.length = 0;
    this.iconCount = 0;
    this.sepCount = 0;
    this.nodeCount = 0;
    this.peak = -1;
    this.isWithin = false;
    // a re-enabled dock starts from where the Shell puts things
    this._lastRest = new WeakMap();
    this._lastVertical = null;
  }

  // Collects what can be laid out this frame. An item takes part only if it
  // was measured NOW: an icon needs its `_icon` and a finite position and
  // size; a separator needs to be visible, mapped (a hidden parent means no
  // slot) and measurable, and to have an icon on both sides. Nothing carries
  // over from earlier frames, so a missing item never reads stale geometry.
  // Returns the number of measured icons.
  measure(items, vertical, withSeparators) {
    // inputs of the frame, filled in by the caller after this call
    this.iconPresence.length = 0;
    // slots measured along another axis say nothing about this one
    if (vertical !== this._lastVertical) {
      this._lastRest = new WeakMap();
      this._lastVertical = vertical;
    }
    // a never-seen item is waiting for its allocation (see below)
    let waiting = false;
    let c = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      let kind = ICON;
      if (item._cls === SEPARATOR_CLASS) {
        if (!withSeparators || !item.visible || !item.mapped) continue;
        kind = SEPARATOR;
      } else if (!item._icon) {
        continue;
      } else if (!this._lastRest.has(item) && item.has_allocation?.() === false) {
        // never seen and not allocated yet: its "position" is its parent's
        // origin; wait a frame instead of letting the icon fly in from there.
        // The Dash already counts it, so the slots are not steady either.
        waiting = true;
        continue;
      }

      const pos = item.get_transformed_position();
      if (!pos || !isNumber(pos[0]) || !isNumber(pos[1])) continue;
      const size = vertical ? item.height : item.width;
      if (!isNumber(size)) continue;

      let start = vertical ? pos[1] : pos[0];
      if (kind === SEPARATOR) {
        // it is shifted along the dock by fitSeparators(): that shift is
        // not part of its slot in the dash
        const shift = vertical ? item.translationY : item.translationX;
        start -= isNumber(shift) ? shift : 0;
      }
      this._cItem[c] = item;
      this._cKind[c] = kind;
      this._cStart[c] = start;
      this._cEnd[c] = start + size;
      this._cSecondary[c] = vertical ? pos[0] : pos[1];
      c++;
    }
    this._cItem.length = c;

    // vet the separators: one only between two icons
    let n = 0;
    let icons = 0;
    let seps = 0;
    let prevIsIcon = false;
    for (let i = 0; i < c; i++) {
      if (this._cKind[i] === SEPARATOR) {
        if (!prevIsIcon) continue;
        prevIsIcon = false;
        this.sepActors[seps] = this._cItem[i];
        this.sepNode[seps] = n;
        this.sepPrev[seps] = icons - 1;
        this.sepNext[seps] = icons;
        this.sepRest[seps] = (this._cStart[i] + this._cEnd[i]) / 2;
        seps++;
      } else {
        prevIsIcon = true;
        this.icons[icons] = this._cItem[i];
        this.iconNode[icons] = n;
        icons++;
      }
      this.nodeKind[n] = this._cKind[i];
      this.nodeRestStart[n] = this._cStart[i];
      this.nodeRestEnd[n] = this._cEnd[i];
      if (n === 0) this._firstSecondary = this._cSecondary[i];
      n++;
    }
    // nothing follows a trailing separator
    if (n > 0 && this.nodeKind[n - 1] === SEPARATOR) {
      n--;
      seps--;
    }

    // The Dash re-lays itself out when an item comes or goes (centred, so
    // every slot moves): report how far each icon's slot moved since it was
    // last measured, so the caller can keep what is drawn where it was and
    // let it glide, instead of showing the jump. A move of more than a few
    // item widths is no item coming or going but the whole dock being put
    // somewhere else (another monitor, a geometry change): that is a jump,
    // not a glide across the screen.
    let steady = true;
    for (let k = 0; k < icons; k++) {
      const node = this.iconNode[k];
      const now = (this.nodeRestStart[node] + this.nodeRestEnd[node]) / 2;
      const before = this._lastRest.get(this.icons[k]);
      const width = this.nodeRestEnd[node] - this.nodeRestStart[node];
      let drift = before === undefined ? 0 : before - now;
      if (Math.abs(drift) > MAX_DRIFT_ITEMS * width) drift = 0;
      this.iconDrift[k] = drift;
      if (Math.abs(drift) >= 0.5) steady = false;
      this._lastRest.set(this.icons[k], now);
    }
    this.iconDrift.length = icons;

    // The slots' own extent along the dock, and whether they held still since
    // the last measure. The platter is drawn from these (not from the live
    // size of the Dash, which can already be final while the slots are still
    // those of an intermediate allocation), so it moves with the icons.
    this.spanStart = n > 0 ? this.nodeRestStart[0] : 0;
    this.spanEnd = n > 0 ? this.nodeRestEnd[n - 1] : 0;
    this.settled = steady && !waiting;

    this.nodeCount = n;
    this.iconCount = icons;
    this.sepCount = seps;
    this.icons.length = icons;
    this.iconNode.length = icons;
    this.sepActors.length = seps;
    this.sepNode.length = seps;
    this.sepPrev.length = seps;
    this.sepNext.length = seps;
    this.sepRest.length = seps;
    this.nodeKind.length = n;
    this.nodeRestStart.length = n;
    this.nodeRestEnd.length = n;
    this.peak = -1;
    this.isWithin = false;
    this._cItem.length = 0;
    return icons;
  }

  // Lays out the nodes measure() kept. `p`:
  //   iconSize, padding, separatorSize     px along the axis
  //   pointerPrimary, pointerSecondary     pointer along / across the dock
  //   threshold, scaleAtMax, curveType     magnification bell
  //   noAnimation, suppressHover           no peak icon / no magnification
  // Fills nodeCenter/nodeSize/nodeScale/nodeDelta and iconDelta/iconScale/
  // peak/isWithin. `delta` is how far a node moves along the axis from its
  // resting slot. Returns false if there is nothing to lay out.
  compute(p) {
    const n = this.nodeCount;
    if (n === 0) {
      this.iconDelta.length = 0;
      this.iconScale.length = 0;
      this.nodeCenter.length = 0;
      this.nodeSize.length = 0;
      this.nodeScale.length = 0;
      this.nodeDelta.length = 0;
      return false;
    }

    const G = NUM_GHOSTS;
    const T = n + 2 * G;
    const { iconSize, padding, separatorSize, threshold, scaleAtMax } = p;
    const curve = p.curveType ?? 0;
    const kind = this.nodeKind;
    const cell = this._cell;
    const base = this._base;
    const iconLike = this._iconLike;
    const staticCenter = this._staticCenter;
    const width = this._width;
    const scale = this._scale;
    const pres = this._pres;
    const ghostCell = iconSize + padding;

    // static (unmagnified) cells: node width plus its padding
    let totalStatic = 0;
    let unpackedL = 0;
    let iconIdx = 0;
    for (let i = 0; i < T; i++) {
      const k = i - G;
      const real = k >= 0 && k < n;
      const sep = real && kind[k] === SEPARATOR;
      base[i] = sep ? separatorSize : iconSize;
      iconLike[i] = !sep;
      cell[i] = base[i] + padding;
      staticCenter[i] = totalStatic + cell[i] / 2;
      totalStatic += cell[i];
      if (real) unpackedL += cell[i];
      // how open the icon's slot is (0..1); ghosts and separators are open
      let open = 1;
      if (real && !sep) {
        const v = this.iconPresence[iconIdx++];
        open = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
      }
      pres[i] = open;
    }

    const restStart = this.nodeRestStart[0];
    const restL = this.nodeRestEnd[n - 1] - restStart;

    // is the pointer over the dock (with room for the ghost nodes)?
    const pointer = p.pointerPrimary;
    const secondaryDist = Math.abs(
      p.pointerSecondary - (this._firstSecondary + iconSize / 2)
    );
    const withinSecondary = secondaryDist < iconSize * 2.0;
    const withinPrimary =
      pointer >= restStart - G * ghostCell &&
      pointer <= restStart + restL + G * ghostCell;
    const within = !p.suppressHover && withinPrimary && withinSecondary;
    this.isWithin = within;

    // pointer in the coordinates of the static cells, centred on the dock
    const unwarpedStart = restStart - (unpackedL - restL) / 2;
    const firstRealStaticLeft = G * ghostCell + padding / 2;
    const xm = Math.max(
      0,
      Math.min(totalStatic, pointer - unwarpedStart + firstRealStaticLeft)
    );

    for (let i = 0; i < T; i++) {
      scale[i] =
        within && iconLike[i]
          ? getScale(staticCenter[i], xm, threshold, scaleAtMax, curve)
          : 1.0;
      width[i] = base[i] * scale[i] * pres[i];
    }

    // the icon under the pointer
    let peak = -1;
    if (within && !p.noAnimation) {
      let minDist = Infinity;
      let icon = 0;
      for (let k = 0; k < n; k++) {
        if (kind[k] === SEPARATOR) continue;
        const dist = Math.abs(staticCenter[k + G] - xm);
        if (dist < minDist) {
          minDist = dist;
          peak = icon;
        }
        icon++;
      }
      if (minDist > Math.max(threshold, ghostCell)) peak = -1;
    }
    this.peak = peak;

    // packed length now, and with the bell at dead centre: the difference is
    // spread over all gaps so the dock keeps its length wherever the pointer is
    let activeL = 0;
    for (let i = 0; i < T; i++) {
      activeL += width[i] + (i > 0 ? (padding * (pres[i - 1] + pres[i])) / 2 : 0);
    }
    const hoverFactor = peak >= 0 ? 1.0 : 0.0;
    const centerMouse = totalStatic / 2;
    let centerPackedL = 0;
    for (let i = 0; i < T; i++) {
      let w = base[i] * pres[i];
      if (iconLike[i]) {
        const target = getScale(
          staticCenter[i],
          centerMouse,
          threshold,
          scaleAtMax,
          curve
        );
        w *= 1.0 + (target - 1.0) * hoverFactor;
      }
      centerPackedL +=
        w + (i > 0 ? (padding * (pres[i - 1] + pres[i])) / 2 : 0);
    }
    // never below -padding: a negative gap would put a node over its neighbour
    const share = Math.max((centerPackedL - activeL) / T, -padding);

    // pack: neighbouring rects are exactly `padding + share` apart, scaled by
    // how present the two are (a node still opening takes half a gap on each
    // side of itself, so a closed one costs nothing)
    const gap = padding + share;
    let edge = 0;
    let leftEdge = 0;
    let rightEdge = 0;
    const centers = this.nodeCenter;
    // first pass: left edge of the first real node, in packed coordinates
    for (let i = 0; i < G; i++) {
      edge += width[i] + (gap * (pres[i] + pres[i + 1])) / 2;
    }
    leftEdge = edge;
    for (let k = 0; k < n; k++) {
      const i = k + G;
      centers[k] = edge + width[i] / 2;
      rightEdge = edge + width[i];
      edge += width[i] + (gap * (pres[i] + pres[i + 1])) / 2;
    }
    const realActiveL = rightEdge - leftEdge;
    const centeringShift = (restL - realActiveL) / 2;

    let icon = 0;
    for (let k = 0; k < n; k++) {
      const i = k + G;
      const activeCenter = centers[k] - leftEdge;
      const restCenter = (this.nodeRestStart[k] + this.nodeRestEnd[k]) / 2;
      const delta = activeCenter + centeringShift - (restCenter - restStart);
      this.nodeDelta[k] = delta;
      this.nodeScale[k] = scale[i];
      this.nodeSize[k] = width[i];
      // stage coordinates: where the node's centre ends up
      centers[k] = restCenter + delta;
      if (kind[k] === ICON) {
        this.iconDelta[icon] = delta;
        this.iconScale[icon] = scale[i];
        icon++;
      }
    }
    this.nodeDelta.length = n;
    this.nodeScale.length = n;
    this.nodeSize.length = n;
    centers.length = n;
    this.iconDelta.length = icon;
    this.iconScale.length = icon;
    return true;
  }

  // Places every kept separator between the icons as they are DISPLAYED
  // this frame (`iconShownStart/End`, filled by the caller from what it
  // drew). Icons ease towards their layout, so the displayed gap can be
  // smaller than the one compute() reserved; the line is centred in the gap
  // that really exists and never wider than it, so its rect stays inside
  // the gap (rect gap >= 0) on every frame. The hit slot is the whole gap:
  // the line plus the padding up to both neighbours.
  fitSeparators(separatorSize) {
    for (let j = 0; j < this.sepCount; j++) {
      const prevEnd = this.iconShownEnd[this.sepPrev[j]];
      const nextStart = this.iconShownStart[this.sepNext[j]];
      const gap = nextStart - prevEnd;
      const center = (prevEnd + nextStart) / 2;
      this.sepFitCenter[j] = center;
      if (gap > 0) {
        this.sepFitSize[j] = Math.min(separatorSize, gap);
        this.slotStart[j] = prevEnd;
        this.slotEnd[j] = nextStart;
      } else {
        // the neighbours touch or overlap: no room for a line, no slot
        this.sepFitSize[j] = 0;
        this.slotStart[j] = center;
        this.slotEnd[j] = center;
      }
    }
    this.sepFitCenter.length = this.sepCount;
    this.sepFitSize.length = this.sepCount;
    this.slotStart.length = this.sepCount;
    this.slotEnd.length = this.sepCount;
  }

  // Index of the separator slot holding `p` (a coordinate along the dock
  // axis in the same space as iconShownStart/End), or -1.
  slotAt(p) {
    for (let j = 0; j < this.sepCount; j++) {
      if (this.slotEnd[j] > this.slotStart[j] && p >= this.slotStart[j] && p <= this.slotEnd[j]) {
        return j;
      }
    }
    return -1;
  }
}
