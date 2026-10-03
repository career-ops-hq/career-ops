// scan.mjs — strong ATS identity participates in scan dedup across URL aliases.
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { computeListingFingerprint } from '../listing-fingerprint.mjs';
import { isOfferSeen, loadDedupSnapshot, markOfferSeen, formatScanHistoryRow, collectSeenUrls, retainVerifiedListingIdentities } from '../scan.mjs';

console.log('\nscan.mjs — listing fingerprint participates in scan dedup');

const identity = { ats_provider: 'greenhouse', board_slug: 'acme', posting_id: '4012345' };
const first = {
  url: 'https://boards.greenhouse.io/acme/jobs/4012345',
  source: 'greenhouse-api',
  title: 'Staff Engineer',
  company: 'Acme',
  listingIdentity: identity,
};
const alias = {
  ...first,
  url: 'https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=career-site',
};
const expectedKey = computeListingFingerprint({ strong: identity }).listing_key;

try {
  const seen = new Set();
  const rows = [];
  for (const offer of [first, alias]) {
    if (isOfferSeen(offer, seen)) continue;
    markOfferSeen(offer, seen);
    rows.push(formatScanHistoryRow(offer, '2026-10-03'));
  }

  if (rows.length === 1) pass('two URLs for one ATS posting produce one accepted row in a scan');
  else fail(`two URL aliases produced ${rows.length} rows (expected 1)`);
  if (rows[0]?.split('\t').at(-1) === expectedKey) pass('the accepted scan-history row persists the strong listing_key');
  else fail(`scan-history listing_key was ${JSON.stringify(rows[0]?.split('\t').at(-1))}`);

  const root = mkdtempSync(join(tmpdir(), 'co-listing-fingerprint-'));
  try {
    const historyPath = join(root, 'scan-history.tsv');
    const pipelinePath = join(root, 'pipeline.md');
    const applicationsPath = join(root, 'applications.md');
    writeFileSync(historyPath,
      'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company\tlisting_key\n'
      + `${rows[0]}\n`);
    writeFileSync(pipelinePath, '# Pipeline\n\n## Pending\n\n## Processed\n');
    writeFileSync(applicationsPath, '');
    const snapshot = loadDedupSnapshot({}, undefined, {
      scanHistoryPath: historyPath,
      pipelinePath,
      applicationsPath,
    });
  if (isOfferSeen(alias, snapshot.seen)) pass('a later scan loads the persisted listing_key and skips the URL alias');
  else fail('a later scan did not load the persisted listing_key');

    // A recheck TTL releases an old added row only when its pipeline item is
    // complete. An actionable item still pins both its URL and listing key.
    const staleUrl = 'https://boards.greenhouse.io/acme/jobs/4012345';
    const staleHistory = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company\tlisting_key\n'
      + `${staleUrl}\t2026-08-01\tgreenhouse\tStaff Engineer\tAcme\tadded\tRemote\t\t\t\t\tacme\t${expectedKey}\n`;
    const pendingPipeline = `# Pipeline\n\n## Pending\n- [ ] ${staleUrl}\n\n## Processed\n`;
    const staleSources = collectSeenUrls({ scanHistoryText: staleHistory, pipelineText: pendingPipeline },
      { recheckAfterDays: 1, today: '2026-10-03' },
      { extraTokensFor: (_url, _portal, key) => key ? `listing:${key}` : null });
    if (staleSources.seen.has(`listing:${expectedKey}`) && isOfferSeen(alias, staleSources.seen)) {
      pass('an actionable pipeline URL retains its aged listing identity across URL aliases');
    } else fail('an actionable aged pipeline row released its listing identity');

    // A previously accepted URL without a stored key teaches the current scan
    // the provider identity, so later aliases from that scan are suppressed.
    const acceptedUrl = 'https://boards.greenhouse.io/acme/jobs/4012345';
    const accepted = collectSeenUrls({
      scanHistoryText: `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n${acceptedUrl}\t2026-10-03\tgreenhouse\tStaff Engineer\tAcme\tadded\n`,
    });
    const hasHistoryIdentity = isOfferSeen(first, accepted.seen, accepted.identityPromotableUrls);
    if (hasHistoryIdentity && isOfferSeen(alias, accepted.seen)) {
      pass('a match to an accepted historical URL promotes current identity for later aliases');
    } else fail('a historical URL match did not promote the current listing identity');

    const reusedIdentity = { ...identity, posting_id: '4012346' };
    const reusedUrlOffer = { ...first, listingIdentity: reusedIdentity, listingKey: '' };
    const storedIdentity = new Map([[acceptedUrl, new Set([expectedKey])]]);
    const reusedUrlSeen = new Set(accepted.seen);
    if (isOfferSeen(reusedUrlOffer, reusedUrlSeen, storedIdentity)
        && !reusedUrlSeen.has(`listing:${computeListingFingerprint({ strong: reusedIdentity }).listing_key}`)) {
      pass('a reused historical URL does not promote a different stored listing identity');
    } else fail('a reused URL promoted an identity that disagrees with its accepted history row');

    // URL-specific failures still pin only that URL and cannot promote an ATS
    // key onto aliases.
    const blocked = collectSeenUrls({
      scanHistoryText: `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company\tlisting_key\n${acceptedUrl}\t2026-10-03\tgreenhouse\tStaff Engineer\tAcme\tskipped_blocked_host\tRemote\t\t\t\t\tacme\t${expectedKey}\n`,
    }, {}, { extraTokensFor: (_url, _portal, key) => key ? `listing:${key}` : null });
    if (blocked.seen.has(acceptedUrl) && !blocked.seen.has(`listing:${expectedKey}`)
        && !isOfferSeen(alias, blocked.seen, blocked.identityPromotableUrls)) {
      pass('URL-specific history failures do not promote listing identity to aliases');
  } else fail('a URL-specific history failure promoted its listing identity');

    // Verification mode pins URLs during collection but delays identity tokens
    // until the verifier returns live offers. A rejected alias therefore leaves
    // a following URL free to be retained after it verifies successfully.
    const verifySeen = new Set();
    markOfferSeen(first, verifySeen, { includeIdentity: false });
    if (!isOfferSeen(alias, verifySeen)) {
      const live = retainVerifiedListingIdentities([alias], verifySeen);
      if (live.length === 1 && verifySeen.has(`listing:${expectedKey}`)) {
        pass('verification retains identity only after a live alias is accepted');
  } else fail('a verified live alias did not retain its identity token');
    } else fail('a rejected URL claimed the identity before verification');

    const uncertainAlias = { ...first, url: 'https://jobs.example.test/uncertain', listingKey: '' };
    const activeAlias = { ...first, url: 'https://jobs.example.test/active', listingKey: '' };
    const verificationStates = new Map([[uncertainAlias, 'uncertain'], [activeAlias, 'active']]);
    const verified = retainVerifiedListingIdentities([uncertainAlias, activeAlias], new Set(), verificationStates);
    if (verified.length === 1 && verified[0] === activeAlias) {
      pass('an active alias wins over a transiently uncertain alias regardless of fetch order');
    } else fail('a transiently uncertain alias took precedence over an active alias');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} catch (error) {
  fail(`listing fingerprint scan dedup test crashed: ${error?.stack || error}`);
}
