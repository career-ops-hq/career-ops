// tests/plugins-recheck-window.test.mjs — plugin ingest honors
// scan_history.recheck_after_days for a checked-off pipeline entry.
//
// The admission gate applies the recheck window (#5905), so a URL whose
// scan-history rows have aged out comes back through scan.mjs even when
// pipeline.md lists it checked off. plugins.mjs dropped every posting
// pipeline.md listed, checked off or not, before the gate saw it, so through
// plugin ingest such a posting never came back. It now dedups only against the
// entries the gate still holds as seen; a pending entry always is one.
//
// Pure: the seen set is built with scan.mjs's collectSeenUrls() for a fixed
// day and handed to the gate, so no user file is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitPluginJobs } from '../plugins.mjs';
import { collectSeenUrls } from '../scan.mjs';

const DONE = 'https://jobs.example.com/acme/1';
const PENDING = 'https://jobs.example.com/acme/2';
const sources = {
  scanHistoryText: [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
    `${DONE}\t2026-01-01\tplugin:demo\tPlatform Engineer\tAcme\tadded`,
    `${PENDING}\t2026-01-01\tplugin:demo\tData Engineer\tAcme\tadded`,
    '',
  ].join('\n'),
  pipelineText: `# Pipeline\n\n## Pending\n\n- [ ] ${PENDING} | Acme | Data Engineer\n\n## Processed\n\n- [x] ${DONE} | Acme | Platform Engineer\n`,
};
const found = [
  { title: 'Platform Engineer', url: DONE, company: 'Acme', location: 'Remote' },
  { title: 'Data Engineer', url: PENDING, company: 'Acme', location: 'Remote' },
];

function admit(policy) {
  const { seen } = collectSeenUrls(sources, { ...policy, today: '2026-08-01' });
  return admitPluginJobs(found.map((j) => ({ ...j })), {
    id: 'demo',
    jobPostings: true,
    pipelineUrls: new Set([DONE, PENDING]),
    gateOptions: { seen, blacklist: new Map(), titleFilter: () => true, locationFilter: () => true },
  });
}

test('a checked-off entry the recheck window released comes back through plugin ingest', () => {
  const { jobs } = admit({ recheckAfterDays: 30 });
  assert.deepEqual(jobs.map((j) => j.url), [DONE]);
  assert.equal(jobs[0].source, 'plugin:demo');
});

test('a pending entry stays out under the window, and with no window both do', () => {
  assert.ok(!admit({ recheckAfterDays: 30 }).jobs.some((j) => j.url === PENDING), 'a pending entry is never re-queued');
  assert.deepEqual(admit({}).jobs, []);
});
