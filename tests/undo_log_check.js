// gjs -m tests/undo_log_check.js - undo/redo bookkeeping rules. Exits 1 on failure.
import { createChecker } from './harness.js';
import { UndoLog } from '../undoLog.js';

const { check, finish } = createChecker();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plan = (p) => (p ? { op: p.op, items: p.items } : p);

const trash = { op: 'trash', items: [{ from: '/h/a', to: 'trash:///a' }] };
const move = { op: 'move', items: [{ from: '/h/a', to: '/h/d/a' }, { from: '/h/b', to: '/h/d/b' }] };
const copy = { op: 'copy', items: [{ from: '/h/a', to: '/h/a copy' }] };
const rename = { op: 'rename', items: [{ from: '/h/a', to: '/h/b' }] };
const mkdir = { op: 'mkdir', items: [{ to: '/h/new' }] };

let log = new UndoLog();
check(!log.canUndo() && !log.canRedo(), 'A new log has nothing to undo or redo');
check(log.undo() === null && log.redo() === null, 'Undo and redo on an empty log give null');

log.push(trash);
check(log.canUndo() && !log.canRedo(), 'A push enables undo only');
let p = log.undo();
check(same(plan(p), { op: 'restore', items: [{ from: 'trash:///a', to: '/h/a' }] }), 'trash undoes to restore from trash to original');
check(!log.canUndo() && log.canRedo(), 'Undo moves the entry to redo');
p = log.redo();
check(same(plan(p), trash), 'Redo of trash is the forward trash plan');
check(log.canUndo() && !log.canRedo(), 'Redo moves the entry back');

log = new UndoLog();
log.push(move);
check(same(plan(log.undo()), { op: 'move', items: [{ from: '/h/d/a', to: '/h/a' }, { from: '/h/d/b', to: '/h/b' }] }), 'move undoes to move back with swapped paths');
check(same(plan(log.redo()), move), 'Redo of move is the forward move');

log = new UndoLog();
log.push(copy);
check(same(plan(log.undo()), { op: 'trash', items: [{ from: '/h/a copy' }] }), 'copy undoes to trashing the copies');
check(same(plan(log.redo()), copy), 'Redo of copy is the forward copy');

log = new UndoLog();
log.push(rename);
check(same(plan(log.undo()), { op: 'rename', items: [{ from: '/h/b', to: '/h/a' }] }), 'rename undoes to rename back');
check(same(plan(log.redo()), rename), 'Redo of rename is the forward rename');

log = new UndoLog();
log.push(mkdir);
check(same(plan(log.undo()), { op: 'trash', items: [{ from: '/h/new' }] }), 'mkdir undoes to trashing the folder');
check(same(plan(log.redo()), mkdir), 'Redo of mkdir is the forward mkdir');

log = new UndoLog();
log.push(rename);
log.push(move);
check(plan(log.undo()).op === 'move' && plan(log.undo()).op === 'rename', 'Undo walks newest first');
check(plan(log.redo()).op === 'rename' && plan(log.redo()).op === 'move', 'Redo walks in the original order');
check(log.redo() === null, 'Redo past the end gives null');

log = new UndoLog();
log.push(rename);
log.undo();
log.push(copy);
check(!log.canRedo(), 'A push clears the redo stack');

log = new UndoLog(3);
for (let i = 1; i <= 5; i++) log.push({ op: 'rename', items: [{ from: `/h/${i}`, to: `/h/n${i}` }] });
const seen = [];
for (let p2 = log.undo(); p2; p2 = log.undo()) seen.push(p2.items[0].to);
check(same(seen, ['/h/5', '/h/4', '/h/3']), 'Limit 3 keeps the newest three of five');
check(!log.canUndo(), 'Nothing older survives the limit');

log = new UndoLog(2);
log.push(rename);
log.push(move);
log.undo();
log.undo();
log.redo();
log.push(copy);
check(plan(log.undo()).op === 'trash' && plan(log.undo()).op === 'rename' && log.undo() === null, 'The default limit trimming also holds after redo and push');

log = new UndoLog();
for (let i = 0; i < 25; i++) log.push(rename);
let n = 0;
while (log.undo()) n++;
check(n === 20, 'The default limit is 20');

log = new UndoLog();
log.push(rename);
log.push(move);
let failed = log.undo();
log.settle(failed, true);
check(log.canRedo() && log.canUndo(), 'A successful settle keeps the log');
failed = log.undo();
log.settle(failed, false);
check(!log.canUndo(), 'A failed undo drops the entry from the undo stack');
check(log.canRedo() && plan(log.redo()).op === 'move', 'A failed undo leaves the other redo entry alone');

log = new UndoLog();
log.push(rename);
log.push(move);
failed = log.undo();
log.settle(failed, false);
check(!log.canRedo() && log.canUndo(), 'A failed undo drops the redo twin too');
const r = log.undo();
check(plan(r).op === 'rename', 'The older entry is still undoable');
log.settle(r, true);
failed = log.redo();
log.settle(failed, false);
check(!log.canUndo() && !log.canRedo(), 'A failed redo drops the entry from both stacks');
log.settle(null, false);
log.settle({ id: 9999, op: 'move', items: [] }, false);
check(true, 'Settling null or an unknown plan is harmless');

