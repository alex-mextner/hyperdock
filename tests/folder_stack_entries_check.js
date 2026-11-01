// gjs -m tests/folder_stack_entries_check.js - edits of the folder-stacks
// setting (pure logic, no GNOME Shell): parsing, adding, removing and moving
// folder entries. Exits 1 on failure.
import { createChecker } from './harness.js';
import {
  addFolder,
  entryPath,
  moveFolder,
  normalizeEntries,
  removeFolder,
} from '../folderStackEntries.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// the glue's normalize: '~' is the home folder, repeated and trailing slashes go
const env = {
  normalize(path) {
    const home =
      path === '~' || path.startsWith('~/') ? `/home/u${path.slice(1)}` : path;
    const squeezed = home.replace(/\/+/g, '/');
    return squeezed.length > 1 ? squeezed.replace(/\/$/, '') : squeezed;
  },
};
const calls = [];
const spyEnv = { normalize: (path) => (calls.push(path), env.normalize(path)) };
const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// ---- normalizeEntries ---------------------------------------------------------
{
  const raw = [
    '/home/u/a',
    {
      path: '/home/u/b',
      view: 'grid',
      sort: 'name',
      display: 'stack',
      group: 'kind',
      title: 'B',
      icon: 'folder',
      future: { n: 1 },
    },
    '',
    { path: '' },
    { path: 5 },
    { view: 'list' },
    null,
    7,
    ['/home/u/nested'],
    undefined,
    true,
    { path: ['x'] },
    '/home/u/c',
  ];
  const got = normalizeEntries(raw);
  check(
    same(got.map(entryPath), ['/home/u/a', '/home/u/b', '/home/u/c']),
    'only strings and objects with a path survive, in order'
  );
  check(same(got[1], raw[1]), 'an entry object keeps every field it has');
  check(
    got !== raw && raw.length === 13,
    'normalizeEntries returns a new array and does not touch its input'
  );
}
for (const raw of [
  undefined,
  null,
  'a string',
  42,
  true,
  {},
  { path: '/a' },
  '/home/u/a',
]) {
  check(
    same(normalizeEntries(raw), []),
    `a raw value that is no array gives []: ${JSON.stringify(raw)}`
  );
}
check(same(normalizeEntries([]), []), 'an empty array stays empty');
check(
  same(normalizeEntries(['  ']), ['  ']),
  'a blank but non-empty string is kept as the contract says non-empty'
);
check(
  same(normalizeEntries(['/a', '/a']), ['/a', '/a']),
  'duplicates are not merged by normalizeEntries'
);
check(
  normalizeEntries(['/ü/Привет 🌍/a b']).length === 1,
  'Unicode paths pass'
);
{
  const big = Array.from({ length: 50000 }, (_, i) =>
    i % 2 ? `/p/${i}` : { path: `/q/${i}` }
  );
  const start = Date.now();
  check(
    normalizeEntries(big).length === 50000 && Date.now() - start < 1000,
    '50000 entries are filtered fast'
  );
}

// ---- entryPath ----------------------------------------------------------------
check(entryPath('/home/u/a') === '/home/u/a', 'a string entry is its own path');
check(
  entryPath({ path: '/home/u/b', view: 'grid' }) === '/home/u/b',
  'an object entry shows its path'
);
for (const entry of [
  undefined,
  null,
  5,
  {},
  { path: 5 },
  { path: null },
  [],
  ['/a'],
  true,
]) {
  check(
    entryPath(entry) === '',
    `an entry without a path is '': ${JSON.stringify(entry)}`
  );
}
check(entryPath({ path: '' }) === '', 'an empty path is empty');

