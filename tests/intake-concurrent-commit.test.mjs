// Atomic replacement alone must not lose another confirmed source.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
const root = mkdtempSync(join(tmpdir(), 'career-ops-state-writers-'));
mkdirSync(join(root, 'data'), { recursive: true });
const hook = join(root, 'slow-ledger-read.mjs');
// Delay the real read return to expose simultaneous read/modify/write reliably.
writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = (path, ...options) => {
  const bytes = read(path, ...options);
  if (String(path) === process.env.STATE_PATH) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  return bytes;
};
syncBuiltinESMExports();\n`);
const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: join(root, 'data', 'applications.md') };
function check(label, fn) { try { fn(); pass(label); } catch (e) { fail(`${label}: ${e.message}`); process.exitCode = 1; } }
const child = (script, args) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, script), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    for (const r of writers) assert.equal(r.status, 0, r.stderr);
    const state = JSON.parse(readFileSync(statePath, 'utf8')).ingested;
    for (const s of sources) assert.ok(state[s]?.hash, `lost confirmation ${s}`);
    assert.deepEqual(state['cv/old.md'], previous);
  });
  const scan = spawnSync(process.execPath, [join(ROOT, 'intake.mjs')], { env, encoding: 'utf8' });
  check('the next scan never proposes confirmed documents again', () => {
    assert.equal(scan.status, 0, scan.stderr);
    for (const s of JSON.parse(scan.stdout).sources) assert.equal(s.status, 'ingested', s.path);
  });
  const again = await Promise.all([child('intake.mjs', ['--commit', sources[0]]), child('intake.mjs', ['--commit', sources[0]])]);
  check('a repeated confirmation is recomputed against the guarded ledger', () => {
    for (const r of again) { assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Recorded 0 source/); }
  });
  const before = readFileSync(statePath, 'utf8');
  const empty = await child('intake.mjs', ['--commit', '--summary']);
  check('an empty confirmation remains rejected without a ledger write', () => {
    assert.equal(empty.status, 1);
    assert.equal(readFileSync(statePath, 'utf8'), before);
  });
} finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
