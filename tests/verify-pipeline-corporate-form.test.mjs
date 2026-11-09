import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';

console.log('\nverify-pipeline — corporate-form duplicates (#4421)');

const tmp = mkdtempSync(join(tmpdir(), 'co-vp-corporate-'));
try {
  const tracker = join(tmp, 'data', 'applications.md');
  mkdirSync(join(tmp, 'data'));
  const header = '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |\n'
    + '|---|------|---------|-----|------|-------|--------|-----|--------|-------|\n';
  const row = (company, role = 'Fullstack Engineer', notes = '', via = '') => ({ company, role, notes, via });
  function check(label, rows, expected) {
    const table = header + rows.map((r, i) =>
      `| ${i + 1} | 2026-09-01 | ${r.company} | ${r.via} | ${r.role} | 3.0/5 | SKIP | ❌ | — | ${r.notes} |\n`).join('');
    writeFileSync(tracker, table);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_')));
    const child = spawnSync(NODE, [join(ROOT, 'verify-pipeline.mjs'), '--no-hints'], {
      cwd: ROOT, env: { ...env, CAREER_OPS_ROOT: tmp },
      encoding: 'utf8', windowsHide: true, timeout: 60_000,
    });
    if (child.error || child.status !== 0 || !child.stdout.includes(`Checking ${rows.length} entries`)) {
      fail(`${label}: CLI did not check the fixture: ${child.error || child.stderr || child.stdout}`);
      return;
    }
    const groups = child.stdout.split('\n').filter(line => line.includes('Possible duplicates:'))
      .map(line => [...line.matchAll(/#(\d+)/g)].map(m => Number(m[1])));
    if (JSON.stringify(groups) === JSON.stringify(expected)) pass(label);
    else fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(groups)}`);
  }

  check('minimum-length stem shares its bucket', [row('A B C'), row('A B C Inc')], [[1, 2]]);
  check('short stems do not become corporate matches', [row('AB'), row('AB Inc')], []);
  check('normalized Unicode prefix shares its bucket', [row('ＡＢＣ'), row('ABC Inc')], [[1, 2]]);
  check('separate prefixes retain their own matches', [row('Acme'), row('Zenith'), row('Acme Inc'), row('Zenith LLC')], [[1, 3], [2, 4]]);
  check('APC suffix twin is reported', [row('Acme Widgets, APC'), row('Acme Widgets')], [[1, 2]]);
  check('APC suffix twin in reverse order is reported', [row('Acme Widgets'), row('Acme Widgets, APC')], [[1, 2]]);
  check('distinct corporate-form tails stay separate', [row('Acme Solutions'), row('Acme Technologies')], []);
  check('substantive suffix stays separate', [row('Acme Widgets'), row('Acme Widgets Robotics')], []);
  check('different roles stay separate', [row('Acme Widgets'), row('Acme Widgets, APC', 'Data Engineer')], []);
  check('normalized role identity is preserved', [row('Acme Widgets', 'FULLSTACK engineer'), row('Acme Widgets, APC')], [[1, 2]]);
  check('different known req IDs stay separate', [row('Acme Widgets', undefined, 'req 12345'), row('Acme Widgets, APC', undefined, 'req 67890')], []);
  check('same req ID is reported', [row('Acme Widgets', undefined, 'req 12345'), row('Acme Widgets, APC', undefined, 'req 12345')], [[1, 2]]);
  check('missing req ID leaves a possible duplicate', [row('Acme Widgets', undefined, 'req 12345'), row('Acme Widgets, APC')], [[1, 2]]);
  check('named employers ignore differing Via', [row('Acme Widgets', undefined, '', 'Agency A'), row('Acme Widgets, APC', undefined, '', 'Agency B')], [[1, 2]]);
  check('unknown employers from different agencies stay separate', [row('?', undefined, '', 'Agency A'), row('?', undefined, '', 'Agency B')], []);
  check('unknown employers from same agency are reported', [row('?', undefined, '', 'Agency A'), row('?', undefined, '', 'Agency A')], [[1, 2]]);
  check('non-Latin employers stay separate', [row('東京商事'), row('大阪商事')], []);
  check('punctuation-normalized exact group keeps its output', [row('Foo-Bar'), row('FooBar'), row('Foo Bar')], [[1, 2, 3]]);
  check('corporate matches never form a transitive group', [row('Acme'), row('Acme Solutions'), row('Acme Technologies')], [[1, 2], [1, 3]]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
