// gjs -m tests/drop_slot_check.js - where on the dock a drop lands (pure logic,
// no GNOME Shell): onto an item or between two, at both ends, off the dock, on
// horizontal and vertical docks. Exits 1 on failure.
import { createChecker } from './harness.js';
import { dropSlot } from '../dropSlot.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const onto = (index) => ({ kind: 'onto', index });
const between = (index) => ({ kind: 'between', index });
const NONE = { kind: 'none' };

// Four 48 px items, 8 px apart, starting at 100 along the axis; the dock is
// 48 px thick starting at 500 across it. Item i spans [100+56i, 148+56i],
// its midline is 124+56i and its "onto" middle (half share) 112+56i..136+56i.
const AXIS0 = 100;
const CROSS0 = 500;
function dock(vertical, accepts = [true, true, true, true]) {
  return accepts.map((ok, i) => {
    const along = AXIS0 + 56 * i;
    return {
      role: `item${i}`,
      x: vertical ? CROSS0 : along,
      y: vertical ? along : CROSS0,
      w: 48,
      h: 48,
      accepts: ok,
    };
  });
}
// the pointer at `along` on the axis and `across` on the cross axis
function drop(slots, vertical, along, across = CROSS0 + 24, opts) {
  return vertical
    ? dropSlot(slots, across, along, true, opts)
    : dropSlot(slots, along, across, false, opts);
}

// [position along the dock, expected result, why]; every row runs on a
// horizontal and on a vertical dock
const ALL_ACCEPT = [
  [124, onto(0), 'the middle of the first item is onto it'],
  [180, onto(1), 'the middle of the second item is onto it'],
  [292, onto(3), 'the middle of the last item is onto it'],
  [112, onto(0), 'the start of the onto zone is onto (inclusive)'],
  [136, onto(0), 'the end of the onto zone is onto (inclusive)'],
  [
    111,
    between(0),
    'just before the onto zone of the first item: the gap before it',
  ],
  [
    137,
    between(1),
    'just after the onto zone of the first item: the gap after it',
  ],
  [100, between(0), 'the left edge of the first item is the gap before it'],
  [102, between(0), 'near the start of the first item is the gap before it'],
  [146, between(1), 'near the end of the first item is the gap after it'],
  [148, between(1), 'the end of the first item'],
  [152, between(1), 'in the gap between the first and second item'],
  [156, between(1), 'the start of the second item is the gap before it'],
  [166, between(1), 'the outer part of the second item, before it'],
  [194, between(2), 'the outer part of the second item, after it'],
  [204, between(2), 'in the gap between the second and third item'],
  [316, between(4), 'the end of the last item is the gap after the whole dock'],
  [310, between(4), 'near the end of the last item'],
  [100.5, between(0), 'a fractional position'],
];
for (const vertical of [false, true]) {
  const name = vertical ? 'vertical' : 'horizontal';
  const slots = dock(vertical);
  for (const [along, expected, why] of ALL_ACCEPT) {
    check(
      same(drop(slots, vertical, along), expected),
      `${name} dock at ${along}: ${why}`
    );
  }
}

