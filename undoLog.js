'use strict';

// Undo / redo bookkeeping for file operations done from the stack dropdown
// (trash, move, copy, rename, new folder). Nothing here touches the filesystem
// or imports gi://: the log only decides which plan the glue must execute
// next, so it can be checked in plain gjs.
//
// Plans are `{ id, op, items }`; `id` ties a plan back to its log entry so
// settle() can drop it. Entries and plans are copied on the way in and out, so
// a caller mutating what it got never changes the log. The undo stack is
// trimmed to `limit` after every push and every redo. Entries whose op has no
// inverse (`restore`, unknown) are ignored by push.

const INVERSE_BUILDERS = {
  trash: (items) => ({
    op: 'restore',
    items: items.map(({ from, to }) => ({ from: to, to: from })),
  }),
  move: (items) => ({
    op: 'move',
    items: items.map(({ from, to }) => ({ from: to, to: from })),
  }),
  rename: (items) => ({
    op: 'rename',
    items: items.map(({ from, to }) => ({ from: to, to: from })),
  }),
  copy: (items) => ({ op: 'trash', items: items.map(({ to }) => ({ from: to })) }),
  mkdir: (items) => ({ op: 'trash', items: items.map(({ to }) => ({ from: to })) }),
};

const VERBS = {
  trash: ['Moved', 'to Trash'],
  restore: ['Restored', ''],
  move: ['Moved', ''],
  copy: ['Copied', ''],
  rename: ['Renamed', ''],
};

// Tables are plain objects: an op like '__proto__' or 'constructor' must find
// nothing, not an inherited member.
const isOwn = (table, op) => typeof op === 'string' && Object.hasOwn(table, op);

const copyItems = (items) => items.map((item) => ({ ...item }));

function describeCount(op, count) {
  const [verb, tail] = VERBS[op];
  const noun = count === 1 ? 'item' : 'items';
  return [verb, count, noun, tail].filter((part) => part !== '').join(' ');
}

export class UndoLog {
  #limit;
  #undoStack = [];
  #redoStack = [];
  #nextId = 1;

  constructor(limit = 20) {
    this.#limit = limit;
  }

  push(entry) {
    if (!isOwn(INVERSE_BUILDERS, entry?.op)) return;
    this.#undoStack.push({
      id: this.#nextId++,
      op: entry.op,
      items: copyItems(entry.items ?? []),
    });
    this.#redoStack = [];
    this.#trim();
  }

  canUndo() {
    return this.#undoStack.length > 0;
  }

  canRedo() {
    return this.#redoStack.length > 0;
  }

  undo() {
    const entry = this.#undoStack.pop();
    if (!entry) return null;
    this.#redoStack.push(entry);
    return { id: entry.id, ...INVERSE_BUILDERS[entry.op](entry.items) };
  }

  redo() {
    const entry = this.#redoStack.pop();
    if (!entry) return null;
    this.#undoStack.push(entry);
    this.#trim();
    return { id: entry.id, op: entry.op, items: copyItems(entry.items) };
  }

  // A failed plan drops its entry. A successful one may carry the paths the
  // transfer really produced (a redo renamed `a copy.png` to `a copy 2.png`);
  // the entry adopts them so its undo targets the real paths.
  settle(plan, ok, actualItems) {
    if (!plan) return;
    if (ok) {
      this.#adoptItems(plan.id, actualItems);
      return;
    }
    const keep = (entry) => entry.id !== plan.id;
    this.#undoStack = this.#undoStack.filter(keep);
    this.#redoStack = this.#redoStack.filter(keep);
  }

  clear() {
    this.#undoStack = [];
    this.#redoStack = [];
  }

  describe(entry) {
    if (entry?.op === 'mkdir') return 'Created folder';
    if (!isOwn(VERBS, entry?.op)) return '';
    return describeCount(entry.op, entry.items?.length ?? 0);
  }

  #adoptItems(id, actualItems) {
    if (!Array.isArray(actualItems)) return;
    const entry = [...this.#undoStack, ...this.#redoStack].find((e) => e.id === id);
    if (entry) entry.items = copyItems(actualItems);
  }

  #trim() {
    const excess = this.#undoStack.length - this.#limit;
    if (excess > 0) this.#undoStack.splice(0, excess);
  }
}
