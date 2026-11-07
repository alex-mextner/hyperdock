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

// a gate wired to fakes: what the window manager was told, the veto it would call, the top grab
function fakeGate() {
  const f = { calls: [], veto: null, watching: 0, top: null, mode: POPOVER_ACTION_MODE };
  f.gate = new OverlayKeyGate({
    allow: (name, modes) => f.calls.push([name, modes]),
    watchFilter: (veto) => {
      f.veto = veto;
      f.watching++;
      return () => {
        f.veto = null;
        f.watching--;
      };
    },
    topGrabActor: () => f.top,
    actionMode: () => f.mode,
  });
  return f;
}

{
  const { gate, calls } = fakeGate();
  const a = {};
  const b = {};
  const first = gate.acquire(a);
  check(calls.length === 1 && calls[0][0] === 'overlay-key' && calls[0][1] === overlayKeyModes(1), 'the first popover to open allows Super');
  const second = gate.acquire(b);
  first();
  check(calls.at(-1)[1] === overlayKeyModes(1), 'Super stays allowed while another popover is open');
  first();
  check(calls.at(-1)[1] === overlayKeyModes(1), 'a popover releasing twice does not close the other one early');
  second();
  check(calls.at(-1)[1] === overlayKeyModes(0), 'the last popover closing restores the Shell\'s own modes');
}

// ---- Super over somebody else's grab ----------------------------------------------------
{
  const f = fakeGate();
  const popover = {};
  const foreign = {};
  const release = f.gate.acquire(popover);
  check(f.watching === 1, 'the keybinding filter is watched while a popover is open');
  f.top = popover;
  check(f.veto('overlay-key') === false, 'Super works with the dock popover on top of the grab stack');
  f.top = foreign;
  check(f.veto('overlay-key') === true, 'Super is dropped when another popup (capture UI, panel menu) is on top');
  check(f.veto('toggle-message-tray') === false && f.veto('switch-input-source') === false, 'every other keybinding is left to the Shell\'s own filter');
  f.top = null;
  check(f.veto('overlay-key') === true, 'Super is dropped with no grab on top while the mode is still POPUP (a stale allowance)');
  f.mode = ActionMode.NORMAL;
  check(f.veto('overlay-key') === false, 'outside POPUP the Shell\'s own rule stands (a menu that opened without a grab)');
  f.mode = POPOVER_ACTION_MODE;
  f.top = popover;
  release();
  check(f.watching === 0 && f.veto === null, 'the filter is not watched once the last popover closed');
}

{
  // two popovers on one actor: closing one leaves the actor counted for the other
  const f = fakeGate();
  const shared = {};
  const first = f.gate.acquire(shared);
  const second = f.gate.acquire(shared);
  f.top = shared;
  first();
  check(f.veto('overlay-key') === false, 'a second popover on the same actor still lets Super through after the first closed');
  second();
  check(f.watching === 0, 'the filter is released with the last popover of a shared actor');
}

{
  // two popovers on two actors: the top one decides
  const f = fakeGate();
  const one = {};
  const two = {};
  const releaseOne = f.gate.acquire(one);
  const releaseTwo = f.gate.acquire(two);
  check(f.watching === 1, 'two open popovers share one filter watch');
  f.top = one;
  check(f.veto('overlay-key') === false, 'the older popover on top lets Super through');
  releaseOne();
  check(f.veto('overlay-key') === true, 'a closed popover\'s actor no longer counts');
  f.top = two;
  check(f.veto('overlay-key') === false, 'the remaining popover still lets Super through');
  releaseTwo();
}

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
