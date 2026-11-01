// gjs -m tests/popover_input_check.js - which action modes a dock popover grabs with and
// lets 'overlay-key' (a tap of Super) work in, with no GNOME Shell. The behaviour itself
// (layout shortcut and Super with a popover open) is proved by tools/input-grab-shell.sh.
// Exits 1 on failure.
import { createChecker, importWithStubs } from './harness.js';

const { check, finish } = createChecker();
// Shell.ActionMode's values (shell-action-modes.h)
const ActionMode = { NONE: 0, NORMAL: 1, OVERVIEW: 2, POPUP: 128 };
const { module } = await importWithStubs('popoverInput.js', {
  stubs: {
    'gi://Shell': `export default { ActionMode: ${JSON.stringify(ActionMode)} };`,
    // an overview whose disconnect() throws on an id that is not connected, as GJS's signals do
    'resource:///org/gnome/shell/ui/main.js': `
      const handlers = new Map();
      let next = 1;
      export const overview = {
        connect(signal, fn) { handlers.set(next, [signal, fn]); return next++; },
        disconnect(id) { if (!handlers.delete(id)) throw new Error('No signal connection ' + id + ' found'); },
        emit(signal) { [...handlers.values()].filter(([s]) => s === signal).forEach(([, fn]) => fn()); },
        connected: () => handlers.size,
      };
      globalThis.fakeOverview = overview;
      export const wm = { allowKeybinding() {} };`,
  },
});
const { POPOVER_ACTION_MODE, overlayKeyModes, OverlayKeyGate, closeOnOverviewTransition } = module;

check(POPOVER_ACTION_MODE === ActionMode.POPUP, 'a popover grabs with POPUP, never the key-blocking NONE');
check(overlayKeyModes(0) === (ActionMode.NORMAL | ActionMode.OVERVIEW), 'at rest Super works in NORMAL and OVERVIEW only, as the Shell sets it');
check((overlayKeyModes(1) & POPOVER_ACTION_MODE) !== 0, 'with a popover open Super works under its grab');
check((overlayKeyModes(1) & ActionMode.NORMAL) !== 0 && (overlayKeyModes(1) & ActionMode.OVERVIEW) !== 0, 'Super keeps working in NORMAL and OVERVIEW');
check(overlayKeyModes(2) === overlayKeyModes(1), 'the modes do not depend on how many popovers are open');

const calls = [];
const gate = new OverlayKeyGate((name, modes) => calls.push([name, modes]));
const first = gate.acquire();
check(calls.length === 1 && calls[0][0] === 'overlay-key' && calls[0][1] === overlayKeyModes(1), 'the first popover to open allows Super');
const second = gate.acquire();
first();
check(calls.at(-1)[1] === overlayKeyModes(1), 'Super stays allowed while another popover is open');
first();
check(calls.at(-1)[1] === overlayKeyModes(1), 'a popover releasing twice does not close the other one early');
second();
check(calls.at(-1)[1] === overlayKeyModes(0), 'the last popover closing restores the Shell\'s own modes');

// ---- closing with the overview ----------------------------------------------------------
const overview = globalThis.fakeOverview;
let closed = 0;
const stop = closeOnOverviewTransition(() => closed++);
overview.emit('showing');
overview.emit('hiding');
check(closed === 2, 'a popover closes when the overview shows and when it hides');
stop();
overview.emit('showing');
check(closed === 2 && overview.connected() === 0, 'a popover that closed by itself no longer hears the overview');
let again = true;
try {
  stop();
} catch {
  again = false;
}
check(again, 'stopping twice (close(), then destroy) is harmless');

finish();
