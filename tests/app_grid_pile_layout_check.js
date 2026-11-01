// gjs -m tests/app_grid_pile_layout_check.js - where the app-grid pile's icons
// lie (pure logic, no GNOME Shell): deterministic, inside the plate, stable per
// app id, drawn back to front. Exits 1 on failure.
import { assert, createSuite } from './mini_test.js';
import {
  ROOM,
  extent,
  iconSide,
  layerReach,
  layoutPile,
} from '../appGridPileLayout.js';
import { iconBounds } from '../pileMetrics.js';

const { test, run } = createSuite();

const appIds = (n) => Array.from({ length: n }, (_, i) => `org.example.App${i + 1}.desktop`);
const EPSILON = 1e-9;

test('same ids, same layout, every time', () => {
  assert.deepEqual(layoutPile(appIds(9)), layoutPile(appIds(9)));
});

test('an empty pile has no layers', () => {
  assert.deepEqual(layoutPile([]), []);
});

test('one layer per app, back to front: the first id lies on top', () => {
  const ids = appIds(9);
  const layers = layoutPile(ids);
  assert.deepEqual(layers.map((l) => l.id), [...ids].reverse());
});

test('every icon stays inside the plate, rotation and shadow included', () => {
  for (let n = 1; n <= 21; n++) {
    for (const layer of layoutPile(appIds(n))) {
      const reach = layerReach(layer);
      assert.ok(reach <= ROOM + EPSILON, `n=${n} ${layer.id}: reach ${reach} > ${ROOM}`);
    }
  }
});

test("an icon's shadow lies down and to the right, and turns with the icon", () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const rest = iconBounds(0.4, 0);
  assert.ok(near(rest.left, 0.2) && near(rest.top, 0.2), 'nothing up or to the left');
  assert.ok(rest.right > 0.2 && rest.bottom > rest.right, 'more below than beside');
  const turned = iconBounds(0.4, 90);
  assert.ok(near(turned.right, 0.2) && turned.left > 0.2, 'a quarter turn: the shadow now lies to the left');
  assert.ok(near(turned.top, 0.2) && turned.bottom > 0.2, 'and still a little below');
  // a right-hand tilt: the first pass lies left of the icon, the last does not
  const tilted = iconBounds(0.4, 24);
  assert.ok(tilted.left > tilted.top - 1e-9 && tilted.left > 0.4 * (Math.abs(Math.cos(0.4189)) + Math.abs(Math.sin(0.4189))) / 2, 'the shadow of the first pass counts');
});

test('an app lies the way its id says: same rank, different id, different tilt', () => {
  const angleAt = (ids, rank) => layoutPile(ids).reverse()[rank].angle;
  const a = angleAt(['top.desktop', 'a.desktop', 'x.desktop'], 1);
  const b = angleAt(['top.desktop', 'b.desktop', 'x.desktop'], 1);
  assert.ok(a !== b, 'two apps at the same rank lie alike');
});

test('the same app at the same rank lies the same in any pile', () => {
  const angleOf = (ids) => layoutPile(ids).find((l) => l.id === 'tilt.desktop').angle;
  const alone = angleOf(['top.desktop', 'a.desktop', 'tilt.desktop']);
  assert.equal(angleOf(['other.desktop', 'b.desktop', 'tilt.desktop']), alone, 'another set');
  assert.equal(angleOf(['other.desktop', 'b.desktop', 'tilt.desktop', 'c.desktop']), alone, 'a bigger pile');
});

test('an app keeps its tilt direction when the pile around it changes', () => {
  const direction = (ids) =>
    Math.sign(layoutPile(ids).find((l) => l.id === 'tilt.desktop').angle);
  const base = direction(['top.desktop', 'tilt.desktop']);
  assert.ok(base !== 0, 'tilted');
  assert.equal(direction(['top.desktop', 'a.desktop', 'tilt.desktop']), base, 'moved down one');
  assert.equal(direction(['top.desktop', 'a.desktop', 'b.desktop', 'tilt.desktop']), base, 'moved down two');
});

test('the heap is tossed: tilted, and not every icon at the same spot', () => {
  const layers = layoutPile(appIds(9));
  assert.ok(layers.every((l) => Math.abs(l.angle) > 0 && Math.abs(l.angle) < 45), 'tilt range');
  const spots = new Set(layers.map((l) => `${l.x.toFixed(3)},${l.y.toFixed(3)}`));
  assert.equal(spots.size, layers.length, 'icons share a spot');
});

test('the heap is centred on the plate: its bounding box, shadow included', () => {
  for (const n of [2, 4, 5, 6, 9]) {
    const { minX, maxX, minY, maxY } = extent(layoutPile(appIds(n)));
    assert.ok(Math.abs(minX + maxX) < 0.01, `n=${n}: horizontal midpoint ${(minX + maxX) / 2}`);
    assert.ok(Math.abs(minY + maxY) < 0.01, `n=${n}: vertical midpoint ${(minY + maxY) / 2}`);
  }
});

test('icons shrink as the heap grows, never below a readable size', () => {
  for (let n = 1; n < 18; n++) {
    assert.ok(iconSide(n + 1) <= iconSide(n), `${n + 1} icons are bigger than ${n}`);
  }
  assert.ok(iconSide(1) > iconSide(9), 'bigger alone');
  assert.ok(iconSide(18) > 0 && iconSide(18) <= iconSide(9), 'still positive with the most icons');
});

test('numbers are finite and layers carry only what the renderer needs', () => {
  for (const layer of layoutPile(appIds(9))) {
    assert.deepEqual(Object.keys(layer).sort(), ['angle', 'id', 'scale', 'x', 'y']);
    assert.ok([layer.x, layer.y, layer.angle, layer.scale].every(Number.isFinite), 'finite');
  }
});

run();
