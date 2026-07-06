#!/usr/bin/env node

/**
 * updater-migration-tests.mjs — source-level safety checks for update-system.
 *
 * Protects cross-version migrations where an older installed updater must fetch
 * newly introduced system paths without touching user data.
 */

import { readFileSync } from 'fs';

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

const requiredSystemPaths = [
  'modes/email.md',
  'modes/followup.md',
  'modes/interview.md',
  'modes/interview-prep.md',
  'modes/patterns.md',
  'modes/update.md',
  'modes/ar/',
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
  'tracker-columns-tests.mjs',
  'updater-migration-tests.mjs',
  'README.ar.md',
  'README.de.md',
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
    pattern: /git\('checkout',\s*'HEAD',\s*'--'/,
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
];

for (const check of twoPassManifestChecks) {
  if (check.pattern.test(source)) pass(check.name);
  else fail(check.name);
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