// ---- off the dock --------------------------------------------------------------
for (const vertical of [false, true]) {
  const name = vertical ? 'vertical' : 'horizontal';
  const slots = dock(vertical);
  check(
    same(drop(slots, vertical, 99), NONE),
    `${name}: a pixel before the first item is off the dock`
  );
  check(
    same(drop(slots, vertical, 317), NONE),
    `${name}: a pixel after the last item is off the dock`
  );
  check(
    same(drop(slots, vertical, 90, undefined, { margin: 10 }), between(0)),
    `${name}: the margin before the dock still counts (edge)`
  );
  check(
    same(drop(slots, vertical, 89, undefined, { margin: 10 }), NONE),
    `${name}: beyond the margin before the dock is off it`
  );
  check(
    same(drop(slots, vertical, 326, undefined, { margin: 10 }), between(4)),
    `${name}: the margin after the dock still counts (edge)`
  );
  check(
    same(drop(slots, vertical, 327, undefined, { margin: 10 }), NONE),
    `${name}: beyond the margin after the dock is off it`
  );
  check(
    same(drop(slots, vertical, 180, CROSS0), onto(1)),
    `${name}: the near edge across the dock is on it`
  );
  check(
    same(drop(slots, vertical, 180, CROSS0 + 48), onto(1)),
    `${name}: the far edge across the dock is on it`
  );
  check(
    same(drop(slots, vertical, 180, CROSS0 - 1), NONE),
    `${name}: above the dock is off it`
  );
  check(
    same(drop(slots, vertical, 180, CROSS0 + 49), NONE),
    `${name}: below the dock is off it`
  );
  check(
    same(drop(slots, vertical, 180, CROSS0 - 4, { margin: 4 }), onto(1)),
    `${name}: the margin applies across the dock`
  );
  check(
    same(drop(slots, vertical, 180, CROSS0 - 5, { margin: 4 }), NONE),
    `${name}: beyond the margin across the dock is off it`
  );
  check(
    same(drop(slots, vertical, 180, CROSS0 + 52, { margin: 4 }), onto(1)),
    `${name}: the margin applies on the far side`
  );
  check(
    same(drop(slots, vertical, 99, undefined, { margin: -50 }), NONE),
    `${name}: a negative margin is no margin`
  );
  check(
    same(drop(slots, vertical, 1e9), NONE) &&
      same(drop(slots, vertical, -1e9), NONE),
    `${name}: far away is off the dock`
  );
}

// ---- items that do not accept ---------------------------------------------------------
for (const vertical of [false, true]) {
  const name = vertical ? 'vertical' : 'horizontal';
  const slots = dock(vertical, [true, false, true, false]);
  check(
    same(drop(slots, vertical, 180), between(2)),
    `${name}: the middle of an item that refuses is the gap after it (midline goes right)`
  );
  check(
    same(drop(slots, vertical, 179), between(1)),
    `${name}: just before the midline of an item that refuses is the gap before it`
  );
  check(
    same(drop(slots, vertical, 160), between(1)),
    `${name}: the first half of an item that refuses`
  );
  check(
    same(drop(slots, vertical, 200), between(2)),
    `${name}: the second half of an item that refuses`
  );
  check(
    same(drop(slots, vertical, 124), onto(0)),
    `${name}: the accepting neighbour is still onto`
  );
  check(
    same(drop(slots, vertical, 236), onto(2)),
    `${name}: the accepting item after a refusing one is onto`
  );
  check(
    same(drop(slots, vertical, 292), between(4)),
    `${name}: the last item refuses, its middle is the gap after the dock`
  );
  check(
    same(drop(slots, vertical, 290), between(3)),
    `${name}: the last item refuses, before its midline`
  );
  const none = dock(vertical, [false, false, false, false]);
  for (const along of [100, 124, 150, 180, 236, 292, 316]) {
    check(
      drop(none, vertical, along).kind === 'between',
      `${name}: with no item accepting, ${along} is never onto`
    );
  }
  const strings = dock(vertical, ['yes', 1, undefined, null]);
  check(
    drop(strings, vertical, 124).kind === 'between' &&
      drop(strings, vertical, 180).kind === 'between',
    `${name}: accepts must be exactly true`
  );
}

