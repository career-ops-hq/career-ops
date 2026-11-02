// tests/dedup-tracker-corporate-form.test.mjs
//
// #4421 defect 4: dedup-tracker.mjs grouped candidates on a plain
// normalizeCompany() key, which keeps a trailing legal-entity suffix, so
// "Acme Widgets, APC" and "Acme Widgets" landed in two different groups and
// were never role-compared — a duplicate re-scan stayed in the tracker forever.
//
// The fix reuses merge-tracker.mjs's corporate-form rule (token PREFIX plus a
// corporate-form tail), NOT a stripped key. That distinction is load-bearing:
// stripping suffixes would map "Acme Solutions" and "Acme Technologies" to the
// same "acme" and delete a real row, so the discrimination cases below are as
// important as the merge case.
import { pass, fail, run, formatRunFailure, NODE, ROOT } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { companiesMatchIgnoringCorporateForm } from '../tracker-utils.mjs';

console.log('\ndedup-tracker.mjs — corporate-form suffix twins (#4421 defect 4)');

// ── 1. The shared predicate: suffix twins match, distinct employers do not ──
const SAME = [
  ['Acme Widgets, APC', 'Acme Widgets', true],
  ['Acme Widgets', 'Acme Widgets, APC', true],
  ['Foo GmbH', 'Foo', true],
  ['Foo SRL', 'Foo', true],
  ['Foo, Inc', 'Foo', true],
];
const DISTINCT = [
  // Both strip to "acme" under a naive suffix-strip key — the exact fold the
  // prefix rule exists to prevent. Equal token length → no match.
  ['Acme Solutions', 'Acme Technologies', false],
  // "Robotics" is not a corporate form, so "Acme" is not a prefix match.
  ['Acme Robotics', 'Acme', false],
  // "Barco" merely ends in the letters "co"; no separator-delimited tail.
  ['Barco', 'Bar', false],
];
for (const [a, b, exp] of [...SAME, ...DISTINCT]) {
  const got = companiesMatchIgnoringCorporateForm(a, b);
  if (got === exp) pass(`companiesMatchIgnoringCorporateForm(${JSON.stringify(a)}, ${JSON.stringify(b)}) === ${exp}`);
  else fail(`companiesMatchIgnoringCorporateForm(${JSON.stringify(a)}, ${JSON.stringify(b)}) returned ${got}, expected ${exp}`);
}

// ── 2. End-to-end: dedup-tracker merges the twin, keeps the distinct rows ──
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|------|---------|------|-------|--------|-----|--------|-------|';
const row = (num, company, score) =>
  `| ${num} | 2026-09-0${num} | ${company} | Fullstack Engineer | ${score} | Evaluated | ✅ | [${num}](reports/${num}.md) |  |`;

function dataRows(md) {
  return md.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('|---') && !l.startsWith('| #'));
}

function runDedup(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-corp-'));
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
  const out = run(NODE, ['dedup-tracker.mjs'], {
    env: { ...process.env, CAREER_OPS_TRACKER: tracker },
  });
  // A crashed child leaves the fixture on disk untouched, so reading the tracker
  // without this guard turns a crash into a vacuous pass: the distinct-company
  // fixtures would read back their own untouched input and report success.
  if (out === null) {
    throw new Error(`dedup-tracker.mjs run failed: ${formatRunFailure()}`);
  }
  return { out, md: readFileSync(tracker, 'utf-8') };
}

// 2a. Suffix twin with the SAME role → one row survives (the higher score).
{
  const { md } = runDedup([
    row(1, 'Acme Widgets, APC', '4.2/5'),
    row(2, 'Acme Widgets', '3.1/5'),
  ]);
  const rows = dataRows(md);
  if (rows.length === 1 && rows[0].includes('4.2/5')) {
    pass('dedup merges "Acme Widgets, APC" / "Acme Widgets" and keeps the higher score');
  } else {
    fail(`suffix twins did not merge to one keeper row: ${JSON.stringify(rows)}`);
  }
}

// 2b. Distinct employers sharing a first token must ALL survive — the naive
// suffix-strip fix would collapse these to one "acme" and delete two real rows.
{
  const { md } = runDedup([
    row(1, 'Acme Solutions', '4.2/5'),
    row(2, 'Acme Technologies', '3.1/5'),
    row(3, 'Acme Robotics', '4.0/5'),
  ]);
  const rows = dataRows(md);
  if (rows.length === 3) {
    pass('dedup keeps "Acme Solutions" / "Acme Technologies" / "Acme Robotics" apart');
  } else {
    fail(`distinct employers were over-merged to ${rows.length} rows: ${JSON.stringify(rows)}`);
  }
}

// 2c. The transitive trap: a bare "Acme" matches BOTH "Acme Solutions" and "Acme
// Technologies", which do not match each other. Gating only on the anchor row
// made all three one cluster and deleted "Acme Technologies". "Acme" / "Acme
// Solutions" is a genuine pair and still merges; the third row must survive.
{
  const { md } = runDedup([
    row(1, 'Acme', '4.2/5'),
    row(2, 'Acme Solutions', '3.1/5'),
    row(3, 'Acme Technologies', '2.9/5'),
  ]);
  const rows = dataRows(md);
  const keptTechnologies = rows.some((l) => l.includes('Acme Technologies'));
  if (rows.length === 2 && keptTechnologies) {
    pass('dedup keeps "Acme Technologies" when only the anchor row matches it');
  } else {
    fail(`non-transitive cluster deleted an unrelated employer: ${JSON.stringify(rows)}`);
  }
}

// 2d. Regression guard for the bucket key: "Foo-Bar" and "FooBar" are one
// employer under normalizeCompany() but tokenize to different first tokens, so
// a first-token bucket never compared them and the exact duplicate survived.
{
  const { md } = runDedup([
    row(1, 'Foo-Bar', '4.2/5'),
    row(2, 'FooBar', '3.1/5'),
  ]);
  const rows = dataRows(md);
  if (rows.length === 1 && rows[0].includes('4.2/5')) {
    pass('dedup merges "Foo-Bar" / "FooBar" (same normalizeCompany key, different tokens)');
  } else {
    fail(`exact-company twins were split across buckets: ${JSON.stringify(rows)}`);
  }
}
