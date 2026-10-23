// gjs -m tests/launcher_entry_check.js — Unity LauncherEntry parsing, clamping and
// sender cleanup (launcherEntry.js). Exits 1 on failure.
import { importWithStubs, createChecker } from './harness.js';

const { check, finish } = createChecker();

const INSTALLED = new Set(['org.telegram.desktop.desktop', 'firefox.desktop']);
const { module } = await importWithStubs('launcherEntry.js', {
  stubs: {
    'gi://Shell': `
      export default {
        AppSystem: {
          get_default: () => ({
            lookup_app: (id) => (${JSON.stringify([...INSTALLED])}.includes(id) ? {} : null),
          }),
        },
      };`,
  },
});
const { LauncherEntries } = module;

// A LauncherEntries without its D-Bus subscriptions: the parsing and bookkeeping
// methods only touch these fields.
function makeEntries() {
  const entries = Object.create(LauncherEntries.prototype);
  entries.entries = {};
  entries._senders = new Map();
  entries._pending = new Map();
  entries.changes = [];
  entries._changed = (appId, previous) => entries.changes.push([appId, previous]);
  return entries;
}

const update = (uri, props) => ({ recursiveUnpack: () => [uri, props] });

{
  const e = makeEntries();
  e._onUpdate(':1.10', update('application://firefox.desktop', { count: 5 }));
  check(e.entries['firefox.desktop']?.count === 5, 'count is stored under the .desktop id');
  check(e.entries['firefox.desktop'].countVisible === false, 'untouched flags keep their defaults');
}

{
  const e = makeEntries();
  e._onUpdate(':1.10', update('application://firefox', { count: 2 }));
  check('firefox.desktop' in e.entries, 'an id without .desktop gets the suffix');
}

{
  const e = makeEntries();
  e._onUpdate(':1.10', update('application://firefox.desktop', { count: 7.9 }));
  check(e.entries['firefox.desktop'].count === 7, 'fractional count is truncated');
  e._onUpdate(':1.10', update('application://firefox.desktop', { count: -3 }));
  check(e.entries['firefox.desktop'].count === 0, 'negative count clamps to 0');
  e._onUpdate(':1.10', update('application://firefox.desktop', { count: 'abc' }));
  check(e.entries['firefox.desktop'].count === 0, 'non-numeric count becomes 0');
}

{
  const e = makeEntries();
  e._onUpdate(':1.10', update('application://firefox.desktop', { progress: 3 }));
  check(e.entries['firefox.desktop'].progress === 1, 'progress above 1 clamps to 1');
  e._onUpdate(':1.10', update('application://firefox.desktop', { progress: -1 }));
  check(e.entries['firefox.desktop'].progress === 0, 'progress below 0 clamps to 0');
  e._onUpdate(':1.10', update('application://firefox.desktop', { progress: 0.25 }));
  check(e.entries['firefox.desktop'].progress === 0.25, 'progress in range is kept');
}

{
  const e = makeEntries();
  e._onUpdate(':1.10', update('application://firefox.desktop', { count: 4, 'count-visible': true }));
  e._onUpdate(':1.10', update('application://firefox.desktop', { urgent: true }));
  const entry = e.entries['firefox.desktop'];
  check(entry.count === 4 && entry.countVisible === true, 'a partial Update merges onto the last state');
  check(entry.urgent === true, 'urgent is applied by the partial Update');
  const [, previous] = e.changes[1];
  check(previous?.urgent === false && previous?.count === 4, 'onChanged receives the previous state');
}

{
  const e = makeEntries();
  e._onUpdate(':1.10', update('application://not-installed.desktop', { count: 9 }));
  check(Object.keys(e.entries).length === 0, 'ids of apps that are not installed are dropped');
  check(e.changes.length === 0, 'a dropped id raises no change');
  e._onUpdate(':1.10', { recursiveUnpack: () => [42, { count: 1 }] });
  e._onUpdate(':1.10', { recursiveUnpack: () => ['application://firefox.desktop', null] });
  e._onUpdate(':1.10', update('application://', { count: 1 }));
  check(Object.keys(e.entries).length === 0, 'malformed payloads are ignored');
}

{
  const e = makeEntries();
  e._onUpdate(':1.10', update('application://firefox.desktop', { count: 1 }));
  e._onUpdate(':1.10', update('application://org.telegram.desktop.desktop', { count: 2 }));
  e.changes.length = 0;
  e._onSenderGone(':1.10');
  check(!('firefox.desktop' in e.entries), 'entries of a vanished sender are removed');
  check(!('org.telegram.desktop.desktop' in e.entries), 'a sender vanishing clears every app it updated');
  check(e.changes.length === 2 && e.changes.every(([, previous]) => previous), 'removal reports the previous state');
  check(!e._senders.has(':1.10'), 'the sender record is forgotten');
}

finish();
