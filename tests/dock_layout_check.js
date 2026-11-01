// Pure dock layout checks (#2 separator slots, #11 measured-only frames, #15 slot hit test).
//   node tests/dock_layout_check.js
//   gjs -m tests/dock_layout_check.js
// dockLayout.js has no Shell imports, so both runtimes load it. Exit 1 on failure.
import {
  DockLayout,
  NUM_GHOSTS,
  SEPARATOR_CLASS,
  getScale,
} from '../dockLayout.js';

const IN_NODE = typeof process !== 'undefined' && !!process.versions?.node;
const out = (line) => (IN_NODE ? console.log(line) : print(line));

let failures = 0;
let passes = 0;
function check(cond, msg) {
  if (cond) {
    passes++;
  } else {
    failures++;
    out(`FAIL ${msg}`);
  }
}

// gjs has no URL: the repo root is the check's own URL minus tests/<file>
const ROOT_URI = import.meta.url.replace(/\/tests\/[^/]*$/, '/');

async function readText(name) {
  const href = ROOT_URI + name;
  if (IN_NODE) {
    const fs = await import('node:fs');
    return fs.readFileSync(new URL(href), 'utf8');
  }
  const { default: Gio } = await import('gi://Gio');
  const [, bytes] = Gio.File.new_for_uri(href).load_contents(null);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------
// Synthetic Dash: the same geometry Dock.relayout() hands the animator.
// Containers are itemSize squares with icon_spacing margins; a separator
// is a (thickness + 0.5) wide actor with 8px margins on both sides.
// ---------------------------------------------------------------------
const ORIGIN = 300;
const CROSS = 900;

function fakeIcon(start, size, vertical, label) {
  const actor = {
    label,
    _icon: {},
    _cls: 'dash-item-container',
    visible: true,
    mapped: true,
    width: size,
    height: size,
    translationX: 0,
    translationY: 0,
    get_transformed_position: () =>
      vertical ? [CROSS, start] : [start, CROSS],
  };
  return actor;
}

function fakeSeparator(start, size, vertical, label) {
  const actor = {
    label,
    _cls: SEPARATOR_CLASS,
    visible: true,
    mapped: true,
    width: vertical ? 40 : size,
    height: vertical ? size : 40,
    translationX: 0,
    translationY: 0,
    get_transformed_position() {
      return vertical
        ? [CROSS, start + this.translationY]
        : [start + this.translationX, CROSS];
    },
  };
  return actor;
}

function buildDock({ vertical, kinds, sf, spacing, spread, thickness }) {
  const margin = 8 * spacing;
  const items = [];
  const iconPx = ICON_BASE * sf;
  const itemSize = Math.floor(
    (Math.floor((ICON_BASE + 2 + 8 * spread) / 2) * 2) * sf
  );
  let pos = ORIGIN;
  kinds.forEach((kind, i) => {
    if (kind === 'sep') {
      pos += 8;
      items.push(fakeSeparator(pos, thickness + 0.5, vertical, `sep${i}`));
      pos += thickness + 0.5 + 8;
    } else {
      pos += margin;
      items.push(fakeIcon(pos, itemSize, vertical, `${kind}${i}`));
      pos += itemSize + margin;
    }
  });
  return { items, iconPx, restEnd: pos, itemSize };
}

const ICON_BASE = 48;

function frameParams({ sf, spacing, thickness, magnify, vertical, pointer }) {
  const spacingMargin = 8 * spacing;
  return {
    iconSize: ICON_BASE * sf,
    padding: 2 * spacingMargin + 2,
    separatorSize: thickness + 0.5,
    pointerPrimary: pointer,
    pointerSecondary: CROSS + (ICON_BASE * sf) / 2,
    threshold: (ICON_BASE + 10) * 2.5 * sf,
    scaleAtMax: 1 + magnify * 1.5,
    curveType: 0,
    noAnimation: false,
    suppressHover: false,
    vertical,
  };
}

const KIND_SETS = {
  apps: ['app', 'app', 'app', 'app'],
  'favorites|running': ['app', 'app', 'sep', 'app', 'app'],
  'favorites_only (no separator)': ['app', 'app', 'app', 'showApps'],
  'full dock: recents, stacks, trash, tiles, show apps': [
    'app', 'app', 'app', 'sep', 'app', 'app', 'recent', 'recent', 'sep',
    'stack', 'stack', 'trash', 'tile', 'tile', 'showApps',
  ],
  'show apps in front': ['showApps', 'app', 'sep', 'app', 'trash'],
  'leading and trailing separators': ['sep', 'app', 'app', 'sep'],
  'adjacent separators': ['app', 'sep', 'sep', 'app', 'app'],
  'single icon + separator': ['app', 'sep', 'trash'],
};

function* scenarios() {
  for (const [setName, kinds] of Object.entries(KIND_SETS)) {
    for (const vertical of [false, true]) {
      for (const sf of [1, 2]) {
        for (const spacing of [0, 0.5, 1]) {
          for (const thickness of [1, 2, 6, 14]) {
            for (const magnify of [0, 0.3, 1.0]) {
              yield { setName, kinds, vertical, sf, spacing, thickness, magnify, spread: 0.75 };
            }
          }
        }
      }
    }
  }
}

function sweep(dock) {
  const first = ORIGIN - 6 * dock.itemSize;
  const last = dock.restEnd + 6 * dock.itemSize;
  const step = Math.max(2, dock.itemSize / 7);
  const points = [NaN];
  for (let x = first; x <= last; x += step) points.push(x);
  return points;
}

// ---------------------------------------------------------------------
// 1. target layout: separators own a slot, gap >= 0 everywhere
// ---------------------------------------------------------------------
{
  const layout = new DockLayout();
  let frames = 0;
  let worst = Infinity;
  let worstSepGap = Infinity;
  let sepFrames = 0;
  for (const s of scenarios()) {
    const dock = buildDock(s);
    for (const pointer of sweep(dock)) {
      const n = layout.measure(dock.items, s.vertical, true);
      const params = frameParams({ ...s, pointer });
      const ok = layout.compute(params);
      const tag = `${s.setName} v=${s.vertical} sf=${s.sf} sp=${s.spacing} th=${s.thickness} mg=${s.magnify} @${pointer}`;
      frames++;
      check(ok && n > 0, `compute ran: ${tag}`);
      let sepsSeen = 0;
      for (let k = 0; k < layout.nodeCount; k++) {
        check(Number.isFinite(layout.nodeCenter[k]) && layout.nodeSize[k] >= 0, `finite node ${k}: ${tag}`);
        if (k > 0) {
          const gap =
            layout.nodeCenter[k] - layout.nodeSize[k] / 2 -
            (layout.nodeCenter[k - 1] + layout.nodeSize[k - 1] / 2);
          worst = Math.min(worst, gap);
          check(gap >= -1e-9, `gap ${gap} >= 0 between node ${k - 1} and ${k}: ${tag}`);
          if (layout.nodeKind[k] === 1 || layout.nodeKind[k - 1] === 1) {
            worstSepGap = Math.min(worstSepGap, gap);
          }
        }
        if (layout.nodeKind[k] === 1) {
          sepsSeen++;
          check(k > 0 && k < layout.nodeCount - 1, `separator is interior: ${tag}`);
          check(layout.nodeKind[k - 1] === 0 && layout.nodeKind[k + 1] === 0, `separator neighbours are icons: ${tag}`);
          check(Math.abs(layout.nodeSize[k] - params.separatorSize) < 1e-9, `separator keeps its own size: ${tag}`);
          check(layout.nodeScale[k] === 1, `separator is never magnified: ${tag}`);
        }
      }
      sepFrames += sepsSeen;
      check(layout.sepCount === sepsSeen, `sepCount matches nodes: ${tag}`);
      // the active span is centred on the resting span
      const spanStart = layout.nodeCenter[0] - layout.nodeSize[0] / 2;
      const spanEnd =
        layout.nodeCenter[layout.nodeCount - 1] + layout.nodeSize[layout.nodeCount - 1] / 2;
      const restMid = (layout.nodeRestStart[0] + layout.nodeRestEnd[layout.nodeCount - 1]) / 2;
      check(Math.abs((spanStart + spanEnd) / 2 - restMid) < 1e-6, `span centred on rest span: ${tag}`);
    }
  }
  out(`target layout: ${frames} frames, ${sepFrames} separator placements, worst gap ${worst.toFixed(3)}, worst separator gap ${worstSepGap.toFixed(3)}`);
  check(sepFrames > 1000, 'the matrix really exercises separators');
}

// ---------------------------------------------------------------------
// 2. every frame, with eased icons: separator rect inside the real gap
// ---------------------------------------------------------------------
{
  const layout = new DockLayout();
  let frames = 0;
  let placements = 0;
  let squeezed = 0;
  for (const s of scenarios()) {
    if (s.sf !== 1 || s.spacing === 1) continue;
    const dock = buildDock(s);
    const shownCenter = [];
    const shownSize = [];
    let primed = false;
    // a pointer sweep, 1 frame per point: the icons chase their targets
    // (position 42%/frame, size 4px/frame) so they lag the layout
    for (const pointer of sweep(dock)) {
      layout.measure(dock.items, s.vertical, true);
      const params = frameParams({ ...s, pointer });
      layout.compute(params);
      for (let k = 0; k < layout.iconCount; k++) {
        const node = layout.iconNode[k];
        const targetCenter = layout.nodeCenter[node];
        const targetSize = layout.nodeSize[node];
        if (!primed) {
          shownCenter[k] = targetCenter;
          shownSize[k] = params.iconSize;
        }
        shownCenter[k] += (targetCenter - shownCenter[k]) * 0.42;
        const d = targetSize - shownSize[k];
        shownSize[k] += Math.abs(d) > 4.15 ? Math.sign(d) * 4.15 : d;
        layout.iconShownStart[k] = shownCenter[k] - shownSize[k] / 2;
        layout.iconShownEnd[k] = shownCenter[k] + shownSize[k] / 2;
      }
      primed = true;
      layout.fitSeparators(params.separatorSize);
      frames++;
      for (let j = 0; j < layout.sepCount; j++) {
        placements++;
        const prevEnd = layout.iconShownEnd[layout.sepPrev[j]];
        const nextStart = layout.iconShownStart[layout.sepNext[j]];
        const half = layout.sepFitSize[j] / 2;
        const c = layout.sepFitCenter[j];
        const tag = `${s.setName} v=${s.vertical} th=${s.thickness} mg=${s.magnify} @${pointer} sep ${j}`;
        check(layout.sepFitSize[j] >= 0, `separator size >= 0: ${tag}`);
        check(nextStart - prevEnd < 0 || c - half >= prevEnd - 1e-9, `separator clear of previous icon: ${tag}`);
        check(nextStart - prevEnd < 0 || c + half <= nextStart + 1e-9, `separator clear of next icon: ${tag}`);
        if (layout.sepFitSize[j] < params.separatorSize - 1e-9) squeezed++;
        check(layout.slotEnd[j] >= layout.slotStart[j], `slot is not inverted: ${tag}`);
        check(layout.slotEnd[j] - layout.slotStart[j] >= layout.sepFitSize[j] - 1e-9, `slot at least as wide as the line: ${tag}`);
      }
    }
    // settled: the layout itself reserved the line plus both paddings
    for (let i = 0; i < 120; i++) {
      for (let k = 0; k < layout.iconCount; k++) {
        const node = layout.iconNode[k];
        shownCenter[k] += (layout.nodeCenter[node] - shownCenter[k]) * 0.42;
        const d = layout.nodeSize[node] - shownSize[k];
        shownSize[k] += Math.abs(d) > 4.15 ? Math.sign(d) * 4.15 : d;
        layout.iconShownStart[k] = shownCenter[k] - shownSize[k] / 2;
        layout.iconShownEnd[k] = shownCenter[k] + shownSize[k] / 2;
      }
    }
    layout.fitSeparators(frameParams({ ...s, pointer: NaN }).separatorSize);
    for (let j = 0; j < layout.sepCount; j++) {
      check(
        Math.abs(layout.sepFitSize[j] - (s.thickness + 0.5)) < 1e-9,
        `settled separator is not squeezed: ${s.setName} th=${s.thickness} mg=${s.magnify}`
      );
    }
  }
  out(`eased frames: ${frames} frames, ${placements} separator placements, ${squeezed} squeezed while the icons were still moving`);
  check(placements > 500, 'eased matrix really exercises separators');
}

// ---------------------------------------------------------------------
// 3. icon-only docks: identical to the pre-separator animator math
// ---------------------------------------------------------------------
function legacyDeltas({ restStarts, restSize, sf, spacing, magnify, pointer }) {
  const n = restStarts.length;
  const iconSize = ICON_BASE;
  const scaleAtMax = 1 + magnify * 1.5;
  const threshold = (iconSize + 10) * 2.5 * sf;
  const ICON_SIZE = iconSize * sf;
  const basePadding = 2 * 8 * spacing + 2;
  const activeContainerWidth = ICON_SIZE + basePadding;
  const NUM_IMAGINARY = 4;
  const TOTAL = NUM_IMAGINARY * 2 + n;
  const staticDockStart = restStarts[0];
  const restingCenters = restStarts.map((p) => p + restSize / 2 - staticDockStart);
  const restingL = restStarts[n - 1] + restSize - restStarts[0];
  const expandedStart = staticDockStart - NUM_IMAGINARY * activeContainerWidth;
  const expandedEnd = staticDockStart + restingL + NUM_IMAGINARY * activeContainerWidth;
  const within = pointer >= expandedStart && pointer <= expandedEnd;
  const staticCenters = [];
  for (let i = 0; i < TOTAL; i++) staticCenters.push(i * activeContainerWidth + activeContainerWidth / 2);
  const activeUnpackedL = n * activeContainerWidth;
  const unwarpedActiveStartX = staticDockStart - (activeUnpackedL - restingL) / 2;
  const firstRealStaticLeft = staticCenters[NUM_IMAGINARY] - ICON_SIZE / 2;
  const totalCalcStaticL = TOTAL * activeContainerWidth;
  const xm = Math.max(0, Math.min(totalCalcStaticL, pointer - unwarpedActiveStartX + firstRealStaticLeft));
  const iconScales = [];
  const iconWidths = [];
  for (let i = 0; i < TOTAL; i++) {
    if (!within) { iconScales.push(1); iconWidths.push(ICON_SIZE); }
    else {
      const sc = getScale(staticCenters[i], xm, threshold, scaleAtMax, 0);
      iconScales.push(sc);
      iconWidths.push(ICON_SIZE * sc);
    }
  }
  let peak = null;
  let minD = Infinity;
  if (within) {
    for (let i = 0; i < n; i++) {
      const d = Math.abs(staticCenters[i + NUM_IMAGINARY] - xm);
      if (d < minD) { minD = d; peak = i; }
    }
    if (minD > Math.max(threshold, activeContainerWidth)) peak = null;
  }
  let cur = 0;
  for (let i = 0; i < TOTAL; i++) {
    const h = iconWidths[i] / 2;
    cur = i === 0 ? h : cur + iconWidths[i - 1] / 2 + h + basePadding;
  }
  const activeL = cur + iconWidths[TOTAL - 1] / 2;
  const centerMouse = totalCalcStaticL / 2;
  const hf = peak !== null ? 1 : 0;
  const centerWidths = [];
  for (let i = 0; i < TOTAL; i++) {
    const t = getScale(staticCenters[i], centerMouse, threshold, scaleAtMax, 0);
    centerWidths.push(ICON_SIZE * (1 + (t - 1) * hf));
  }
  let cc = 0;
  for (let i = 0; i < TOTAL; i++) {
    const h = centerWidths[i] / 2;
    cc = i === 0 ? h : cc + centerWidths[i - 1] / 2 + h + basePadding;
  }
  const centerPackedL = cc + centerWidths[TOTAL - 1] / 2;
  const variance = centerPackedL - activeL;
  const adj = iconWidths.map((w) => w + variance / TOTAL);
  let realLeftEdgeUnshifted = 0;
  for (let i = 0; i < NUM_IMAGINARY; i++) realLeftEdgeUnshifted += adj[i];
  realLeftEdgeUnshifted += NUM_IMAGINARY * basePadding;
  const adjCenters = [];
  let ac = 0;
  for (let i = 0; i < TOTAL; i++) {
    const h = adj[i] / 2;
    ac = i === 0 ? h : ac + adj[i - 1] / 2 + h + basePadding;
    adjCenters.push(ac);
  }
  const realLeft = adjCenters[NUM_IMAGINARY] - adj[NUM_IMAGINARY] / 2;
  const realRight = adjCenters[NUM_IMAGINARY + n - 1] + adj[NUM_IMAGINARY + n - 1] / 2;
  const centeringShift = (restingL - (realRight - realLeft)) / 2;
  const deltas = [];
  let minGap = Infinity;
  for (let i = 0; i < n; i++) {
    const idx = i + NUM_IMAGINARY;
    deltas.push(adjCenters[idx] - realLeftEdgeUnshifted + centeringShift - restingCenters[i]);
    if (i > 0) {
      const gap = adjCenters[idx] - iconWidths[idx] / 2 - (adjCenters[idx - 1] + iconWidths[idx - 1] / 2);
      minGap = Math.min(minGap, gap);
    }
  }
  return { deltas, minGap, peak };
}

{
  const layout = new DockLayout();
  let compared = 0;
  for (const vertical of [false, true]) {
    for (const sf of [1, 2]) {
      for (const spacing of [0.5, 1]) {
        for (const magnify of [0, 0.3, 1.0]) {
          const kinds = ['app', 'app', 'app', 'app', 'app', 'app', 'app', 'app', 'app', 'app'];
          const dock = buildDock({ vertical, kinds, sf, spacing, spread: 0.75, thickness: 2 });
          const restStarts = dock.items.map((a) => (vertical ? a.get_transformed_position()[1] : a.get_transformed_position()[0]));
          for (const pointer of sweep(dock)) {
            if (Number.isNaN(pointer)) continue;
            const legacy = legacyDeltas({ restStarts, restSize: dock.itemSize, sf, spacing, magnify, pointer });
            if (legacy.minGap < 0) continue;
            layout.measure(dock.items, vertical, true);
            layout.compute(frameParams({ vertical, sf, spacing, thickness: 2, magnify, pointer }));
            compared++;
            for (let i = 0; i < kinds.length; i++) {
              check(
                Math.abs(layout.iconDelta[i] - legacy.deltas[i]) < 1e-9,
                `icon-only dock matches the old math: v=${vertical} sf=${sf} sp=${spacing} mg=${magnify} @${pointer} icon ${i}: ${layout.iconDelta[i]} vs ${legacy.deltas[i]}`
              );
            }
            const peak = layout.peak < 0 ? null : layout.peak;
            check(peak === legacy.peak, `icon-only peak matches: ${peak} vs ${legacy.peak}`);
          }
        }
      }
    }
  }
  out(`icon-only regression: ${compared} frames compared with the old Step 2-4 math`);
  check(compared > 200, 'regression compares enough frames');
}

// ---------------------------------------------------------------------
// 4. #11: only icons measured THIS frame take part; nothing throws
// ---------------------------------------------------------------------
{
  const layout = new DockLayout();
  const sf = 1;
  const base = { vertical: false, sf, spacing: 0.5, spread: 0.75, thickness: 2, magnify: 0.3 };
  const kinds = ['app', 'app', 'sep', 'app', 'app', 'app', 'sep', 'trash', 'showApps'];

  function stale(actor) {
    // a leftover measurement from an earlier frame must never be read
    Object.defineProperty(actor, '_fixedPosition', {
      get() {
        throw new TypeError('read a _fixedPosition: stale measurement used');
      },
    });
  }
  const unmeasure = {
    'no _icon': (a) => { a._icon = null; },
    'NaN position': (a) => { a.get_transformed_position = () => [NaN, NaN]; },
    'undefined position': (a) => { a.get_transformed_position = () => undefined; },
    'NaN size': (a) => { a.width = NaN; a.height = NaN; },
  };
  const iconIndexes = kinds.map((k, i) => [k, i]).filter(([k]) => k !== 'sep').map(([, i]) => i);
  const first = iconIndexes[0];
  const last = iconIndexes[iconIndexes.length - 1];
  const middle = iconIndexes[Math.floor(iconIndexes.length / 2)];
  const sets = {
    first: [first],
    middle: [middle],
    last: [last],
    'first+middle+last': [first, middle, last],
    'every other icon': iconIndexes.filter((_, n) => n % 2 === 0),
    'all but one': iconIndexes.slice(1),
    'all of them': iconIndexes,
  };
  let runs = 0;
  for (const [how, apply] of Object.entries(unmeasure)) {
    for (const [which, idxs] of Object.entries(sets)) {
      const dock = buildDock({ ...base, kinds });
      dock.items.forEach(stale);
      idxs.forEach((i) => apply(dock.items[i]));
      const expected = iconIndexes.filter((i) => !idxs.includes(i));
      const tag = `${how} / ${which}`;
      let threw = null;
      let n = 0;
      let ok = false;
      for (const pointer of [NaN, ORIGIN + 120, ORIGIN + 300]) {
        try {
          n = layout.measure(dock.items, false, true);
          ok = layout.compute(frameParams({ ...base, vertical: false, pointer }));
        } catch (e) {
          threw = e;
        }
      }
      runs++;
      check(threw === null, `${tag}: no throw (${threw?.message})`);
      check(n === expected.length, `${tag}: measured ${n} of expected ${expected.length}`);
      check(layout.icons.length === expected.length, `${tag}: icon list is exactly the measured icons`);
      check(
        layout.icons.every((a, k) => a === dock.items[expected[k]]),
        `${tag}: measured icons are in dock order`
      );
      check(ok === (expected.length > 0), `${tag}: compute reports whether anything was laid out`);
      check(layout.iconDelta.length === expected.length && layout.iconDelta.every(Number.isFinite), `${tag}: finite deltas for each measured icon only`);
      // separators whose neighbour was not measured are dropped, not laid out
      check(layout.sepActors.every((a) => a._cls === SEPARATOR_CLASS), `${tag}: kept separators are separators`);
      check(layout.nodeKind.slice(0, layout.nodeCount).every((k, i, all) => k === 0 || (i > 0 && i < all.length - 1 && all[i - 1] === 0 && all[i + 1] === 0)), `${tag}: kept separators have icon neighbours`);
    }
  }
  out(`unmeasured icon sets: ${runs} combinations`);

  // a frame after an unmeasured one starts from scratch
  const dock = buildDock({ ...base, kinds });
  const [a, b] = [dock.items[0], dock.items[1]];
  a.get_transformed_position = () => [NaN, NaN];
  layout.measure(dock.items, false, true);
  check(!layout.icons.includes(a), 'unmeasured icon is out of this frame');
  a.get_transformed_position = () => [ORIGIN, CROSS];
  layout.measure(dock.items, false, true);
  check(layout.icons.includes(a) && layout.icons.includes(b), 'icon is back once it measures again');

  // separators: only visible + mapped ones take part, thickness 0 means none
  const d2 = buildDock({ ...base, kinds });
  layout.measure(d2.items, false, false);
  check(layout.sepCount === 0, 'thickness 0: no separator takes part');
  d2.items[2].mapped = false;
  layout.measure(d2.items, false, true);
  check(layout.sepCount === 1, 'an unmapped separator (hidden parent) is dropped');
  d2.items[6].visible = false;
  layout.measure(d2.items, false, true);
  check(layout.sepCount === 0, 'an invisible separator is dropped');
}

// ---------------------------------------------------------------------
// 5. #15: the separator slot is the hit area
// ---------------------------------------------------------------------
{
  const layout = new DockLayout();
  const s = { vertical: false, sf: 1, spacing: 0.5, spread: 0.75, thickness: 2, magnify: 0.3 };
  const dock = buildDock({ ...s, kinds: ['app', 'app', 'sep', 'app', 'app'] });
  layout.measure(dock.items, false, true);
  const params = frameParams({ ...s, pointer: NaN });
  layout.compute(params);
  for (let k = 0; k < layout.iconCount; k++) {
    const node = layout.iconNode[k];
    layout.iconShownStart[k] = layout.nodeCenter[node] - layout.nodeSize[node] / 2;
    layout.iconShownEnd[k] = layout.nodeCenter[node] + layout.nodeSize[node] / 2;
  }
  layout.fitSeparators(params.separatorSize);
  const start = layout.slotStart[0];
  const end = layout.slotEnd[0];
  const prevEnd = layout.iconShownEnd[layout.sepPrev[0]];
  const nextStart = layout.iconShownStart[layout.sepNext[0]];
  check(start === prevEnd && end === nextStart, 'slot runs from the previous icon edge to the next icon edge');
  check(end - start >= params.separatorSize + 2 * params.padding - 1e-9, `slot (${end - start}) holds the line and both paddings`);
  check(layout.slotAt(start) === 0 && layout.slotAt(end) === 0, 'both slot edges hit');
  check(layout.slotAt((start + end) / 2) === 0, 'slot middle hits');
  check(layout.slotAt(start + 0.01) === 0 && layout.slotAt(end - 0.01) === 0, 'padding next to the neighbours hits');
  check(layout.slotAt(start - 0.5) === -1 && layout.slotAt(end + 0.5) === -1, 'icon area does not hit');
  check(layout.slotAt(NaN) === -1, 'NaN pointer does not hit');
  // squeezed to nothing (the neighbours touch): there is no slot to hit
  {
    const zero = new DockLayout();
    const touching = buildDock({ ...s, kinds: ['app', 'sep', 'app'] });
    zero.measure(touching.items, false, true);
    zero.compute(params);
    zero.iconShownStart[0] = 0;
    zero.iconShownEnd[0] = 100;
    zero.iconShownStart[1] = 100;
    zero.iconShownEnd[1] = 200;
    zero.fitSeparators(params.separatorSize);
    check(zero.sepFitSize[0] === 0 && zero.slotAt(100) === -1, 'touching neighbours: no slot, no hit at the seam');
  }
  layout.clear();
  check(layout.slotAt((start + end) / 2) === -1, 'no slot after the layout is cleared');
}

// ---------------------------------------------------------------------
// 6. #1: a new icon opens its slot over time; the dock width animates
// ---------------------------------------------------------------------
{
  const layout = new DockLayout();
  const s = { vertical: false, sf: 1, spacing: 0.5, spread: 0.75, thickness: 2, magnify: 0.3 };
  const kinds = ['app', 'app', 'app', 'sep', 'app', 'app', 'app'];
  const dock = buildDock({ ...s, kinds });
  const params = frameParams({ ...s, pointer: NaN });
  layout.measure(dock.items, false, true);
  const n = layout.iconCount;
  const spanOf = () => {
    const last = layout.nodeCount - 1;
    return layout.nodeCenter[last] + layout.nodeSize[last] / 2 - (layout.nodeCenter[0] - layout.nodeSize[0] / 2);
  };
  layout.compute(params);
  const fullSpan = spanOf();

  // presence scales a node and the gaps next to it; 1 is the old layout
  for (let k = 0; k < n; k++) layout.iconPresence[k] = 1;
  layout.compute(params);
  check(Math.abs(spanOf() - fullSpan) < 1e-9, 'presence 1 everywhere leaves the layout unchanged');

  let prevSpan = -Infinity;
  for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    for (let k = 0; k < n; k++) layout.iconPresence[k] = k === 1 ? p : 1;
    layout.compute(params);
    const tag = `new icon at presence ${p}`;
    const node = layout.iconNode[1];
    check(Math.abs(layout.nodeSize[node] - params.iconSize * layout.nodeScale[node] * p) < 1e-9, `${tag}: node size scales with presence`);
    for (let k = 1; k < layout.nodeCount; k++) {
      const gap =
        layout.nodeCenter[k] - layout.nodeSize[k] / 2 -
        (layout.nodeCenter[k - 1] + layout.nodeSize[k - 1] / 2);
      check(gap >= -1e-9, `${tag}: gap ${gap} >= 0 at node ${k}`);
    }
    const span = spanOf();
    check(span > prevSpan - 1e-9, `${tag}: dock span never shrinks while a slot opens (${prevSpan} -> ${span})`);
    prevSpan = span;
    if (p === 0) {
      // a closed slot costs nothing: its neighbours keep one normal gap
      const before = layout.iconNode[0];
      const after = layout.iconNode[2];
      const closed =
        layout.nodeCenter[after] - layout.nodeSize[after] / 2 -
        (layout.nodeCenter[before] + layout.nodeSize[before] / 2);
      const normal =
        layout.nodeCenter[layout.iconNode[4]] - layout.nodeSize[layout.iconNode[4]] / 2 -
        (layout.nodeCenter[layout.iconNode[3]] + layout.nodeSize[layout.iconNode[3]] / 2);
      check(Math.abs(closed - normal) < 1e-9, `closed slot: neighbours ${closed} apart, like any other pair (${normal})`);
    }
  }
  check(Math.abs(prevSpan - fullSpan) < 1e-9, 'a fully open slot is the plain layout');

  // separators keep their slot while a neighbour is still opening
  const sepNeighbours = layout.sepActors.length;
  check(sepNeighbours === 1, 'the separator is kept');
  for (const p of [0, 0.3, 0.7]) {
    for (let k = 0; k < n; k++) layout.iconPresence[k] = k === layout.sepNext[0] ? p : 1;
    layout.compute(params);
    const sn = layout.sepNode[0];
    const gapNext =
      layout.nodeCenter[sn + 1] - layout.nodeSize[sn + 1] / 2 -
      (layout.nodeCenter[sn] + layout.nodeSize[sn] / 2);
    const gapPrev =
      layout.nodeCenter[sn] - layout.nodeSize[sn] / 2 -
      (layout.nodeCenter[sn - 1] + layout.nodeSize[sn - 1] / 2);
    check(gapNext >= -1e-9 && gapPrev >= -1e-9, `separator clear of both neighbours with a neighbour at presence ${p}`);
  }
}

