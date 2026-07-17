#!/usr/bin/env node
/**
 * seed-fixture.mjs — materialize a realistic user-data fixture into an install.
 *
 * Fixture states live in test-fixtures/upgrade/<state>/ and mirror the
 * user-layer files a real install of that era contains. Returns a SHA-256
 * manifest so callers can assert byte-identity later.
 *
 * Usage:
 *   node seed-fixture.mjs <targetDir> [--state state-v1.18]
 *   node seed-fixture.mjs --self-test
 */
import { createHash } from 'crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(ROOT, 'test-fixtures', 'upgrade');
export const DEFAULT_STATE = 'state-v1.18';

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

export function listStates() {
  return readdirSync(FIXTURES).filter((n) => statSync(join(FIXTURES, n)).isDirectory());
}

export function seedFixture(targetDir, { state = DEFAULT_STATE } = {}) {
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) throw new Error(`targetDir is not an existing directory: ${targetDir}`);
  const src = join(FIXTURES, state);
  if (!existsSync(src)) throw new Error(`Unknown fixture state: ${state} (have: ${listStates().join(', ')})`);
  // expected.json is harness metadata, not user data — never seed it.
  const files = walk(src).filter((f) => f !== 'expected.json');
  const manifest = {};
  for (const f of files) {
    const dest = join(targetDir, f);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(src, f), dest);
    manifest[f] = createHash('sha256').update(readFileSync(dest)).digest('hex');
  }
  return { state, files, manifest };
}

export function loadExpectations(state = DEFAULT_STATE) {
  return JSON.parse(readFileSync(join(FIXTURES, state, 'expected.json'), 'utf-8'));
}

function selfTest() {
  let failed = 0;
  const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++; };
  for (const state of listStates()) {
    const dir = mkdtempSync(join(tmpdir(), 'seed-fixture-'));
    try {
      const { files, manifest } = seedFixture(dir, { state });
      check(files.length >= 8, `${state}: seeds ${files.length} files (>=8)`);
      check(!files.includes('expected.json'), `${state}: expected.json not seeded`);
      const REQUIRED = ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml', 'data/applications.md'];
      for (const r of REQUIRED) check(files.includes(r), `${state}: required file seeded: ${r}`);
      const again = seedFixture(dir, { state });
      check(JSON.stringify(again.manifest) === JSON.stringify(manifest), `${state}: manifest is deterministic`);
      const exp = loadExpectations(state);
      check(Number.isInteger(exp.tracker_rows) && exp.tracker_rows > 0, `${state}: expected.json parses with tracker_rows`);
      const tracker = readFileSync(join(dir, 'data/applications.md'), 'utf-8');
      const rows = tracker.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).length;
      check(rows === exp.tracker_rows, `${state}: tracker has ${rows} rows == expected ${exp.tracker_rows}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(failed ? `${failed} check(s) failed` : 'seed-fixture self-test green');
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--self-test') selfTest();
  else if (args[0] && !args[0].startsWith('--')) {
    const stateIdx = args.indexOf('--state');
    if (stateIdx > -1 && (args[stateIdx + 1] === undefined || args[stateIdx + 1].startsWith('--'))) {
      console.error('Missing value for --state');
      process.exit(1);
    }
    const res = seedFixture(args[0], stateIdx > -1 ? { state: args[stateIdx + 1] } : {});
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.error('Usage: node seed-fixture.mjs <targetDir> [--state name] | --self-test');
    process.exit(1);
  }
}
