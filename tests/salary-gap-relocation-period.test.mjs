/**
 * tests/salary-gap-relocation-period.test.mjs — an ordinary annual figure needs
 * no "per year" wording for the relocation comparison.
 *
 * parseAmount() rejects every non-annual period, so an accepted figure with no
 * period word is annual. relocationForApplication() required period ===
 * 'annual', a value only a literal "per year"/"annual" string ever produced:
 * "60k CAD" and "80-90k EUR" — the shape reports actually carry — silently
 * skipped the comparison.
 *
 * Run: node tests/salary-gap-relocation-period.test.mjs
 */
import { reportToObservation, fold, relocationForApplication, loadRelocationTable } from '../salary-gap.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';

console.log('\nsalary-gap relocation accepts annual figures with no period word');

const assert = (cond, name) => (cond ? pass(name) : fail(name));
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const ctx = { jurisdictions: loadRelocationTable(), homeLocation: 'Toronto, ON' };

const report = [
  '# Eval: Fictional Corp — Backend Eng', '', '## Machine Summary', '', '```yaml',
  'company: "Fictional Corp"', 'role: "Backend Eng"', 'advertised_comp: "60k CAD"',
  'posting_location: "Halifax, NS"', '```', '',
].join(NL);
const fromReport = reportToObservation(report, '1', '2026-09-01');
const folded = fold([fromReport.observation], { 1: { company: 'Fictional Corp', role: 'Backend Eng' } }, null);
const app = folded.applications[0];

assert(app.advertised?.value === 60000 && app.advertised.currency === 'CAD',
  'premise: "60k CAD" folds into a 60000 CAD advertised figure');
assert(app.advertised?.period === null,
  'premise: no period word leaves period null, not the string "annual"');

const reloc = relocationForApplication(app, ctx);
assert(reloc?.ok === true && reloc.grossAnnual === 60000 && reloc.dest.takeHome < reloc.home.takeHome,
  `a plain annual "60k CAD" still gets the bracket-tax comparison, got ${JSON.stringify(reloc)}`);

// Non-annual periods stay out: parseAmount refuses to parse them, so no effective
// figure can carry one — confirm the guard still refuses an explicit one.
const explicitMonthly = { advertised: { ...app.advertised, period: 'monthly' } };
assert(relocationForApplication(explicitMonthly, ctx) === null,
  'an explicitly monthly advertised figure is still not evaluated');

// The user-visible path annotates the same folded application in main().
{
  const root = mkdtempSync(join(tmpdir(), 'sg-reloc-period-'));
  try {
    mkdirSync(join(root, 'config'), { recursive: true });
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeFileSync(join(root, 'config', 'profile.yml'), ['candidate:', '  location: "Toronto, ON"', ''].join(NL));
    writeFileSync(join(root, 'data', 'applications.md'), [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-09-01 | Fictional Corp | Backend Eng | 4.1/5 | Applied | n | [001](../reports/001-fictional-corp-2026-09-01.md) | |',
      '',
    ].join(NL));
    writeFileSync(join(root, 'reports', '001-fictional-corp-2026-09-01.md'), report);
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'salary-gap.mjs');
    const run = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CAREER_OPS_ROOT: root,
        CAREER_OPS_TRACKER: '',
        CAREER_OPS_PROFILE: join(root, 'config', 'profile.yml'),
      },
    });
    let out = null;
    try { out = JSON.parse(run.stdout); } catch { /* reported by the assertion below */ }
    const annotated = out?.applications?.find(a => a.num === '1');
    assert(run.status === 0 && annotated?.relocation?.ok === true,
      `salary-gap JSON annotates the application's relocation, got ${JSON.stringify(annotated?.relocation ?? run.stderr?.slice(0, 200))}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
