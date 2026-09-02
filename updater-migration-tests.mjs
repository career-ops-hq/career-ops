#!/usr/bin/env node

/**
 * updater-migration-tests.mjs — source-level safety checks for update-system.
 *
 * Protects cross-version migrations where an older installed updater must fetch
 * newly introduced system paths without touching user data.
 */

import { readFileSync, existsSync } from 'fs';

let passed = 0;
let failed = 0;

function pass(message) {
  console.log(`PASS ${message}`);
  passed++;
}

function fail(message) {
  console.error(`FAIL ${message}`);
  failed++;
}

let source = '';
try {
  source = readFileSync('update-system.mjs', 'utf-8');
  pass('update-system.mjs is readable');
} catch (error) {
  fail(`update-system.mjs is readable: ${error.message}`);
  process.exit(1);
}

function extractArray(name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) {
    fail(`${name} array exists`);
    return [];
  }
  pass(`${name} array exists`);
  return Array.from(match[1].matchAll(/['"]([^'"]+)['"]/g), (entry) => entry[1]);
}

const systemPaths = extractArray('SYSTEM_PATHS');
const userPaths = extractArray('USER_PATHS');
const bootstrapPaths = extractArray('BOOTSTRAP_PATHS');

// Every concrete (non-directory) manifest entry (SYSTEM_PATHS or
// BOOTSTRAP_PATHS) must exist in the working tree. A path deleted upstream
// but left in the manifest survives as a permanent `error: pathspec ...` in
// every user's upgrade output (#2002). Directory entries (trailing '/') are
// exempt: git checkout of a directory pathspec tolerates content drift
// inside it. Add an entry to ALLOWED_MISSING_ENTRIES only with a comment
// justifying why it may legitimately be absent.
const ALLOWED_MISSING_ENTRIES = new Set([]);
for (const [listName, entries] of [['SYSTEM_PATHS', systemPaths], ['BOOTSTRAP_PATHS', bootstrapPaths]]) {
  for (const entry of entries) {
    if (entry.endsWith('/')) continue;
    if (ALLOWED_MISSING_ENTRIES.has(entry)) continue;
    if (existsSync(entry)) {
      pass(`${listName} entry exists on disk: ${entry}`);
    } else {
      fail(`${listName} entry missing from tree (stale manifest entry, #2002): ${entry}`);
    }
  }
}

const requiredSystemPaths = [
  'modes/email.md',
  'modes/followup.md',
  'modes/interview.md',
  'modes/interview-prep.md',
  'modes/patterns.md',
  'modes/update.md',
  'modes/ar/',
  'modes/hi/',
  'modes/tr/',
  'modes/ua/',
  'batch/README.md',
  'examples/',
  'config/profile.example.yml',
  '.env.example',
  '.claude-plugin/',
  '.qwen/',
  '.antigravitycli/skills/',
  '.grok/skills/',
  '.cursor/skills/',
  'tracker-columns-tests.mjs',
  'updater-migration-tests.mjs',
  'README.ar.md',
  'README.de.md',
  'README.hi.md',
  'README.ja.md',
  'README.ua.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'GOVERNANCE.md',
  'SECURITY.md',
  'SUPPORT.md',
  'TRADEMARK.md',
];

const requiredBootstrapPaths = [
  '.agents/',
  '.cursor/skills/',
  '.opencode/skills/',
  '.antigravitycli/skills/',
  '.grok/skills/',
  'providers/',
  'liveness-browser.mjs',
  'role-matcher.mjs',
  'tracker-utils.mjs',
  'tracker-parse.mjs',
  'updater-migration-tests.mjs',
  'tracker-columns-tests.mjs',
];

for (const path of requiredSystemPaths) {
  if (systemPaths.includes(path)) pass(`SYSTEM_PATHS covers ${path}`);
  else fail(`SYSTEM_PATHS missing ${path}`);
}

for (const path of requiredBootstrapPaths) {
  if (bootstrapPaths.includes(path)) pass(`BOOTSTRAP_PATHS covers ${path}`);
  else fail(`BOOTSTRAP_PATHS missing ${path}`);
}

