// gjs -m tests/window_feedback_rect_check.js
// WindowFeedback._itemRect: the rect a window minimizes into, an icon at rest
// in its dash slot, on every edge, shown and autohidden.
import System from 'system';

import { importWithStubs, createChecker } from './harness.js';

const { check, finish } = createChecker();
const { module } = await importWithStubs('windowFeedback.js', {
  stubs: {
    './dock.js': "export const DockPosition = { BOTTOM: 'bottom', LEFT: 'left', RIGHT: 'right', TOP: 'top' };",
  },
});
const rect = (dock, container) => module.WindowFeedback.prototype._itemRect.call(module.WindowFeedback.prototype, dock, container);

function dockAt(position, { edge = 10, slide = 0 } = {}) {
  const vertical = position === 'left' || position === 'right';
  return {
    _position: position,
    _iconSizeScaledDown: 48,
    _scaleFactor: 1.5,
    _edge_distance: edge,
    isVertical: () => vertical,
    dash: { translationX: vertical ? slide : 0, translationY: vertical ? 0 : slide },
  };
}
const container = (extra = {}) => ({
  width: 100, height: 100,
  get_transformed_position: () => [200, 300],
  _icon: { translationX: 5, translationY: 7 },
  ...extra,
});

// 72 px icon centred in a 100 px slot: +14 on both axes
let r = rect(dockAt('bottom'), container());
check(r.x === 200 + 14 + 5 && r.y === 300 + 14 - 10 && r.width === 72 && r.side === 'bottom',
  `bottom: ${JSON.stringify(r)}`);
r = rect(dockAt('top'), container());
check(r.x === 219 && r.y === 300 + 14 + 10, `top: icon is lifted inwards (${r.y})`);
r = rect(dockAt('left'), container());
check(r.x === 200 + 14 + 10 && r.y === 300 + 14 + 7, `left: ${JSON.stringify(r)}`);
r = rect(dockAt('right'), container());
check(r.x === 200 + 14 - 10 && r.y === 321, `right: ${JSON.stringify(r)}`);
r = rect(dockAt('bottom', { slide: 40 }), container());
check(r.y === 300 + 14 - 10 - 40, `autohidden bottom dock aims where the icon is when shown (${r.y})`);
r = rect(dockAt('bottom'), container({ _translate: -3 }));
check(r.x === 200 + 14 - 3, '_translate wins over the eased translation');
r = rect(dockAt('bottom'), container({ get_transformed_position: () => [NaN, 1] }));
check(r === null, 'an unmeasured item has no rect');
r = rect({ ...dockAt('bottom'), dash: null }, container());
check(r === null, 'a dock without a dash has no rect');

finish();
System.exit(0);
