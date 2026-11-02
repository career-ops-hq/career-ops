import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../auto-apply.mjs';

function fixture(count = 1) {
  const root = mkdtempSync(join(tmpdir(), 'auto-apply-decisions-'));
  mkdirSync(join(root, 'config'), { recursive: true }); mkdirSync(join(root, 'data')); mkdirSync(join(root, 'reports'));
  const config = readFileSync(new URL('../config/auto-apply.example.yml', import.meta.url), 'utf8').replace('enabled: false', 'enabled: true');
  writeFileSync(join(root, 'config/auto-apply.yml'), config);
  writeFileSync(join(root, 'cv.md'), ''); writeFileSync(join(root, 'config/profile.yml'), '');
  const rows = [], urls = [];
  for (let i = 1; i <= count; i++) {
    const url = `https://boards.greenhouse.io/acme/jobs/${70 + i}`, report = `${String(i).padStart(3, '0')}-acme.md`; urls.push(url);
    writeFileSync(join(root, 'reports', report), ['**URL:** ' + url, '', '## Machine Summary', '', '```yaml', 'company: Acme', 'url: ' + url, 'advertised_comp: "$100,000 - $120,000 USD"', 'posting_location: "Remote, United States"', 'required_questions: []', '```', ''].join('\n'));
    rows.push(`| ${i} | 2026-11-02 | Acme | Staff Services Analyst | 4.5/5 | Evaluated | — | [${i}](../reports/${report}) | — |`);
  }
  writeFileSync(join(root, 'data/applications.md'), `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
  return { root, urls, close: () => rmSync(root, { recursive: true, force: true }) };
}
const runtimeChecks = { live: async () => true, duplicate: async () => false };
const driver = async () => ({ confirmed: true, screenshot: 'proof', confirmationText: 'Submitted' });
function store(f, decisions) { mkdirSync(join(f.root, 'output/auto-apply'), { recursive: true }); writeFileSync(join(f.root, 'output/auto-apply/decisions.json'), JSON.stringify({ decisions })); }
function readEvents(f) { return readFileSync(join(f.root, 'output/auto-apply/live.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse); }

test('missing decision file leaves the existing approval behavior unchanged', async () => {
  const f = fixture(); try { const r = await run({ dataRoot: f.root, dryRun: false, submit: false, runtimeChecks, pageDriver: driver, setStatus: async () => {} }); assert.equal(r.submitted, 0); assert.equal(r.queued[0].detail, 'awaiting approval'); } finally { f.close(); }
});

test('malformed decisions fail before submit and write an error event', async () => {
  const f = fixture(); try { store(f, 'wrong'); let calls = 0; await assert.rejects(run({ dataRoot: f.root, dryRun: false, submit: true, runtimeChecks, pageDriver: async () => { calls++; return driver(); } }), /invalid shape/); assert.equal(calls, 0); assert.ok(readEvents(f).some((event) => event.type === 'error')); } finally { f.close(); }
});

test('skip is never submitted in unattended mode', async () => {
  const f = fixture(); try { store(f, [{ url: f.urls[0], decision: 'skip', ts: new Date().toISOString() }]); let calls = 0; const r = await run({ dataRoot: f.root, dryRun: false, submit: true, runtimeChecks, pageDriver: async () => { calls++; return driver(); }, setStatus: async () => {} }); assert.equal(calls, 0); assert.equal(r.skipped[0].reason, 'skipped by user'); assert.ok(readEvents(f).some((event) => event.type === 'decision-applied' && event.decision === 'skip')); } finally { f.close(); }
});

test('decision approval submits with unattended mode disabled', async () => {
  const f = fixture(); try { const configPath = join(f.root, 'config/auto-apply.yml'); writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('unattended: true', 'unattended: false')); store(f, [{ url: f.urls[0], decision: 'approve', ts: new Date().toISOString() }]); let calls = 0; const r = await run({ dataRoot: f.root, dryRun: false, submit: true, runtimeChecks, pageDriver: async () => { calls++; return driver(); }, setStatus: async () => {} }); assert.equal(calls, 1); assert.equal(r.submitted, 1); } finally { f.close(); }
});

test('decision approval submits its URL while unattended still handles other eligible URLs', async () => {
  const f = fixture(2); try { store(f, [{ url: f.urls[0], decision: 'approve', ts: new Date().toISOString() }]); const called = []; const r = await run({ dataRoot: f.root, dryRun: false, submit: true, runtimeChecks, pageDriver: async (job) => { called.push(job.url); return driver(); }, setStatus: async () => {} }); assert.deepEqual(called, f.urls); assert.equal(r.submitted, 2); } finally { f.close(); }
});

test('decision approval does not bypass the daily cap', async () => {
  const f = fixture(); try { store(f, [{ url: f.urls[0], decision: 'approve', ts: new Date().toISOString() }]); let calls = 0; const r = await run({ dataRoot: f.root, dryRun: false, submit: true, limit: 0, runtimeChecks, pageDriver: async () => { calls++; return driver(); }, setStatus: async () => {} }); assert.equal(calls, 0); assert.equal(r.submitted, 0); assert.match(r.skipped[0].reason, /daily application cap/); } finally { f.close(); }
});
