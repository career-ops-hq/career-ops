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
  return Array.from(match[1].matchAll(/'([^']+)'/g), (entry) => entry[1]);
}

const systemPaths = extractArray('SYSTEM_PATHS');
const userPaths = extractArray('USER_PATHS');
const bootstrapPaths = extractArray('BOOTSTRAP_PATHS');

const requiredSystemPaths = [
  'modes/followup.md',
  'modes/interview-prep.md',
  'modes/patterns.md',
  'modes/update.md',
  'modes/tr/',
  'modes/ua/',
  'batch/README.md',
  'examples/',
  'config/profile.example.yml',
  '.env.example',
  '.claude-plugin/',
  '.qwen/',
  'updater-migration-tests.mjs',
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
  'providers/',
  'liveness-browser.mjs',
  'updater-migration-tests.mjs',
];

for (const path of requiredSystemPaths) {
  if (systemPaths.includes(path)) pass(`SYSTEM_PATHS covers ${path}`);
  else fail(`SYSTEM_PATHS missing ${path}`);
}

for (const path of requiredBootstrapPaths) {
  if (bootstrapPaths.includes(path)) pass(`BOOTSTRAP_PATHS covers ${path}`);
  else fail(`BOOTSTRAP_PATHS missing ${path}`);
}

for (const userPath of ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml', 'data/', 'reports/']) {
  if (userPaths.includes(userPath)) pass(`USER_PATHS protects ${userPath}`);
  else fail(`USER_PATHS missing ${userPath}`);
}

const allowedSystemUserOverlap = new Set(['writing-samples/README.md']);
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