// ---- addFolder ----------------------------------------------------------------
{
  const entries = deepFreeze([
    '/home/u/a',
    { path: '/home/u/b', view: 'list' },
  ]);
  const got = addFolder(entries, '/home/u/c', undefined, env);
  check(
    same(got, [
      '/home/u/a',
      { path: '/home/u/b', view: 'list' },
      { path: '/home/u/c' },
    ]),
    'a new folder is appended as a { path } object'
  );
  check(
    got !== entries && entries.length === 2,
    'addFolder returns a new array and does not mutate the input'
  );
  check(got[1] === entries[1], 'existing entries are carried over untouched');
}
{
  const entries = ['/a', '/b', '/c'];
  check(
    same(addFolder(entries, '/x', 0, env).map(entryPath), [
      '/x',
      '/a',
      '/b',
      '/c',
    ]),
    'index 0 inserts at the front'
  );
  check(
    same(addFolder(entries, '/x', 1, env).map(entryPath), [
      '/a',
      '/x',
      '/b',
      '/c',
    ]),
    'index 1 inserts between the first two'
  );
  check(
    same(addFolder(entries, '/x', 3, env).map(entryPath), [
      '/a',
      '/b',
      '/c',
      '/x',
    ]),
    'index = length appends'
  );
  check(
    same(addFolder(entries, '/x', 99, env).map(entryPath), [
      '/a',
      '/b',
      '/c',
      '/x',
    ]),
    'an index past the end is clamped'
  );
  check(
    same(addFolder(entries, '/x', Infinity, env).map(entryPath), [
      '/a',
      '/b',
      '/c',
      '/x',
    ]),
    'an infinite index appends'
  );
  check(
    same(addFolder(entries, '/x', -5, env).map(entryPath), [
      '/x',
      '/a',
      '/b',
      '/c',
    ]),
    'a negative index is clamped to the front'
  );
  check(
    same(addFolder(entries, '/x', -1, env).map(entryPath), [
      '/x',
      '/a',
      '/b',
      '/c',
    ]),
    'index -1 is the front, not the end'
  );
  check(
    same(addFolder(entries, '/x', -2, env).map(entryPath), [
      '/x',
      '/a',
      '/b',
      '/c',
    ]),
    'index -2 is the front, not before the last entry'
  );
  check(
    same(addFolder(entries, '/x', -Infinity, env).map(entryPath), [
      '/x',
      '/a',
      '/b',
      '/c',
    ]),
    'a minus-infinite index goes to the front'
  );
  check(
    same(addFolder(entries, '/x', 1.9, env).map(entryPath), [
      '/a',
      '/x',
      '/b',
      '/c',
    ]),
    'a fractional index is floored'
  );
  check(
    same(addFolder(entries, '/x', NaN, env).map(entryPath), [
      '/a',
      '/b',
      '/c',
      '/x',
    ]),
    'a NaN index appends'
  );
  check(
    same(addFolder(entries, '/x', null, env).map(entryPath), [
      '/a',
      '/b',
      '/c',
      '/x',
    ]),
    'a null index appends'
  );
  check(
    same(addFolder(entries, '/x', '1', env).map(entryPath), [
      '/a',
      '/b',
      '/c',
      '/x',
    ]),
    'an index that is no number appends'
  );
  check(
    same(addFolder([], '/x', 5, env), [{ path: '/x' }]),
    'into an empty list at any index'
  );
  check(
    same(entries, ['/a', '/b', '/c']),
    'the input is intact after all that'
  );
}
{
  const entries = ['/home/u/Pictures'];
  check(
    addFolder(entries, '/home/u/Pictures', undefined, env) === entries,
    'the same path is a no-op returning the same array'
  );
  check(
    addFolder(entries, '/home/u/Pictures/', undefined, env) === entries,
    'a trailing slash is the same folder'
  );
  check(
    addFolder(entries, '~/Pictures', undefined, env) === entries,
    '~ resolves through env.normalize to the same folder'
  );
  check(
    addFolder(entries, '/home//u/Pictures///', 0, env) === entries,
    'repeated slashes are the same folder'
  );
  check(
    addFolder(['~/Music/'], '/home/u/Music', undefined, env).length === 1,
    'an entry written with ~ and a slash matches a plain path'
  );
  check(
    addFolder(
      [{ path: '/home/u/Pictures/', view: 'grid' }],
      '/home/u/Pictures',
      0,
      env
    ).length === 1,
    'an object entry matches too'
  );
  check(
    addFolder(entries, '/home/u/pictures', undefined, env).length === 2,
    'paths differing in case are different folders'
  );
  check(
    addFolder(entries, '/home/u/Pictures2', undefined, env).length === 2,
    'a longer name is a different folder'
  );
  check(
    addFolder(entries, '/home/u/Pictures/sub', undefined, env).length === 2,
    'a subfolder is a different folder'
  );
}
{
  const entries = [null, 5, { view: 'grid' }, '', '/a'];
  const got = addFolder(entries, '/b', undefined, env);
  check(
    same(got, [null, 5, { view: 'grid' }, '', '/a', { path: '/b' }]),
    'garbage entries are kept and never match'
  );
  check(
    addFolder(entries, '/a', undefined, env) === entries,
    'a real entry among garbage is still found'
  );
}
for (const path of [undefined, null, '', 5, {}, ['/a']]) {
  const entries = ['/a'];
  check(
    addFolder(entries, path, 0, env) === entries,
    `a path that is no usable string adds nothing: ${JSON.stringify(path)}`
  );
}
check(
  same(addFolder(undefined, '/a', undefined, env), [{ path: '/a' }]),
  'entries that are no array count as empty'
);
check(
  same(addFolder('junk', '/a', undefined, env), [{ path: '/a' }]),
  'entries given as a string count as empty'
);
check(
  same(addFolder(['/a'], '~/ü Привет 🌍', 1, env), [
    '/a',
    { path: '~/ü Привет 🌍' },
  ]),
  'the path is stored as given, Unicode included'
);
{
  calls.length = 0;
  addFolder(['/a', '/b'], '/c', undefined, spyEnv);
  check(
    calls.includes('/c') && calls.includes('/a') && calls.includes('/b'),
    'every comparison goes through env.normalize'
  );
}

