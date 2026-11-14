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
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectSeenUrls, appendToPipeline } from '../scan.mjs';

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

// The gate decides what plugin ingest admits; appendToPipeline then re-checks
// pipeline.md and scan-history under the pipeline lock and drops what it still
// holds as seen. Each case below runs both on the same files and expects them
// to agree, so an entry the gate lets back in is actually written.
const DAY = '2026-08-01';
const POLICY = { recheckAfterDays: 30 };
const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';

async function gateAndWriter(historyRows) {
  const dir = mkdtempSync(join(tmpdir(), 'plugins-recheck-'));
  try {
    const pipelinePath = join(dir, 'pipeline.md');
    const scanHistoryPath = join(dir, 'scan-history.tsv');
    const pipelineText = `# Pipeline\n\n## Pending\n\n## Processed\n\n- [x] ${DONE} | Acme | Platform Engineer\n`;
    const scanHistoryText = [HEADER, ...historyRows, ''].join('\n');
    writeFileSync(pipelinePath, pipelineText);
    writeFileSync(scanHistoryPath, scanHistoryText);
    const { seen } = collectSeenUrls({ scanHistoryText, pipelineText }, { ...POLICY, today: DAY });
    const job = { title: 'Platform Engineer', url: DONE, company: 'Acme', location: 'Remote' };
    const { jobs } = admitPluginJobs([{ ...job }], {
      id: 'demo',
      jobPostings: true,
      pipelineUrls: new Set([DONE]),
      gateOptions: { seen, blacklist: new Map(), titleFilter: () => true, locationFilter: () => true },
    });
    // The writer is handed the posting whatever the gate said, to read its own verdict.
    await appendToPipeline([job], { pipelinePath, scanHistoryPath, historyPolicy: { ...POLICY, today: DAY } });
    const written = readFileSync(pipelinePath, 'utf-8').split('\n').filter((l) => l.includes(DONE)).length > 1;
    return { admitted: jobs.length === 1, written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the locked write keeps an entry the window released', async () => {
  const r = await gateAndWriter([`${DONE}\t2026-01-01\tplugin:demo\tPlatform Engineer\tAcme\tadded`]);
  assert.deepEqual(r, { admitted: true, written: true });
});

test('a recent repeat sighting of a released entry goes with its original in the locked write too', async () => {
  const r = await gateAndWriter([
    `${DONE}\t2026-01-01\tplugin:demo\tPlatform Engineer\tAcme\tadded`,
    `${DONE}\t2026-07-30\tplugin:demo\tPlatform Engineer\tAcme\tskipped_dup`,
  ]);
  assert.deepEqual(r, { admitted: true, written: true });
});

test('an aged repeat sighting with no original keeps a checked-off entry out of both', async () => {
  const r = await gateAndWriter([`${DONE}\t2026-01-01\tplugin:demo\tPlatform Engineer\tAcme\tskipped_dup`]);
  assert.deepEqual(r, { admitted: false, written: false });
});
