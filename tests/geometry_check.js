// gjs -m tests/geometry_check.js — the rectangle/distance helpers behind dock hit-testing
// and intellihide (utils.js isInRect, isOverlapRect, get_distance*). Rects are
// [x, y, width, height]. Exits 1 on failure.
import { importWithStubs, createChecker } from './harness.js';

const { check, finish } = createChecker();
const { module: utils } = await importWithStubs('utils.js');
const { isInRect, isOverlapRect, get_distance, get_distance_sqr } = utils;

// isOverlapRect: autohide hides the dock when a window overlaps the dock rect
const dock = [100, 700, 800, 100];
check(isOverlapRect(dock, [300, 650, 200, 100]), 'a window dipping into the dock overlaps');
check(isOverlapRect(dock, [0, 0, 2000, 2000]), 'a window covering the dock overlaps');
check(isOverlapRect([300, 650, 200, 100], dock), 'overlap is symmetric');
check(!isOverlapRect(dock, [300, 100, 200, 400]), 'a window well above the dock does not overlap');
check(!isOverlapRect(dock, [1000, 700, 100, 100]), 'a window right of the dock does not overlap');
check(!isOverlapRect(dock, [0, 700, 50, 100]), 'a window left of the dock does not overlap');
check(isOverlapRect(dock, [900, 700, 50, 100]), 'touching edges count as overlap');
check(isOverlapRect([0, 0, 0, 0], [0, 0, 0, 0]), 'two empty rects at the same point overlap');

// isInRect: pointer inside the dock rect, with a padding that grows the hit area
const rect = [10, 20, 100, 50];
check(isInRect(rect, [10, 20], 0), 'top-left corner is inside');
check(isInRect(rect, [60, 45], 0), 'the middle is inside');
check(!isInRect(rect, [110, 45], 0), 'the right edge is exclusive');
check(!isInRect(rect, [60, 70], 0), 'the bottom edge is exclusive');
check(!isInRect(rect, [9, 45], 0), 'left of the rect is outside');
check(isInRect(rect, [0, 45], 10), 'padding extends the hit area to the left');
check(isInRect(rect, [119, 45], 10), 'padding extends the hit area to the right');
check(!isInRect(rect, [0, 45], 5), 'padding smaller than the gap stays outside');

// distances used by the magnification falloff
check(get_distance_sqr([0, 0], [3, 4]) === 25, 'squared distance of a 3-4-5 triangle');
check(get_distance([0, 0], [3, 4]) === 5, 'distance of a 3-4-5 triangle');
check(get_distance([5, 5], [5, 5]) === 0, 'distance to self is 0');
check(get_distance([-3, -4], [0, 0]) === 5, 'distance ignores direction');

finish();
