// tests/role-matcher-sibling-qualifiers.test.mjs — a content word on EACH side
// that the other title lacks is two openings, not one.
//
// roleFuzzyMatch scores token overlap with a 0.6 Jaccard cut-off. Three words
// shared plus one unique word per side is 3 / 5 = 0.6 exactly, so two sibling
// requisitions that differ by a single qualifier word cleared the cut-off:
//
//   "Customer Success Manager, Enterprise"  vs  "Customer Success Manager, Commercial"
//   "Machine Learning Engineer, Vision"     vs  "Machine Learning Engineer, Speech"
//
// With no posting URL and no req number on either side (an older tracker row
// that predates the URL column, or an aggregator link), merge-tracker reaches
// this matcher as its last identity tier, takes the update path onto the
// existing row, and overwrites that row's score, date and report link with the
// other requisition. The status survives; the evaluation it described does not.
//
// #4058 added a guard for exactly this shape, but only when one of the two
// titles also stated a level. The vocabulary disagreement is the signal, so the
// guard now applies whether or not a level is present. Titles whose only
// difference is baseline vocabulary, or a plural, still match as before.
import { pass, fail, ROOT, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nrole-matcher.mjs — a unique content word on each side keeps siblings apart');

try {
  const { roleFuzzyMatch } = await import(pathToFileURL(join(ROOT, 'role-matcher.mjs')).href);

  const same = (label, a, b) => {
    if (roleFuzzyMatch(a, b) && roleFuzzyMatch(b, a)) pass(label);
    else fail(`${label}: "${a}" vs "${b}" should match (both orders)`);
  };
  const distinct = (label, a, b) => {
    if (!roleFuzzyMatch(a, b) && !roleFuzzyMatch(b, a)) pass(label);
    else fail(`${label}: "${a}" vs "${b}" should NOT match (both orders)`);
  };

  // ── 1. The defect: one qualifier word on each side ──
  distinct('segment qualifiers split',
    'Customer Success Manager, Enterprise', 'Customer Success Manager, Commercial');
  distinct('modality qualifiers split',
    'Machine Learning Engineer, Vision', 'Machine Learning Engineer, Speech');
  distinct('infrastructure qualifiers split',
    'Site Reliability Engineer, Storage', 'Site Reliability Engineer, Networking');
  distinct('product-area qualifiers split',
    'Technical Program Manager, Devices', 'Technical Program Manager, Cloud');
  distinct('qualifier after the shared prefix splits',
    'Software Engineer, Payments Infrastructure', 'Software Engineer, Payments Compliance');
  distinct('a longer shared prefix still splits',
    'Senior Machine Learning Engineer, Ranking Recommendations',
    'Senior Machine Learning Engineer, Ranking Personalization');
  distinct('a parenthesised qualifier splits',
    'Enterprise Account Executive (West)', 'Enterprise Account Executive (East)');
  distinct('seniority on one side does not hide the disagreement',
    'Senior Customer Success Manager, Enterprise', 'Customer Success Manager, Commercial');

  // ── 2. The same opening written two ways still matches ──
  same('an exact repost matches',
    'Customer Success Manager, Enterprise', 'Customer Success Manager, Enterprise');
  same('word order does not matter',
    'Customer Success Manager, Enterprise', 'Enterprise Customer Success Manager');
  same('punctuation and a work-mode suffix do not matter',
    'Product Manager, Growth (Remote)', 'Product Manager - Growth');
  same('a city suffix on one side does not split',
    'Data Scientist, Marketing Analytics', 'Data Scientist - Marketing Analytics (Berlin)');
  same('a seniority prefix on one side alone does not split',
    'Senior Software Engineer, Payments', 'Software Engineer, Payments');
  same('a baseline-only difference on both sides does not split',
    'Backend Engineer, Data Platform', 'Backend Developer, Data Platform');
  same('a content word against a baseline word does not split',
    'Data Engineer, Payments Platform', 'Data Engineer, Payments Reliability');
  same('a plural on one side does not split',
    'Manager, Solution Architecture Platforms', 'Manager, Solutions Architecture - Platforms (Chicago)');

  // ── 3. The #4058 pair still splits ──
  distinct('a one-sided level with a unique word on each side still splits',
    'Front Desk Assistant (Summer Housing)',
    'Administrative Assistant II (Housing Front Desk)');

  // ── 4. merge-tracker keeps both openings and leaves the first row alone ──
  const work = mkdtempSync(join(tmpdir(), 'co-role-siblings-'));
  try {
    const tracker = join(work, 'applications.md');
    const additions = join(work, 'additions');
    mkdirSync(additions);
    writeFileSync(tracker, [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-01 | Acme | Customer Success Manager, Enterprise | 4.0/5 | Applied | ❌ | [1](../reports/001-acme.md) | Applied via referral |',
      '',
    ].join('\n'));
    writeFileSync(join(additions, '2-acme.tsv'), [
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes',
      '2\t2026-01-05\tAcme\tCustomer Success Manager, Commercial\tEvaluated\t4.3/5\t❌\t[2](reports/002-acme.md)\tsecond opening',
      '',
    ].join('\n'));

    execFileSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CAREER_OPS_ROOT: work,
        CAREER_OPS_TRACKER: tracker,
        CAREER_OPS_ADDITIONS: additions,
        CAREER_OPS_BATCH_STATE: join(work, 'batch-state.tsv'),
      },
    });
    const rows = readFileSync(tracker, 'utf8').split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
    const first = rows.find(line => /^\|\s*1\s*\|/.test(line)) ?? '';
    if (rows.length === 2
        && first.includes('Enterprise') && first.includes('| 4.0/5 |') && first.includes('| Applied |')
        && first.includes('[1](') && first.includes('2026-01-01')
        && rows.some(line => /^\|\s*2\s*\|/.test(line) && line.includes('Commercial'))) {
      pass('merge-tracker adds the sibling opening and leaves the Applied row untouched');
    } else {
      fail(`merge-tracker folded the sibling openings together: ${rows.join(' / ')}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
} catch (error) {
  fail(`role-matcher sibling-qualifier tests could not run: ${error.message}`);
}
