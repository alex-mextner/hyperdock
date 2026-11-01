// gjs -m tests/stack_menu_model_check.js - what the context menus of a stack
// dropdown hold (pure logic, no GNOME Shell): entries, enabling, accelerators,
// submenus and the separators, for every combination of context flags.
// Exits 1 on failure.
import { createChecker } from './harness.js';
import { backgroundMenu, itemMenu } from '../stackMenuModel.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const APPS = [
  { id: 'org.gnome.eog.desktop', name: 'Image Viewer' },
  { id: 'gimp.desktop', name: 'GNU Image Manipulation Program' },
];
const COMMANDS = new Set([
  'open',
  'properties',
  'quickLook',
  'selectAll',
  'copy',
  'cut',
  'paste',
  'trash',
  'deletePermanently',
  'removeFromRecents',
  'clearRecents',
  'rename',
  'undo',
  'newFolder',
  'copyPath',
  'showInFiles',
  'openWith',
  'wallpaper',
  'sort',
  'group',
  'view',
]);
const entries = (menu) => menu.filter((item) => item !== '-');
const ids = (menu) => entries(menu).map((item) => item.id);
const find = (menu, id) => entries(menu).find((item) => item.id === id);
const shape = (menu) => menu.map((item) => (item === '-' ? '-' : item.id));

// ---- structure that must hold whatever the context -------------------------
// Each property is checked on every context; one line per property says
// whether it held everywhere and names the first context where it did not.
const PROPERTIES = {
  'a non-empty array': (menu) => Array.isArray(menu) && menu.length > 0,
  'no separator at either end': (menu) =>
    menu[0] !== '-' && menu[menu.length - 1] !== '-',
  'no two separators in a row': (menu) =>
    menu.every((item, i) => item !== '-' || menu[i - 1] !== '-'),
  'every id once': (menu) => new Set(ids(menu)).size === ids(menu).length,
  'every entry has id, label and a boolean enabled': (menu) =>
    entries(menu).every(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.label === 'string' &&
        item.label !== '' &&
        typeof item.enabled === 'boolean'
    ),
  'accel is a non-empty string or absent': (menu) =>
    entries(menu).every(
      (item) =>
        item.accel === undefined ||
        (typeof item.accel === 'string' && item.accel !== '')
    ),
  'top-level ids are command names': (menu) =>
    entries(menu).every((item) => COMMANDS.has(item.id)),
  'children have prefixed ids, labels and enabled': (menu) =>
    entries(menu)
      .flatMap((item) => item.children ?? [])
      .every(
        (kid) =>
          typeof kid.id === 'string' &&
          kid.id.includes(':') &&
          typeof kid.label === 'string' &&
          typeof kid.enabled === 'boolean'
      ),
  'a submenu is never empty': (menu) =>
    entries(menu).every(
      (item) =>
        item.children === undefined ||
        (Array.isArray(item.children) && item.children.length > 0)
    ),
};
const firstFailure = new Map();
function wellFormed(menu, where) {
  const isArray = PROPERTIES['a non-empty array'](menu);
  for (const [name, holds] of Object.entries(PROPERTIES)) {
    if (!firstFailure.has(name) && !(isArray && holds(menu)))
      firstFailure.set(name, where);
  }
}
function report(prefix) {
  for (const name of Object.keys(PROPERTIES)) {
    check(
      !firstFailure.has(name),
      `${prefix}: ${name}${firstFailure.has(name) ? ` (first broken for ${firstFailure.get(name)})` : ''}`
    );
  }
  firstFailure.clear();
}

// ---- item menu: every combination ---------------------------------------------
let combos = 0;
for (const kind of ['folder', 'recents']) {
  for (const writable of [false, true]) {
    for (const count of [0, 1, 2, 50]) {
      for (const isImage of [false, true]) {
        for (const inTrash of [false, true]) {
          for (const clipboardHasFiles of [false, true]) {
            for (const openWith of [[], APPS]) {
              const ctx = {
                kind: 'file',
                count,
                isImage,
                stack: { kind, writable },
                clipboardHasFiles,
                openWith,
                inTrash,
              };
              combos += 1;
              wellFormed(
                itemMenu(ctx),
                `item ${JSON.stringify({ kind, writable, count, isImage, inTrash, clipboardHasFiles, apps: openWith.length })}`
              );
            }
          }
        }
      }
    }
  }
}
check(
  combos === 2 * 2 * 4 * 2 * 2 * 2 * 2,
  `all ${combos} item contexts were checked`
);
report(`every item menu of ${combos} contexts`);