// ---- removeFolder ---------------------------------------------------------------
{
  const entries = deepFreeze([
    '/home/u/a',
    { path: '/home/u/b/', view: 'list' },
    '~/c',
    '/home/u/b',
  ]);
  const got = removeFolder(entries, '/home/u/b', env);
  check(
    same(got, ['/home/u/a', '~/c']),
    'every entry of that normalized path is removed (string and object)'
  );
  check(
    got !== entries && entries.length === 4,
    'removeFolder returns a new array and does not mutate the input'
  );
  check(
    same(removeFolder(entries, '~/c/', env), [
      '/home/u/a',
      { path: '/home/u/b/', view: 'list' },
      '/home/u/b',
    ]),
    'a ~ entry is removed through its normalized path'
  );
  check(
    removeFolder(entries, '/home/u/zzz', env) === entries,
    'nothing to remove returns the same array'
  );
}
{
  const entries = [null, { view: 'x' }, '/a', ''];
  check(
    same(removeFolder(entries, '/a', env), [null, { view: 'x' }, '']),
    'garbage is kept when a real entry is removed'
  );
  check(
    same(removeFolder(['/a'], '/a', env), []),
    'removing the last entry leaves []'
  );
  check(
    removeFolder([], '/a', env).length === 0,
    'removing from an empty list'
  );
}
for (const path of [undefined, null, '', 5, {}]) {
  const entries = ['/a', ''];
  check(
    removeFolder(entries, path, env) === entries,
    `a path that is no usable string removes nothing: ${JSON.stringify(path)}`
  );
}
check(
  same(removeFolder(undefined, '/a', env), []) &&
    same(removeFolder('junk', '/a', env), []),
  'entries that are no array count as empty'
);

