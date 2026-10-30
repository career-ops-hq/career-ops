#!/usr/bin/env node
/**
 * A report **URL:** token whose path ends in a parenthesised segment
 * (`…/eng-(remote)`) keeps its closing `)`. Only a `)` with no `(` partner in
 * the token is wrapping punctuation. Cutting a balanced one gave the report a
 * different URL key from the same posting's URL carried verbatim in a TSV, so a
 * re-evaluation added a second tracker row for one posting.
 *
 * Run: node test-all.mjs --only report-url-balanced-paren
 */

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync, isolatedBatchStatePath } from './helpers.mjs';
import { unwrapReportUrlToken } from '../tracker-parse.mjs';

console.log('\nReport URL token unwrap (balanced parentheses)');

const PAREN = 'https://careers.example.test/jobs/7/eng-(remote)';

const cases = [
  // balanced: the `)` belongs to the URL
  [PAREN, PAREN],
  [`${PAREN},`, PAREN],
  [`${PAREN}.`, PAREN],
  [`${PAREN};`, PAREN],
  [`<${PAREN}>`, PAREN],
  [`<${PAREN}>,`, PAREN],
  ['https://example.test/wiki/Foo_(bar)_(baz)', 'https://example.test/wiki/Foo_(bar)_(baz)'],
  // unbalanced: the `)` closes a paren wrapping the URL
  [`${PAREN})`, PAREN],
  [`${PAREN}).`, PAREN],
  [`<${PAREN}>).`, PAREN],
  ['https://careers.example.test/jobs/7)', 'https://careers.example.test/jobs/7'],
  ['https://careers.example.test/jobs/7).', 'https://careers.example.test/jobs/7'],
  ['https://careers.example.test/jobs/7)),;', 'https://careers.example.test/jobs/7'],
  // an unclosed `(` is not stripped or completed
  ['https://careers.example.test/jobs/7/eng-(remote', 'https://careers.example.test/jobs/7/eng-(remote'],
  ['https://careers.example.test/jobs/7/eng-(remote,', 'https://careers.example.test/jobs/7/eng-(remote'],
];

for (const [input, expected] of cases) {
  const got = unwrapReportUrlToken(input);
  if (got === expected) pass(`unwrap ${JSON.stringify(input)}`);
  else fail(`unwrap ${JSON.stringify(input)}: got ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
}

{
  const work = mkdtempSync(join(tmpdir(), 'co-url-paren-'));
  try {
    mkdirSync(join(work, 'data'), { recursive: true });
    mkdirSync(join(work, 'reports'), { recursive: true });
    mkdirSync(join(work, 'adds'), { recursive: true });
    const apps = join(work, 'data/applications.md');
    writeFileSync(apps, `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
`);
    writeFileSync(join(work, 'reports/001-acme-2026-10-01.md'), `# Acme — Engineer\n\n**Score:** 4.0/5 | **URL:** ${PAREN}\n`);
    writeFileSync(join(work, 'reports/002-acme-2026-10-02.md'), `# Acme — Engineer\n\n**Score:** 4.2/5 | **URL:** ${PAREN}\n`);
    const env = {
      ...process.env,
      CAREER_OPS_TRACKER: apps,
      CAREER_OPS_ADDITIONS: join(work, 'adds'),
      CAREER_OPS_DATA_DIR: work,
      CAREER_OPS_ROOT: work,
      CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(join(work, 'adds')),
      CAREER_OPS_PDF_INDEX: join(work, 'data/pdf-index.tsv'),
    };
    const merge = () => execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], { cwd: ROOT, encoding: 'utf8', env, timeout: 30000 });

    // First evaluation: no url field, so the key comes from the report header.
    writeFileSync(
      join(work, 'adds/001-acme.tsv'),
      '1\t2026-10-01\tAcme\tEngineer\tEvaluated\t4.0/5\t❌\t[1](reports/001-acme-2026-10-01.md)\tfirst\n',
    );
    merge();
    // Re-evaluation of the same posting, URL carried verbatim in the TSV.
    writeFileSync(
      join(work, 'adds/002-acme.tsv'),
      `2\t2026-10-02\tAcme\tEngineer\tEvaluated\t4.2/5\t❌\t[2](reports/002-acme-2026-10-02.md)\tsecond\t${PAREN}\n`,
    );
    const out = merge();

    const rows = readFileSync(apps, 'utf8').split('\n').filter((l) => /^\| \d+/.test(l));
    if (rows.length !== 1) {
      fail(`a re-evaluation of a parenthesised URL produced ${rows.length} rows:\n${rows.join('\n')}\n${out}`);
    } else if (!rows[0].includes(PAREN)) {
      fail(`the merged row lost the URL's closing paren: ${rows[0]}`);
    } else {
      pass('re-evaluating a posting whose URL ends in "(…)" updates its row instead of adding one');
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
