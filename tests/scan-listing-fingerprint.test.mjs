// scan.mjs — strong ATS identity participates in scan dedup across URL aliases.
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { computeListingFingerprint } from '../listing-fingerprint.mjs';
import { isOfferSeen, loadDedupSnapshot, markOfferSeen, formatScanHistoryRow } from '../scan.mjs';

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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} catch (error) {
  fail(`listing fingerprint scan dedup test crashed: ${error?.stack || error}`);
}
