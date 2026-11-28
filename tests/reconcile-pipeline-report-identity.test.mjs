import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const SCRIPT = fileURLToPath(new URL('../reconcile-pipeline.mjs', import.meta.url));
const POSTING = 'https://jobs.example.test/openings/422';
const OTHER = 'https://jobs.example.test/openings/421';
const PENDING = `# Pipeline\n\n## Pending\n\n- [ ] ${POSTING} | Example | Engineer\n\n## Processed\n`;

function reconcile(t, reports) {
  const root = mkdtempSync(join(tmpdir(), 'co-reconcile-report-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pipeline = join(root, 'pipeline.md');
  const state = join(root, 'batch-state.tsv');
  mkdirSync(join(root, 'reports'));
  writeFileSync(pipeline, PENDING);
  writeFileSync(state, `1\t${POSTING}\tcompleted\t2026-11-01\t2026-11-02\t42\t-\n`);
  for (const [name, content] of Object.entries(reports)) {
    writeFileSync(join(root, 'reports', name), content);
  }
  const result = spawnSync(process.execPath, [SCRIPT, '--pipeline', pipeline, '--state', state], {
    cwd: root, env: { ...process.env, CAREER_OPS_ROOT: root }, encoding: 'utf8', timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, describeSpawn(result, '\n'));
  return readFileSync(pipeline, 'utf8');
}

test('reconciliation links the report for the posting when report numbers collide', t => {
  const pipeline = reconcile(t, {
    '042-a-other.md': `**URL:** ${OTHER}\n**Score:** 2/5\n`,
    '042-z-right.md': `**URL:** ${POSTING}?utm_source=batch\n**Score:** 4/5\n**PDF:** output/right.pdf\n`,
  });
  assert.match(pipeline, /- \[x\] \[42\]\(reports\/042-z-right\.md\).*\| 4\/5 \| PDF ✅/);
  assert.doesNotMatch(pipeline, /042-a-other/);
});

test('without a unique matching posting, reconciliation leaves the item pending', t => {
  const pipeline = reconcile(t, {
    '042-a-other.md': `**URL:** ${OTHER}\n`,
    '042-z-legacy.md': '**Score:** 4/5\n',
  });
  assert.equal(pipeline, PENDING);
});

test('a reservation alone does not reconcile a completed item', t => {
  const pipeline = reconcile(t, { '042-RESERVED.md': '# Reserved report slot\n' });
  assert.equal(pipeline, PENDING);
});
