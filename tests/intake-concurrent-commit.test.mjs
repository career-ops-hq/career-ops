// Atomic replacement alone must not lose another confirmed source.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
const root = mkdtempSync(join(tmpdir(), 'career-ops-state-writers-'));
mkdirSync(join(root, 'data'), { recursive: true });
const hook = join(root, 'slow-ledger-read.mjs');
// Delay the real read return to expose simultaneous read/modify/write reliably.
writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
let paused = false;
fs.readFileSync = (path, ...options) => {
  const bytes = read(path, ...options);
  if (String(path) === process.env.STATE_PATH && process.env.SCAN_READY && !paused) {
    paused = true;
    fs.writeFileSync(process.env.SCAN_READY, 'scanned');
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(process.env.SCAN_RESUME)) {
      if (Date.now() > deadline) throw new Error('scan barrier timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (String(path) === process.env.STATE_PATH) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  return bytes;
};
syncBuiltinESMExports();\n`);
const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: join(root, 'data', 'applications.md') };
function check(label, fn) { try { fn(); pass(label); } catch (e) { fail(`${label}: ${e.message}`); process.exitCode = 1; } }
const child = (script, args, extraEnv = {}) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, script), ...args], { env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  p.stdout.on('data', b => stdout += b); p.stderr.on('data', b => stderr += b);
  p.on('error', reject); p.on('close', status => resolve({ status, stdout, stderr }));
});

mkdirSync(join(root, 'documents', 'cv'), { recursive: true });
const sources = Array.from({ length: 8 }, (_, i) => `cv/fictional-${i}.md`);
for (const s of sources) writeFileSync(join(root, 'documents', s), '# Fictional source ' + s + '\n');
const statePath = join(root, 'data', 'intake-state.json');
env.STATE_PATH = statePath;
env.CAREER_OPS_INTAKE_STATE = statePath;
env.CAREER_OPS_DOCUMENTS_DIR = join(root, 'documents');
const previous = { hash: 'old-confirmed-source', ingestedAt: '2026-01-01T00:00:00Z' };
writeFileSync(statePath, JSON.stringify({ ingested: { 'cv/old.md': previous } }));
try {
  const writers = await Promise.all(sources.map(s => child('intake.mjs', ['--commit', s])));
  check('all concurrent per-source confirmations and old entries persist', () => {
    for (const r of writers) assert.equal(r.status, 0, describeSpawn(r));
    const state = JSON.parse(readFileSync(statePath, 'utf8')).ingested;
    for (const s of sources) assert.ok(state[s]?.hash, `lost confirmation ${s}`);
    assert.deepEqual(state['cv/old.md'], previous);
  });
  const scan = spawnSync(process.execPath, [join(ROOT, 'intake.mjs')], { env, encoding: 'utf8' });
  check('the next scan never proposes confirmed documents again', () => {
    assert.equal(scan.status, 0, describeSpawn(scan));
    for (const s of JSON.parse(scan.stdout).sources) assert.equal(s.status, 'ingested', s.path);
  });
  const again = await Promise.all([child('intake.mjs', ['--commit', sources[0]]), child('intake.mjs', ['--commit', sources[0]])]);
  check('a repeated confirmation is recomputed against the guarded ledger', () => {
    for (const r of again) { assert.equal(r.status, 0, describeSpawn(r)); assert.match(r.stdout, /Recorded 0 source/); }
  });
  const before = readFileSync(statePath, 'utf8');
  const empty = await child('intake.mjs', ['--commit', '--summary']);
  check('an empty confirmation remains rejected without a ledger write', () => {
    assert.equal(empty.status, 1, describeSpawn(empty));
    assert.equal(readFileSync(statePath, 'utf8'), before);
  });
  const ready = join(root, 'scan-ready'), resume = join(root, 'scan-resume');
  const stale = child('intake.mjs', ['--commit', sources[0]], { SCAN_READY: ready, SCAN_RESUME: resume });
  let newer;
  try {
    const deadline = Date.now() + 30000;
    while (!existsSync(ready)) {
      assert.ok(Date.now() < deadline, 'old scan did not reach the barrier');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    writeFileSync(join(root, 'documents', sources[0]), '# Newly confirmed fictional source\n');
    const updated = await child('intake.mjs', ['--commit', sources[0]]);
    assert.equal(updated.status, 0, describeSpawn(updated));
    assert.match(updated.stdout, /Recorded 1 source/);
    newer = JSON.parse(readFileSync(statePath, 'utf8')).ingested;
  } finally { writeFileSync(resume, 'resume'); }
  const staleResult = await stale;
  check('a source already ingested at scan time cannot replace a newer confirmation', () => {
    assert.equal(staleResult.status, 0, describeSpawn(staleResult));
    assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).ingested, newer);
  });
  check('a stale ingested scan records no source after waiting for a newer writer', () => {
    assert.match(staleResult.stdout, /Recorded 0 source/);
  });
} finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
