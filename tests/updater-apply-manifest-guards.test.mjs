/*
 * updater-apply-manifest-guards.test.mjs — apply() target manifest validation,
 * .env user protection, and literal pathspecs (#3825).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  USER_PATHS,
  assertSafeManifestPaths,
  isSafeManifestPath,
} from '../update-system.mjs';
import { fail, makeUpdaterRepo, NODE, pass, rmSync } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const updaterSource = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8');

function check(condition, ok, bad) {
  if (condition) pass(ok);
  else fail(bad);
}

const DEAD_PROXY = 'http://127.0.0.1:9';

function updaterChildEnv(extra = {}) {
  const env = {
    ...process.env,
    CAREER_OPS_GIT_TIMEOUT_MS: '20000',
    http_proxy: DEAD_PROXY,
    https_proxy: DEAD_PROXY,
    HTTP_PROXY: DEAD_PROXY,
    HTTPS_PROXY: DEAD_PROXY,
    ALL_PROXY: DEAD_PROXY,
    ...extra,
  };
  delete env.NO_PROXY;
  delete env.no_proxy;
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

console.log('\n🧪 Testing updater apply target manifest guards (#3825)...');

// ── 1. .env is protected as user-owned; .env.example remains safe ──
{
  check(
    USER_PATHS.includes('.env'),
    'USER_PATHS includes ".env"',
    '.env is missing from USER_PATHS',
  );

  check(
    isSafeManifestPath('.env') === false,
    'isSafeManifestPath(".env") is false',
    '.env was unexpectedly accepted as a safe manifest path',
  );

  check(
    isSafeManifestPath('.env.example') === true,
    'isSafeManifestPath(".env.example") is true',
    '.env.example was unexpectedly rejected',
  );

  const envVariants = [
    ['.ENV', false, 'case-folded alias'],
    ['.env/nested', false, 'child path under .env'],
    ['./.env', false, 'leading dot-slash alias'],
    ['.env.example', true, 'example scaffold file'],
    ['.env.sample', true, 'sample scaffold file'],
    ['.env.local', true, 'unrelated non-overlapping sibling file'],
  ];

  for (const [path, expected, desc] of envVariants) {
    const actual = isSafeManifestPath(path);
    check(
      actual === expected,
      `isSafeManifestPath(${JSON.stringify(path)}) is ${expected} (${desc})`,
      `isSafeManifestPath(${JSON.stringify(path)}) was ${actual}, expected ${expected} (${desc})`,
    );
  }
}

// ── 2. assertSafeManifestPaths rejects user-layer paths and .env ──
{
  let threwEnv = false;
  let envError = '';
  try {
    assertSafeManifestPaths(['.env', 'lib/update-manifest.mjs'], USER_PATHS, 'Target manifest');
  } catch (err) {
    threwEnv = true;
    envError = err.message;
  }
  check(
    threwEnv && envError.includes('Target manifest contains unsafe manifest path(s): ".env"')
      && envError.includes('it overlaps protected user path ".env"'),
    'assertSafeManifestPaths rejects .env naming the protected user path',
    `assertSafeManifestPaths did not reject .env as expected: threw=${threwEnv}, message=${envError}`,
  );

  let threwUser = false;
  let userError = '';
  try {
    assertSafeManifestPaths(['data/private.json', 'lib/update-manifest.mjs'], USER_PATHS, 'Target manifest');
  } catch (err) {
    threwUser = true;
    userError = err.message;
  }
  check(
    threwUser && userError.includes('Target manifest contains unsafe manifest path(s): "data/private.json"')
      && userError.includes('it overlaps protected user path "data/"'),
    'assertSafeManifestPaths rejects user directory descendants (data/private.json)',
    `assertSafeManifestPaths did not reject user directory as expected: threw=${threwUser}, message=${userError}`,
  );

  let allowed = false;
  try {
    const safe = assertSafeManifestPaths(['.env.example', 'lib/update-manifest.mjs'], USER_PATHS, 'Target manifest');
    allowed = safe.length === 2 && safe[0] === '.env.example';
  } catch {
    allowed = false;
  }
  check(
    allowed,
    'assertSafeManifestPaths permits safe paths including .env.example',
    'assertSafeManifestPaths unexpectedly rejected safe paths',
  );
}

// ── 3. apply() refuses a target manifest that includes .env ──
{
  const { dir: upstreamDir, g: gUp } = makeUpdaterRepo({ prefix: 'co-apply-guard-upstream-env-' });
  const { dir: localDir, g: gLoc } = makeUpdaterRepo({ prefix: 'co-apply-guard-local-env-' });

  try {
    // Upstream has v2.0.0, update-system.mjs, and a target manifest claiming .env
    writeFileSync(join(upstreamDir, 'VERSION'), '2.0.0\n');
    writeFileSync(join(upstreamDir, 'update-system.mjs'), updaterSource);
    mkdirSync(join(upstreamDir, 'lib'), { recursive: true });
    writeFileSync(
      join(upstreamDir, 'lib', 'update-manifest.mjs'),
      'export const SYSTEM_PATHS = [\n'
        + '  ".env",\n'
        + '  "lib/update-manifest.mjs",\n'
        + '  "target-only.txt",\n'
        + '  "update-system.mjs",\n'
        + '  "VERSION",\n'
        + '];\n'
        + 'Object.freeze(SYSTEM_PATHS);\n',
    );
    writeFileSync(join(upstreamDir, 'target-only.txt'), 'upstream payload\n');
    gUp('add', '-A');
    gUp('commit', '-qm', 'upstream v2.0.0');

    // Local install has v1.0.0, user's private .env, and user's cv.md
    writeFileSync(join(localDir, 'VERSION'), '1.0.0\n');
    writeFileSync(join(localDir, 'update-system.mjs'), updaterSource);
    mkdirSync(join(localDir, 'lib'), { recursive: true });
    writeFileSync(
      join(localDir, 'lib', 'update-manifest.mjs'),
      'export const SYSTEM_PATHS = [\n'
        + '  "lib/update-manifest.mjs",\n'
        + '  "update-system.mjs",\n'
        + '  "VERSION",\n'
        + '];\n'
        + 'Object.freeze(SYSTEM_PATHS);\n',
    );
    const userEnvSecret = 'OPENAI_API_KEY=sk-private-secret-12345\n';
    const userCvBytes = '# User Curriculum Vitae\nPrivate user content\n';
    writeFileSync(join(localDir, '.env'), userEnvSecret);
    writeFileSync(join(localDir, 'cv.md'), userCvBytes);
    gLoc('add', 'lib', 'update-system.mjs', 'VERSION');
    gLoc('commit', '-qm', 'local v1.0.0');

    // Route fetch calls to our throwaway upstream repository
    const upUrl = upstreamDir.replace(/\\/g, '/');
    gLoc('config', `url.${upUrl}.insteadOf`, 'https://github.com/career-ops-hq/career-ops.git');

    const res = spawnSync(NODE, ['update-system.mjs', 'apply', '--channel', 'main', '--confirm', '--force'], {
      cwd: localDir,
      encoding: 'utf8',
      env: updaterChildEnv(),
      timeout: 30000,
    });

    check(
      res.status !== 0,
      'apply() exits non-zero when target manifest contains .env',
      `apply() unexpectedly exited ${res.status}: ${res.stdout}\n${res.stderr}`,
    );

    const combinedOutput = `${res.stdout}\n${res.stderr}`;
    check(
      combinedOutput.includes('contains unsafe manifest path(s): ".env"')
        && combinedOutput.includes('it overlaps protected user path ".env"'),
      'apply() stderr/stdout reports .env as an unsafe manifest path overlapping protected user path',
      `expected refusal message not found in output: ${combinedOutput}`,
    );

    check(
      existsSync(join(localDir, '.env')) && readFileSync(join(localDir, '.env'), 'utf8') === userEnvSecret,
      'user .env was left completely untouched byte-for-byte',
      'user .env was modified or deleted by apply()',
    );

    check(
      existsSync(join(localDir, 'cv.md')) && readFileSync(join(localDir, 'cv.md'), 'utf8') === userCvBytes,
      'user cv.md was left completely untouched byte-for-byte',
      'user cv.md was modified or deleted by apply()',
    );

    check(
      !existsSync(join(localDir, 'target-only.txt')),
      'target files were NOT checked out when target manifest was refused',
      'target-only.txt was unexpectedly checked out',
    );
  } finally {
    rmSync(upstreamDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  }
}

// ── 4. apply() refuses a target manifest that includes user-layer paths ──
{
  const { dir: upstreamDir, g: gUp } = makeUpdaterRepo({ prefix: 'co-apply-guard-upstream-user-' });
  const { dir: localDir, g: gLoc } = makeUpdaterRepo({ prefix: 'co-apply-guard-local-user-' });

  try {
    writeFileSync(join(upstreamDir, 'VERSION'), '2.0.0\n');
    writeFileSync(join(upstreamDir, 'update-system.mjs'), updaterSource);
    mkdirSync(join(upstreamDir, 'lib'), { recursive: true });
    writeFileSync(
      join(upstreamDir, 'lib', 'update-manifest.mjs'),
      'export const SYSTEM_PATHS = [\n'
        + '  "cv.md",\n'
        + '  "data/rogue-doc.json",\n'
        + '  "lib/update-manifest.mjs",\n'
        + '  "target-file.txt",\n'
        + '  "update-system.mjs",\n'
        + '  "VERSION",\n'
        + '];\n'
        + 'Object.freeze(SYSTEM_PATHS);\n',
    );
    writeFileSync(join(upstreamDir, 'target-file.txt'), 'upstream file\n');
    gUp('add', '-A');
    gUp('commit', '-qm', 'upstream v2.0.0 with user-layer paths in manifest');

    writeFileSync(join(localDir, 'VERSION'), '1.0.0\n');
    writeFileSync(join(localDir, 'update-system.mjs'), updaterSource);
    mkdirSync(join(localDir, 'lib'), { recursive: true });
    writeFileSync(
      join(localDir, 'lib', 'update-manifest.mjs'),
      'export const SYSTEM_PATHS = [\n'
        + '  "lib/update-manifest.mjs",\n'
        + '  "update-system.mjs",\n'
        + '  "VERSION",\n'
        + '];\n'
        + 'Object.freeze(SYSTEM_PATHS);\n',
    );
    const userCvBytes = '# My CV\nPersonal experiences\n';
    writeFileSync(join(localDir, 'cv.md'), userCvBytes);
    gLoc('add', 'lib', 'update-system.mjs', 'VERSION');
    gLoc('commit', '-qm', 'local v1.0.0');

    const upUrl = upstreamDir.replace(/\\/g, '/');
    gLoc('config', `url.${upUrl}.insteadOf`, 'https://github.com/career-ops-hq/career-ops.git');

    const res = spawnSync(NODE, ['update-system.mjs', 'apply', '--channel', 'main', '--confirm', '--force'], {
      cwd: localDir,
      encoding: 'utf8',
      env: updaterChildEnv(),
      timeout: 30000,
    });

    check(
      res.status !== 0,
      'apply() exits non-zero when target manifest contains user-layer paths (cv.md, data/)',
      `apply() unexpectedly exited ${res.status}: ${res.stdout}\n${res.stderr}`,
    );

    const combinedOutput = `${res.stdout}\n${res.stderr}`;
    check(
      combinedOutput.includes('contains unsafe manifest path(s):')
        && combinedOutput.includes('"cv.md"')
        && combinedOutput.includes('"data/rogue-doc.json"'),
      'apply() reports both unsafe user-layer paths in its refusal error',
      `expected refusal paths not found in output: ${combinedOutput}`,
    );

    check(
      existsSync(join(localDir, 'cv.md')) && readFileSync(join(localDir, 'cv.md'), 'utf8') === userCvBytes,
      'user cv.md was left untouched byte-for-byte when manifest was refused',
      'user cv.md was modified or deleted',
    );

    check(
      !existsSync(join(localDir, 'target-file.txt')),
      'no target files were checked out when manifest was refused',
      'target-file.txt was unexpectedly checked out',
    );
  } finally {
    rmSync(upstreamDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  }
}

// ── 5. The per-path fallback checkout passes --literal-pathspecs ──
{
  const applyStart = updaterSource.indexOf('async function apply() {');
  const applyEnd = updaterSource.indexOf('\nfunction rollback(', applyStart);
  check(
    applyStart !== -1 && applyEnd !== -1,
    'located apply() in update-system.mjs',
    'could not locate apply() in update-system.mjs',
  );

  const applyBody = updaterSource.slice(applyStart, applyEnd);
  const fallbackLoopIndex = applyBody.indexOf('for (const path of batched ? [] : updatePaths) {');
  check(
    fallbackLoopIndex !== -1,
    'located per-path fallback loop in apply()',
    'could not locate per-path fallback loop in apply()',
  );

  const fallbackSnippet = applyBody.slice(fallbackLoopIndex, fallbackLoopIndex + 2000);
  const literalCheckoutPattern = /gitQuiet\(\s*['"]--literal-pathspecs['"],\s*['"]checkout['"],\s*targetCommit,\s*['"]--['"],\s*path(?:,\s*\.\.\.preserveSpecs)?\s*\)/;
  check(
    literalCheckoutPattern.test(fallbackSnippet),
    'per-path fallback checkout passes "--literal-pathspecs" before checkout',
    `per-path fallback checkout does not pass --literal-pathspecs: ${fallbackSnippet}`,
  );

  // Symmetry across all updater checkouts: batched, re-exec, rollback, and fallback
  const reexecCheckoutPattern = /git\(\s*['"]--literal-pathspecs['"],\s*['"]checkout['"],\s*targetCommit,\s*['"]--['"],\s*\.\.\.reexecFiles\s*\)/;
  check(
    reexecCheckoutPattern.test(applyBody),
    're-exec checkout passes "--literal-pathspecs"',
    're-exec checkout does not pass --literal-pathspecs',
  );

  const rollbackBody = updaterSource.slice(applyEnd);
  const rollbackCheckoutPattern = /git\(\s*['"]--literal-pathspecs['"],\s*['"]checkout['"],\s*latest,\s*['"]--['"],\s*file\s*\)/;
  check(
    rollbackCheckoutPattern.test(rollbackBody),
    'rollback restore checkout passes "--literal-pathspecs"',
    'rollback restore checkout does not pass --literal-pathspecs',
  );
}
