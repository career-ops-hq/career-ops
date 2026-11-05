// One read of scan history feeds every dedup structure. A title skip does not
// hide the posting from a later scan, an added row does, and two spellings of
// one Greenhouse job count once. A headerless file still counts its first row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  loadDedupSnapshot,
  collectSeenUrls,
  collectSeenCompanyRoles,
  collectFingerprintHistory,
  collectPostingAttributes,
  companyRoleDedupKey,
} from '../scan.mjs';

const HEADER = [
  'url', 'first_seen', 'portal', 'title', 'company', 'status', 'location',
  'fingerprint', 'posted_at', 'trust_score', 'trust_flags', 'normalized_company',
  'requisition_id', 'language', 'listing_key',
].join('\t');

const fold = (name) => String(name ?? '').trim().toLowerCase();

function snapshotOf(historyText) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-dedup-once-'));
  const history = join(root, 'scan-history.tsv');
  const pipeline = join(root, 'pipeline.md');
  const apps = join(root, 'applications.md');
  writeFileSync(history, historyText);
  writeFileSync(pipeline, '');
  writeFileSync(apps, '');
  const started = performance.now();
  const snap = loadDedupSnapshot({}, fold, {
    scanHistoryPath: history,
    pipelinePath: pipeline,
    applicationsPath: apps,
  });
  const ms = performance.now() - started;
  rmSync(root, { recursive: true, force: true });
  return { snap, ms, historyText };
}

const FIXTURE = [
  HEADER,
  'https://boards.greenhouse.io/acme/jobs/42\t2026-01-01\tgreenhouse\tEngineer\tAcme\tadded\tRemote\taaaaaaaaaaaaaaaa\t2026-01-01\t\t\tacme\tREQ-1\ten\t',
  'https://job-boards.greenhouse.io/acme/jobs/42?gh_src=x\t2026-01-02\tgreenhouse\tEngineer\tAcme\tadded\tRemote\t\t\t\t\t\t\t\t',
  'https://jobs.example.com/skip\t2026-01-03\texample\tIntern\tAcme\tskipped_title\tRemote\tbbbbbbbbbbbbbbbb\t\t\t\t\t\t\t',
  'https://jobs.example.com/live\t2026-01-04\texample\tAnalyst\tHooli\tadded\tAustin\tcccccccccccccccc\t2026-01-04\t\t\thooli\t\tde\t',
].join('\n') + '\n';

test('one history parse matches the collectors and the dedup rules', () => {
  const { snap, historyText } = snapshotOf(FIXTURE);
  const sources = { scanHistoryText: historyText, pipelineText: '', applicationsText: '' };
  const urls = collectSeenUrls(sources, {});
  const roles = collectSeenCompanyRoles(sources, {}, fold);

  assert.equal(snap.seen.size, 2);
  assert.ok(snap.seen.has('greenhouse:42'));
  assert.ok(snap.seen.has('https://jobs.example.com/live'));
  assert.equal(snap.seen.has('https://jobs.example.com/skip'), false);
  assert.equal(snap.recheckEligible, 0);
  assert.equal(snap.seenCompanyRoles.size, 2);
  assert.ok(snap.seenCompanyRoles.has(companyRoleDedupKey('Acme', 'Engineer')));
  assert.ok(snap.seenCompanyRoles.has(companyRoleDedupKey('Hooli', 'Analyst')));
  assert.equal(snap.seenCompanyRoles.has(companyRoleDedupKey('Acme', 'Intern')), false);
  assert.deepEqual(snap.fingerprintHistory.map((row) => row.url), [
    'https://boards.greenhouse.io/acme/jobs/42',
    'https://jobs.example.com/skip',
    'https://jobs.example.com/live',
  ]);
  assert.deepEqual(collectPostingAttributes(historyText).get('greenhouse:42'), {
    requisitionId: 'REQ-1',
    language: 'en',
  });
  assert.deepEqual(collectPostingAttributes(historyText).get('https://jobs.example.com/live'), {
    language: 'de',
  });

  assert.deepEqual([...snap.seen].sort(), [...urls.seen].sort());
  assert.equal(snap.recheckEligible, urls.recheckEligible);
  assert.deepEqual([...snap.seenCompanyRoles].sort(), [...roles].sort());
  assert.deepEqual(snap.fingerprintHistory, collectFingerprintHistory(historyText));
});

test('a headerless history still counts its first row', () => {
  const text = 'https://jobs.example.com/first\t2026-02-01\texample\tFirst\tAcme\tadded\tRemote\t\t\t\t\t\t\t\t\n';
  const { snap } = snapshotOf(text);
  assert.equal(snap.seen.size, 1);
  assert.ok(snap.seen.has('https://jobs.example.com/first'));
  assert.ok(snap.seenCompanyRoles.has(companyRoleDedupKey('Acme', 'First')));
  assert.equal(snap.fingerprintHistory.length, 0);
});

test('a 20k-row history keeps one key per posting', () => {
  const lines = [HEADER];
  for (let i = 0; i < 20000; i++) {
    const id = i === 19999 ? 0 : i;
    const fingerprint = i % 2 === 0 ? 'a'.repeat(16) : '';
    lines.push([
      `https://jobs.example.com/j/${id}`,
      '2026-01-01',
      'example',
      `Role ${id}`,
      'Acme',
      'added',
      'Remote',
      fingerprint,
      '', '', '',
      'acme',
      '',
      'en',
      '',
    ].join('\t'));
  }
  const { snap, ms } = snapshotOf(lines.join('\n') + '\n');
  console.log(`loadDedupSnapshot 20k rows: ${ms.toFixed(1)} ms`);
  assert.equal(snap.seen.size, 19999);
  assert.ok(snap.seen.has('https://jobs.example.com/j/0'));
  assert.ok(snap.seen.has('https://jobs.example.com/j/19998'));
  assert.equal(snap.seenCompanyRoles.size, 19999);
  assert.equal(snap.fingerprintHistory.length, 10000);
  assert.ok(ms < 5000, `parse took ${ms.toFixed(1)} ms`);
});