// ---- item menu: the file menu ---------------------------------------------------
const FILE = {
  kind: 'file',
  count: 1,
  isImage: false,
  stack: { kind: 'folder', writable: true },
  clipboardHasFiles: false,
  openWith: APPS,
  inTrash: false,
};
{
  const menu = itemMenu(FILE);
  check(
    same(shape(menu), [
      'open',
      'openWith',
      '-',
      'quickLook',
      '-',
      'copy',
      'cut',
      '-',
      'rename',
      'trash',
      '-',
      'copyPath',
      'showInFiles',
      'properties',
    ]),
    'a file menu: Open, Open With | Quick Look | Copy, Cut | Rename, Move to Trash | Copy Path, Show in Files, Properties'
  );
  check(
    find(menu, 'paste') === undefined,
    'there is no Paste in the item menu'
  );
  check(
    find(menu, 'wallpaper') === undefined,
    'a file that is no image has no Set as Wallpaper'
  );
  check(
    same(
      entries(menu).map((item) => item.label),
      [
        'Open',
        'Open With',
        'Quick Look',
        'Copy',
        'Cut',
        'Rename',
        'Move to Trash',
        'Copy Path',
        'Show in Files',
        'Properties',
      ]
    ),
    'the labels are plain English'
  );
  const accel = Object.fromEntries(
    entries(menu).map((item) => [item.id, item.accel])
  );
  check(
    accel.open === 'Return' &&
      accel.quickLook === 'Space' &&
      accel.copy === 'Ctrl+C' &&
      accel.cut === 'Ctrl+X',
    'accelerators of Open, Quick Look, Copy, Cut'
  );
  check(
    accel.rename === 'F2' &&
      accel.trash === 'Delete' &&
      accel.copyPath === 'Ctrl+Shift+C' &&
      accel.showInFiles === 'Ctrl+R' &&
      accel.properties === 'Alt+Return',
    'accelerators of Rename, Trash, Copy Path, Show in Files, Properties'
  );
  check(
    accel.openWith === undefined && !('accel' in find(menu, 'openWith')),
    'the Open With submenu has no accelerator'
  );
  check(
    entries(menu).every((item) => item.enabled),
    'in a writable folder with one item everything is enabled'
  );
  const openWith = find(menu, 'openWith');
  check(
    same(
      openWith.children.map((kid) => kid.id),
      ['openWith:org.gnome.eog.desktop', 'openWith:gimp.desktop']
    ),
    'Open With lists the apps by id, in the given order'
  );
  check(
    same(
      openWith.children.map((kid) => kid.label),
      ['Image Viewer', 'GNU Image Manipulation Program']
    ),
    'Open With shows the app names'
  );
  check(
    openWith.children.every(
      (kid) => kid.enabled === true && kid.children === undefined
    ),
    'Open With children are enabled leaves'
  );
}
{
  check(ids(itemMenu({ ...FILE, count: 1, openWith: APPS })).includes('openWith'), 'one item has Open With');
  check(
    [0, 2, 50].every((count) => !ids(itemMenu({ ...FILE, count, openWith: APPS })).includes('openWith')),
    'no item and several items have no Open With'
  );
}
{
  const menu = itemMenu({ ...FILE, openWith: [] });
  check(
    !ids(menu).includes('openWith'),
    'Open With is absent when no app can open the file'
  );
  check(
    shape(menu)[0] === 'open' && shape(menu)[1] === '-',
    'without Open With the first group is Open alone'
  );
  check(
    !ids(itemMenu({ ...FILE, openWith: undefined })).includes('openWith'),
    'an undefined app list is no Open With'
  );
  check(
    !ids(itemMenu({ ...FILE, openWith: null })).includes('openWith'),
    'a null app list is no Open With'
  );
}
{
  const readOnly = itemMenu({
    ...FILE,
    stack: { kind: 'folder', writable: false },
  });
  check(
    find(readOnly, 'cut').enabled === false,
    'Cut is disabled in a read-only stack'
  );
  check(
    find(readOnly, 'trash').enabled === false,
    'Move to Trash is disabled in a read-only stack'
  );
  check(
    find(readOnly, 'rename').enabled === false,
    'Rename is disabled in a read-only stack'
  );
  check(
    find(readOnly, 'copy').enabled &&
      find(readOnly, 'open').enabled &&
      find(readOnly, 'quickLook').enabled &&
      find(readOnly, 'copyPath').enabled &&
      find(readOnly, 'showInFiles').enabled &&
      find(readOnly, 'properties').enabled,
    'Copy, Open, Quick Look, Copy Path, Show in Files and Properties work in a read-only stack'
  );
  check(
    find(itemMenu({ ...FILE, stack: { kind: 'folder' } }), 'cut').enabled ===
      false,
    'a stack without a writable flag is read-only'
  );
  check(
    find(
      itemMenu({ ...FILE, stack: { kind: 'folder', writable: 'yes' } }),
      'cut'
    ).enabled === false,
    'writable must be exactly true'
  );
}
for (const count of [0, 2, 3, 99]) {
  const menu = itemMenu({ ...FILE, count });
  check(
    find(menu, 'rename').enabled === false,
    `Rename is disabled for ${count} items`
  );
  check(
    find(menu, 'trash').enabled === true && find(menu, 'cut').enabled === true,
    `Cut and Trash stay enabled for ${count} items`
  );
}
check(
  find(itemMenu({ ...FILE, count: 1 }), 'rename').enabled === true,
  'Rename is enabled for exactly one item'
);
{
  const menu = itemMenu({ ...FILE, isImage: true });
  check(
    same(shape(menu), [
      'open',
      'openWith',
      'wallpaper',
      '-',
      'quickLook',
      '-',
      'copy',
      'cut',
      '-',
      'rename',
      'trash',
      '-',
      'copyPath',
      'showInFiles',
      'properties',
    ]),
    'an image adds Set as Wallpaper right after the Open With group'
  );
  check(
    find(menu, 'wallpaper').label === 'Set as Wallpaper' &&
      find(menu, 'wallpaper').enabled === true,
    'Set as Wallpaper is enabled for one image'
  );
  check(
    find(menu, 'wallpaper').accel === undefined,
    'Set as Wallpaper has no hotkey'
  );
  check(
    find(itemMenu({ ...FILE, isImage: true, count: 3 }), 'wallpaper')
      .enabled === false,
    'Set as Wallpaper is disabled for several images'
  );
  check(
    same(
      shape(itemMenu({ ...FILE, isImage: true, openWith: [] })).slice(0, 4),
      ['open', 'wallpaper', '-', 'quickLook']
    ),
    'an image without Open With apps: Open, Set as Wallpaper'
  );
}
{
  const menu = itemMenu({ ...FILE, inTrash: true });
  check(
    find(menu, 'trash') === undefined &&
      find(menu, 'deletePermanently') !== undefined,
    'in the Trash Move to Trash becomes Delete Permanently'
  );
  const gone = find(menu, 'deletePermanently');
  check(
    gone.label === 'Delete Permanently' &&
      gone.accel === 'Shift+Delete' &&
      gone.enabled === true,
    'Delete Permanently has its hotkey and is enabled in a writable stack'
  );
  check(
    find(
      itemMenu({
        ...FILE,
        inTrash: true,
        stack: { kind: 'folder', writable: false },
      }),
      'deletePermanently'
    ).enabled === false,
    'Delete Permanently is disabled in a read-only stack'
  );
  check(
    shape(menu).join() ===
      shape(itemMenu(FILE)).join().replace('trash', 'deletePermanently'),
    'the Trash menu has the same layout'
  );
}
{
  const menu = itemMenu({
    ...FILE,
    stack: { kind: 'recents', writable: false },
  });
  check(
    same(shape(menu), ['open', '-', 'removeFromRecents']),
    'a recents stack: Open, separator, Remove from Recents, nothing else'
  );
  check(
    find(menu, 'removeFromRecents').label === 'Remove from Recents' &&
      find(menu, 'removeFromRecents').accel === 'Delete',
    'Remove from Recents has its label and hotkey'
  );
  check(
    entries(menu).every((item) => item.enabled),
    'both recents entries are enabled'
  );
  check(
    same(
      shape(
        itemMenu({
          ...FILE,
          stack: { kind: 'recents', writable: true },
          isImage: true,
          inTrash: true,
        })
      ),
      ['open', '-', 'removeFromRecents']
    ),
    'flags do not add anything to a recents menu'
  );
}
check(itemMenu(FILE) !== itemMenu(FILE), 'every call builds a fresh array');
{
  const ctx = JSON.parse(JSON.stringify(FILE));
  const before = JSON.stringify(ctx);
  itemMenu(ctx);
  check(JSON.stringify(ctx) === before, 'the item context is not modified');
  const first = itemMenu(ctx);
  first[0].label = 'Changed';
  check(
    itemMenu(ctx)[0].label === 'Open',
    'changing a returned entry changes no later menu'
  );
}
check(
  ids(itemMenu({})).length > 0 && ids(itemMenu()).length > 0,
  'an empty or missing context still gives a menu'
);
{
  const apps = [{ id: 'a b&c<d>.desktop', name: 'Ünï 🌍 Приложение' }];
  const kid = find(itemMenu({ ...FILE, openWith: apps }), 'openWith')
    .children[0];
  check(
    kid.id === 'openWith:a b&c<d>.desktop' && kid.label === 'Ünï 🌍 Приложение',
    'odd app ids and names pass through verbatim'
  );
  const many = Array.from({ length: 300 }, (_, i) => ({
    id: `app${i}.desktop`,
    name: `App ${i}`,
  }));
  check(
    find(itemMenu({ ...FILE, openWith: many }), 'openWith').children.length ===
      300,
    'many apps are all listed'
  );
}

