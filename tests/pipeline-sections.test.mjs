// The pipeline.md writers and readers agree on the Pending and Processed
// headings every modes/*/pipeline.md tells an agent to write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendToPipeline } from '../scan.mjs';
import { parsePending } from '../sync-batch-input.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DONE = 'https://jobs.example.com/done';
const OPEN = 'https://jobs.example.com/open';

function sandbox(t, pipelineText) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-sections-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['data', 'batch', 'reports']) mkdirSync(join(root, dir));
  const pipeline = join(root, 'data', 'pipeline.md');
  writeFileSync(pipeline, pipelineText);
  return { root, pipeline };
}

function reconcile(t, pipelineText) {
  const { root, pipeline } = sandbox(t, pipelineText);
  const state = join(root, 'batch', 'batch-state.tsv');
  writeFileSync(state, `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\t${DONE}\tcompleted\t2026-10-01\t2026-10-01\t7\t4.1\t-\t0\n`);
  writeFileSync(join(root, 'reports', '007-acme-2026-10-01.md'), '**Score:** 4.1/5\n**PDF:** not generated\n');
  const result = spawnSync(process.execPath, [join(ROOT, 'reconcile-pipeline.mjs'), '--pipeline', pipeline, '--state', state], {
    cwd: root,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_TRACKER: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(pipeline, 'utf8');
}

function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `missing ${heading} in:\n${text}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return rest.slice(0, end < 0 ? undefined : end).filter((line) => line.startsWith('- ['));
}

const pipelineIn = (pending, processed) =>
  `# Pipeline\n\n## ${pending}\n\n- [ ] ${DONE} | Acme | Engineer\n- [ ] ${OPEN} | Initech | Analyst\n${processed ? `\n## ${processed}\n\n` : ''}`;

for (const [pending, processed] of [['Pending', 'Processed'], ['Offen', 'Verarbeitet'], ['En attente', 'Traitees'], ['Oczekujące', 'Przetworzone']]) {
  test(`reconcile moves a finished entry from ${pending} to ${processed}`, (t) => {
    const out = reconcile(t, pipelineIn(pending, processed));
    assert.deepEqual(section(out, `## ${pending}`), [`- [ ] ${OPEN} | Initech | Analyst`]);
    assert.equal(section(out, `## ${processed}`).length, 1);
    assert.match(section(out, `## ${processed}`)[0], /\[7\]\(\.\.\/reports\/007-acme-2026-10-01\.md\) \| https:\/\/jobs\.example\.com\/done \|/);
  });
}

test('reconcile names a missing processed section in the pending section language', (t) => {
  const out = reconcile(t, pipelineIn('Pendentes', null));
  assert.equal(section(out, '## Processadas').length, 1);
});

test('scan adds new postings to a German Offen section, not a second Pending section', async (t) => {
  const { pipeline } = sandbox(t, pipelineIn('Offen', 'Verarbeitet'));
  await appendToPipeline([{ url: 'https://jobs.example.com/new', company: 'Globex', title: 'Data Engineer', location: 'Remote' }], { pipelinePath: pipeline });
  const out = readFileSync(pipeline, 'utf8');
  assert.doesNotMatch(out, /^## Pending$/m);
  assert.equal(section(out, '## Offen').length, 3);
  assert.match(section(out, '## Offen')[2], /jobs\.example\.com\/new \| Globex \| Data Engineer/);
});

test('scan starts a Pending section before a localized processed section', async (t) => {
  const { pipeline } = sandbox(t, '# Pipeline\n\n## Verwerkt\n\n- [x] #1 | https://jobs.example.com/old | Acme | Engineer | 3.0/5 | PDF ❌\n');
  await appendToPipeline([{ url: 'https://jobs.example.com/new', company: 'Globex', title: 'Data Engineer', location: 'Remote' }], { pipelinePath: pipeline });
  const out = readFileSync(pipeline, 'utf8');
  assert.ok(out.indexOf('## Pending') < out.indexOf('## Verwerkt'), out);
  assert.equal(section(out, '## Verwerkt').length, 1);
});

test('sync-batch-input reads a Dutch pending section', () => {
  assert.deepEqual(parsePending(pipelineIn('In afwachting', 'Verwerkt')).map((e) => e.url), [DONE, OPEN]);
});
