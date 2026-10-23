'use strict';

// Settings that were removed must stay gone from the schema, the key table,
// the prefs UI and the runtime. Run under plain node by `make check`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const REMOVED = [
  // #13: dead toggle that only re-hooked the Magic Lamp extension
  /lamp[-_]app[-_]animation/,
  /hookCompiz|releaseCompiz|compiz_getIcon/,
];
const SKIP_DIRS = new Set([
  'node_modules',
  'build',
  '.git',
  'tests',
  'tools',
  'agents',
  'docs',
]);
const EXTS = /\.(js|ui|xml)$/;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (EXTS.test(name)) files.push(path);
  }
})(ROOT);

let failed = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const re of REMOVED) {
    if (re.test(text)) {
      console.error(`FAIL ${file.slice(ROOT.length)} still matches ${re}`);
      failed++;
    }
  }
}
if (failed) process.exit(1);
console.log(`ok   no removed setting is referenced (${files.length} files scanned)`);
