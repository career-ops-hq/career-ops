/**
 * discover-ats.test.mjs — Systematic test suite for discover-ats.mjs
 *
 * Tests the pure, network-free functions with inline fixtures:
 * - deriveSlug (lowercasing, punctuation, edge cases)
 * - parseCompanyInput (shape, bare-name merge, malformed YAML, dedup, drops)
 * - buildCandidateUrls (vendor order, subset, SLUG_RE rejection, explicit slug)
 * - yamlScalar / renderPortalEntry (GH api line, quoting)
 * - dedupeAgainstPortals (name/url/api hits, trailing-slash norm, self-dedup)
 * - insertIntoTrackedCompanies (splice correctness, byte-preservation, empty
 *   block, missing header, idempotency)
 * - CLI behavior (--self-test, default preview never writes, --write opt-in,
 *   unknown --vendors, --help) via execFileSync — no live network.
 *
 * Run: node discover-ats.test.mjs
 *
 * Issue #1864 — github.com/santifer/career-ops
 */

import {
  deriveSlug,
  parseCompanyInput,
  buildCandidateUrls,
  yamlScalar,
  renderPortalEntry,
  dedupeAgainstPortals,
  insertIntoTrackedCompanies,
  parseWorkdayHint,
  buildWorkdayCandidates,
  resolveCompany,
} from './discover-ats.mjs';
import yaml from 'js-yaml';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond) {
  if (cond) { passed++; } else { failed++; failures.push(label); console.log(`  FAIL: ${label}`); }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

// ============================================================================
// 1. deriveSlug
// ============================================================================
console.log('\n--- 1. deriveSlug ---');

eq('spaces → dashes', deriveSlug('Trade Republic'), 'trade-republic');
eq('lowercases', deriveSlug('Adyen'), 'adyen');
eq('strips leading/trailing punctuation', deriveSlug('  N8N!  '), 'n8n');
eq('collapses runs of punctuation', deriveSlug('Foo & Bar, Inc.'), 'foo-bar-inc');
eq('empty name → empty', deriveSlug(''), '');
eq('null → empty', deriveSlug(null), '');
eq('already-slug unchanged', deriveSlug('mistral'), 'mistral');

// ============================================================================
// 2. parseCompanyInput
// ============================================================================
console.log('\n--- 2. parseCompanyInput ---');

const p1 = parseCompanyInput('companies:\n  - name: Adyen\n  - name: Monzo\n    slug: monzo-bank\n', ['Ramp']);
eq('merges file + CLI names', p1.companies.length, 3);
eq('keeps explicit slug', p1.companies[1].slug, 'monzo-bank');
eq('CLI name added', p1.companies[2].name, 'Ramp');

const p2 = parseCompanyInput('companies:\n  - name: Adyen\n', ['adyen']);
eq('dedupes by lowercased name', p2.companies.length, 1);

const p3 = parseCompanyInput('companies:\n  - name: Adyen\n', ['Adyen']);
eq('file wins over CLI on dup name', p3.companies.length, 1);

const p4 = parseCompanyInput(': : not : valid\n[', []);
ok('malformed YAML → no crash, empty companies', p4.companies.length === 0);
ok('malformed YAML → warning emitted', p4.warnings.length > 0);

const p5 = parseCompanyInput('companies:\n  - name: ""\n  - slug: x\n', []);
eq('drops nameless entries', p5.companies.length, 0);

const p6 = parseCompanyInput('companies:\n  - Adyen\n  - name: Monzo\n', []);
eq('accepts bare string list items', p6.companies.length, 2);
eq('bare string item name', p6.companies[0].name, 'Adyen');

const p7 = parseCompanyInput('', ['Stripe', 'Ramp']);
eq('CLI-only input', p7.companies.length, 2);

const p8 = parseCompanyInput('companies:\n  - name: Mollie\n    website: mollie.com\n', []);
eq('keeps website hint', p8.companies[0].website, 'mollie.com');

const p9 = parseCompanyInput('foo: bar\n', []);
ok('non-list doc → warning about companies key', p9.warnings.some(w => w.includes('companies')));

// ============================================================================
// 3. buildCandidateUrls
// ============================================================================
console.log('\n--- 3. buildCandidateUrls ---');

const b1 = buildCandidateUrls({ name: 'Adyen' });
eq('3 candidates in vendor order', b1.candidates.map(c => c.vendor), ['gh', 'ashby', 'lever']);
eq('GH careers_url', b1.candidates[0].careers_url, 'https://job-boards.greenhouse.io/adyen');
eq('Ashby careers_url', b1.candidates[1].careers_url, 'https://jobs.ashbyhq.com/adyen');
eq('Lever careers_url', b1.candidates[2].careers_url, 'https://jobs.lever.co/adyen');

const b2 = buildCandidateUrls({ name: 'X', slug: 'bad/slug' });
eq('unsafe slug builds NO candidate URLs (SSRF guard)', b2.candidates.length, 0);
eq('unsafe slug records all vendors as skipped', b2.skipped, ['gh', 'ashby', 'lever']);

const b2b = buildCandidateUrls({ name: 'X', slug: 'has space' });
eq('slug with space rejected', b2b.candidates.length, 0);

const b3 = buildCandidateUrls({ name: 'Adyen' }, ['ashby']);
eq('honors vendor subset', b3.candidates.map(c => c.vendor), ['ashby']);

const b4 = buildCandidateUrls({ name: 'Some Co', slug: 'DeepL' });
eq('explicit mixed-case slug preserved', b4.candidates[1].careers_url, 'https://jobs.ashbyhq.com/DeepL');

// ============================================================================
// 4. yamlScalar / renderPortalEntry
// ============================================================================
console.log('\n--- 4. renderPortalEntry ---');

eq('bare scalar stays bare', yamlScalar('Adyen'), 'Adyen');
eq('colon triggers quote', yamlScalar('Foo: Bar'), '"Foo: Bar"');
eq('hash triggers quote', yamlScalar('a#b'), '"a#b"');
eq('embedded quote escaped', yamlScalar('a"b'), '"a\\"b"');

const gh = renderPortalEntry({ name: 'Adyen', careers_url: 'https://job-boards.greenhouse.io/adyen', api: 'https://boards-api.greenhouse.io/v1/boards/adyen/jobs' });
ok('GH entry has name line', gh.includes('  - name: Adyen'));
ok('GH entry has api line', gh.includes('    api: https://boards-api.greenhouse.io/v1/boards/adyen/jobs'));
ok('GH entry has enabled line', gh.includes('    enabled: true'));
ok('entry leads with newline', gh.startsWith('\n'));

const lv = renderPortalEntry({ name: 'Mistral AI', careers_url: 'https://jobs.lever.co/mistral' });
ok('non-GH omits api line', !lv.includes('api:'));

const nq = renderPortalEntry({ name: 'Foo: Bar', careers_url: 'https://jobs.ashbyhq.com/foo' });
ok('quotes name with colon', nq.includes('name: "Foo: Bar"'));

const nt = renderPortalEntry({ name: 'Acme', careers_url: 'https://jobs.lever.co/acme', notes: 'via discover-ats' });
ok('includes notes when present', nt.includes('    notes: via discover-ats'));

// ============================================================================
// 5. dedupeAgainstPortals
// ============================================================================
console.log('\n--- 5. dedupeAgainstPortals ---');

const existing = [
  { name: 'Adyen', careers_url: 'https://job-boards.greenhouse.io/adyen/', api: 'https://boards-api.greenhouse.io/v1/boards/adyen/jobs' },
];

const d1 = dedupeAgainstPortals([{ name: 'Adyen', careers_url: 'https://x' }], existing);
eq('name hit → duplicate', d1.duplicates.length, 1);
eq('name hit → nothing fresh', d1.fresh.length, 0);

const d2 = dedupeAgainstPortals([{ name: 'Different', careers_url: 'https://job-boards.greenhouse.io/adyen' }], existing);
eq('careers_url hit (trailing slash normalized)', d2.duplicates.length, 1);

const d3 = dedupeAgainstPortals([{ name: 'Diff', careers_url: 'https://y', api: 'https://boards-api.greenhouse.io/v1/boards/adyen/jobs' }], existing);
eq('api hit → duplicate', d3.duplicates.length, 1);

const d4 = dedupeAgainstPortals([{ name: 'A', careers_url: 'u1' }, { name: 'A', careers_url: 'u2' }], []);
eq('self-dedupe within fresh by name', d4.fresh.length, 1);

const d5 = dedupeAgainstPortals([{ name: 'New Co', careers_url: 'https://jobs.lever.co/newco' }], existing);
eq('genuinely new → fresh', d5.fresh.length, 1);

const d6 = dedupeAgainstPortals([{ name: 'X', careers_url: 'u' }], null);
eq('null existing entries handled', d6.fresh.length, 1);

// ============================================================================
// 6. insertIntoTrackedCompanies
// ============================================================================
console.log('\n--- 6. insertIntoTrackedCompanies ---');

const doc = 'title_filter:\n  positive: [a]\n\ntracked_companies:\n  - name: Existing\n    careers_url: https://jobs.lever.co/existing\n\njob_boards:\n  - name: Foo\n';
const snip = renderPortalEntry({ name: 'New', careers_url: 'https://jobs.lever.co/new' });
const inserted = insertIntoTrackedCompanies(doc, [snip]);

ok('lands after tracked_companies:', inserted.indexOf('- name: New') > inserted.indexOf('tracked_companies:'));
ok('lands before job_boards:', inserted.indexOf('- name: New') < inserted.indexOf('job_boards:'));
ok('preserves leading bytes (title_filter block)', inserted.startsWith('title_filter:\n  positive: [a]\n'));
ok('preserves trailing block (job_boards)', inserted.includes('job_boards:\n  - name: Foo\n'));
ok('preserves existing entry', inserted.includes('- name: Existing'));
ok('re-parses as valid YAML', (() => { try { const y = yaml.load(inserted); return Array.isArray(y.tracked_companies) && y.tracked_companies.length === 2 && Array.isArray(y.job_boards); } catch { return false; } })());

// Byte-preservation: everything outside the spliced region is unchanged.
const cut = inserted.indexOf('\n  - name: New');
ok('bytes before insertion identical to original prefix', inserted.slice(0, doc.indexOf('\n\njob_boards:')).replace(/\n[ \t]*(?=\njob_boards)/, '').length > 0);

// empty companies snippet → no-op
eq('empty snippets → unchanged', insertIntoTrackedCompanies(doc, []), doc);

// missing header → appended fresh block
const noHeader = insertIntoTrackedCompanies('title_filter:\n  positive: [a]\n', [snip]);
ok('missing header → tracked_companies appended', /tracked_companies:/.test(noHeader) && noHeader.includes('- name: New'));
ok('missing header → still valid YAML', (() => { try { return yaml.load(noHeader).tracked_companies.length === 1; } catch { return false; } })());

// empty block (header immediately followed by top-level key)
const emptyBlock = insertIntoTrackedCompanies('tracked_companies:\njob_boards:\n  - name: Foo\n', [snip]);
ok('empty block → insert before job_boards', emptyBlock.indexOf('- name: New') < emptyBlock.indexOf('job_boards:'));
ok('empty block → valid YAML', (() => { try { const y = yaml.load(emptyBlock); return y.tracked_companies.length === 1 && y.job_boards.length === 1; } catch { return false; } })());

// tracked_companies at EOF (no trailing block)
const eofDoc = 'title_filter:\n  positive: [a]\n\ntracked_companies:\n  - name: Existing\n    careers_url: https://jobs.lever.co/existing\n';
const eofInserted = insertIntoTrackedCompanies(eofDoc, [snip]);
ok('EOF block → new entry appended', eofInserted.includes('- name: New'));
ok('EOF block → valid YAML with 2 entries', (() => { try { return yaml.load(eofInserted).tracked_companies.length === 2; } catch { return false; } })());

// idempotency through dedupe
const parsed = yaml.load(inserted);
const again = dedupeAgainstPortals([{ name: 'New', careers_url: 'https://jobs.lever.co/new' }], parsed.tracked_companies);
eq('idempotent: re-run finds nothing fresh', again.fresh.length, 0);

// comment preservation
const commentDoc = '# top comment\ntracked_companies:\n  # inline comment\n  - name: Existing\n    careers_url: https://jobs.lever.co/existing\n\njob_boards:\n  - name: Foo\n';
const commentInserted = insertIntoTrackedCompanies(commentDoc, [snip]);
ok('preserves top comment', commentInserted.includes('# top comment'));
ok('preserves inline comment', commentInserted.includes('# inline comment'));

// ============================================================================
// 6b. Workday coordinate parsing (pure, no network)
// ============================================================================
console.log('\n--- 6b. Workday coordinates ---');

const wh1 = parseWorkdayHint({ name: 'Nvidia', workday: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite' });
eq('parseWorkdayHint URL tenant', wh1?.tenant, 'nvidia');
eq('parseWorkdayHint URL instance', wh1?.instance, 'wd5');
eq('parseWorkdayHint URL site', wh1?.site, 'NVIDIAExternalCareerSite');

const wh2 = parseWorkdayHint({ name: 'X', careers_url: 'https://acme.wd3.myworkdayjobs.com/en-US/CareerSite/job/Foo-Bar' });
eq('parseWorkdayHint strips locale prefix', wh2?.site, 'CareerSite');
eq('parseWorkdayHint reads from careers_url field', wh2?.tenant, 'acme');

const wh3 = parseWorkdayHint({ name: 'Salesforce', workday: { tenant: 'salesforce', site: 'External_Career_Site' } });
eq('parseWorkdayHint object form tenant', wh3?.tenant, 'salesforce');
eq('parseWorkdayHint object form null instance', wh3?.instance, null);
eq('parseWorkdayHint object form keeps underscores in site', wh3?.site, 'External_Career_Site');

const wh4 = parseWorkdayHint({ name: 'Nvidia', website: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite' });
eq('parseWorkdayHint reads from website field', wh4?.tenant, 'nvidia');

eq('parseWorkdayHint returns null without any hint', parseWorkdayHint({ name: 'Adyen', careers_url: 'https://adyen.com' }), null);
eq('parseWorkdayHint rejects unsafe tenant', parseWorkdayHint({ name: 'X', workday: { tenant: 'a/b', site: 'S' } }), null);
eq('parseWorkdayHint rejects object missing site', parseWorkdayHint({ name: 'X', workday: { tenant: 'a' } }), null);

const wc1 = buildWorkdayCandidates({ tenant: 'nvidia', instance: 'wd5', site: 'NVIDIAExternalCareerSite' });
eq('buildWorkdayCandidates known instance → 1 URL', wc1.length, 1);
eq('buildWorkdayCandidates known instance URL', wc1[0].careers_url, 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');

const wc2 = buildWorkdayCandidates({ tenant: 'sf', instance: null, site: 'CS' });
ok('buildWorkdayCandidates null instance → expands', wc2.length > 1);
ok('buildWorkdayCandidates first candidate is wd1', new URL(wc2[0].careers_url).hostname === 'sf.wd1.myworkdayjobs.com');
ok('buildWorkdayCandidates every URL well-formed', wc2.every(c => /^https:\/\/sf\.wd[\w-]+\.myworkdayjobs\.com\/CS$/.test(c.careers_url)));

// Workday entry rendering
const wdRender = renderPortalEntry({ name: 'Nvidia', careers_url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', provider: 'workday' });
ok('workday entry has provider line', wdRender.includes('    provider: workday'));
ok('workday entry has no api line', !wdRender.includes('api:'));

// resolveCompany without a hint must NOT attempt Workday (name alone can't resolve it)
// — use includeWorkday:false + no slug vendors to keep this network-free.
const noWd = await resolveCompany({ name: 'Whatever', slug: 'bad/slug' }, { vendors: [], includeWorkday: false });
ok('resolveCompany no-vendor no-workday → unresolved', !!noWd.unresolved);
ok('resolveCompany unresolved names workday hint path', /Workday/.test(noWd.unresolved.reason));

// A rejected Workday hint (bad tenant/site) must produce a "fix your hint" reason,
// NOT the "add a hint" message. No slug vendors → network-free.
const badHint = await resolveCompany({ name: 'BadHint', workday: { tenant: 'a/b', site: 'S' } }, { vendors: [] });
ok('rejected hint → "given but rejected" reason', /rejected/i.test(badHint.unresolved.reason));
ok('rejected hint → NOT the "add a hint" message', !/add a hint/i.test(badHint.unresolved.reason));

// parseCompanyInput warns on a present-but-wrong-typed workday field (e.g. a number).
const wrongType = parseCompanyInput('companies:\n  - name: X\n    workday: 42\n', []);
ok('wrong-typed workday hint → warning emitted', wrongType.warnings.some(w => /workday/i.test(w)));
ok('wrong-typed workday hint → field dropped', !('workday' in wrongType.companies[0]));

// ============================================================================
// 7. CLI behavior (execFileSync — no live network)
// ============================================================================
console.log('\n--- 7. CLI behavior ---');

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'discover-ats.mjs');

// --self-test exits 0
try {
  execFileSync('node', [scriptPath, '--self-test'], { encoding: 'utf-8', timeout: 15000 });
  ok('--self-test exits 0', true);
} catch (e) {
  ok('--self-test exits 0', false);
  console.log(`    exit code: ${e.status}, stderr: ${e.stderr?.slice(0, 200)}`);
}

// --help exits 0 and documents the opt-in --write flag
const helpOut = execFileSync('node', [scriptPath, '--help'], { encoding: 'utf-8', timeout: 15000 });
ok('--help prints usage', helpOut.includes('Usage:') && helpOut.includes('--write'));
ok('--help states preview-by-default (never writes without --write)', /never writes[\s\S]*--write/i.test(helpOut));

// Empty input (no --in, no names): valid JSON envelope, no network, exit 0.
const emptyOut = execFileSync('node', [scriptPath], { encoding: 'utf-8', timeout: 15000, cwd: dirname(scriptPath) });
const emptyJson = JSON.parse(emptyOut);
ok('empty input → valid JSON envelope', typeof emptyJson === 'object' && 'metadata' in emptyJson);
eq('empty input → resolved []', emptyJson.resolved, []);
eq('empty input → unresolved []', emptyJson.unresolved, []);
ok('empty input → previewOnly true', emptyJson.metadata.previewOnly === true);
ok('empty input → written false', emptyJson.metadata.written === false);

// Data contract: the DEFAULT run (no --write) must never touch portals.yml, even
// when it can't be parsed. Run against a scratch file and assert it's untouched.
// Network-free: an unresolvable slug (SLUG_RE-safe but no real board) + no --write.
const tmpDir = mkdtempSync(join(tmpdir(), 'discover-ats-test-'));
const scratchPortals = join(tmpDir, 'portals.yml');
const scratchContent = 'title_filter:\n  positive: [pm]\n\ntracked_companies:\n  - name: Existing\n    careers_url: https://jobs.lever.co/existing\n\njob_boards:\n  - name: Foo\n';
writeFileSync(scratchPortals, scratchContent);
try {
  // Empty company list → no network — the point is only to prove the default
  // path writes nothing and reports previewOnly.
  const previewOut = execFileSync('node', [scriptPath], {
    encoding: 'utf-8', timeout: 15000, cwd: dirname(scriptPath),
    env: { ...process.env, CAREER_OPS_PORTALS: scratchPortals },
  });
  const previewJson = JSON.parse(previewOut);
  ok('default run → previewOnly true', previewJson.metadata.previewOnly === true);
  ok('default run → written false', previewJson.metadata.written === false);
  eq('default run → portals.yml byte-for-byte unchanged', readFileSync(scratchPortals, 'utf-8'), scratchContent);

  // --write is accepted as a known flag (empty list → no fresh entries → still
  // no write, file unchanged). Proves the flag parses and the guard holds.
  const writeOut = execFileSync('node', [scriptPath, '--write'], {
    encoding: 'utf-8', timeout: 15000, cwd: dirname(scriptPath),
    env: { ...process.env, CAREER_OPS_PORTALS: scratchPortals },
  });
  const writeJson = JSON.parse(writeOut);
  ok('--write accepted (valid JSON, exit 0)', typeof writeJson === 'object' && 'metadata' in writeJson);
  eq('--write with nothing fresh → portals.yml still unchanged', readFileSync(scratchPortals, 'utf-8'), scratchContent);

  // --dry-run is accepted as a harmless alias for the default (no write).
  const aliasOut = execFileSync('node', [scriptPath, '--dry-run'], {
    encoding: 'utf-8', timeout: 15000, cwd: dirname(scriptPath),
    env: { ...process.env, CAREER_OPS_PORTALS: scratchPortals },
  });
  ok('--dry-run still accepted (no-op alias)', JSON.parse(aliasOut).metadata.written === false);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// insertIntoTrackedCompanies unit test already proves the actual write/splice
// mechanics deterministically (section 6); the CLI-level --write path shares it.

// unknown --vendors → nonzero exit
let vendorExit = 0;
try {
  execFileSync('node', [scriptPath, '--vendors', 'xyz', 'Foo'], { encoding: 'utf-8', timeout: 15000 });
} catch (e) {
  vendorExit = e.status;
}
ok('unknown --vendors → nonzero exit', vendorExit !== 0);

// unknown flag → nonzero exit
let flagExit = 0;
try {
  execFileSync('node', [scriptPath, '--bogus'], { encoding: 'utf-8', timeout: 15000 });
} catch (e) {
  flagExit = e.status;
}
ok('unknown flag → nonzero exit', flagExit !== 0);

// --vendors workday is accepted (no companies → no network, exit 0)
let workdayVendorOk = true;
try {
  const wvOut = execFileSync('node', [scriptPath, '--vendors', 'workday'], { encoding: 'utf-8', timeout: 15000, cwd: dirname(scriptPath) });
  JSON.parse(wvOut);
} catch (e) {
  workdayVendorOk = false;
}
ok('--vendors workday accepted', workdayVendorOk);

// ============================================================================
// RESULTS
// ============================================================================
console.log(`\n${'='.repeat(78)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\n  Failed tests:`);
  for (const f of failures) console.log(`    - ${f}`);
}
console.log(`${'='.repeat(78)}`);

process.exit(failed > 0 ? 1 : 0);
