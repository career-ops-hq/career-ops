// A declined sharing decision must survive another session's update.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-state-writers-')));
mkdirSync(join(root, 'data'), { recursive: true });
const hook = join(root, 'slow-ledger-read.mjs');
// Delay the real read return to expose simultaneous read/modify/write reliably.
writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = (path, ...options) => {
  const bytes = read(path, ...options);
  if (String(path) === process.env.HISTORY_PATH && process.env.DRAFT_READY) {
    fs.writeFileSync(process.env.DRAFT_READY, 'payload');
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(process.env.DRAFT_RESUME)) {
      if (Date.now() > deadline) throw new Error('draft barrier timed out');
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

const reports = Array.from({ length: 8 }, (_, i) => String(i + 1));
writeFileSync(env.CAREER_OPS_TRACKER, '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n' + reports.map(n => `| ${n} | 2026-01-05 | Fictional | Engineer | 4/5 | Hired | — | [#${n}](reports/${n}-fictional.md) | notes |`).join('\n'));
const statePath = join(root, 'data', '.hired-share-state.json');
env.STATE_PATH = statePath;
const previous = { status: 'never', askedAt: '2026-01-01T00:00:00Z' };
writeFileSync(statePath, JSON.stringify({ byReport: { '999': previous } }));
try {
  const writers = await Promise.all(reports.map(n => child('hired-share.mjs', ['--report', n, '--mark', 'never'])));
  check('every concurrent never decision persists with existing marks', () => {
    for (const r of writers) assert.equal(r.status, 0, describeSpawn(r));
    const state = JSON.parse(readFileSync(statePath, 'utf8')).byReport;
    for (const n of reports) assert.equal(state[n]?.status, 'never', `lost report ${n}`);
    assert.deepEqual(state['999'], previous);
  });
  const status = spawnSync(process.execPath, [join(ROOT, 'hired-share.mjs'), '--status'], { env, encoding: 'utf8' });
  check('status does not ask about a hire whose sharing was declined', () => {
    assert.equal(status.status, 0, describeSpawn(status));
    assert.deepEqual(JSON.parse(status.stdout).askable, []);
  });
  const declinedBeforeDraft = JSON.parse(readFileSync(statePath, 'utf8')).byReport['1'];
  const draft = await child('hired-share.mjs', ['--report', '1']);
  check('drafting preserves a permanent decline and every other report', () => {
    assert.equal(draft.status, 0, describeSpawn(draft));
    const state = JSON.parse(readFileSync(statePath, 'utf8')).byReport;
    assert.deepEqual(state['1'], declinedBeforeDraft);
    assert.equal(state['1'].status, 'never');
    for (const n of reports.slice(1)) assert.equal(state[n].status, 'never');
  });
  env.HISTORY_PATH = join(root, 'data', 'scan-history.tsv');
  writeFileSync(env.HISTORY_PATH, '2026-01-01\tfictional\n');
  const later = await child('hired-share.mjs', ['--report', '2', '--mark', 'later']);
  assert.equal(later.status, 0, describeSpawn(later));
  const ready = join(root, 'draft-ready'), resume = join(root, 'draft-resume');
  const pendingDraft = child('hired-share.mjs', ['--report', '2'], { DRAFT_READY: ready, DRAFT_RESUME: resume });
  let declined;
  try {
    const deadline = Date.now() + 30000;
    while (!existsSync(ready)) {
      assert.ok(Date.now() < deadline, 'draft did not reach the payload barrier');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const never = await child('hired-share.mjs', ['--report', '2', '--mark', 'never']);
    assert.equal(never.status, 0, describeSpawn(never));
    declined = JSON.parse(readFileSync(statePath, 'utf8')).byReport['2'];
  } finally { writeFileSync(resume, 'resume'); }
  const finishedDraft = await pendingDraft;
  check('a draft finishing after a concurrent never preserves the exact decline', () => {
    assert.equal(finishedDraft.status, 0, describeSpawn(finishedDraft));
    assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).byReport['2'], declined);
  });
  const allowed = await child('hired-share.mjs', ['--report', '3', '--mark', 'later']);
  assert.equal(allowed.status, 0, describeSpawn(allowed));
  const allowedDraft = await child('hired-share.mjs', ['--report', '3']);
  check('a draft still records drafted when the saved decision is later', () => {
    assert.equal(allowedDraft.status, 0, describeSpawn(allowedDraft));
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).byReport['3'].status, 'drafted');
  });
} finally { rmSync(root, { recursive: true, force: true, maxRetries: 10 }); }
