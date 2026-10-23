// Tiny test runner and assertions for gjs checks that are written as named
// cases (tests/harness.js createChecker is the flat alternative). Prints the
// `ok`/`FAIL` lines and the final `all passed` tools/run-tests.sh looks for.
import System from 'system';

function fail(message, detail) {
  throw new Error(detail ? `${message} (${detail})` : message);
}

const show = (v) => JSON.stringify(v) ?? String(v);

export const assert = {
  ok(value, message = 'expected a truthy value') {
    if (!value) fail(message);
  },
  equal(actual, expected, message = 'values differ') {
    if (actual !== expected)
      fail(message, `got ${show(actual)}, want ${show(expected)}`);
  },
  deepEqual(actual, expected, message = 'values differ') {
    if (show(actual) !== show(expected))
      fail(message, `got ${show(actual)}, want ${show(expected)}`);
  },
  match(text, re, message = 'no match') {
    if (!re.test(text)) fail(message, `${show(text)} !~ ${re}`);
  },
  doesNotMatch(text, re, message = 'unexpected match') {
    if (re.test(text)) fail(message, `${show(text)} =~ ${re}`);
  },
};

export function createSuite() {
  const cases = [];
  return {
    test: (name, fn) => cases.push([name, fn]),
    run() {
      let failures = 0;
      for (const [name, fn] of cases) {
        try {
          fn();
          print(`ok   ${name}`);
        } catch (err) {
          failures++;
          print(`FAIL ${name}\n     ${err.message}`);
        }
      }
      if (failures) {
        print(`${failures} of ${cases.length} check(s) FAILED`);
        System.exit(1);
      }
      print(`${cases.length}/${cases.length} passed`);
      print('all passed');
    },
  };
}
