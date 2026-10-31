// gjs -m tests/stack_sources_check.js - which stacks the settings ask for and
// what the Recents stack lists (no GNOME Shell). Exits 1 on failure.
import Gio from 'gi://Gio';
import { createChecker } from './harness.js';
import { folderStackSpecs, iconFileOf, recentItems } from '../stackSources.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const warnings = [];
const env = {
  home: '/home/u',
  isDir: (p) => !p.includes('missing'),
  normalize: (p) => p.replace(/\/+$/, ''),
  titleOf: (p) => p.split('/').pop(),
  iconOf: () => 'folder',
  warn: (m) => warnings.push(m),
};
const downloads = { path: '/home/u/Downloads', view: 0, sort: 0, display: 1, group: 1 };
const shots = { enabled: true, path: '/home/u/Pictures/Screenshots' };
const specs = (extra = {}) => folderStackSpecs({ downloads, entries: [], screenshots: shots, ...extra }, env);

// ---- the group's stacks -------------------------------------------------
const base = specs();
check(same(base.map((s) => s.key), ['downloads', '/home/u/Pictures/Screenshots']), 'Downloads, then the built-in Screenshots stack');
check(base[0].isDownloads && base[0].group === 'date' && base[0].display === 'stack', 'Downloads is a dated pile by default');
check(base[1].isBuiltin && base[1].title === 'Screenshots' && base[1].view === 'automatic' && base[1].sort === 'date-added', 'Screenshots opens automatically, newest added first');
check(specs({ screenshots: { enabled: false, path: shots.path } }).length === 1, 'the Screenshots stack can be switched off');
check(specs({ screenshots: { enabled: true, path: null } }).length === 1, 'no Screenshots folder, no Screenshots stack');

const entries = ['~/Documents', { path: '/home/u/Pictures/Screenshots/', title: 'Shots', view: 'grid', group: 'kind' }, '/mnt/missing', { nopath: 1 }, 7];
warnings.length = 0;
const listed = specs({ entries });
check(same(listed.map((s) => s.key), ['downloads', '/home/u/Documents', '/home/u/Pictures/Screenshots']), '~ expands, bad entries are skipped, entries keep their order');
check(listed[2].title === 'Shots' && listed[2].view === 'grid' && listed[2].group === 'kind' && !listed[2].isBuiltin, 'an entry for the Screenshots folder takes over the built-in stack');
check(listed[2].entryIndex === 1 && listed[1].entryIndex === 0, 'entries remember their index for the menu to rewrite');
check(warnings.length === 1 && /missing/.test(warnings[0]), 'a folder that does not exist is reported once');
check(specs({ entries: [{ path: '/home/u/Downloads' }] }).length === 2, 'an entry for the Downloads folder does not make a second stack');
check(specs({ entries: [{ path: '/x/a', view: 'bogus', group: 'bogus', display: 'bogus' }] })[1].group === 'date', 'unknown options fall back to the defaults');
check(folderStackSpecs({ downloads, entries: null, screenshots: null }, env).length === 1, 'missing entries and screenshots are fine');
check(folderStackSpecs({ downloads: { ...downloads, view: 9, sort: 9, display: 9, group: 9 }, entries: [] }, env)[0].view === 'fan', 'out-of-range Downloads settings fall back');

// ---- icon files -----------------------------------------------------------
const lookup = (name) => (name === 'calc' ? '/icons/calc.svg' : null);
check(iconFileOf(null, lookup) === null, 'no icon, no file');
check(iconFileOf(Gio.FileIcon.new(Gio.File.new_for_path('/icons/x.png')), lookup) === '/icons/x.png', 'a file icon is its file');
check(iconFileOf(new Gio.ThemedIcon({ names: ['nope', 'calc'] }), lookup) === '/icons/calc.svg', 'a themed icon is the first name that resolves');
check(iconFileOf(new Gio.ThemedIcon({ names: ['nope'] }), lookup) === null, 'an unresolvable themed icon has no file');

// ---- recents --------------------------------------------------------------
const started = [];
const app = (name, id) => ({
  get_name: () => name,
  get_icon: () => new Gio.ThemedIcon({ names: [id] }),
  activate: () => started.push(name),
});
const items = recentItems([app('Calculator', 'calc'), app('Other', 'other')], lookup);
check(items.length === 2 && items[0].name === 'Calculator' && items[0].index === 0, 'one item per app, in order');
check(items[0].iconFile === '/icons/calc.svg' && items[1].iconFile === null, 'each item carries its icon file for the pile');
check(items[0].type === 'application/x-desktop' && items[0].gicon !== null, 'an item is an application with its icon');
items[1].activate();
check(same(started, ['Other']), 'activating an item starts its app');
check(recentItems([], lookup).length === 0, 'no apps, no items');

finish();
