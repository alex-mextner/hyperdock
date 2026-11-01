// gjs -m tests/stack_geometry_check.js - where a stack popover stands (pure
// geometry, no GNOME Shell). Exits 1 on failure.
import { createChecker } from './harness.js';
import { anchorFor, clamp, directionFor, isVertical, originFor } from '../stackGeometry.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const wa = { x: 0, y: 32, width: 1200, height: 768 };
const monitor = { x: 0, y: 0, width: 1200, height: 800 };
const sizes = { gap: 6, depth: 10, margin: 8 };
const bottom = { x: 300, y: 740, w: 600, h: 60 };
const left = { x: 0, y: 200, w: 60, h: 400 };

check(clamp(5, 0, 3) === 3 && clamp(-1, 0, 3) === 0 && clamp(2, 0, 3) === 2, 'clamp keeps a value in range');
check(isVertical('left') && isVertical('right') && !isVertical('top') && !isVertical('bottom'), 'left and right docks are vertical');

check(anchorFor('bottom', bottom, wa, sizes).tip === 734, 'a bottom dock points from just above its background');
check(anchorFor('bottom', bottom, wa, sizes).room === 734 - 10 - 40, 'room above a bottom dock ends at the work area margin');
check(anchorFor('top', { x: 300, y: 0, w: 600, h: 60 }, wa, sizes).tip === 66, 'a top dock points from just below its background');
check(anchorFor('left', left, wa, sizes).tip === 66 && anchorFor('left', left, wa, sizes).room === 752, 'a left dock points from its right edge');
check(anchorFor('right', { ...left, x: 1140 }, wa, sizes).tip === 1134, 'a right dock points from its left edge');

const common = { tip: 734, depth: 10, size: { w: 300, h: 200 }, wa, monitor, margin: 8 };
check(same(originFor('bottom', { ...common, icon: { x: 600, y: 770 } }), { x: 450, y: 524 }), 'the popover is centred on the icon above a bottom dock');
check(originFor('bottom', { ...common, icon: { x: 20, y: 770 } }).x === 8, 'a stack at the far left keeps the popover on the screen');
check(originFor('bottom', { ...common, icon: { x: 1190, y: 770 } }).x === 892, 'a stack at the far right keeps the popover on the screen');
check(originFor('left', { ...common, tip: 66, icon: { x: 30, y: 400 } }).x === 76, 'beside a left dock the popover starts past the pointer');
check(originFor('right', { ...common, tip: 1134, icon: { x: 1170, y: 400 } }).x === 824, 'beside a right dock the popover ends before the pointer');
check(originFor('left', { ...common, tip: 66, icon: { x: 30, y: 10 } }).y === 40, 'a high icon keeps the popover below the work area top');
check(originFor('top', { ...common, tip: 66, icon: { x: 600, y: 30 } }).y === 76, 'below a top dock the popover starts past the pointer');

check(same(directionFor('bottom'), { dx: 0, dy: -1 }) && same(directionFor('top'), { dx: 0, dy: 1 }), 'the pointer aims up from a bottom dock and down from a top one');
check(same(directionFor('left'), { dx: 1, dy: 0 }) && same(directionFor('right'), { dx: -1, dy: 0 }), 'the pointer aims right from a left dock and left from a right one');

finish();
