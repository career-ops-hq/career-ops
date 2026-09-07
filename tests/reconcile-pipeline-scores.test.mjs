// Exercise the real CLI and its written pipeline rows, using only synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'reconcile-pipeline.mjs');
const URL = 'https://jobs.example.test/4521';

function fixture(t, { report, stateScore = '-', stateStatus = 'completed', language = 'en' }) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-reconcile-score-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['data', 'batch', 'reports']) mkdirSync(join(root, dir));
  const pipeline = join(root, 'data', 'pipeline.md');
  const pending = language === 'es' ? 'Pendientes' : 'Pending';
  const processed = language === 'es' ? 'Procesadas' : 'Processed';
  const original = `# Pipeline\n\n## ${pending}\n\n- [ ] ${URL} | Example | Engineer\n- [ ] https://jobs.example.test/pending | Other | Analyst\n\n## ${processed}\n\n`;
  writeFileSync(pipeline, original);
  writeFileSync(join(root, 'batch', 'batch-state.tsv'),
    `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\t${URL}\t${stateStatus}\t2026-09-01\t2026-09-01\t42\t${stateScore}\t\t0\n`);
  writeFileSync(join(root, 'reports', '042-example-2026-09-01.md'), report);
  const run = (...args) => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_TRACKER: '' },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result;
  };
  return { pipeline, original, run };
}

function processedRow(pipeline) {
  const rows = readFileSync(pipeline, 'utf8').split('\n').filter(line => line.startsWith('- [x]'));
  assert.equal(rows.length, 1);
  const fields = rows[0].split('|').map(field => field.trim());
  assert.equal(fields[1], URL);
  assert.match(fields[0], /\[42\]\(\.\.\/reports\/042-example-2026-09-01\.md\)/);
  return { score: fields[4], pdf: fields[5] };
}

const cases = [
  ['empty Score before URL', '**Score:**\n**URL:** https://jobs.example.test/4521', 'N/A'],
  ['empty Score before PDF', '**Score:** \t\n**PDF:** output/042-cv.pdf', 'N/A'],
  ['empty Score with CRLF', '**Score:**\t\r\n**URL:** https://jobs.example.test/4521', 'N/A'],
  ['first empty Score before a later score', '**Score:**\n\n## Notes\n**Score:** 4.9/5', 'N/A'],
  ['missing Score', '**URL:** https://jobs.example.test/4521', 'N/A'],
  ['N/A with a posting ID', '**Score:** N/A (posting 4521 unavailable)', 'N/A'],
  ['prose containing a number', '**Score:** unavailable after 2 attempts', 'N/A'],
  ['negative report score', '**Score:** -1/5', 'N/A'],
  ['out-of-range report score', '**Score:** 6/5', 'N/A'],
  ['different denominator', '**Score:** 4.2/10', 'N/A'],
  ['denominator prefix', '**Score:** 4.2/50', 'N/A'],
  ['decimal denominator', '**Score:** 4.2/5.5', 'N/A'],
  ['denominator followed by a word', '**Score:** 4.2/5th', 'N/A'],
  ['unreadable denominator', '**Score:** 4.2/unknown', 'N/A'],
  ['percentage', '**Score:** 4.2%', 'N/A'],
  ['unverified comparison score', '**Score:** pending — compare with 3/5 baseline', 'N/A'],
  ['decimal score', '**Score:** 4.2/5', '4.2/5'],
  ['bare numeric report score', '**Score:** 4.2', '4.2/5'],
  ['annotated score', '**Score:** 4.2/5 (strong match)', '4.2/5'],
  ['comma after denominator', '**Score:** 4.2/5, strong match', '4.2/5'],
  ['annotated bare score', '**Score:** 4.2 (strong fit)', '4.2/5'],
  ['final score annotation', '**Score:** 4.2 (final)', '4.2/5'],
  ['internal score annotation', '**Score:** 4.2 (internal)', '4.2/5'],
  ['dash after bare score', '**Score:** 4.5 - strong signal', '4.5/5'],
  ['N/A in score annotation', '**Score:** 4.2 (N/A noted)', '4.2/5'],
  ['annotation before denominator', '**Score:** 4.2 (strong fit)/5', '4.2/5'],
  ['annotation before wrong denominator', '**Score:** 4.2 (strong fit)/10', 'N/A'],
  ['first fraction before denominator', '**Score:** 4.2 (fit 3/4 axes)/5', 'N/A'],
  ['first fraction without denominator', '**Score:** 4.2 (fit 3/4 axes)', 'N/A'],
  ['bold score', '**Score:** **4.2/5** — strong match', '4.2/5'],
  ['code-wrapped bare score', '**Score:** `4.2`', '4.2/5'],
  ['zero score', '**Score:** 0/5', '0/5'],
  ['maximum score', '**Score:** 5/5', '5/5'],
  ['spaced score with CRLF', '**Score:**\t4.2 / 5\r\n**URL:** https://jobs.example.test/4521', '4.2/5'],
];

for (const [name, report, expected] of cases) {
  test(`reconciliation writes the expected score for ${name}`, t => {
    const f = fixture(t, { report });
    f.run();
    assert.equal(processedRow(f.pipeline).score, expected);
  });
}

for (const [name, stateScore, expected] of [
  ['authoritative numeric batch score', '4.7', '4.7/5'],
  ['zero batch score', '0', '0/5'],
  ['out-of-range batch falls back to report', '4521', '4.2/5'],
]) {
  test(name, t => {
    const f = fixture(t, { report: '**Score:** 4.2/5', stateScore });
    f.run();
    assert.equal(processedRow(f.pipeline).score, expected);
  });
}

test('an empty PDF field does not consume the next header', t => {
  const f = fixture(t, { report: '**Score:** 4.2/5\n**PDF:**\n**URL:** https://jobs.example.test/4521' });
  f.run();
  assert.deepEqual(processedRow(f.pipeline), { score: '4.2/5', pdf: 'PDF ❌' });
});

for (const [pdf, expected] of [['Not generated', 'PDF ❌'], ['output/042-cv.pdf', 'PDF ✅']]) {
  test(`a skipped batch entry preserves PDF field: ${pdf}`, t => {
    const f = fixture(t, { report: `**Score:** 2.5/5\n**PDF:** ${pdf}`, stateStatus: 'skipped' });
    f.run();
    assert.deepEqual(processedRow(f.pipeline), { score: '2.5/5', pdf: expected });
  });
}

test('dry-run, backup and repeated reconciliation preserve the Spanish pipeline', t => {
  const f = fixture(t, { report: '**Score:**\n**URL:** https://jobs.example.test/4521', language: 'es' });
  const dryRun = f.run('--dry-run');
  assert.match(dryRun.stdout, /\(N\/A\)/);
  assert.equal(readFileSync(f.pipeline, 'utf8'), f.original);
  assert.equal(existsSync(`${f.pipeline}.pre-reconcile.bak`), false);
  f.run();
  const written = readFileSync(f.pipeline, 'utf8');
  assert.match(written, /^## Procesadas$/m);
  assert.match(written, /^- \[ \] https:\/\/jobs\.example\.test\/pending \| Other \| Analyst$/m);
  assert.equal(processedRow(f.pipeline).score, 'N/A');
  assert.equal(readFileSync(`${f.pipeline}.pre-reconcile.bak`, 'utf8'), f.original);
  f.run();
  assert.equal(readFileSync(f.pipeline, 'utf8'), written);
  assert.equal(readFileSync(`${f.pipeline}.pre-reconcile.bak`, 'utf8'), f.original);
});
