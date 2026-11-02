// A Report-cell link whose target holds a parenthesis, e.g. a report named
// `001-acme-(berlin)-2026-10-01.md`, must resolve whole in every reader (#5482).
// Private `\]\(([^)]+)\)` copies cut the target at the first `)`, so
// `set-status --report-link` (the dashboard's status write) refused the row and
// verify-pipeline called the present report missing. Fictional data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { firstLinkTarget, soleMarkdownLink, linkedReportNumbers } from '../tracker-parse.mjs';
import { findDeadReportLink } from '../tracker-utils.mjs';
import { resolveReportPath } from '../followup-cadence.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPORT = '001-acme-(berlin)-2026-10-01.md';
const LINK = `[1](../reports/${REPORT})`;
const HEADER = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];
const row = (report) => `| 1 | 2026-10-01 | Acme (Berlin) | Engineer | 4.2/5 | Evaluated | ❌ | ${report} | note |`;

function fixture(t, { report = LINK, withFile = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-link-parens-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'reports'));
  if (withFile) writeFileSync(join(root, 'reports', REPORT), '# Eval\n\n**URL:** https://jobs.example.test/1\n');
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, [...HEADER, row(report)].join('\n') + '\n');
  return { root, tracker };
}

function run(f, script, args = []) {
  const env = { ...process.env };
  for (const k of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_TRACKER_LOCK']) delete env[k];
  env.CAREER_OPS_ROOT = f.root;
  const r = spawnSync(process.execPath, [join(CODE_ROOT, script), ...args], { cwd: CODE_ROOT, env, encoding: 'utf-8', timeout: 30_000 });
  assert.equal(r.error, undefined);
  return { ...r, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('firstLinkTarget keeps balanced parentheses and unwraps <…> destinations', () => {
  assert.equal(firstLinkTarget(LINK), `../reports/${REPORT}`);
  assert.equal(firstLinkTarget('[1](<../reports/001 acme.md>)'), '../reports/001 acme.md');
  assert.equal(firstLinkTarget('[1](a.md) / [2](b.md)'), 'a.md');
  for (const empty of ['', '—', 'N/A', 'reports/001-acme.md', '[1]', undefined, null]) {
    assert.equal(firstLinkTarget(empty), null, String(empty));
  }
});

test('soleMarkdownLink accepts exactly one link spanning the trimmed cell', () => {
  assert.deepEqual(soleMarkdownLink(` ${LINK} `), { label: '1', target: `../reports/${REPORT}` });
  assert.equal(soleMarkdownLink(`${LINK} / [2](../reports/002-b.md)`), null);
  assert.equal(soleMarkdownLink(`see ${LINK}`), null);
  assert.equal(soleMarkdownLink(`${LINK} (old)`), null);
  assert.equal(soleMarkdownLink('—'), null);
});

test('linkedReportNumbers still reads a parenthesised Report link', () => {
  assert.deepEqual(linkedReportNumbers(LINK, ''), [1]);
});

test('a malformed Report link does not fall back to a Notes link', () => {
  // Link syntax whose destination cannot be parsed is a present-but-invalid
  // link, not an empty Report cell.
  assert.deepEqual(linkedReportNumbers('[1](<missing)', '[2](../reports/002-b.md)'), []);
  assert.deepEqual(linkedReportNumbers('[1\\]draft](<missing)', '[2](../reports/002-b.md)'), []);
  assert.deepEqual(linkedReportNumbers('[1\\\n draft](<missing)', '[2](../reports/002-b.md)'), []);
  assert.deepEqual(linkedReportNumbers('—', '[2](../reports/002-b.md)'), [2]);
});

test('set-status --report-link updates a row whose report name holds parentheses', (t) => {
  const f = fixture(t);
  const r = run(f, 'set-status.mjs', ['--report-link', '1', 'Applied', '--json']);
  assert.equal(r.status, 0, describeSpawn(r));
  assert.equal(JSON.parse(r.stdout).newStatus, 'Applied');
  assert.ok(readFileSync(f.tracker, 'utf-8').includes(`| Applied | ❌ | ${LINK} |`), 'the Report cell must be written back unchanged');
});

test('findDeadReportLink sees the whole parenthesised target', (t) => {
  const live = fixture(t);
  assert.equal(findDeadReportLink(LINK, join(live.root, 'data'), live.root), null);
  const dead = fixture(t, { withFile: false });
  assert.equal(findDeadReportLink(LINK, join(dead.root, 'data'), dead.root), `../reports/${REPORT}`);
});

test('verify-pipeline does not report a present parenthesised report as missing', (t) => {
  const f = fixture(t);
  const r = run(f, 'verify-pipeline.mjs');
  assert.doesNotMatch(r.out, /Report not found/, r.out);
  assert.match(r.out, /All report links valid/, r.out);
});

test('fix-report-links treats a parenthesised link as one link: live is kept, dead is fixed', (t) => {
  const live = fixture(t);
  const before = readFileSync(live.tracker, 'utf-8');
  const kept = run(live, 'fix-report-links.mjs');
  assert.equal(kept.status, 0, describeSpawn(kept));
  assert.doesNotMatch(kept.out, /skipped/, kept.out);
  assert.equal(readFileSync(live.tracker, 'utf-8'), before);

  const dead = fixture(t, { withFile: false });
  const fixed = run(dead, 'fix-report-links.mjs');
  assert.equal(fixed.status, 0, describeSpawn(fixed));
  assert.match(fixed.out, /1 dead report link\(s\) fixed/, fixed.out);
  assert.match(readFileSync(dead.tracker, 'utf-8'), /\| ❌ \| — \| note \|/);
});

test('followup-cadence and find resolve the full report path', (t) => {
  const f = fixture(t);
  assert.equal(resolveReportPath(LINK, f.tracker, f.root), `reports/${REPORT}`);
  const r = run(f, 'find.mjs', ['acme']);
  assert.equal(r.status, 0, describeSpawn(r));
  assert.match(r.out, /reports\/001-acme-\(berlin\)-2026-10-01\.md/, r.out);
});
