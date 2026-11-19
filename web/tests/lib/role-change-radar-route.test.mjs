// Exercise the real report reader -> API -> core stdin handoff with local fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../helpers/web-ts-alias-loader.mjs';

const codeRoot = fileURLToPath(new URL('../../../', import.meta.url));
const description = 'Title: Engineer\nCompany: Fictional Labs\nWork arrangement: Remote\nResponsibilities\nBuild reliable systems and maintain service documentation.\nQualifications\nKnowledge of SQL and testing.';
function fixture(t, reportFile, archived) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-route-')));
  const env = { CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: codeRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: path.join(root, 'data', 'applications.md') };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(env.CAREER_OPS_TRACKER, `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 7 | 2026-01-01 | Fictional Labs | Engineer | 4/5 | Applied | — | [7](../${reportFile}) | |\n`);
  fs.mkdirSync(path.dirname(path.join(root, reportFile)), { recursive: true });
  fs.writeFileSync(path.join(root, reportFile), `# Fictional Labs\n\n${archived ? `## Job Description (archived verbatim)\n\n${description}\n` : 'Evaluation report without an archived description.\n'}`);
  return root;
}
async function post(input) {
  const { POST } = await import('@/app/api/role-change-radar/route.ts');
  const response = await POST(new Request('http://127.0.0.1/api/role-change-radar', { method: 'POST', body: JSON.stringify({ id: '7', ...input }) }));
  const state = await response.json();
  assert.equal(response.status, 200, JSON.stringify(state));
  return state;
}
for (const reportFile of ['reports/007-fictional-labs-2026-01-01.md', 'reports/archive/007-fictional-labs-2026-01-01.md']) {
  test(`Radar resolves and compares the archived report at ${reportFile}`, async t => {
    const root = fixture(t, reportFile, true);
    const { readReport } = await import('@/lib/career-ops.ts');
    assert.equal(readReport('7').file, path.basename(reportFile));
    const state = await post({ action: 'load' });
    assert.equal(state.baseline.text, description);
    assert.equal(state.baseline.source, path.normalize(reportFile));
    const result = await post({ action: 'check', source: 'paste', text: description.replace('Remote', 'Hybrid') });
    assert.equal(result.lastCheck.status, 'success');
    assert.ok(result.comparisons[0].changes.some(change => change.categories.includes('Work arrangement')));
    assert.deepEqual(result.baseline, state.baseline);
    assert.ok(fs.readdirSync(path.join(root, 'data', 'role-change-radar')).some(name => name.endsWith('.json')));
  });
}
test('a saved report without an archive still allows creating a pasted baseline', async t => {
  fixture(t, 'reports/007-fictional-labs-2026-01-01.md', false);
  assert.equal((await post({ action: 'load' })).baseline, null);
  const result = await post({ action: 'baseline', source: 'paste', text: description });
  assert.equal(result.lastCheck.status, 'baseline-saved');
  assert.equal(result.baseline.text, description);
});
