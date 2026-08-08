// tests/user-layer-gitignored.test.mjs
//
// AGENTS.md declares a User Layer: the files a candidate fills with their own
// personal data. Every one of those paths must be git-ignored, or a contributor
// working in a fork can stage their own CV, proof points or tracker into a public
// repository with a reflexive `git add .`.
//
// article-digest.md drifted off .gitignore while remaining on the AGENTS.md list.
// This test compares the two lists directly so they cannot diverge again.

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\n🔒 user-layer files are git-ignored');

// Pull the declared user-layer paths straight out of AGENTS.md so the test tracks
// the document rather than a hand-copied duplicate of it.
const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf-8');
const line = agents.split(/\r?\n/).find(l => l.includes('**User Layer'));

if (!line) {
  fail('AGENTS.md no longer contains a "**User Layer" line — update this test');
} else {
  // Backtick-quoted paths, minus the glob suffix: `data/*` -> data/
  const paths = [...line.matchAll(/`([^`]+)`/g)]
    .map(m => m[1])
    .map(p => (p.endsWith('/*') ? `${p.slice(0, -1)}` : p));

  if (paths.length === 0) fail('parsed no paths from the AGENTS.md user-layer line');
  else pass(`parsed ${paths.length} user-layer paths from AGENTS.md`);

  for (const p of paths) {
    // A directory glob is satisfied by a probe file inside it; a bare filename
    // is checked directly. check-ignore exits 1 when the path is NOT ignored.
    const probe = p.endsWith('/') ? `${p}__gitignore_probe__.md` : p;
    let ignored = true;
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', probe], { cwd: ROOT });
    } catch {
      ignored = false;
    }
    if (ignored) pass(`${p} is git-ignored`);
    else fail(`${p} is declared user-layer in AGENTS.md but is NOT git-ignored — personal data could be committed`);
  }
}

// safe-write.ts names backups like `cv.md.bak-2026-08-05T16-55-08-641Z`.
// The old `*.bak` pattern did not match those timestamped paths, so a
// reflexive `git add .` could stage PII sitting in the repo root.
const timestampedBackupProbes = [
  'cv.md.bak-2026-08-05T16-55-08-641Z',
  'config/profile.yml.bak-2026-08-05T16-55-08-641Z',
  'portals.yml.bak-2026-08-05T16-55-08-641Z',
  'cv.md.bak10',
];

for (const path of timestampedBackupProbes) {
  let ignored = true;
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT });
  } catch {
    ignored = false;
  }
  if (ignored) pass(`${path} is git-ignored`);
  else fail(`${path} is NOT git-ignored — a timestamped backup could expose PII`);
}

// Not user-layer data, but the same mechanism: this one is about what a
// reflexive `git add .` can swallow. test-all.mjs builds its script-runner
// sandbox with mkdtempSync under the repo ROOT, and a suite interrupted
// mid-run (a flake, a Ctrl-C) leaves that copy behind: ~650MB and ~1000
// stageable files. The copied .gitignore does travel with it and does keep the
// user-layer paths inside it ignored, so this is noise rather than a leak, but
// it is noise a contributor can commit by accident.
const scratchProbes = [
  '.tmp-script-test-abc123/AGENTS.md',
  '.tmp-script-test-abc123/nested/deep/file.mjs',
];

for (const path of scratchProbes) {
  let ignored = true;
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT });
  } catch {
    ignored = false;
  }
  if (ignored) pass(`${path} is git-ignored`);
  else fail(`${path} is NOT git-ignored — an interrupted test run leaves it stageable`);
}
