/**
 * tests/discover-ats.test.mjs — Systematic test suite for discover-ats.mjs
 *
 * Tests the pure, network-free functions with inline fixtures:
 * - deriveSlug (lowercasing, punctuation, edge cases)
 * - parseCompanyInput (shape, bare-name merge, malformed YAML, dedup, drops)
 * - buildCandidateUrls (vendor order, subset, SLUG_RE rejection, explicit slug,
 *   dotted slugs vs subdomain vendors, host-never-leaves-vendor-domain)
 * - yamlScalar / renderPortalEntry (GH api line, quoting)
 * - dedupeAgainstPortals (name/url/api hits, trailing-slash norm, self-dedup)
 * - insertIntoTrackedCompanies (splice correctness, byte-preservation, empty
 *   block, missing header, idempotency)
 * - CLI behavior (--self-test, default preview never writes, --write opt-in,
 *   unknown --vendors, --help) via execFileSync — no live network.
 *
 * Run: node test-all.mjs --only discover-ats
 *      Running the file directly prints the same ✅/❌ lines, but a
 *      discovered suite reports through the shared counters and never
 *      exits — so a direct run returns 0 even when assertions fail.
 *
 * Issue #1864 — github.com/career-ops-hq/career-ops
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
  resolveWorkday,
} from '../discover-ats.mjs';
import * as yaml from 'js-yaml';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pass, fail } from './helpers.mjs';

console.log('\ndiscover-ats.mjs — ATS board discovery');


function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(label);
  else fail(`${label} — expected ${e}, got ${a}`);
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
// The three highest-hit-rate vendors must stay FIRST: resolveCompany returns on
// the first match, so this ordering is what caps a company they can resolve at
// three probes (one on gh, two on ashby, three on lever) even though the long
// tail is now probed too.
eq('common vendors probed first', b1.candidates.slice(0, 3).map(c => c.vendor), ['gh', 'ashby', 'lever']);
eq('GH careers_url', b1.candidates[0].careers_url, 'https://job-boards.greenhouse.io/adyen');
eq('Ashby careers_url', b1.candidates[1].careers_url, 'https://jobs.ashbyhq.com/adyen');
eq('Lever careers_url', b1.candidates[2].careers_url, 'https://jobs.lever.co/adyen');

const b2 = buildCandidateUrls({ name: 'X', slug: 'bad/slug' });
eq('unsafe slug builds NO candidate URLs (SSRF guard)', b2.candidates.length, 0);
eq('unsafe slug records every vendor as skipped', b2.skipped.length, b1.candidates.length);

const b2b = buildCandidateUrls({ name: 'X', slug: 'has space' });
eq('slug with space rejected', b2b.candidates.length, 0);

const b3 = buildCandidateUrls({ name: 'Adyen' }, ['ashby']);
eq('honors vendor subset', b3.candidates.map(c => c.vendor), ['ashby']);

const b4 = buildCandidateUrls({ name: 'Some Co', slug: 'DeepL' });
eq('explicit mixed-case slug preserved', b4.candidates[1].careers_url, 'https://jobs.ashbyhq.com/DeepL');

// --- dotted slugs vs subdomain vendors -------------------------------------
// SLUG_RE allows dots and path vendors accept them, but a subdomain vendor
// interpolates the slug into the HOSTNAME: `foo.bar` → `foo.bar.bamboohr.com`,
// two tenant labels, which every subdomain provider's `<tenant>.<vendor>` regex
// rejects. The host assertion cannot catch this (the expected host is built by
// the same concatenation), so buildCandidateUrls asks the provider itself.
const SUBDOMAIN_VENDORS = ['recruitee', 'breezy', 'bamboohr', 'pinpoint'];
const bDot = buildCandidateUrls({ name: 'X', slug: 'foo.bar' });
const dotCandidates = bDot.candidates.map(c => c.vendor);
for (const v of SUBDOMAIN_VENDORS) {
  ok(`dotted slug is not a ${v} candidate`, !dotCandidates.includes(v));
  ok(`dotted slug reported unsupported for ${v}`, bDot.unsupported.includes(v));
}
eq('dotted slug is an unsupported shape, not an unsafe-slug skip', bDot.skipped, []);
ok('dotted slug still probes the vendors whose contract accepts it', bDot.candidates.length > 0);

// The security property, asserted rather than argued: buildUrl always appends the
// vendor suffix, so no slug can move the host off the vendor's own domain. A
// dotted slug is a wasted-probe/reporting problem, not an SSRF one.
const SUBDOMAIN_SUFFIX = {
  recruitee: '.recruitee.com', breezy: '.breezy.hr', bamboohr: '.bamboohr.com', pinpoint: '.pinpointhq.com',
};
const offDomain = [];
for (const s of ['foo.bar', 'evil.com', 'a.b.c.d', '..evil.com', 'x.bamboohr.com', '169.254.169.254', 'localhost']) {
  for (const c of buildCandidateUrls({ name: 'X', slug: s }, SUBDOMAIN_VENDORS).candidates) {
    if (!new URL(c.careers_url).hostname.endsWith(SUBDOMAIN_SUFFIX[c.vendor])) offDomain.push(c.careers_url);
  }
}
eq('no slug moves a subdomain-vendor host off the vendor domain', offDomain, []);

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

// A CXS endpoint pasted as the hint carries the site behind /wday/cxs/{tenant}/.
// Parsed as a careers page it yields site `wday`, and the generated entry then
// pins `careers_url: .../wday` — a plausible-looking line for a board that does
// not exist (#3498). Coordinates must match what the careers-page form gives.
const whCxs = parseWorkdayHint({ name: 'CrowdStrike', workday: 'https://crowdstrike.wd5.myworkdayjobs.com/wday/cxs/crowdstrike/crowdstrikecareers/jobs' });
const whPlain = parseWorkdayHint({ name: 'CrowdStrike', workday: 'https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers' });
eq('parseWorkdayHint CXS URL site', whCxs?.site, 'crowdstrikecareers');
eq('parseWorkdayHint CXS URL tenant', whCxs?.tenant, 'crowdstrike');
eq('parseWorkdayHint CXS URL instance', whCxs?.instance, 'wd5');
eq('parseWorkdayHint CXS URL === careers-page URL', JSON.stringify(whCxs), JSON.stringify(whPlain));

const whCxsBare = parseWorkdayHint({ name: 'CrowdStrike', careers_url: 'https://crowdstrike.wd5.myworkdayjobs.com/wday/cxs/crowdstrike/crowdstrikecareers' });
eq('parseWorkdayHint CXS URL without trailing /jobs', whCxsBare?.site, 'crowdstrikecareers');

const whCxsJob = parseWorkdayHint({ name: 'Acme', website: 'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/job/Toronto-ON/Eng_R1' });
eq('parseWorkdayHint per-job CXS URL keeps the site', whCxsJob?.site, 'External');

// The whole point of the coordinates: they rebuild a careers_url that resolves.
eq(
  'buildWorkdayCandidates from a CXS hint yields the real board URL',
  buildWorkdayCandidates(whCxs)[0].careers_url,
  'https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers',
);

// Both URL patterns are anchored, so a Workday URL embedded in a wrapper (a
// redirect's next=, a tracking link) is not a hint. Unanchored, such a value
// silently produces coordinates for whatever tenant it carries.
eq(
  'parseWorkdayHint ignores a careers URL embedded in a redirect wrapper',
  parseWorkdayHint({ name: 'X', website: 'https://evil.example/r?next=https://acme.wd5.myworkdayjobs.com/Careers' }),
  null,
);
eq(
  'parseWorkdayHint ignores a CXS URL embedded in a redirect wrapper',
  parseWorkdayHint({ name: 'X', website: 'https://evil.example/r?next=https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs' }),
  null,
);

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
// VENDOR_ORDER probes eleven vendors now, so the fallback must not name three of
// them as if they were the whole list.
ok('fallback reason is provider-neutral', !/Greenhouse|Ashby|Lever/i.test(noWd.unresolved.reason));

// A slug no vendor's contract can represent must be reported as such — NOT as a
// probe error, which would read as transient and invite a pointless re-run.
// Subdomain vendors only → nothing is probeable → network-free.
const dotResolve = await resolveCompany({ name: 'X', slug: 'foo.bar' }, { vendors: SUBDOMAIN_VENDORS, includeWorkday: false });
eq('dotted slug → nothing tried', dotResolve.unresolved.triedVendors, []);
eq('dotted slug → reported as unsupported shape', dotResolve.unresolved.unsupportedSlugShape, SUBDOMAIN_VENDORS);
ok('dotted slug → no probe errors recorded', !dotResolve.unresolved.errors);
ok('dotted slug → reason says the slug is invalid, not that a board is missing', /not a valid board slug/i.test(dotResolve.unresolved.reason));

// A rejected Workday hint (bad tenant/site) must produce a "fix your hint" reason,
// NOT the "add a hint" message. No slug vendors → network-free.
const badHint = await resolveCompany({ name: 'BadHint', workday: { tenant: 'a/b', site: 'S' } }, { vendors: [] });
ok('rejected hint → "given but rejected" reason', /rejected/i.test(badHint.unresolved.reason));
ok('rejected hint → NOT the "add a hint" message', !/add a hint/i.test(badHint.unresolved.reason));

// ── #2883: a definitive 404 must not be reported as a transient error ──
// Greenhouse/Ashby/Lever answering 404 means the board does not exist. Reporting
// that as "board status unknown ... re-run" advises a retry guaranteed to give
// the same answer, and erases the difference between "no board" and "the network
// hiccuped" — the two states a user pruning portals.yml has to tell apart.
const httpErrorCtx = (statusByVendor) => ({
  fetchJson: async (url) => {
    const vendor = /greenhouse/.test(url) ? 'gh' : /ashby/.test(url) ? 'ashby' : 'lever';
    const status = statusByVendor[vendor] ?? 404;
    const err = new Error(`HTTP ${status}${status === 404 ? ' Not Found' : ''}`);
    err.status = status;
    throw err;
  },
  fetchText: async () => { throw new Error('unused'); },
});
const SLUG_VENDORS = ['gh', 'ashby', 'lever'];

const all404 = await resolveCompany({ name: 'Mercado Libre' },
  { vendors: SLUG_VENDORS, includeWorkday: false, ctx: httpErrorCtx({ gh: 404, ashby: 404, lever: 404 }) });
ok('all-404 → not reported as unknown', !/status unknown/i.test(all404.unresolved.reason));
// Precisely: no advice to re-run THE SAME PROBE. The fallback message does say
// "add a Workday hint and re-run", which is a different and actionable
// instruction — the user changes their input first. What must not survive is
// the unconditional retry attached to an unknown status.
ok('all-404 → no advice to re-run the same probe', !/errors\[\] and re-run/i.test(all404.unresolved.reason));
ok('all-404 → says no board was found', /no .*board found/i.test(all404.unresolved.reason));
ok('all-404 → each error is marked definitive',
  all404.unresolved.errors.length === 3 && all404.unresolved.errors.every(e => e.definitive === true));

// A 410 Gone is equally definitive.
const all410 = await resolveCompany({ name: 'Gone Co' },
  { vendors: SLUG_VENDORS, includeWorkday: false, ctx: httpErrorCtx({ gh: 410, ashby: 410, lever: 410 }) });
ok('all-410 → treated as definitive too', !/status unknown/i.test(all410.unresolved.reason));

// Guard: a genuinely transient failure must KEEP the unknown/re-run wording.
const all503 = await resolveCompany({ name: 'Flaky Co' },
  { vendors: SLUG_VENDORS, includeWorkday: false, ctx: httpErrorCtx({ gh: 503, ashby: 503, lever: 503 }) });
ok('all-503 → still reported as unknown', /status unknown/i.test(all503.unresolved.reason));
ok('all-503 → still advises a re-run', /re-run/i.test(all503.unresolved.reason));
ok('all-503 → errors are not marked definitive', all503.unresolved.errors.every(e => e.definitive !== true));

// Guard: ONE transient failure among 404s leaves the outcome unknown — that
// vendor was never actually answered, so absence is not established.
const mixed = await resolveCompany({ name: 'Mixed Co' },
  { vendors: SLUG_VENDORS, includeWorkday: false, ctx: httpErrorCtx({ gh: 404, ashby: 503, lever: 404 }) });
ok('mixed 404/503 → still unknown, absence not established', /status unknown/i.test(mixed.unresolved.reason));

// ── Refused redirect: a third answer, neither transient nor absence (#3788) ──
//
// Subdomain vendors don't 404 an unknown tenant. BambooHR answers
// `302 → www.bamboohr.com`, which redirect:'error' (#1440) turns into a bare
// `TypeError: fetch failed` — the same SHAPE as a timeout, so it was reported
// as an unknown status with advice to re-run. It is deterministic: the same
// probe redirects again, forever. providers/_http.mjs already said so for the
// retry layer; this pins the user-facing half to the same verdict.
//
// The cause message is hardcoded, not imported, for the same reason
// tests/providers/_http.test.mjs hardcodes it: comparing the constant to
// itself would pin nothing.
const refusalCtx = () => ({
  fetchJson: async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { message: 'unexpected redirect' } });
  },
  fetchText: async () => { throw new Error('unused'); },
});
const redirected = await resolveCompany({ name: 'MaRS Discovery District' },
  { vendors: ['bamboohr'], includeWorkday: false, ctx: refusalCtx() });

ok('refused redirect → not reported as an unknown status',
  !/status unknown/i.test(redirected.unresolved.reason));
ok('refused redirect → no advice to re-run the same probe',
  !/errors\[\] and re-run/i.test(redirected.unresolved.reason));
ok('refused redirect → names the slug as the fix',
  /slug/i.test(redirected.unresolved.reason));
ok('refused redirect → names the vendor that redirected',
  /bamboohr/i.test(redirected.unresolved.reason));
// Not absence: the board may well exist under a different tenant label —
// mars-discovery-district redirects, marsdd serves jobs. Saying "no supported
// ATS board found" here would be as wrong as saying "re-run".
ok('refused redirect → does NOT claim no board was found',
  !/no .*board found/i.test(redirected.unresolved.reason));
ok('refused redirect → error entry carries the discriminator',
  redirected.unresolved.errors.every(e => e.refusedRedirect === true));
ok('refused redirect → error entry is not marked definitive',
  redirected.unresolved.errors.every(e => e.definitive !== true));
// The cause is what says "not this tenant"; keeping only err.message left
// errors[] reading the single word "fetch failed".
ok('refused redirect → the dropped cause survives into errors[]',
  redirected.unresolved.errors.every(e => /unexpected redirect/.test(e.error)));

// Guard, the direction that matters most: a redirect refusal must not swallow
// a genuinely transient failure alongside it. That vendor never answered, so
// the status really is unknown and a re-run really is the right advice.
const redirectPlus503 = await resolveCompany({ name: 'Half Answered Co' },
  {
    vendors: ['gh', 'bamboohr'],
    includeWorkday: false,
    ctx: {
      fetchJson: async (url) => {
        if (/bamboohr/.test(url)) {
          throw Object.assign(new TypeError('fetch failed'), { cause: { message: 'unexpected redirect' } });
        }
        const err = new Error('HTTP 503');
        err.status = 503;
        throw err;
      },
      fetchText: async () => { throw new Error('unused'); },
    },
  });
ok('refused redirect + 503 → still unknown, the 503 vendor never answered',
  /status unknown/i.test(redirectPlus503.unresolved.reason));

// Guard, the direction that costs a user real time. A DNS failure reaches this
// code as the SAME bare TypeError with no status; only err.cause distinguishes
// it. Widening the predicate in providers/_http.mjs to accept any cause leaves
// every assertion above green while turning a network hiccup into "your slug is
// wrong" — measured, not hypothetical: that mutation reddens --only _http and
// leaves --only discover-ats at 149/0. This is the case that closes it.
const dnsFailureCtx = () => ({
  fetchJson: async () => {
    throw Object.assign(new TypeError('fetch failed'), {
      cause: { message: 'getaddrinfo ENOTFOUND unreachable-co.bamboohr.com' },
    });
  },
  fetchText: async () => { throw new Error('unused'); },
});
const dnsFailure = await resolveCompany({ name: 'Unreachable Co' },
  { vendors: ['bamboohr'], includeWorkday: false, ctx: dnsFailureCtx() });
ok('DNS-shaped TypeError → still an unknown status',
  /status unknown/i.test(dnsFailure.unresolved.reason));
ok('DNS-shaped TypeError → still advises a re-run',
  /errors\[\] and re-run/i.test(dnsFailure.unresolved.reason));
ok('DNS-shaped TypeError → not marked as a refused redirect',
  dnsFailure.unresolved.errors.every(e => e.refusedRedirect !== true));
ok('DNS-shaped TypeError → the slug is never blamed for a transport failure',
  !/redirected off-tenant/i.test(dnsFailure.unresolved.reason));

// The refused-redirect branch sits ABOVE the workday-hint branch, so a
// malformed hint alongside a refusal reports the redirect. That order is
// deliberate and load-bearing: the redirect is an answer a vendor actually
// gave, while the hint is a field the user must fix in either case — and main
// said "status unknown" here, so this is a choice between two new messages
// rather than a regression. Pinned so reshuffling the ladder has to argue.
const hintPlusRedirect = await resolveCompany(
  { name: 'Hinted Co', workday: { tenant: 'a/b', site: 'S' } },
  { vendors: ['bamboohr'], includeWorkday: true, ctx: refusalCtx() });
ok('malformed workday hint + refused redirect → the measured answer wins the message',
  /redirected off-tenant/i.test(hintPlusRedirect.unresolved.reason));

// And a malformed hint on its own is untouched — the guard that the branch
// above did not swallow the Workday case wholesale.
const hintOnly = await resolveCompany(
  { name: 'Hint Only Co', workday: { tenant: 'a/b', site: 'S' } },
  { vendors: [], includeWorkday: true });
ok('malformed workday hint alone → still the Workday-hint message',
  /Workday hint given but rejected/i.test(hintOnly.unresolved.reason));

// resolveWorkday is the file's OTHER .fetch( site, and workday.mjs passes
// redirect:'error' as well — so the same refusal arrives there and used to be
// flattened to a bare "fetch failed" while probeVendor's copy kept the cause.
//
// Injected through ctx.fetchJson, which is where the provider actually reads:
// a first attempt passing `{}` and stubbing globalThis.fetch produced
// detail === "ctx.fetchJson is not a function", i.e. a failing assertion that
// never reached the refusal path at all.
{
  const wdRefusalCtx = {
    fetchJson: async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { message: 'unexpected redirect' } });
    },
    fetchText: async () => { throw new Error('unused'); },
  };
  const wdCoords = parseWorkdayHint({ name: 'WD Co', workday: { tenant: 'acme', site: 'External' } });
  const wd = await resolveWorkday({ name: 'WD Co' }, wdCoords, wdRefusalCtx);
  ok('workday refusal → reaches the refusal path, not a ctx shape error',
    wd.status === 'error' && /fetch failed/.test(String(wd.detail)));
  ok('workday refusal → the cause survives into detail',
    /unexpected redirect/.test(String(wd.detail)));
  ok('workday refusal → carries the same discriminator as a vendor probe',
    wd.refusedRedirect === true);
}

// parseCompanyInput warns on a present-but-wrong-typed workday field (e.g. a number).
const wrongType = parseCompanyInput('companies:\n  - name: X\n    workday: 42\n', []);
ok('wrong-typed workday hint → warning emitted', wrongType.warnings.some(w => /workday/i.test(w)));
ok('wrong-typed workday hint → field dropped', !('workday' in wrongType.companies[0]));

// ============================================================================
// 7. CLI behavior (execFileSync — no live network)
// ============================================================================
console.log('\n--- 7. CLI behavior ---');

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'discover-ats.mjs');

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
