// stats.mjs portal coverage: the --summary count and percentage must share a
// denominator. producingPct divides by distinct ENABLED tracked_companies
// names, but the summary printed every entry (disabled ones included) as the
// count beside it, so on the shipped template — which disables many entries —
// "173 companies configured | 58 have produced a match (49.6%)" did not divide
// out: 58/173 is 33.5%. The JSON keeps configuredCompanies as the raw entry
// count and adds enabledCompanies, the number the percentage is a share of.
import { pass, fail, run, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nstats.mjs — portal coverage count and percentage share one denominator');

const stats = await import(pathToFileURL(join(ROOT, 'stats.mjs')).href);

// Five entries: one disabled, one a duplicate name. Three distinct enabled
// names (Acme, Beta, Gama), two of which have produced a scanned job.
const portalsYml = [
  'tracked_companies:',
  '  - name: Acme',
  '    careers_url: https://boards.greenhouse.io/acme',
  '  - name: Beta',
  '    careers_url: https://jobs.ashbyhq.com/beta',
  '  - name: Gama',
  '    careers_url: https://gama.example.com/jobs',
  '  - name: Delta',
  '    careers_url: https://jobs.lever.co/delta',
  '    enabled: false',
  '  - name: acme',
  '    careers_url: https://jobs.ashbyhq.com/acme',
  'job_boards:',
  '  - name: BigBoard',
  '    url: https://bigboard.example.com',
].join('\n');

const p = stats.computePortalStats(portalsYml, null, ['acme', 'beta', 'delta']);

// Premise: the raw count still includes the disabled and duplicate entries,
// so the two numbers really do differ in this fixture.
if (p && p.configuredCompanies === 5) {
  pass('premise: configuredCompanies stays the raw tracked_companies entry count');
} else {
  fail(`premise broken — configuredCompanies is not the raw entry count: ${JSON.stringify(p)}`);
}

if (p && p.enabledCompanies === 3 && p.producingCompanies === 2 && p.producingPct === 66.7) {
  pass('enabledCompanies is the distinct enabled names producingPct divides by (disabled Delta never counts)');
} else {
  fail(`enabledCompanies/producingPct disagree: ${JSON.stringify(p)}`);
}

if (p && Math.round((p.producingCompanies / p.enabledCompanies) * 1000) / 10 === p.producingPct) {
  pass('producingPct divides out from producingCompanies / enabledCompanies');
} else {
  fail(`producingPct does not divide out from the reported counts: ${JSON.stringify(p)}`);
}

// --summary: the line the user reads must show the denominator the
// percentage was computed against.
const root = mkdtempSync(join(tmpdir(), 'co-stats-portal-denominator-'));
try {
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'portals.yml'), portalsYml);
  writeFileSync(join(root, 'data', 'scan-history.tsv'), [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
    'https://boards.greenhouse.io/acme/jobs/1\t2026-10-01\tgreenhouse\tEngineer\tAcme\tadded',
    'https://jobs.ashbyhq.com/beta/2\t2026-10-01\tashby\tEngineer\tBeta\tadded',
    'https://jobs.lever.co/delta/3\t2026-10-01\tlever\tEngineer\tDelta\tadded',
  ].join('\n') + '\n');
  const out = run(NODE, [join(ROOT, 'stats.mjs'), '--summary'], {
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
  });
  const line = (out || '').split('\n').find((l) => l.startsWith('Portals:')) || '';
  if (line.includes('5 companies + 1 boards configured') && line.includes('2 of 3 enabled have produced a match (66.7%)')) {
    pass('--summary prints the enabled denominator beside the percentage');
  } else {
    fail(`--summary Portals line does not show the percentage's denominator: ${JSON.stringify(line || out)}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
