// tests/scan-ats-full-dedup-key.test.mjs — dedupTokenFor() (#3439). A Workday
// tenant can publish one requisition under several sites (careers page, Indeed
// feed, Glassdoor feed, ...): same tenant/instance host, different `site` path
// segment, so normalizeUrlForDedup's per-URL comparison never recognizes them
// as the same posting and the requisition is queued 2-3 times. dedupTokenFor
// prefers a provider's own dedupKey(job) when one is derivable and falls back
// to the pre-#3439 URL-normalization behavior otherwise.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — dedupTokenFor (#3439)');

const mod = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { dedupTokenFor, SOURCES, providerForSource } = mod;
const workdayModule = await import(pathToFileURL(join(ROOT, 'providers/workday.mjs')).href);

const workdaySiteA = { url: 'https://acme.wd5.myworkdayjobs.com/External/job/Remote/Staff-Engineer_JR00123' };
const workdaySiteB = { url: 'https://acme.wd5.myworkdayjobs.com/Careers/job/Remote/Staff-Engineer_JR00123' };
const workdayOtherTenant = { url: 'https://other.wd5.myworkdayjobs.com/External/job/Remote/Staff-Engineer_JR00123' };

// The bug, reproduced directly: URL normalization alone treats the two sites
// as different postings.
{
  const { normalizeUrlForDedup } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  if (normalizeUrlForDedup(workdaySiteA.url) !== normalizeUrlForDedup(workdaySiteB.url)) {
    pass('reproduces the bug: normalizeUrlForDedup alone does NOT collapse the two sites');
  } else {
    fail('fixture no longer reproduces the bug — normalizeUrlForDedup unexpectedly collapsed the two sites');
  }
}

// The fix: dedupTokenFor(), given the workday provider, collapses them.
{
  const tokenA = dedupTokenFor(workdaySiteA, workdayModule.default);
  const tokenB = dedupTokenFor(workdaySiteB, workdayModule.default);
  if (tokenA && tokenA === tokenB) {
    pass('dedupTokenFor() collapses the same requisition across two Workday sites');
  } else {
    fail(`dedupTokenFor() did not collapse: ${JSON.stringify({ tokenA, tokenB })}`);
  }
}

// Tenant scoping survives through dedupTokenFor, not just workdayDedupKey directly.
{
  const tokenA = dedupTokenFor(workdaySiteA, workdayModule.default);
  const tokenOther = dedupTokenFor(workdayOtherTenant, workdayModule.default);
  if (tokenA !== tokenOther) {
    pass('dedupTokenFor() keeps different Workday tenants distinct');
  } else {
    fail('dedupTokenFor() incorrectly collapsed two different tenants');
  }
}

// A provider with no dedupKey (e.g. greenhouse) falls back to URL normalization,
// unchanged from before #3439.
{
  const greenhouseModule = await import(pathToFileURL(join(ROOT, 'providers/greenhouse.mjs')).href);
  const { normalizeUrlForDedup } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const job = { url: 'https://boards.greenhouse.io/acme/jobs/12345?gh_src=abc' };
  const token = dedupTokenFor(job, greenhouseModule.default);
  if (token === normalizeUrlForDedup(job.url)) {
    pass('dedupTokenFor() falls back to normalizeUrlForDedup for a provider with no dedupKey');
  } else {
    fail(`dedupTokenFor() fallback mismatch: ${JSON.stringify({ token, expected: normalizeUrlForDedup(job.url) })}`);
  }
}

// No provider at all (e.g. a seed-pass job whose SOURCES lookup misses) — must
// not throw, must fall back to URL normalization.
{
  const { normalizeUrlForDedup } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
  const job = { url: 'https://jobs.lever.co/acme/abc-123?lever-source=Indeed' };
  let token;
  try {
    token = dedupTokenFor(job, undefined);
  } catch (err) {
    fail(`dedupTokenFor() threw with no provider: ${err.message}`);
  }
  if (token === normalizeUrlForDedup(job.url)) {
    pass('dedupTokenFor() with no provider falls back to normalizeUrlForDedup without throwing');
  } else {
    fail(`dedupTokenFor() with no provider returned ${JSON.stringify(token)}`);
  }
}

// SOURCES.workday.provider is wired to the module that owns dedupKey — the
// checkpoint-resume reseed derives its provider from SOURCES by source name,
// so a stale/mismatched registration would silently reopen the resume-time gap.
if (SOURCES.workday.provider === workdayModule.default) {
  pass('SOURCES.workday.provider is the same module workdayDedupKey lives on');
} else {
  fail('SOURCES.workday.provider does not match providers/workday.mjs\'s default export');
}

// A historical (already-recorded) Workday offer must dedupe against a FRESH
// job for the same requisition served under a different site — not just two
// offers discovered in the same run. Without loadSeenUrls' extraTokensFor
// hook, a requisition first seen last run under site A's URL would look
// "new" again the moment site B is the only one still listing it, since
// scan-history.tsv records the URL it was first seen on and
// normalizeUrlForDedup never equates two different sites' URLs.
{
  const { collectSeenUrls } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  // A legacy scan-history.tsv row: this requisition was recorded under
  // site A ("External") on a previous run, tagged with the portal/source
  // scan-ats-full.mjs actually writes (offer.source, "{ats}-full").
  const scanHistoryText = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
    `${workdaySiteA.url}\t2020-01-01\tworkday-full\tStaff Engineer\tAcme\tadded\tRemote`,
    '',
  ].join('\n');

  const { seen } = collectSeenUrls({ scanHistoryText }, {}, {
    extraTokensFor: (url, portal) => providerForSource(portal)?.dedupKey?.({ url }),
  });

  // Site B publishes the same requisition on THIS run.
  const freshToken = dedupTokenFor(workdaySiteB, workdayModule.default);
  if (seen.has(freshToken)) {
    pass('a legacy Workday history row dedupes a fresh same-requisition offer from a different site');
  } else {
    fail(`legacy history row did not cover the fresh cross-site token: ${JSON.stringify({ seen: [...seen], freshToken })}`);
  }
}

// providerForSource resolves both the "-full" main-sweep suffix and a bare
// SOURCES key, and returns undefined (not throw) for a seed offer's
// "{seedId}-seed" source, which SOURCES intentionally has no entry for.
{
  if (providerForSource('workday-full') === workdayModule.default) {
    pass('providerForSource resolves the "-full" suffix to the registered provider');
  } else {
    fail('providerForSource did not resolve "workday-full" to providers/workday.mjs');
  }
  if (providerForSource('some-seed-id-seed') === undefined) {
    pass('providerForSource returns undefined for a seed-pass source, not a throw');
  } else {
    fail('providerForSource unexpectedly resolved a seed-pass source to a provider');
  }
}
