// tests/merge-tracker-creates-missing-tracker.test.mjs — a data root with no
// tracker yet. merge-tracker.mjs used to print "No applications.md found.
// Nothing to merge into." and exit 0, leaving every pending addition unmerged.
// The web evaluate flow treats exit 0 as success, so the score popup showed
// while the Pipeline tab stayed empty. A merge with pending additions now
// creates the tracker at the canonical write path (AGENTS.md: first-run
// creation targets {DATA_ROOT}/data/applications.md) and merges into it.
import { pass, fail, isolatedBatchStatePath } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MERGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const TSV_HEAD = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl';
const REPORT = '011-acme-2026-10-02.md';
const URL = 'https://jobs.ashbyhq.com/acme/11111111-2222-3333-4444-555555555555';

function fixture({ withAddition = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'merge-missing-tracker-'));
  const env = { base, addDir: join(base, 'batch', 'tracker-additions'), reportsDir: join(base, 'reports') };
  for (const dir of [env.addDir, env.reportsDir]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(env.reportsDir, REPORT), `# Evaluation: Acme\n\n**Score:** 4.1/5\n**URL:** ${URL}\n`);
  if (withAddition) {
    writeFileSync(join(env.addDir, '011-acme.tsv'),
      `${TSV_HEAD}\n11\t2026-10-02\tAcme\tData Analyst\tEvaluated\t4.1/5\t❌\t[11](reports/${REPORT})\tfirst eval\t${URL}\n`);
  }
  return env;
}

function merge(env, { args = [], trackerOverride } = {}) {
  const childEnv = {
    ...process.env,
    CAREER_OPS_ROOT: env.base,
    CAREER_OPS_ADDITIONS: env.addDir,
    CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(env.addDir),
    CAREER_OPS_FOLLOWUPS: '',
    CAREER_OPS_REPORTS_DIR: '',
    CAREER_OPS_PDF_INDEX: '',
  };
  delete childEnv.CAREER_OPS_DATA_DIR;
  delete childEnv.CAREER_OPS_CODE_ROOT;
  if (trackerOverride) childEnv.CAREER_OPS_TRACKER = trackerOverride;
  else delete childEnv.CAREER_OPS_TRACKER;
  const run = spawnSync('node', [MERGE, ...args], { encoding: 'utf-8', env: childEnv });
  assert.equal(run.status, 0, describeSpawn(run));
  return `${run.stdout}${run.stderr}`;
}

const withFixture = (opts, fn) => {
  const env = fixture(opts);
  try { fn(env); } finally { rmSync(env.base, { recursive: true, force: true }); }
};
function dataRows(file) {
  return readFileSync(file, 'utf-8').split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
}

ok('no tracker anywhere: the merge creates data/applications.md and adds the row', () => {
  withFixture({}, (env) => {
    const output = merge(env);
    const canonical = join(env.base, 'data', 'applications.md');
    assert.ok(existsSync(canonical), `expected ${canonical} to be created\n${output}`);
    assert.ok(!existsSync(join(env.base, 'applications.md')), 'must not create the legacy root-level tracker');
    const rows = dataRows(canonical);
    assert.strictEqual(rows.length, 1, output);
    assert.match(rows[0], /\| Acme \| Data Analyst \| 4\.1\/5 \| Evaluated \|/);
    assert.match(output, /Created .*applications\.md/);
    assert.deepStrictEqual(readdirSync(env.addDir).filter((f) => f.endsWith('.tsv')), [], 'the TSV is moved to merged/');
  });
});

ok('a created tracker carries a URL column, so URL dedup is active from the first merge', () => {
  withFixture({}, (env) => {
    const output = merge(env);
    const header = readFileSync(join(env.base, 'data', 'applications.md'), 'utf-8')
      .split('\n').find((l) => l.startsWith('| #'));
    assert.match(header, /\| Notes \| URL \|$/);
    assert.doesNotMatch(output, /URL dedup is INACTIVE/);
  });
});

ok('CAREER_OPS_TRACKER override: the missing tracker is created at the override path', () => {
  withFixture({}, (env) => {
    const override = join(env.base, 'custom', 'tracker.md');
    merge(env, { trackerOverride: override });
    assert.ok(existsSync(override));
    assert.strictEqual(dataRows(override).length, 1);
    assert.ok(!existsSync(join(env.base, 'data', 'applications.md')));
  });
});

ok('--dry-run with no tracker reports what it would do and writes nothing', () => {
  withFixture({}, (env) => {
    const output = merge(env, { args: ['--dry-run'] });
    assert.ok(!existsSync(join(env.base, 'data', 'applications.md')));
    assert.ok(!existsSync(join(env.base, 'applications.md')));
    assert.match(output, /would create/i);
    assert.deepStrictEqual(readdirSync(env.addDir).filter((f) => f.endsWith('.tsv')), ['011-acme.tsv']);
  });
});

ok('no tracker and nothing pending: no tracker is created', () => {
  withFixture({ withAddition: false }, (env) => {
    merge(env);
    assert.ok(!existsSync(join(env.base, 'data', 'applications.md')));
    assert.ok(!existsSync(join(env.base, 'applications.md')));
  });
});
