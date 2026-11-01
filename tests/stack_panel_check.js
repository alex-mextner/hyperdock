// gjs -m tests/stack_panel_check.js - the stack popover's rules that need no
// GNOME Shell: which presses close it. Exits 1 on failure.
import { createChecker, importWithStubs } from './harness.js';

const { check, finish } = createChecker();
// the panel class extends St.Widget: any GObject class stands in for it
const { module } = await importWithStubs('stackPanel.js', {
  stubs: {
    'gi://St': `import GObject from 'gi://GObject';
      const Widget = GObject.registerClass(class StubWidget extends GObject.Object {});
      export default { Widget };`,
  },
});
const { pressClosesPanel, withStackOption } = module;

// Clutter's contains(): true for the actor itself and its descendants
const popover = { contains: (a) => a === popover || a === cell };
const cell = {};
const outside = {};

check(pressClosesPanel(popover, outside) === true, 'a press outside the popover closes the panel');
check(pressClosesPanel(popover, cell) === false, 'a press on a file inside the popover leaves it open and unhandled');
check(pressClosesPanel(popover, popover) === false, 'a press on the popover itself leaves it open');
check(pressClosesPanel(popover, null) === true, 'a press with no actor under it counts as outside');

// ---- persisting a stack option in folder-stacks ------------------------------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const listed = [{ path: '/p/a', view: 'grid' }, '/p/b'];
check(
  same(withStackOption(listed, { entryIndex: 0 }, 'group', 'kind'), [{ path: '/p/a', view: 'grid', group: 'kind' }, '/p/b']),
  'an option change keeps the rest of the entry'
);
check(
  same(withStackOption(listed, { entryIndex: 1 }, 'sort', 'name')[1], { path: '/p/b', sort: 'name' }),
  'a plain path entry becomes an object with the option'
);
check(listed[0].group === undefined, 'the stored list is not mutated');
check(withStackOption(listed, { entryIndex: 5 }, 'sort', 'name') === listed, 'a vanished entry changes nothing');
const builtin = { path: '/home/u/Pictures/Screenshots', view: 'automatic', sort: 'date-added', display: 'stack', group: 'date' };
check(
  same(withStackOption(listed, builtin, 'view', 'grid')[2], { ...builtin, view: 'grid' }),
  'the built-in Screenshots stack is appended with its current options and the change'
);

finish();