// ---- ontoShare -------------------------------------------------------------------------
for (const vertical of [false, true]) {
  const name = vertical ? 'vertical' : 'horizontal';
  const slots = dock(vertical);
  check(
    same(drop(slots, vertical, 156, undefined, { ontoShare: 1 }), onto(1)),
    `${name}: with share 1 the whole item is onto (its start)`
  );
  check(
    same(drop(slots, vertical, 203, undefined, { ontoShare: 1 }), onto(1)),
    `${name}: with share 1 the whole item is onto (its last pixel)`
  );
  check(
    same(drop(slots, vertical, 204, undefined, { ontoShare: 1 }), between(2)),
    `${name}: an item ends before its end coordinate (the next gap starts there)`
  );
  check(
    same(drop(slots, vertical, 206, undefined, { ontoShare: 1 }), between(2)),
    `${name}: with share 1 the gap is still a gap`
  );
  check(
    same(drop(slots, vertical, 180, undefined, { ontoShare: 0 }), between(2)),
    `${name}: with share 0 nothing is onto`
  );
  check(
    same(drop(slots, vertical, 179, undefined, { ontoShare: 0 }), between(1)),
    `${name}: with share 0 the midline splits the item`
  );
  check(
    same(drop(slots, vertical, 174, undefined, { ontoShare: 0.25 }), onto(1)),
    `${name}: share 0.25 starts 6 px before the middle`
  );
  check(
    same(
      drop(slots, vertical, 173, undefined, { ontoShare: 0.25 }),
      between(1)
    ),
    `${name}: share 0.25 ends 7 px before the middle`
  );
  check(
    same(drop(slots, vertical, 186, undefined, { ontoShare: 0.25 }), onto(1)),
    `${name}: share 0.25 ends 6 px after the middle`
  );
  check(
    same(
      drop(slots, vertical, 187, undefined, { ontoShare: 0.25 }),
      between(2)
    ),
    `${name}: share 0.25 is over 7 px after the middle`
  );
  check(
    same(drop(slots, vertical, 156, undefined, { ontoShare: 7 }), onto(1)),
    `${name}: a share above 1 counts as 1`
  );
  check(
    same(drop(slots, vertical, 180, undefined, { ontoShare: -1 }), between(2)),
    `${name}: a negative share counts as 0`
  );
  check(
    same(drop(slots, vertical, 180, undefined, { ontoShare: NaN }), between(2)),
    `${name}: a share that is not a number never gives onto`
  );
  check(
    same(drop(slots, vertical, 180, undefined, {}), onto(1)) &&
      same(drop(slots, vertical, 180, undefined, null), onto(1)),
    `${name}: missing options mean the defaults`
  );
}