const twoPassManifestChecks = [
  {
    name: 'apply has a re-exec guard',
    pattern: /CAREER_OPS_UPDATE_REEXEC/,
  },
  {
    name: 'apply resolves the re-exec checkout closure from FETCH_HEAD (#1245)',
    pattern: /resolveReexecCheckout\('FETCH_HEAD',\s*'update-system\.mjs'\)/,
  },
  {
    name: 'apply checks out the resolved re-exec files from FETCH_HEAD (#1245)',
    pattern: /git\('checkout',\s*'FETCH_HEAD',\s*'--',\s*\.\.\.reexecFiles\)/,
  },
  {
    name: 're-exec fallback still covers the skill-entrypoints import (#1245)',
    pattern: /REEXEC_FALLBACK_FILES\s*=\s*\[[^\]]*'scaffolder\/bin\/skill-entrypoints\.mjs'/,
  },
  {
    name: 'apply re-execs through the current Node binary',
    pattern: /execFileSync\(process\.execPath,\s*\[\s*'update-system\.mjs',\s*'apply'\s*\]/,
  },
  {
    name: 'apply carries the original backup branch across re-exec',
    pattern: /CAREER_OPS_UPDATE_BACKUP_BRANCH/,
  },
  {
    name: 'apply reads the target updater manifest from FETCH_HEAD',
    pattern: /git\('show',\s*'FETCH_HEAD:update-system\.mjs'\)/,
  },
  {
    name: 'apply extracts SYSTEM_PATHS from the target updater',
    pattern: /extractArrayFromSource\([^,]+,\s*'SYSTEM_PATHS'\)/,
  },
  {
    name: 'apply merges local and target system manifests',
    pattern: /mergePathLists\(SYSTEM_PATHS,\s*remoteSystemPaths[\s\S]*?\)/,
  },
  {
    name: 'apply checks out the merged manifest instead of only the local manifest',
    pattern: /for\s*\(const path of updatePaths\)/,
  },
  {
    name: 'revertPaths uses git checkout HEAD (not just --) to reset index+worktree (#915)',
    pattern: /\b(?:git|runGit)\('checkout',\s*'HEAD',\s*'--'/,
  },
  {
    name: 'apply commit is scoped to update paths, not bare commit (#915)',
    pattern: /git\('commit',\s*'-m',[^)]+'--',\s*\.\.\.pathsToStage\)/,
  },
  {
    name: 'rollback commit is scoped to rollback paths, not bare commit (#915)',
    pattern: /git\('commit',\s*'-m',[^)]+'--',\s*\.\.\.rollbackPaths\)/,
  },
  {
    name: 'apply captures uncommitted work via git stash create before branching (#915)',
    pattern: /git\('stash',\s*'create'\)/,
  },
  {
    // A client whose manifest predates the target checks out only its own
    // paths, so everything added upstream since is silently absent and apply
    // still printed "Update complete" (#1998).
    name: 'apply verifies the target manifest materialized before claiming success (#1998)',
    pattern: /missingFromTargetManifest\(remoteSystemPaths\)/,
  },
  {
    name: 'an incomplete apply exits non-zero instead of reporting success (#1998)',
    pattern: /Update incomplete[\s\S]{0,600}?process\.exit\(1\)/,
  },
  {
    // execFileSync inherits stderr, so an expected per-path skip printed git's
    // raw pathspec error right before the success banner (#1998).
    // The trailing spread is the #2337 preserve-exclusions; the property this
    // pins is the runner (gitQuiet, not git) and the ref, not the arity.
    name: 'per-path checkout pipes stderr so expected skips stay quiet (#1998)',
    pattern: /gitQuiet\('checkout',\s*'FETCH_HEAD',\s*'--',\s*path(?:,\s*\.\.\.\w+)?\)/,
  },
  {
    // #2337: a system file this install edited must be listed and backed up
    // before the checkout, not overwritten in silence.
    name: 'locally edited system files are detected before checkout (#2337)',
    pattern: /const atRisk = locallyModifiedSystemFiles\(updatePaths, 'FETCH_HEAD'\)/,
  },
  {
    name: 'the local copy is saved as .bak before any overwrite (#2337)',
    // backupSystemFiles owns the byte copy for both the normal update and the
    // earlier self-bootstrap overwrite (#3207); pin the normal call site here.
    pattern: /backupSystemFiles\(atRisk\)/,
  },
  {
    name: 'overwriting a locally edited system file requires --force (#2337)',
    pattern: /updateForce[\s\S]{0,400}?preservedPaths\.push\(\.\.\.atRisk\)/,
  },
  {
    // Excluded paths must stay out of the scoped commit too, or the
    // "auto-update" commit records the very edit the user kept (#2337).
    name: 'preserved paths are excluded from the update commit (#2337)',
    pattern: /pathsToStage = \[\.\.\.updated, \.\.\.preserveSpecs\]/,
  },
  {
    name: 'skipped upstream-absent paths are summarized explicitly (#1998)',
    pattern: /Skipped \$\{skippedPaths\.length\} path\(s\) absent upstream/,
  },
  {
    // existsSync on a pre-existing directory (docs/) would call it materialized
    // even when the target added files under it — the verification must recurse
    // into directory entries against FETCH_HEAD (#1998 CodeRabbit review).
    name: 'manifest verification recurses into directory entries via ls-tree (#1998)',
    pattern: /ls-tree', '-r', '--name-only', 'FETCH_HEAD'[\s\S]{0,400}?treeFiles\.some\(f => !existsSync/,
  },
  {
    // A checkout failure is only an expected skip when the path is truly absent
    // from FETCH_HEAD; timeouts/permission errors must rethrow, not report
    // success (#1998 CodeRabbit review).
    name: 'a checkout failure only skips when the path is absent upstream, else rethrows (#1998)',
    pattern: /catch \{ absentUpstream = true; \}\s*if \(!absentUpstream\) throw err;/,
  },
  {
    // `git checkout HEAD -- docs/` restores tracked content but never removes
    // paths HEAD lacks, so files the update introduced under a directory
    // pathspec survived the rollback as staged additions (#2015).
    name: 'revertPaths clears additions HEAD lacks under a directory pathspec (#2015)',
    pattern: /removeAdditionsNotInHead\(p, protectedPaths, ctx\)/,
  },
  {
    name: 'removeAdditionsNotInHead only targets additions, never modifications (#2015)',
    pattern: /'--diff-filter=A'/,
  },
  {
    // The cleanup must not delete a file the user already had staged before the
    // update ran, only additions the update itself introduced (#2015 review).
    name: 'rollback cleanup skips pre-update staged paths (protectedPaths) (#2015)',
    pattern: /if \(protectedPaths\.has\(file\)\) continue;/,
  },
  {
    name: 'revertPaths receives the pre-update snapshot at its call sites (#2015)',
    pattern: /revertPaths\(updated, initialStatusPaths\)/,
  },
  {
    // -z output is NUL-delimited/unquoted, so a path with spaces or newlines is
    // not mangled by split('\n').trim() (#2015 review).
    name: 'rollback cleanup parses NUL-delimited git output (#2015)',
    pattern: /'--cached', '-z', '--name-only', '--diff-filter=A'[\s\S]*?added\.split\('\\0'\)\.filter/,
  },
  {
    // The worktree file is deleted only after git rm succeeds, so a failed
    // index removal never strands a staged addition with no file (#2015).
    name: 'rollback deletes the worktree copy only after a successful git rm (#2015)',
    pattern: /removed = true;[\s\S]{0,400}?if \(removed\) \{[\s\S]{0,80}?rmSync/,
  },
];

for (const check of twoPassManifestChecks) {
  if (check.pattern.test(source)) pass(check.name);
  else fail(check.name);
}

// #1706: update-system.mjs must be self-loading — no static (top-level) relative
// imports. A pre-#1245 client's apply() self-reexec checks out ONLY
// update-system.mjs before re-execing it, so any top-level `import ... from
// './...'` (or bare `import './...'`) crashes that re-exec with
// ERR_MODULE_NOT_FOUND on the old→new jump. Relative modules must be lazily
// `await import()`ed at their point of use instead.
const staticRelativeImport = /^\s*(?:import|export)\b[^\n]*?\bfrom\s*['"]\.[^'"]*['"]|^\s*import\s*['"]\.[^'"]*['"]/m;
if (staticRelativeImport.test(source)) {
  fail('update-system.mjs is self-loading — no static relative imports (#1706)');
} else {
  pass('update-system.mjs is self-loading — no static relative imports (#1706)');
}

for (const userPath of ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml', 'data/', 'reports/']) {
  if (userPaths.includes(userPath)) pass(`USER_PATHS protects ${userPath}`);
  else fail(`USER_PATHS missing ${userPath}`);
}

const allowedSystemUserOverlap = new Set([
  'writing-samples/README.md',
  // System-owned scaffold inside the user-layer interview-prep/ dir (#1242):
  // the updater ships these two, but never the real session files alongside them.
  'interview-prep/sessions/.gitkeep',
  'interview-prep/sessions/README.md',
  // Same pattern for the user-layer documents/ intake dir (#1723): the
  // updater ships the scaffold, never the user's source documents.
  'documents/.gitkeep',
  'documents/README.md',
]);
let hasSystemUserCollision = false;
for (const systemPath of systemPaths) {
  const overlapsUserPath = userPaths.some((userPath) => {
    if (allowedSystemUserOverlap.has(systemPath)) return false;
    return systemPath === userPath || systemPath.startsWith(userPath);
  });
  if (overlapsUserPath) {
    hasSystemUserCollision = true;
    fail(`SYSTEM_PATHS must not update user path ${systemPath}`);
  }
}
if (!hasSystemUserCollision) {
  pass('SYSTEM_PATHS does not collide with USER_PATHS');
}

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\n${passed} passed, ${failed} failed`);
