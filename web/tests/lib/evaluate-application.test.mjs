import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeTargetedEvaluation } from '../../../persist-evaluation-report.mjs';
import { attachEvaluationToRow } from '../../../lib/evaluation-target.mjs';
import { resolveColumns, parseTrackerRow } from '../../../tracker-parse.mjs';
import { persistEvaluation } from '../../src/lib/report-persist.mjs';
import { evaluationState, stampEvaluationScope } from '../../src/lib/evaluation-state.mjs';
import { FULL_EVALUATION } from '../../src/lib/evaluation-options.mjs';

const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const url = 'https://employer.example/jobs/11';
const markdown = '# Evaluation: Fixture — Engineer\n\n**URL:** ' + url + '\n\n## Machine Summary\n```yaml\ncompany: Fixture\nrole: Engineer\nscore: 4.2\n```\n\n## B) Match with CV\nEvidence.\n\n## Job Description (archived verbatim)\nFictional posting.\n';
const table = status => '# Applications\r\n\r\n| # | Company | Role | Status | Score | Report | Notes | URL | PDF |\r\n|---|---|---|---|---|---|---|---|---|\r\n| 11 | Fixture | Engineer | ' + status + ' | — | — | Keep my note | [posting](' + url + ') | ✅ |\r\n';
const target = { num: '11', expectedCompany: 'Fixture', expectedRole: 'Engineer', expectedReport: '—' };
function row(text) { const lines = text.split(/\r?\n/), cols = resolveColumns(lines); return lines.map(line => parseTrackerRow(line, cols)).filter(Boolean)[0]; }
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-existing-eval-'));
  fs.mkdirSync(path.join(root, 'data'));
  const previous = process.env.CAREER_OPS_TRACKER;
  process.env.CAREER_OPS_TRACKER = path.join(root, 'data/applications.md');
  t.after(() => { if (previous === undefined) delete process.env.CAREER_OPS_TRACKER; else process.env.CAREER_OPS_TRACKER = previous; fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

test('evaluation scope is durable and a focused report becomes full only after a full save', () => {
  assert.equal(evaluationState(null).kind, 'none');
  assert.equal(evaluationState('## Old report\nEvidence.').kind, 'full');
  const partial = stampEvaluationScope(markdown, ['summary']);
  assert.deepEqual(evaluationState(partial), { kind: 'partial', sections: ['summary'] });
  const full = stampEvaluationScope(partial);
  assert.deepEqual(evaluationState(full), { kind: 'full', sections: [...FULL_EVALUATION] });
  assert.equal((full.match(/\*\*Evaluation scope:\*\*/g) || []).length, 1);
  assert.ok(!full.includes('Focused'));
  assert.equal(evaluationState('# Evaluation\n\n**Evaluation scope:** Focused — summary.\n\n## Match\n').kind, 'partial');
});

test('attaching a report updates the same row in Skip, Preparation or Applied and preserves every workflow field', () => {
  for (const status of ['SKIP', 'Preparation', 'Applied']) {
    const original = table(status);
    const after = attachEvaluationToRow(original, { target, url, score: '4.2/5', reportPath: '/fixture/reports/090-fixture.md', trackerPath: '/fixture/data/applications.md', reportNum: '090' });
    assert.equal(after, original.replace('| — | — |', '| 4.2/5 | [090](../reports/090-fixture.md) |'));
    assert.equal(row(after).num, 11);
  }
  assert.throws(() => attachEvaluationToRow(table('SKIP'), { target, url: 'https://employer.example/jobs/12', score: '4.2/5', reportPath: '/fixture/reports/x.md', trackerPath: '/fixture/data/applications.md', reportNum: '090' }), /URL/);
});

test('targeted persistence creates no merge addition; conflicting edits and missing jobs leave reports and tracker untouched', async t => {
  const root = fixture(t), file = path.join(root, 'data/applications.md');
  const payload = { markdown, num: '090', today: '2026-10-28', company: 'Fixture', role: 'Engineer', score: '4.2/5', via: null, url, notes: '', reportFile: '090-fixture-2026-10-28.md', targetApplication: target };
  fs.writeFileSync(file, table('SKIP'));
  assert.deepEqual(await writeTargetedEvaluation(root, payload), { ok: true });
  assert.equal(row(fs.readFileSync(file, 'utf8')).status, 'SKIP');
  assert.equal(fs.existsSync(path.join(root, 'batch/tracker-additions')), false);
  const saved = fs.readFileSync(file, 'utf8');
  const retry = await writeTargetedEvaluation(root, { ...payload, num: '091', reportFile: '091-fixture-2026-10-28.md' });
  assert.equal(retry.ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  assert.equal(fs.existsSync(path.join(root, 'reports/091-fixture-2026-10-28.md')), false);
  const missing = await writeTargetedEvaluation(root, { ...payload, targetApplication: { ...target, num: '99' } });
  assert.equal(missing.ok, false);
});

test('real evaluation orchestration upgrades a partial report on the same job and retains its earlier version', async t => {
  const root = fixture(t), file = path.join(root, 'data/applications.md');
  fs.writeFileSync(file, table('Preparation'));
  const common = { spawnFn: spawn, execPath: process.execPath, root, coreRoot: codeRoot, markdown, url, today: '2026-10-28' };
  const focused = await persistEvaluation({ ...common, evaluationSections: ['summary'], targetApplication: target });
  assert.equal(focused.ok, true, focused.error);
  assert.equal(focused.applicationN, '11');
  const first = row(fs.readFileSync(file, 'utf8'));
  const partialPath = path.join(root, 'reports', focused.reportFile);
  const partial = fs.readFileSync(partialPath, 'utf8');
  assert.equal(evaluationState(partial).kind, 'partial');
  // A status change while AI runs must survive the save.
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('| Preparation |', '| Applied |'));
  const full = await persistEvaluation({ ...common, evaluationSections: [...FULL_EVALUATION], targetApplication: { ...target, expectedReport: first.report } });
  assert.equal(full.ok, true, full.error);
  const saved = fs.readFileSync(file, 'utf8');
  const final = row(saved);
  assert.equal(final.num, 11);
  assert.equal(final.status, 'Applied');
  assert.equal(final.notes, 'Keep my note');
  assert.equal(final.url, url);
  assert.equal(final.pdf, '✅');
  assert.equal(saved.split(/\r?\n/).filter(line => /^\| 11 \|/.test(line)).length, 1);
  assert.equal(evaluationState(fs.readFileSync(path.join(root, 'reports', full.reportFile), 'utf8')).kind, 'full');
  assert.equal(fs.readFileSync(partialPath, 'utf8'), partial);
  assert.notEqual(full.reportFile, focused.reportFile);
  assert.ok(final.report.startsWith(`[${full.num}](`));
  assert.ok(final.report.endsWith(` · ${first.report}`), 'the same row keeps the previous report linked');
});
