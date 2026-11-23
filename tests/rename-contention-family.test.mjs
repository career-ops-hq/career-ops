// tests/rename-contention-family.test.mjs
//
// #3006 fixed the Windows rename-contention class (bare `renameSync` racing a
// LIVE destination handle, answered with EPERM/EACCES/EBUSY) in
// `writeFileAtomic`'s closing rename inside tracker-utils.mjs. #3046 is the
// census of the other files carrying the same shape: write-tmp-then-rename
// over a destination that already exists and can be held open by a transient
// reader (AV scanner, Search indexer, a concurrent readFileSync).
//
// This test used to pin five hand-picked files. Ten more write-tmp-then-rename
// sites (scan.mjs atomicWriteFile, capture-jd.mjs, dead-boards.mjs,
// career-profile.mjs, learn.mjs, sponsor-check.mjs, plugins.mjs, and the .part
// renames in backup.mjs, install-latex-engine.mjs and batch/jd-rescue.mjs) kept
// calling bare renameSync because nothing listed them. The set is now DERIVED from the files git ships, the way tests/lock-rm-contention.test.mjs
// derives its lock-body scan: every shipped core module is forbidden a direct
// renameSync call, except the files in EXEMPT below, each with its reason.
// A new site fails here instead of waiting for the next census.

import { readFileSync } from 'fs';
import { dirname, join, posix } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { trackedFiles } from '../lib/mjs-files.mjs';

console.log('\n📝 rename contention: no shipped core module calls bare renameSync (#3006, #3046)');

const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));

// lib/rename-retry.mjs defines renameSyncWithRetry and imports only node:fs,
// so plugins/_lock.mjs can use it while doctor.mjs runs without node_modules.
// tracker-utils.mjs re-exports it and defines writeFileAtomic on top of it.
const DEFINITIONS = ['lib/rename-retry.mjs', 'tracker-utils.mjs'];

// Files allowed a direct renameSync call, and why. Keep this list short: each
// entry is a place the Windows retry does not run.
// (lib/rename-retry.mjs needs no entry: it only names renameSync as
// renameSyncWithRetry's default `rename`, and never calls it bare.)
const EXEMPT = {
  // Byte-for-byte mirrored into web/src/lib/core/inbox-skip.mjs
  // (web/tests/lib/inbox-skip-core.test.mjs), where `../tracker-utils.mjs`
  // does not resolve, and the helper's blocking Atomics.wait backoff would
  // stall a Next request handler (see web/src/lib/core/safe-write.ts).
  'lib/inbox-skip.mjs': 'shared verbatim with the web bundle',
  // Moves an inbox file into imported/ under a name the loop just proved free.
  'lib/linkedin-mail-drop.mjs': 'moves to a fresh destination',
  // Moves a processed TSV into merged/, one fresh file per run.
  'merge-tracker.mjs': 'moves to a fresh destination',
  // Renames inside a freshly created temp/scaffold directory, and the first
  // call already has a tolerant catch with an in-place fallback.
  'plugin-install.mjs': 'renames inside a directory it just created',
};

// Every core module git ships. The suites are out (fixtures rename by hand on
// purpose) and so is web/: the Next bundle cannot import the core
// (web/next.config.mjs pins its root to web/) and wants an async retry.
const shipped = trackedFiles(ROOT, (rel) => rel.endsWith('.mjs')
  && !rel.startsWith('tests/') && !rel.startsWith('web/') && rel !== 'test-all.mjs')
  .map((abs) => abs.slice(ROOT.length + 1).replace(/\\/g, '/'));

// Comments are stripped first: explaining the bare call is not making it.
// String and template literals are copied through untouched, so the `//` in
// 'https://...' does not swallow the code after it on the same line.
function withoutComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      out += ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      const start = i;
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      out += src.slice(start, i + 1);
    } else {
      out += c;
    }
  }
  return out;
}