log = new UndoLog();
log.push(trash);
log.push(move);
log.undo();
log.clear();
check(!log.canUndo() && !log.canRedo(), 'clear empties both stacks');

log = new UndoLog();
const entry = { op: 'move', items: [{ from: '/x', to: '/y' }] };
log.push(entry);
entry.items[0].from = 'CHANGED';
entry.items.push({ from: 'z', to: 'z' });
const undone = log.undo();
check(same(plan(undone), { op: 'move', items: [{ from: '/y', to: '/x' }] }), 'Mutating the pushed entry does not change the log');
undone.items[0].to = 'HACKED';
undone.items.length = 0;
const redone = log.redo();
check(same(plan(redone), { op: 'move', items: [{ from: '/x', to: '/y' }] }), 'Mutating an undo plan does not change the log');
redone.items[0].from = 'HACKED';
log.undo();
check(same(plan(log.redo()), { op: 'move', items: [{ from: '/x', to: '/y' }] }), 'Mutating a redo plan does not change the log');

log = new UndoLog();
log.push({ op: 'restore', items: [{ from: 'a', to: 'b' }] });
log.push({ op: 'bogus', items: [] });
log.push(null);
check(!log.canUndo(), 'Ops without an inverse are not logged');
log.push({ op: 'move' });
check(same(plan(log.undo()), { op: 'move', items: [] }), 'An entry without items is an empty plan');

const d = (op, k) => log.describe({ op, items: Array.from({ length: k }, () => ({ from: 'a', to: 'b' })) });
check(d('trash', 1) === 'Moved 1 item to Trash', 'trash singular');
check(d('trash', 3) === 'Moved 3 items to Trash', 'trash plural');
check(d('move', 1) === 'Moved 1 item', 'move singular');
check(d('move', 2) === 'Moved 2 items', 'move plural');
check(d('copy', 1) === 'Copied 1 item', 'copy singular');
check(d('copy', 5) === 'Copied 5 items', 'copy plural');
check(d('rename', 1) === 'Renamed 1 item', 'rename singular');
check(d('rename', 2) === 'Renamed 2 items', 'rename plural');
check(d('restore', 1) === 'Restored 1 item', 'restore singular');
check(d('restore', 4) === 'Restored 4 items', 'restore plural');
check(d('mkdir', 1) === 'Created folder', 'mkdir');
check(d('trash', 0) === 'Moved 0 items to Trash', 'zero items is plural');
check(d('nope', 1) === '', 'An unknown op describes as empty');
check(log.describe({ op: 'move' }) === 'Moved 0 items', 'Missing items count as zero');

// ---- op names that are inherited members of a plain object -----------------
for (const op of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
  const hostile = new UndoLog();
  hostile.push({ op, items: [] });
  check(!hostile.canUndo() && hostile.undo() === null, `push ignores the op ${op}: nothing to undo`);
  check(hostile.describe({ op, items: [] }) === '', `describe gives '' for the op ${op}`);
}
check(new UndoLog().describe(undefined) === '' && new UndoLog().describe(null) === '', 'describe of no entry is empty');

// ---- settle with the paths a redo really produced --------------------------
log = new UndoLog();
log.push(copy);
log.undo();
let redoPlan = log.redo();
const actual = [{ from: '/h/a', to: '/h/a copy 2' }];
log.settle(redoPlan, true, actual);
actual[0].to = 'HACKED';
check(same(plan(log.undo()), { op: 'trash', items: [{ from: '/h/a copy 2' }] }), 'Undo after a renamed copy redo trashes the renamed path, and the passed array is not aliased');

log = new UndoLog();
log.push(move);
log.undo();
redoPlan = log.redo();
log.settle(redoPlan, true, [{ from: '/h/a', to: '/h/d/a 2' }, { from: '/h/b', to: '/h/d/b' }]);
check(same(plan(log.undo()), { op: 'move', items: [{ from: '/h/d/a 2', to: '/h/a' }, { from: '/h/d/b', to: '/h/b' }] }), 'Move redo undoes against the real destination');

log = new UndoLog();
log.push(copy);
log.undo();
redoPlan = log.redo();
log.settle(redoPlan, true);
check(same(plan(log.undo()), { op: 'trash', items: [{ from: '/h/a copy' }] }), 'ok without actual items changes nothing');
log.settle({ id: 999 }, true, [{ from: 'x', to: 'y' }]);
check(log.canRedo() && !log.canUndo(), 'An unknown plan id is ignored');
const pending = log.redo();
log.undo();
log.settle(pending, true, [{ from: '/h/a', to: '/h/q' }]);
check(same(plan(log.redo()), { op: 'copy', items: [{ from: '/h/a', to: '/h/q' }] }), 'An entry in the redo stack adopts the actual items too');

finish();