// ---- moveFolder ----------------------------------------------------------------------
{
  const entries = deepFreeze(['/a', { path: '/b', view: 'grid' }, '/c', '/d']);
  const names = (list) => list.map(entryPath);
  check(
    same(names(moveFolder(entries, 0, 2)), ['/b', '/c', '/a', '/d']),
    'the first entry moved to index 2 ends at index 2'
  );
  check(
    same(names(moveFolder(entries, 2, 0)), ['/c', '/a', '/b', '/d']),
    'the third entry moved to the front'
  );
  check(
    same(names(moveFolder(entries, 1, 3)), ['/a', '/c', '/d', '/b']),
    'an entry moved to the end'
  );
  check(
    same(names(moveFolder(entries, 3, 2)), ['/a', '/b', '/d', '/c']),
    'one step back'
  );
  check(
    same(names(moveFolder(entries, 0, 1)), ['/b', '/a', '/c', '/d']),
    'one step forward'
  );
  check(
    same(names(moveFolder(entries, 0, 99)), ['/b', '/c', '/d', '/a']),
    'a target past the end is clamped to the end'
  );
  check(
    same(names(moveFolder(entries, 3, -4)), ['/d', '/a', '/b', '/c']),
    'a negative target is clamped to the front'
  );
  check(
    same(names(moveFolder(entries, 1, 0.7)), ['/b', '/a', '/c', '/d']),
    'a fractional target is floored'
  );
  check(
    moveFolder(entries, 2, 2) === entries,
    'moving to the same place returns the same array'
  );
  check(
    moveFolder(entries, 3, 99) === entries,
    'moving the last entry to the end changes nothing'
  );
  check(
    moveFolder(entries, 0, -1) === entries,
    'moving the first entry to the front changes nothing'
  );
  const moved = moveFolder(entries, 1, 0);
  check(moved[0] === entries[1], 'the moved entry keeps all its fields');
  check(
    moved !== entries && entries.length === 4 && entryPath(entries[0]) === '/a',
    'moveFolder returns a new array and does not mutate the input'
  );
  for (const from of [-1, 4, 99, 1.5, NaN, Infinity, '1', null, undefined]) {
    check(
      moveFolder(entries, from, 0) === entries,
      `a source index ${JSON.stringify(from)} outside the list changes nothing`
    );
  }
  for (const to of [NaN, '1', null, undefined]) {
    check(
      moveFolder(entries, 0, to) === entries,
      `a target ${JSON.stringify(to)} that is no number changes nothing`
    );
  }
  check(
    same(names(moveFolder(entries, 0, Infinity)), ['/b', '/c', '/d', '/a']),
    'an infinite target moves to the end'
  );
}
check(
  same(moveFolder([], 0, 0), []) &&
    same(moveFolder(undefined, 0, 1), []) &&
    same(moveFolder('junk', 0, 1), []),
  'an empty or invalid list stays empty'
);
check(
  same(moveFolder(['/only'], 0, 5), ['/only']),
  'a single entry cannot move'
);

{
  const fields = { display: 'stack', view: 'automatic', sort: 'date-added', group: 'none' };
  const got = addFolder(['/a'], '/b', undefined, env, fields);
  check(
    same(got[1], { display: 'stack', view: 'automatic', sort: 'date-added', group: 'none', path: '/b' }),
    'the fields of the design are stored in the new entry'
  );
  fields.view = 'list';
  check(got[1].view === 'automatic', 'fields are copied, not aliased');
  check(
    addFolder([], '/b', 0, env, { path: '/evil', view: 'grid' })[0].path === '/b',
    'fields never override the path'
  );
  const same1 = ['/b'];
  check(addFolder(same1, '/b', 0, env, { view: 'grid' }) === same1, 'a duplicate with fields is still a no-op');
  check(same(addFolder([], '/b', 0, env), [{ path: '/b' }]), 'no fields keeps { path }');
}

finish();
