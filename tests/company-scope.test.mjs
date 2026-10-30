// tests/company-scope.test.mjs — batch/company-scope.mjs picks the rows of a
// `--company` run, and batch-runner.sh --dry-run honours it before --limit.
import { pass, fail, rmSync, getBash, linkNodeModules, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, cpSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { requestedLabels, companyOfNotes, companyOfUrl, matchesCompany, idsForCompanies } from '../batch/company-scope.mjs';
import { normalizeCompany } from '../tracker-utils.mjs';

console.log('\nbatch/company-scope.mjs — --company scope');
const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`));

eq('names fold case and punctuation (shared normalizeCompany)', normalizeCompany('Acme Corp.'), 'acmecorp');
eq('a comma list becomes keys, blanks dropped', requestedLabels('Acme, ,Globex Inc'), ['acme', 'globexinc']);
eq('company half of "Company - Role"', companyOfNotes('Acme - Data Scientist'), 'Acme');
eq('notes without the separator are used whole', companyOfNotes('priority'), 'priority');
eq('empty notes give empty text', companyOfNotes(undefined), '');

const TSV = [
  'id\turl\tsource\tnotes',
  '1\thttps://boards.greenhouse.io/acme/jobs/1\tGreenhouse\tAcme - Data Scientist',
  '2\thttps://jobs.example.com/globex-42\tLinkedIn\tGlobex Inc. - Analyst',
  '3\thttps://boards.greenhouse.io/initech/jobs/9\tGreenhouse\t',
  '4\thttps://jobs.lever.co/acme-labs/7\tLever\tAcme Labs - ML Engineer',
  'x\thttps://bad.example/row\tLinkedIn\tAcme - not numeric id',
].join('\n') + '\n';

eq('matches the company half of the notes', idsForCompanies(TSV, 'globex'), ['2']);
eq('"acme" also reaches Acme Labs (substring) and ignores the non-numeric id', idsForCompanies(TSV, 'Acme'), ['1', '4']);
eq('matches by URL when the notes are empty', idsForCompanies(TSV, 'initech'), ['3']);
eq('several names, file order kept', idsForCompanies(TSV, 'initech, globex'), ['2', '3']);
eq('no match gives no ids', idsForCompanies(TSV, 'nonesuch'), []);
eq('matchesCompany with no wanted names accepts everything', matchesCompany({ url: 'u', notes: 'n' }, []), true);

// A shared ATS host names the platform, not the employer (follow-up to #5526).
eq('a shared ATS domain is left out of the URL text', companyOfUrl('https://acme.wd5.myworkdayjobs.com/External/job/1'), 'acme.wd5 /External/job/1 ');
eq('a URL off any known ATS is used whole', companyOfUrl('https://jobs.example.com/globex-42'), 'https://jobs.example.com/globex-42');
eq('a value that is not a URL is used whole', companyOfUrl('not a url'), 'not a url');
eq('"Lever" does not pick every posting hosted on jobs.lever.co', idsForCompanies(TSV, 'Lever'), []);
eq('"Greenhouse" does not pick every posting hosted on boards.greenhouse.io', idsForCompanies(TSV, 'greenhouse'), []);
const WORKDAY = 'id\turl\tsource\tnotes\n1\thttps://acme.wd5.myworkdayjobs.com/External/job/1\tWorkday\t\n2\thttps://globex.wd1.myworkdayjobs.com/Careers/job/2\tWorkday\t\n';
eq('multi-tenant Workday: the tenant subdomain still matches', idsForCompanies(WORKDAY, 'globex'), ['2']);
eq('multi-tenant Workday: "Workday" matches no tenant', idsForCompanies(WORKDAY, 'workday'), []);

const bad = spawnSync(NODE, ['batch/company-scope.mjs', '--input', 'x.tsv', '--company', ' , '], { cwd: ROOT, encoding: 'utf-8' });
if (bad.status === 1 && /no usable name/.test(bad.stderr)) pass('CLI rejects a company list with no usable name');
else fail(`CLI accepted an empty company list: status=${bad.status}`);

// ── runner wiring (dry run against a temp project) ───────────────────────
const bash = getBash();
if (!bash) {
  pass('runner checks skipped: no bash available on this platform');
} else {
  const work = mkdtempSync(join(tmpdir(), 'co-company-scope-'));
  try {
    const batch = join(work, 'batch');
    mkdirSync(batch, { recursive: true });
    for (const f of ['batch-runner.sh', 'company-scope.mjs', 'batch-prompt.md']) cpSync(join(ROOT, 'batch', f), join(batch, f));
    chmodSync(join(batch, 'batch-runner.sh'), 0o755);
    for (const d of ['lib']) cpSync(join(ROOT, d), join(work, d), { recursive: true });
    // company-scope.mjs imports normalizeCompany from tracker-utils.mjs (and its siblings)
    // and the shared ATS host table from ats-vendor.mjs.
    for (const f of ['tracker-utils.mjs', 'tracker-parse.mjs', 'tracker-aliases.json', 'path-resolver.mjs', 'ats-vendor.mjs', 'package.json']) cpSync(join(ROOT, f), join(work, f));
    const linkProblem = linkNodeModules(work);
    if (linkProblem) throw new Error(linkProblem);
    writeFileSync(join(batch, 'batch-input.tsv'), TSV);
    // The runner checks that the worker CLI exists before it lists offers; a stub
    // keeps this test independent of a developer-installed claude binary.
    const stubBin = join(work, 'stub-bin');
    mkdirSync(stubBin, { recursive: true });
    writeFileSync(join(stubBin, 'claude'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(stubBin, 'claude'), 0o755);
    const run = (...args) => {
      const r = spawnSync(bash, [join(batch, 'batch-runner.sh'), '--dry-run', ...args], { cwd: work, encoding: 'utf-8', timeout: 60000, env: { ...process.env, CAREER_OPS_ROOT: work, PATH: `${stubBin}${delimiter}${process.env.PATH}` } });
      return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
    };
    const all = run();
    const scoped = run('--company', 'acme');
    const limited = run('--company', 'acme', '--limit', '1');
    const none = run('--company', 'nonesuch');
    const dry = (r) => (r.out.match(/#\d+/g) || []).join(' ');
    if (/Scope: company=acme \(2 matching/.test(scoped.out)) pass('--company prints the scope line with the match count');
    else fail('no scope line: ' + scoped.out.slice(0, 300));
    if (dry(scoped) === '#1 #4' && dry(all).includes('#2')) pass('only the matching offers are processed; without --company all are');
    else fail(`dry run lists: scoped="${dry(scoped)}" all="${dry(all)}"`);
    if (dry(limited) === '#1') pass('--limit counts only the in-scope rows');
    else fail(`--limit with --company listed "${dry(limited)}"`);
    if (/No offers to process/.test(none.out)) pass('a company with no match processes nothing');
    else fail('no-match run: ' + none.out.slice(0, 200));
    const missing = spawnSync(bash, [join(batch, 'batch-runner.sh'), '--company'], { cwd: work, encoding: 'utf-8', timeout: 60000 });
    if (missing.status !== 0 && /--company requires an argument/.test(`${missing.stdout}${missing.stderr}`)) pass('--company without a value is a usage error');
    else fail('--company without a value was accepted');
    const swallowed = run('--company', '--limit', '5');
    if (swallowed.code !== 0 && /--company requires an argument/.test(swallowed.out)) pass('--company followed by another flag is rejected, not read as a company name');
    else fail('"--company --limit 5" took --limit as the company: ' + swallowed.out.slice(0, 200));
    const dashed = run('--company', '-h');
    if (dashed.code !== 0 && /--company requires an argument/.test(dashed.out)) pass('--company followed by a single-dash option is rejected, not read as a company name');
    else fail('"--company -h" took -h as the company: ' + dashed.out.slice(0, 200));
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
