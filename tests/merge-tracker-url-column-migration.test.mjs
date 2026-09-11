import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MERGE = join(ROOT, 'merge-tracker.mjs');
const LEGACY_HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const LEGACY_SEPARATOR = '|---|------|---------|------|-------|--------|-----|--------|-------|';

function workspace(t, { dataLayout = false, header = LEGACY_HEADER, separator = LEGACY_SEPARATOR, rows = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'url-column-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tracker = dataLayout ? join(root, 'data', 'applications.md') : join(root, 'applications.md');
  mkdirSync(dirname(tracker), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(tracker, ['# Applications Tracker', '', header, separator, ...rows, ''].join('\n'));
  return { root, tracker, additions: join(root, 'additions') };
}

function run(env, args = ['--backfill-urls']) {
  return execFileSync(process.execPath, [MERGE, ...args], {
    cwd: env.root,
    encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_TRACKER: env.tracker, CAREER_OPS_ADDITIONS: env.additions },
  });
}

function tableLine(text, prefix) {
  return text.split(/\r?\n/).find(line => line.startsWith(prefix));
}

test('--backfill-urls adds a trailing URL column and fills a canonical legacy tracker', t => {
  const env = workspace(t, {
    rows: ['| 1 | 2026-09-11 | Acme | Learning Designer | 4.0/5 | Applied | ✅ | [1](reports/001-acme.md) | keep |'],
  });
  writeFileSync(join(env.root, 'reports', '001-acme.md'), '# Evaluation\n\n**URL:** https://example.com/jobs/one\n');

  const output = run(env);
  const after = readFileSync(env.tracker, 'utf8');
  assert.match(output, /added the URL column/);
  assert.equal(tableLine(after, '| # |'), `${LEGACY_HEADER} URL |`);
  assert.match(tableLine(after, '| 1 |'), /\| keep \| https:\/\/example\.com\/jobs\/one \|$/);
});

test('migration preserves wider custom-column values and appends URL last', t => {
  const header = '| # | Date | Company | Owner Note | Role | Location | Score | Status | PDF | Report | Notes | Follow-up |';
  const separator = '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const env = workspace(t, {
    dataLayout: true,
    header,
    separator,
    rows: ['| 7 | 2026-09-11 | Acme | user-owned exact value | Designer | Toronto | 3.9/5 | Interview | ✅ | [7](../reports/007-acme.md) | do not alter | 2026-09-20 |'],
  });
  writeFileSync(join(env.root, 'reports', '007-acme.md'), '**URL:** https://jobs.example.org/acme/7\n');

  run(env);
  const after = readFileSync(env.tracker, 'utf8');
  const row = tableLine(after, '| 7 |');
  assert.equal(tableLine(after, '| # |'), `${header} URL |`);
  assert.match(row, /\| user-owned exact value \| Designer \| Toronto \|/);
  assert.match(row, /\| do not alter \| 2026-09-20 \| https:\/\/jobs\.example\.org\/acme\/7 \|$/);
  assert.equal(row.split('|').length, tableLine(after, '| # |').split('|').length);
});

test('an unfillable legacy row gains a full-width empty URL cell without shifting values', t => {
  const env = workspace(t, {
    rows: ['| 2 | 2026-09-11 | Acme | Private Referral | N/A | Evaluated | ❌ | — | keep exactly |'],
  });

  const output = run(env);
  const after = readFileSync(env.tracker, 'utf8');
  const header = tableLine(after, '| # |');
  const row = tableLine(after, '| 2 |');
  assert.match(output, /1 no\/missing report/);
  assert.equal(row.split('|').length, header.split('|').length);
  assert.match(row, /\| — \| keep exactly \|  \|$/);
});

test('--backfill-urls is idempotent after adding and filling the column', t => {
  const env = workspace(t, {
    rows: ['| 3 | 2026-09-11 | Acme | Designer | 4.1/5 | Applied | ✅ | [3](reports/003-acme.md) | note |'],
  });
  writeFileSync(join(env.root, 'reports', '003-acme.md'), '**URL:** https://example.com/jobs/three\n');

  run(env);
  const once = readFileSync(env.tracker, 'utf8');
  const secondOutput = run(env);
  assert.equal(readFileSync(env.tracker, 'utf8'), once);
  assert.doesNotMatch(secondOutput, /added the URL column/);
  assert.match(secondOutput, /1 already set/);
});

test('--backfill-urls --dry-run previews but does not write the schema migration', t => {
  const env = workspace(t, {
    rows: ['| 4 | 2026-09-11 | Acme | Designer | 4.2/5 | Applied | ✅ | [4](reports/004-acme.md) | note |'],
  });
  writeFileSync(join(env.root, 'reports', '004-acme.md'), '**URL:** https://example.com/jobs/four\n');
  const before = readFileSync(env.tracker, 'utf8');

  const output = run(env, ['--backfill-urls', '--dry-run']);
  assert.equal(readFileSync(env.tracker, 'utf8'), before);
  assert.match(output, /would add the URL column and fill 1 row/);
});

test('ordinary merge leaves a legacy tracker schema unchanged until explicit migration', t => {
  const env = workspace(t);
  mkdirSync(env.additions, { recursive: true });
  writeFileSync(join(env.additions, '5-acme.tsv'), [
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl',
    '5\t2026-09-11\tAcme\tDesigner\tEvaluated\t4.0/5\t❌\t[5](reports/005-acme.md)\tnote\thttps://example.com/jobs/five',
  ].join('\n'));

  run(env, []);
  const after = readFileSync(env.tracker, 'utf8');
  assert.equal(tableLine(after, '| # |'), LEGACY_HEADER);
  assert.doesNotMatch(tableLine(after, '| 5 |'), /https:\/\//);
});
