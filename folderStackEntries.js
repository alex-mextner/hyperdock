'use strict';

// Edits of the `folder-stacks` setting (a JSON array of folder paths or
// {path, view?, sort?, display?, group?, title?, icon?, ...} objects), as pure
// functions (no gi:// imports) so tests/folder_stack_entries_check.js runs them
// under plain gjs. The dock glue reads and writes the setting; the rules of
// "which folder is already there" live here.
//
// No function mutates its input; entry objects are shared with the result
// untouched, so every field of an entry survives an edit.
//
// Two paths name the same folder when env.normalize gives the same string
// ('~/Pictures/' and '/home/u/Pictures' once the glue's normalize resolves '~'
// and trailing slashes); the glue passes its own normalize so this module
// needs no file system.
//
// Choices where the contract is silent:
//   * addFolder stores the path as given (the glue normalises when it must)
//     and copies the optional `fields` into the entry beneath the path.
//   * addFolder, removeFolder and moveFolder return the SAME array when they
//     change nothing, so the caller can skip writing the setting.
//   * Entries that normalizeEntries would drop are kept by the editing
//     functions (the user's setting is never silently shortened by an unrelated
//     edit) but never match a path; `entries` that is no array counts as [].
//   * moveFolder(entries, from, to) moves the entry at index `from` so that it
//     ends up at index `to` of the new array; `to` is clamped, a `from`
//     outside the array or a non-integer index changes nothing.

const isPath = (value) => typeof value === 'string' && value.length > 0;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// The usable entries of a raw setting value; anything else is dropped.
export function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry) => isPath(entry) || (isPlainObject(entry) && isPath(entry.path))
  );
}

// The folder path an entry shows, '' for an entry that names none.
export function entryPath(entry) {
  if (typeof entry === 'string') return entry;
  return isPlainObject(entry) && typeof entry.path === 'string'
    ? entry.path
    : '';
}

const listOf = (entries) => (Array.isArray(entries) ? entries : []);

function samePath(entry, key, env) {
  const path = entryPath(entry);
  return path !== '' && env.normalize(path) === key;
}

// Where an insertion at `index` goes: the end unless `index` is a number, then
// clamped to the list.
function insertionIndex(index, length) {
  if (typeof index !== 'number' || Number.isNaN(index)) return length;
  return Math.min(length, Math.max(0, Math.floor(index)));
}

// A new list with `path` shown as a { path } entry, appended or inserted at
// `index`; the same list when a folder with that normalized path is there.
// `fields` (optional) are copied into the entry, never overriding `path`.
export function addFolder(entries, path, index, env, fields) {
  const list = listOf(entries);
  if (!isPath(path)) return list;
  const key = env.normalize(path);
  if (list.some((entry) => samePath(entry, key, env))) return list;
  const at = insertionIndex(index, list.length);
  return [...list.slice(0, at), { ...fields, path }, ...list.slice(at)];
}

// A new list without the entries that show `path` (by normalized path); the
// same list when there are none.
export function removeFolder(entries, path, env) {
  const list = listOf(entries);
  if (!isPath(path)) return list;
  const key = env.normalize(path);
  const kept = list.filter((entry) => !samePath(entry, key, env));
  return kept.length === list.length ? list : kept;
}

export function moveFolder(entries, from, to) {
  const list = listOf(entries);
  const validFrom = Number.isInteger(from) && from >= 0 && from < list.length;
  if (!validFrom || typeof to !== 'number' || Number.isNaN(to)) return list;
  const target = Math.min(list.length - 1, Math.max(0, Math.floor(to)));
  if (target === from) return list;
  const rest = [...list.slice(0, from), ...list.slice(from + 1)];
  return [...rest.slice(0, target), list[from], ...rest.slice(target)];
}
