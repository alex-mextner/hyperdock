'use strict';

// What the dock's stacks are made of, free of Shell imports so
// tests/stack_sources_check.js runs it under plain gjs: the list of folder
// stacks from the settings (Downloads, the folder-stacks entries, the built-in
// Screenshots one) and the items of the Recents stack. services.js turns the
// specs into dock items, watchers and pile renderers.

import {
  STACK_DISPLAYS,
  STACK_GROUPS,
  STACK_SORTS,
  STACK_VIEWS,
  pick,
} from './stackModel.js';

// a stack that has no `group` of its own batches its files by date
const DEFAULT_GROUP = 'date';

function groupOf(value) {
  return STACK_GROUPS.includes(value) ? value : DEFAULT_GROUP;
}

// One folder-stacks entry ("path" or {path, title?, icon?, view?, sort?,
// display?, group?}) as a stack spec, or null when it names no usable folder.
// `env` = { home, isDir(path), normalize(path), titleOf(path), iconOf(path) };
// "~/" means the home folder.
function entrySpec(entry, entryIndex, env) {
  const spec = typeof entry === 'string' ? { path: entry } : entry;
  if (!spec || typeof spec.path !== 'string') return null;
  const requested = spec.path.replace(/^~(?=\/|$)/, env.home);
  if (!env.isDir(requested)) return { skipped: requested };
  const path = env.normalize(requested);
  return {
    key: path,
    path,
    title: spec.title || env.titleOf(path),
    icon: spec.icon || env.iconOf(path),
    // the stack's menu rewrites this entry of folder-stacks
    entryIndex,
    view: pick(spec.view, STACK_VIEWS),
    sort: pick(spec.sort, STACK_SORTS),
    display: pick(spec.display, STACK_DISPLAYS),
    group: groupOf(spec.group),
  };
}

// The stacks the settings ask for, in dock order: Downloads, the
// folder-stacks entries in their order, then the built-in Screenshots stack
// unless an entry already shows that folder. `cfg`:
//   downloads  { path, view, sort, display, group }  (setting ints)
//   entries    the parsed folder-stacks setting
//   screenshots  { enabled, path }  path null when the folder does not exist
//   env        see entrySpec; plus warn(message)
export function folderStackSpecs(cfg, env) {
  const d = cfg.downloads;
  const specs = [
    {
      key: 'downloads',
      path: d.path,
      title: 'Downloads',
      icon: env.iconOf(d.path),
      isDownloads: true,
      view: STACK_VIEWS[d.view] ?? STACK_VIEWS[0],
      sort: STACK_SORTS[d.sort] ?? STACK_SORTS[0],
      display: STACK_DISPLAYS[d.display] ?? STACK_DISPLAYS[0],
      group: STACK_GROUPS[d.group] ?? DEFAULT_GROUP,
    },
  ];
  (cfg.entries || []).forEach((entry, index) => {
    const spec = entrySpec(entry, index, env);
    if (spec?.skipped) env.warn(`folder stack ${spec.skipped} is not a folder`);
    if (spec && !spec.skipped && !specs.some((s) => s.path === spec.path)) {
      specs.push(spec);
    }
  });
  const shots = cfg.screenshots;
  if (shots?.enabled && shots.path && !specs.some((s) => s.path === shots.path)) {
    specs.push({
      key: shots.path,
      path: shots.path,
      title: 'Screenshots',
      icon: env.iconOf(shots.path),
      isBuiltin: true,
      view: 'automatic',
      sort: 'date-added',
      display: 'stack',
      group: DEFAULT_GROUP,
    });
  }
  return specs;
}

// The icon FILE of a Gio icon, for the pile renderer (which only reads
// files): a file icon's own file, or the first themed name `lookup(name)`
// resolves to a path. Null when there is none.
export function iconFileOf(gicon, lookup) {
  if (!gicon) return null;
  const file = gicon.get_file?.();
  if (file) return file.get_path();
  for (const name of gicon.get_names?.() ?? []) {
    const path = lookup(name);
    if (path) return path;
  }
  return null;
}

// The Recents stack's items for `apps` (Shell.App-like: get_name, get_icon,
// activate), newest first. An item starts its app when clicked.
export function recentItems(apps, lookup) {
  return apps.map((app, index) => {
    const gicon = app.get_icon();
    return {
      index,
      id: app.get_id?.() ?? null,
      name: app.get_name(),
      icon: null,
      gicon,
      iconFile: iconFileOf(gicon, lookup),
      type: 'application/x-desktop',
      date: { tv_sec: 0 },
      created: 0,
      activate: () => app.activate(),
    };
  });
}