// ---- background menu: every combination ------------------------------------------
let backgrounds = 0;
for (const kind of ['folder', 'recents']) {
  for (const writable of [false, true]) {
    for (const clipboardHasFiles of [false, true]) {
      for (const canUndo of [false, true]) {
        for (const sort of [
          'name',
          'date-added',
          'date-modified',
          'date-created',
          'kind',
          'bogus',
          undefined,
        ]) {
          for (const group of ['none', 'date', 'kind', 'bogus', undefined]) {
            for (const view of [
              'fan',
              'grid',
              'list',
              'automatic',
              'bogus',
              undefined,
            ]) {
              backgrounds += 1;
              wellFormed(
                backgroundMenu({
                  stack: { kind, writable, view, sort, group },
                  clipboardHasFiles,
                  canUndo,
                }),
                `background ${JSON.stringify({ kind, writable, clipboardHasFiles, canUndo, sort, group, view })}`
              );
            }
          }
        }
      }
    }
  }
}
check(
  backgrounds === 2 * 2 * 2 * 2 * 7 * 5 * 6,
  `all ${backgrounds} background contexts were checked`
);
report(`every background menu of ${backgrounds} contexts`);

// ---- background menu: contents ---------------------------------------------------
const STACK = {
  kind: 'folder',
  writable: true,
  view: 'grid',
  sort: 'name',
  group: 'date',
};
const BG = { stack: STACK, clipboardHasFiles: true, canUndo: true };
{
  const menu = backgroundMenu(BG);
  check(
    same(shape(menu), [
      'paste',
      'newFolder',
      'undo',
      '-',
      'selectAll',
      '-',
      'sort',
      'group',
      'view',
      '-',
      'showInFiles',
    ]),
    'the background menu: Paste, New Folder, Undo | Select All | Sort by, Group by, View as | Open in Files'
  );
  check(
    same(
      entries(menu).map((item) => item.label),
      [
        'Paste',
        'New Folder',
        'Undo',
        'Select All',
        'Sort by',
        'Group by',
        'View as',
        'Open in Files',
      ]
    ),
    'the labels are plain English'
  );
  const accel = Object.fromEntries(
    entries(menu).map((item) => [item.id, item.accel])
  );
  check(
    accel.paste === 'Ctrl+V' &&
      accel.newFolder === 'Ctrl+Shift+N' &&
      accel.undo === 'Ctrl+Z' &&
      accel.selectAll === 'Ctrl+A',
    'accelerators of Paste, New Folder, Undo, Select All'
  );
  check(
    accel.sort === undefined &&
      accel.group === undefined &&
      accel.view === undefined &&
      accel.showInFiles === undefined,
    'submenus and Open in Files have no accelerator (the hotkey needs a selection)'
  );
  check(
    entries(menu).every((item) => item.enabled),
    'with files on the clipboard, an undo and a writable stack everything is enabled'
  );
}
{
  const states = (stackPatch, ctxPatch) => {
    const menu = backgroundMenu({
      ...BG,
      ...ctxPatch,
      stack: { ...STACK, ...stackPatch },
    });
    return Object.fromEntries(
      entries(menu).map((item) => [item.id, item.enabled])
    );
  };
  check(
    states({}, { clipboardHasFiles: false }).paste === false,
    'Paste is disabled with nothing to paste'
  );
  check(
    states({ writable: false }, {}).paste === false,
    'Paste is disabled in a read-only stack'
  );
  check(
    states({}, {}).paste === true,
    'Paste is enabled with files on the clipboard in a writable stack'
  );
  check(
    states({ writable: false }, {}).newFolder === false &&
      states({}, {}).newFolder === true,
    'New Folder follows writable'
  );
  check(
    states({}, { canUndo: false }).undo === false &&
      states({ writable: false }, {}).undo === true,
    'Undo follows canUndo only'
  );
  check(
    states({ writable: false }, { clipboardHasFiles: false, canUndo: false })
      .selectAll === true,
    'Select All is always enabled'
  );
  const all = states(
    { writable: false },
    { clipboardHasFiles: false, canUndo: false }
  );
  check(
    all.showInFiles === true &&
      all.sort === true &&
      all.group === true &&
      all.view === true,
    'Open in Files and the submenus are always enabled'
  );
  check(
    states({}, { clipboardHasFiles: 'yes' }).paste === false,
    'clipboardHasFiles must be exactly true'
  );
  check(
    states({}, { canUndo: 1 }).undo === false,
    'canUndo must be exactly true'
  );
}
{
  const menu = backgroundMenu(BG);
  const labelsOf = (id) => find(menu, id).children.map((kid) => kid.label);
  const idsOf = (id) => find(menu, id).children.map((kid) => kid.id);
  check(
    same(idsOf('sort'), [
      'sort:name',
      'sort:date-added',
      'sort:date-modified',
      'sort:date-created',
      'sort:kind',
    ]),
    'Sort by offers the five sort orders'
  );
  check(
    same(labelsOf('sort'), [
      'Name',
      'Date Added',
      'Date Modified',
      'Date Created',
      'Kind',
    ]),
    'Sort by labels'
  );
  check(
    same(idsOf('group'), ['group:none', 'group:date', 'group:kind']),
    'Group by offers none, date and kind'
  );
  check(same(labelsOf('group'), ['None', 'Date', 'Kind']), 'Group by labels');
  check(
    same(idsOf('view'), [
      'view:fan',
      'view:grid',
      'view:list',
      'view:automatic',
    ]),
    'View as offers the four views'
  );
  check(
    same(labelsOf('view'), ['Fan', 'Grid', 'List', 'Automatic']),
    'View as labels'
  );
  const checkedOf = (id) =>
    find(menu, id)
      .children.filter((kid) => kid.checked === true)
      .map((kid) => kid.id);
  check(
    same(checkedOf('sort'), ['sort:name']),
    'the current sort order is checked'
  );
  check(
    same(checkedOf('group'), ['group:date']),
    'the current grouping is checked'
  );
  check(same(checkedOf('view'), ['view:grid']), 'the current view is checked');
  check(
    ['sort', 'group', 'view'].every((id) =>
      find(menu, id).children.every(
        (kid) => typeof kid.checked === 'boolean' && kid.enabled === true
      )
    ),
    'every choice says whether it is checked and is enabled'
  );
  for (const sort of [
    'name',
    'date-added',
    'date-modified',
    'date-created',
    'kind',
  ]) {
    const m = backgroundMenu({ ...BG, stack: { ...STACK, sort } });
    check(
      same(
        find(m, 'sort')
          .children.filter((kid) => kid.checked)
          .map((kid) => kid.id),
        [`sort:${sort}`]
      ),
      `exactly sort:${sort} is checked when it is current`
    );
  }
  for (const group of ['none', 'date', 'kind']) {
    const m = backgroundMenu({ ...BG, stack: { ...STACK, group } });
    check(
      same(
        find(m, 'group')
          .children.filter((kid) => kid.checked)
          .map((kid) => kid.id),
        [`group:${group}`]
      ),
      `exactly group:${group} is checked when it is current`
    );
  }
  for (const view of ['fan', 'grid', 'list', 'automatic']) {
    const m = backgroundMenu({ ...BG, stack: { ...STACK, view } });
    check(
      same(
        find(m, 'view')
          .children.filter((kid) => kid.checked)
          .map((kid) => kid.id),
        [`view:${view}`]
      ),
      `exactly view:${view} is checked when it is current`
    );
  }
  const unknown = backgroundMenu({
    ...BG,
    stack: { ...STACK, sort: 'bogus', group: undefined, view: null },
  });
  check(
    ['sort', 'group', 'view'].every((id) =>
      find(unknown, id).children.every((kid) => kid.checked === false)
    ),
    'an unknown current choice checks nothing'
  );
}
{
  const menu = backgroundMenu({
    stack: {
      kind: 'recents',
      writable: false,
      view: 'list',
      sort: 'kind',
      group: 'none',
    },
    clipboardHasFiles: true,
    canUndo: false,
  });
  check(
    ['paste', 'newFolder', 'undo', 'selectAll', 'sort', 'group', 'showInFiles'].every(
      (id) => find(menu, id) === undefined
    ),
    'a recents background menu has no Paste, New Folder, Undo, Select All, Sort by, Group by or Open in Files'
  );
  check(
    same(shape(menu), ['clearRecents', '-', 'view']),
    'the recents background menu is Clear Recents, a separator and View as, nothing else'
  );
  check(
    find(menu, 'clearRecents').enabled === true &&
      find(menu, 'clearRecents').label === 'Clear Recents',
    'Clear Recents is always enabled'
  );
  const view = find(menu, 'view');
  check(
    same(
      view.children.map((kid) => kid.id),
      find(backgroundMenu(BG), 'view').children.map((kid) => kid.id)
    ) && view.label === 'View as',
    'the recents View as has the same choices as a folder stack'
  );
  check(
    same(
      view.children.filter((kid) => kid.checked).map((kid) => kid.id),
      ['view:list']
    ),
    'the recents View as marks the current choice'
  );
  const writable = backgroundMenu({
    stack: { kind: 'recents', writable: true, view: 'grid' },
    clipboardHasFiles: true,
    canUndo: true,
  });
  check(
    same(shape(writable), ['clearRecents', '-', 'view']),
    'a writable recents stack with a clipboard and an undo gets no folder entries'
  );
}
check(
  backgroundMenu(BG) !== backgroundMenu(BG),
  'every call builds a fresh array'
);
{
  const ctx = JSON.parse(JSON.stringify(BG));
  const before = JSON.stringify(ctx);
  const menu = backgroundMenu(ctx);
  menu[0].label = 'X';
  find(menu, 'sort').children[0].label = 'X';
  check(
    JSON.stringify(ctx) === before,
    'the background context is not modified'
  );
  check(
    find(backgroundMenu(ctx), 'sort').children[0].label === 'Name',
    'changing a returned submenu changes no later menu'
  );
}
check(
  ids(backgroundMenu({})).length === 8 && ids(backgroundMenu()).length === 8,
  'an empty or missing context still gives the whole menu'
);
check(
  find(backgroundMenu({}), 'paste').enabled === false &&
    find(backgroundMenu(), 'undo').enabled === false,
  'a missing context disables the conditional entries'
);

finish();