// ---- other shapes -----------------------------------------------------------------------
{
  // a dock with a narrow separator that takes nothing and a wide item
  const slots = [
    { role: 'app', x: 0, y: 0, w: 40, h: 40, accepts: true },
    { role: 'separator', x: 44, y: 0, w: 8, h: 40, accepts: false },
    { role: 'trash', x: 56, y: 0, w: 100, h: 40, accepts: true },
  ];
  check(
    same(dropSlot(slots, 20, 20, false), onto(0)),
    'the first icon of a mixed dock'
  );
  check(
    same(dropSlot(slots, 48, 20, false), between(2)),
    'on the separator, at its midline: the gap after it'
  );
  check(
    same(dropSlot(slots, 47, 20, false), between(1)),
    'on the separator before its midline: the gap before it'
  );
  check(
    same(dropSlot(slots, 106, 20, false), onto(2)),
    'the middle of a wide item is onto it'
  );
  check(
    same(dropSlot(slots, 70, 20, false), between(2)),
    'the left part of a wide item is the gap before it'
  );
  check(
    same(dropSlot(slots, 145, 20, false), between(3)),
    'the right part of a wide item is the gap after it'
  );
  check(
    same(dropSlot(slots, 42, 20, false), between(1)),
    'in the gap before the separator'
  );
}
{
  const one = [{ role: 'a', x: 10, y: 10, w: 20, h: 20, accepts: true }];
  check(
    same(dropSlot(one, 20, 20, false), onto(0)),
    'a single item: its middle is onto it'
  );
  check(
    same(dropSlot(one, 11, 20, false), between(0)),
    'a single item: its start is before it'
  );
  check(
    same(dropSlot(one, 29, 20, false), between(1)),
    'a single item: its end is after it'
  );
  check(
    same(dropSlot(one, 5, 20, false), NONE),
    'a single item: left of it is off the dock'
  );
  check(
    same(dropSlot(one, 5, 20, false, { margin: 5 }), between(0)),
    'a single item: the margin reaches left of it'
  );
}
{
  // a vertical dock is read along y
  const slots = dock(true);
  check(
    same(dropSlot(slots, 524, 180, true), onto(1)),
    'a vertical dock looks along y'
  );
}
check(
  same(dropSlot([], 10, 10, false), NONE) &&
    same(dropSlot([], 10, 10, true, { margin: 100 }), NONE),
  'an empty slot list is off the dock'
);
check(
  same(dropSlot(undefined, 10, 10, false), NONE) &&
    same(dropSlot(null, 10, 10, false), NONE) &&
    same(dropSlot('slots', 10, 10, false), NONE),
  'slots that are no array are off the dock'
);
{
  const slots = dock(false);
  check(
    same(dropSlot(slots, NaN, 524, false), NONE) &&
      same(dropSlot(slots, 180, NaN, false), NONE),
    'a pointer that is NaN is off the dock'
  );
  check(
    same(dropSlot(slots, Infinity, 524, false), NONE) &&
      same(dropSlot(slots, -Infinity, 524, false), NONE),
    'an infinite pointer is off the dock'
  );
  check(
    same(dropSlot(slots, undefined, undefined, false), NONE) &&
      same(dropSlot(slots, null, null, false), NONE),
    'a missing pointer is off the dock'
  );
  check(
    same(dropSlot(slots, '180', '524', false), NONE),
    'a pointer given as strings is off the dock'
  );
}
{
  // damaged slots must not throw; they are unmeasured and ignored
  const slots = [
    null,
    { accepts: true },
    { x: NaN, y: NaN, w: NaN, h: NaN, accepts: true },
    { x: 100, y: 0, w: 40, h: 40, accepts: true },
  ];
  let result = null;
  try {
    result = dropSlot(slots, 120, 20, false);
  } catch (error) {
    result = error;
  }
  check(
    same(result, onto(3)),
    'damaged slots do not throw and the good one still works'
  );
  check(
    same(
      dropSlot([{ x: 0, y: 0, w: -10, h: -10, accepts: true }], 0, 0, false),
      NONE
    ),
    'a negative size is unmeasured: no slot at all is none'
  );
  check(
    same(
      dropSlot([{}, { x: 1000, y: 1000, w: 48, h: 48, accepts: true }], 10, 10, false),
      NONE
    ),
    'an unmeasured slot does not stretch the dock bounds'
  );
  check(
    same(
      dropSlot([{}, { x: 1000, y: 1000, w: 48, h: 48, accepts: true }], 1024, 1024, false),
      onto(1)
    ),
    'a measured slot after an unmeasured one keeps its array index'
  );
}
{
  const slots = [
    { x: 0, y: 0, w: 0, h: 40, accepts: true },
    { x: 0, y: 0, w: 40, h: 40, accepts: true },
  ];
  check(
    same(
      drop([{ x: 10, y: 10, w: 0, h: 0, accepts: true }], false, 10, 10),
      NONE
    ),
    'a zero-size slot is unmeasured and never hit'
  );
  check(
    same(dropSlot(slots, 20, 20, false), onto(1)),
    'a zero-size slot in front does not hide the next one'
  );
}
{
  const slots = Array.from({ length: 5000 }, (_, i) => ({
    x: i * 10,
    y: 0,
    w: 8,
    h: 8,
    accepts: i % 2 === 0,
  }));
  const start = Date.now();
  const got = dropSlot(slots, 49996, 4, false);
  check(
    same(got, between(5000)),
    'past the midline of the last (refusing) item of 5000 is the gap after the dock'
  );
  check(
    same(dropSlot(slots, 20 * 100 + 4, 4, false), onto(200)),
    'item 200 of 5000 (accepting) is onto at its middle'
  );
  check(
    same(dropSlot(slots, 2014, 4, false), between(202)) &&
      same(dropSlot(slots, 2013, 4, false), between(201)),
    'item 201 of 5000 (refusing) splits at its midline'
  );
  check(Date.now() - start < 1000, 'a dock of 5000 items is answered fast');
}
check(
  same(dropSlot(dock(false), 180, 524, false, undefined), onto(1)),
  'the options may be left out'
);
check(
  same(dropSlot(dock(false), 180, 524), onto(1)),
  'the vertical flag may be left out (horizontal)'
);
{
  const slots = dock(false);
  const copy = JSON.stringify(slots);
  dropSlot(slots, 180, 524, false, { margin: 3, ontoShare: 0.4 });
  check(JSON.stringify(slots) === copy, 'the slots are not modified');
}

finish();