// `renameSync(`, a call through any namespace (`fs.renameSync(`,
// `disk.renameSync(` after `import * as disk`), and a renamed binding
// (`renameSync as mv`, `{ renameSync: mv } = fs`).
const DIRECT_CALL = /(?<![\w$])renameSync\s*\(|\brenameSync\s+as\s+[\w$]+|\brenameSync\s*:\s*[\w$]+/;
const SEAM_CALL = /\b(?:renameSyncWithRetry|writeFileAtomic)\s*\(/;

// A guard that cannot look must never pass.
ok(shipped.length > 100, `scanned ${shipped.length} shipped .mjs files (the guard can see the tree)`);
ok(DIRECT_CALL.test('fs.renameSync(tmp, file)'), 'the scan recognizes fs.renameSync(');
ok(DIRECT_CALL.test('disk.renameSync(tmp, file)'), 'the scan recognizes a namespace alias (disk.renameSync()');
ok(DIRECT_CALL.test('const { renameSync: mv } = fs;'), 'the scan recognizes a destructured rename binding');
ok(!DIRECT_CALL.test('renameSyncWithRetry(tmp, file)'), 'the scan does not flag renameSyncWithRetry(');
ok(
  DIRECT_CALL.test(withoutComments("const url = 'https://example.com'; renameSync(tmp, file);")),
  'a // inside a string does not hide the call after it',
);
ok(
  DIRECT_CALL.test(withoutComments('void/* publish */renameSync(tmp, file);')),
  'a removed block comment does not glue the tokens around it',
);
ok(!DIRECT_CALL.test(withoutComments('// renameSync(tmp, file)\n/* renameSync(a, b) */')), 'comments are not calls');

const directCallers = shipped.filter((rel) =>
  DIRECT_CALL.test(withoutComments(readFileSync(join(ROOT, rel), 'utf-8'))));

for (const rel of directCallers.filter((f) => !(f in EXEMPT))) {
  fail(`${rel} calls renameSync directly — use renameSyncWithRetry or writeFileAtomic from ${DEFINITIONS.join(' or ')} (#3046)`);
}
if (directCallers.every((f) => f in EXEMPT)) {
  pass(`no shipped core module outside the ${Object.keys(EXEMPT).length} exempt files calls renameSync directly`);
}

// An exemption whose file no longer renames is a hole waiting for the next
// edit: drop it from EXEMPT.
for (const [rel, why] of Object.entries(EXEMPT)) {
  ok(directCallers.includes(rel), `${rel} still needs its exemption (${why})`);
}

// Every caller of the seam takes renameSyncWithRetry from the one canonical
// definition (directly, or through tracker-utils.mjs's re-export), not a local
// copy: that drift is what #2984 cost weeks chasing.
// A local writeFileAtomic wrapper around the imported helper is fine
// (followup-seed.mjs has one). update-system.mjs must stay self-loading
// (#1706), so it lazy-imports with `await import(...)`; both forms count.
const seamCallers = shipped.filter((f) => !DEFINITIONS.includes(f)
  && SEAM_CALL.test(withoutComments(readFileSync(join(ROOT, f), 'utf-8'))));
ok(seamCallers.length >= 10, `found ${seamCallers.length} modules that rename through the helper (the scan can see them)`);
const strays = [];
for (const rel of seamCallers) {
  const src = withoutComments(readFileSync(join(ROOT, rel), 'utf-8'));
  if (/\bfunction\s+renameSyncWithRetry\b|\brenameSyncWithRetry\s*=\s*(?:\(|function|async)/.test(src)) {
    strays.push(`${rel} (defines its own renameSyncWithRetry)`);
    continue;
  }
  const specs = DEFINITIONS.map((def) => {
    const spec = posix.relative(dirname(rel) || '.', def);
    return spec.startsWith('.') ? spec : `./${spec}`;
  });
  const quoted = `['"](?:${specs.map((spec) => spec.replace(/[./]/g, (c) => `\\${c}`)).join('|')})['"]`;
  const names = '\\{[^}]*\\b(?:renameSyncWithRetry|writeFileAtomic)\\b[^}]*\\}';
  const imports = new RegExp(`import\\s*${names}\\s*from\\s*${quoted}`).test(src)
    || new RegExp(`(?:const|let|var)\\s*${names}\\s*=\\s*await\\s+import\\(\\s*${quoted}\\s*\\)`).test(src);
  if (!imports) strays.push(`${rel} (no import from ${specs.join(' or ')})`);
}
ok(strays.length === 0, `every helper caller imports it from ${DEFINITIONS.join(' or ')}${strays.length ? `: ${strays.join(', ')}` : ''}`);