// ---------------------------------------------------------------------
// 7. #1: the rest layout jumps when an icon is added; the drawn dock must not
// ---------------------------------------------------------------------
{
  const S = { vertical: false, sf: 1, spacing: 0.5, spread: 0.75, thickness: 2, magnify: 0.3 };
  const params = frameParams({ ...S, pointer: NaN });
  const itemSize = Math.floor(Math.floor((ICON_BASE + 2 + 8 * 0.75) / 2) * 2);
  const margin = 8 * S.spacing;
  const DASH_CENTER = 700;
  const mk = (label) => ({
    label,
    _icon: {},
    _cls: 'dash-item-container',
    visible: true,
    mapped: true,
    width: itemSize,
    height: itemSize,
    translationX: 0,
    translationY: 0,
    start: 0,
    get_transformed_position() {
      return [this.start, CROSS];
    },
  });
  // the Dash is centred: adding a container moves every other one
  function place(list) {
    const pitch = itemSize + 2 * margin;
    const x0 = DASH_CENTER - (list.length * pitch) / 2;
    list.forEach((it, k) => {
      it.start = x0 + margin + k * pitch;
    });
  }

  function addIcon(compensate) {
    const layout = new DockLayout();
    const [A, B, C, D, E] = ['A', 'B', 'C', 'D', 'E'].map(mk);
    const N = mk('new');
    const shown = new Map();
    const presence = new Map();
    const platters = [];
    const frame = (list, ease) => {
      place(list);
      layout.measure(list, false, true);
      for (let k = 0; k < layout.iconCount; k++) {
        const it = layout.icons[k];
        if (!presence.has(it)) presence.set(it, 1);
        layout.iconPresence[k] = presence.get(it);
      }
      layout.compute(params);
      for (let k = 0; k < layout.iconCount; k++) {
        const it = layout.icons[k];
        if (!shown.has(it)) shown.set(it, 0);
        if (compensate) shown.set(it, shown.get(it) + layout.iconDrift[k]);
      }
      const first = layout.icons[0];
      const last = layout.icons[layout.iconCount - 1];
      const before = layout.nodeRestEnd[layout.nodeCount - 1] + shown.get(last) - (layout.nodeRestStart[0] + shown.get(first));
      for (let k = 0; k < layout.iconCount; k++) {
        const it = layout.icons[k];
        shown.set(it, shown.get(it) + (layout.iconDelta[k] - shown.get(it)) * (ease ? 0.21 : 1));
        if (presence.get(it) < 1) presence.set(it, 1 - (1 - presence.get(it)) * 0.8);
      }
      const after = layout.nodeRestEnd[layout.nodeCount - 1] + shown.get(last) - (layout.nodeRestStart[0] + shown.get(first));
      return { before, after };
    };
    const list = [A, B, C, D, E];
    for (let i = 0; i < 80; i++) frame(list, i > 0);
    const settled = frame(list, true).after;
    list.splice(2, 0, N);
    presence.set(N, 0);
    for (let i = 0; i < 80; i++) platters.push(frame(list, true));
    return { settled, platters, final: platters[platters.length - 1].after };
  }

  const withFix = addIcon(true);
  const without = addIcon(false);
  const total = withFix.final - withFix.settled;
  check(total > 20, `adding an icon widens the dock (${total.toFixed(1)}px)`);

  // continuity: right after the insert, before any easing, the drawn dock is as wide as before
  check(
    Math.abs(withFix.platters[0].before - withFix.settled) < 1e-6,
    `drawn width is continuous across the insert (${withFix.platters[0].before} vs ${withFix.settled})`
  );
  // it opens over several frames, monotonically, no step bigger than 40%
  let maxStep = 0;
  let monotone = true;
  let prev = withFix.settled;
  let framesTo90 = -1;
  withFix.platters.forEach((p, i) => {
    maxStep = Math.max(maxStep, p.after - prev);
    if (p.after < prev - 1e-9) monotone = false;
    prev = p.after;
    if (framesTo90 < 0 && p.after - withFix.settled >= 0.9 * total) framesTo90 = i + 1;
  });
  check(monotone, 'the dock only widens while the slot opens');
  check(maxStep <= 0.4 * total, `largest per-frame step ${maxStep.toFixed(1)}px <= 40% of ${total.toFixed(1)}px`);
  check(framesTo90 >= 6, `the width takes ${framesTo90} frames to reach 90% (animated, not a jump)`);
  check(Math.abs(withFix.final - (withFix.settled + total)) < 1e-6 && Math.abs(withFix.platters[withFix.platters.length - 1].after - withFix.final) < 0.5, 'and it ends at the new width');

  // what the old code did: the rest layout jumped and the drawn dock jumped with it
  const jump = without.platters[0].before - without.settled;
  check(jump > 0.5 * total, `without continuity the drawn dock jumps ${jump.toFixed(1)}px at once (the bug)`);
  out(
    `add-icon: dock ${withFix.settled.toFixed(1)}px -> ${withFix.final.toFixed(1)}px; ` +
      `with continuity first-frame jump 0px, ${framesTo90} frames to 90%, largest step ${maxStep.toFixed(1)}px; ` +
      `without it the drawn dock jumped ${jump.toFixed(1)}px in one frame`
  );

  // icons with no history, a changed axis and gone items do not drift
  const layout = new DockLayout();
  const a = mk('a');
  const b = mk('b');
  const list = [a, b];
  place(list);
  layout.measure(list, false, true);
  check(layout.iconDrift.length === 2 && layout.iconDrift.every((d) => d === 0), 'first sight of an icon: no drift');
  a.start += 30;
  layout.measure(list, false, true);
  check(Math.abs(layout.iconDrift[0] + 30) < 1e-9 && layout.iconDrift[1] === 0, 'moved icon: drift is how far its rest slot moved, opposite');
  layout.measure(list, true, true);
  check(layout.iconDrift.every((d) => d === 0), 'a new axis forgets the old slots');
  // an icon that is not measured for a frame keeps its history: continuity
  // is relative to where it was last seen
  layout.measure(list, false, true);
  const seenAt = a.start;
  const keep = a.get_transformed_position;
  a.get_transformed_position = () => [NaN, NaN];
  layout.measure(list, false, true);
  check(layout.icons.length === 1 && layout.iconDrift.length === 1, 'unmeasured icon: not part of the frame');
  a.get_transformed_position = keep;
  a.start = seenAt + 10;
  layout.measure(list, false, true);
  check(Math.abs(layout.iconDrift[0] + 10) < 1e-9, 'an icon that was out for a frame drifts from where it was last seen');

  // a brand-new container has no allocation yet: its "position" is the
  // parent's origin, which would send the icon flying in from there
  const fresh = mk('fresh');
  let allocated = false;
  fresh.has_allocation = () => allocated;
  const withFresh = [a, fresh, b];
  place(withFresh);
  layout.measure(withFresh, false, true);
  check(!layout.icons.includes(fresh) && layout.icons.length === 2, 'an unallocated new icon is not measured yet');
  allocated = true;
  layout.measure(withFresh, false, true);
  check(layout.icons.includes(fresh) && layout.iconDrift[layout.icons.indexOf(fresh)] === 0, 'once allocated it is measured, with no drift');
  allocated = false;
  a.has_allocation = () => false;
  layout.measure(withFresh, false, true);
  check(layout.icons.includes(fresh) && layout.icons.includes(a), 'an icon that was seen stays measured while its allocation is pending');
  // the Dash already reports its final size while a fresh container waits for
  // its allocation: the slots are not steady then, whatever the old ones did
  const waiting = mk('waiting');
  waiting.has_allocation = () => false;
  const withWaiting = [a, waiting, b];
  place(withWaiting);
  layout.measure(withWaiting, false, true);
  layout.measure(withWaiting, false, true);
  check(layout.iconDrift.every((d) => d === 0), 'the measured slots did not move');
  check(layout.settled === false, 'but a fresh unallocated item keeps the frame from counting as settled');

  // the platter follows the icons' own slots (no live dash size mixed in):
  // the layout reports the measured span and whether the slots are steady
  const stable = [mk('s1'), mk('s2'), mk('s3')];
  place(stable);
  layout.measure(stable, false, true);
  check(layout.iconDrift.every((d) => d === 0) && layout.settled === true, 'first sight of the slots: no drift, settled');
  layout.measure(stable, false, true);
  check(layout.settled === true, 'unchanged slots: settled');
  check(
    layout.spanStart === stable[0].start && layout.spanEnd === stable[2].start + stable[2].width,
    `span is first slot start .. last slot end (${layout.spanStart}, ${layout.spanEnd})`
  );
  stable[2].start += 40;
  layout.measure(stable, false, true);
  check(layout.settled === false, 'a slot moved: not settled');
  check(layout.spanEnd === stable[2].start + stable[2].width, 'span follows the moved slot');
  layout.measure(stable, false, true);
  check(layout.settled === true, 'settled again once the slots stop moving');

  // a rigid jump of the whole dock (another monitor, a geometry change) is a
  // teleport, not an item coming or going: no glide across the screen
  const jumpy = [mk('j1'), mk('j2'), mk('j3')];
  place(jumpy);
  layout.measure(jumpy, false, true);
  jumpy.forEach((it) => {
    it.start += 1920;
  });
  layout.measure(jumpy, false, true);
  check(layout.iconDrift.every((d) => d === 0), 'a 1920px jump of every slot does not drift');
  check(layout.settled === false || layout.iconDrift.every((d) => d === 0), 'and it still reports consistent state');
  jumpy.forEach((it) => {
    it.start += 70;
  });
  layout.measure(jumpy, false, true);
  check(layout.iconDrift.every((d) => Math.abs(d + 70) < 1e-9), 'an item-sized move still drifts');

  // presence is an input of the frame: a stale value from a longer frame
  // must not leak into the next one
  layout.iconPresence[5] = 0.3;
  layout.measure(jumpy, false, true);
  check(layout.iconPresence.length === 0, 'presence starts empty on every measure');
}

// ---------------------------------------------------------------------
// 8. the animator itself keeps the invariants
// ---------------------------------------------------------------------
{
  const src = await readText('animator.js');
  const dockSrc = await readText('dock.js');
  check(!src.includes('_fixedPosition'), 'animator.js never reads a per-icon _fixedPosition');
  check(src.includes("from './dockLayout.js'"), 'animator.js lays out through dockLayout.js');
  check(!src.includes('_fast_forward') && !dockSrc.includes('_fast_forward'), 'no fast-forward hack: new icons are animated, not skipped');
}

check(NUM_GHOSTS === 4, 'ghost count is the one the old animator used');
out(`${passes} checks passed, ${failures} failed`);
// tools/run-tests.sh looks for this line
if (!failures) out(`all passed (${passes} checks)`);
if (IN_NODE) {
  process.exit(failures ? 1 : 0);
} else {
  const { default: System } = await import('system');
  System.exit(failures ? 1 : 0);
}
