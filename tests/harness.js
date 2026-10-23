// Test harness for gjs checks: loads one extension module outside GNOME Shell.
//
// The shipped modules import Shell-only namespaces (gi://Shell, gi://St,
// resource:///org/gnome/shell/...) that plain gjs cannot resolve. importWithStubs()
// rewrites the module's import specifiers into a scratch directory so that
//   - `real` specifiers (GLib/Gio/GObject by default) load unchanged,
//   - specifiers named in `stubs` load the given ES module source,
//   - every other specifier (Shell, St, relative modules, ...) becomes an inert stub,
//     so only the module under test runs real code.
// Pass `real: ['./utils.js']` to load a sibling module for real instead of stubbing it.
//
// Usage:
//   const { module } = await importWithStubs('launcherEntry.js', {
//     stubs: { 'gi://Shell': 'export default { AppSystem: {...} };' },
//   });

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DEFAULT_REAL = ['gi://GLib', 'gi://Gio', 'gi://GObject'];
const REPO_ROOT = GLib.path_get_dirname(
  GLib.path_get_dirname(import.meta.url.replace(/^file:\/\//, ''))
);

// import/export-from statements, including multi-line named lists
const IMPORT_RE =
  /^([ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*)(['"])([^'"]+)\2/gm;

const INERT_STUB = `
const handler = {
  get(_t, key) {
    if (key === 'then') return undefined;
    if (key === Symbol.toPrimitive) return () => '';
    return inert;
  },
  apply: () => inert,
  construct: () => inert,
  has: () => true,
};
const inert = new Proxy(function () {}, handler);
`;

function readText(path) {
  const [, bytes] = GLib.file_get_contents(path);
  return new TextDecoder().decode(bytes);
}

// Names bound by an import clause: default, `* as ns`, `{ a, b as c }`.
function importedNames(statement) {
  const clause = statement.replace(/^\s*(?:import|export)\s*/, '').replace(/\s*from\s*$/, '');
  const names = new Set();
  const named = clause.match(/\{([^}]*)\}/);
  if (named) {
    named[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => names.add(s.split(/\s+as\s+/)[0].trim()));
  }
  return names;
}

export async function importWithStubs(modulePath, options = {}) {
  const real = new Set([...DEFAULT_REAL, ...(options.real ?? [])]);
  const stubs = options.stubs ?? {};
  const sourcePath = GLib.build_filenamev([REPO_ROOT, modulePath]);
  const sourceDir = GLib.path_get_dirname(sourcePath);
  const scratch = GLib.dir_make_tmp('d2da-harness-XXXXXX');
  const written = [];
  const write = (name, text) => {
    const path = GLib.build_filenamev([scratch, name]);
    GLib.file_set_contents(path, text);
    written.push(path);
    return `file://${path}`;
  };

  const namedExports = new Map(); // stub file name -> Set of export names
  const stubUrls = new Map(); // specifier -> url
  let counter = 0;

  const rewritten = readText(sourcePath).replace(
    IMPORT_RE,
    (statement, head, quote, specifier) => {
      if (real.has(specifier)) return statement;
      if (specifier.startsWith('.') && real.has(specifier)) return statement;
      let url = stubUrls.get(specifier);
      if (!url) {
        const name = `stub_${counter++}.js`;
        if (specifier in stubs) {
          url = write(name, stubs[specifier]);
        } else {
          url = `file://${GLib.build_filenamev([scratch, name])}`;
          namedExports.set(name, new Set());
        }
        stubUrls.set(specifier, url);
      }
      const name = url.split('/').pop();
      const names = namedExports.get(name);
      if (names) importedNames(head).forEach((n) => names.add(n));
      return `${head}${quote}${url}${quote}`;
    }
  );

  // sibling modules the caller wants real: point them at the original file
  const withReal = rewritten.replace(
    /(from\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,
    (statement, head, quote, specifier) =>
      real.has(specifier)
        ? `${head}${quote}file://${GLib.build_filenamev([sourceDir, specifier])}${quote}`
        : statement
  );

  namedExports.forEach((names, name) => {
    const exports = [...names].map((n) => `export const ${n} = inert;`).join('\n');
    write(name, `${INERT_STUB}\nexport default inert;\n${exports}\n`);
  });

  const moduleUrl = write('module_under_test.js', withReal);
  try {
    return { module: await import(moduleUrl) };
  } finally {
    written.forEach((p) => Gio.File.new_for_path(p).delete(null));
    Gio.File.new_for_path(scratch).delete(null);
  }
}

// Shared pass/fail bookkeeping, same output shape as the older gjs checks.
export function createChecker() {
  let failures = 0;
  return {
    check(cond, msg) {
      print(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
      if (!cond) failures++;
    },
    finish() {
      if (failures > 0) {
        print(`${failures} check(s) FAILED`);
        imports.system.exit(1);
      }
      print('all passed');
    },
  };
}
