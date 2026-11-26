// A plugin that caches the JD (apify with field_map.description) hands the
// scanner `url: local:jds/<file>.md` plus the posting link in `_remote_url`.
// Those offers must still reach pipeline.md and scan-history.tsv (#7740), while
// every other non-http(s) url stays refused.
//
// Run:  node --test tests/scan-local-jd-offers.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendToPipeline, appendToScanHistory, collectSeenCompanyRoles, collectSeenUrls, isOfferSeen, matchesSeenCompanyRole, companyRoleDedupKey } from '../scan.mjs';

const REMOTE = 'https://mx.linkedin.com/jobs/view/manager-4492212791';
const offer = (over = {}) => ({
  title: 'Commodity Manager',
  company: 'Clarios',
  source: 'apify',
  url: 'local:jds/clarios-commodity-manager-9d93f8d630.md',
  _remote_url: REMOTE,
  ...over,
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'local-jd-'));
  return { dir, pipelinePath: join(dir, 'pipeline.md'), scanHistoryPath: join(dir, 'scan-history.tsv'),
    // Explicit policy: the writers otherwise read the real portals.yml, whose
    // scan_history.recheck_after_days would make these assertions date-dependent.
    historyPolicy: { recheckAfterDays: null } };
}

test('a cached-JD offer is written to the pipeline and the history', async () => {
  const f = fixture();
  try {
    await appendToPipeline([offer()], f);
    const written = await appendToScanHistory([offer()], '2026-11-26', 'added', { historyPath: f.scanHistoryPath, historyPolicy: f.historyPolicy });
    assert.equal(written, 1);
    assert.match(readFileSync(f.pipelinePath, 'utf8'), /- \[ \] local:jds\/clarios-commodity-manager-9d93f8d630\.md \| Clarios \| Commodity Manager/);
    // Compare the url column itself, by position, rather than searching the row.
    const [header, row] = readFileSync(f.scanHistoryPath, 'utf8').split('\n').map((line) => line.split('\t'));
    assert.strictEqual(row[header.indexOf('url')], REMOTE);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a second scan of the same posting adds nothing', async () => {
  const f = fixture();
  try {
    await appendToPipeline([offer()], f);
    await appendToScanHistory([offer()], '2026-11-26', 'added', { historyPath: f.scanHistoryPath, historyPolicy: f.historyPolicy });
    const before = readFileSync(f.pipelinePath, 'utf8');
    await appendToPipeline([offer()], f);
    assert.equal(readFileSync(f.pipelinePath, 'utf8'), before);
    assert.equal(await appendToScanHistory([offer()], '2026-11-26', 'added', { historyPath: f.scanHistoryPath, historyPolicy: f.historyPolicy }), 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('other non-http(s) urls are still refused', async () => {
  const f = fixture();
  try {
    const bad = [
      offer({ url: 'local:../../etc/passwd.md' }),
      offer({ url: 'local:jds/x.md', _remote_url: 'javascript:alert(1)' }),
      offer({ url: 'local:jds/x.md', _remote_url: undefined }),
      offer({ url: 'javascript:alert(1)', _remote_url: REMOTE }),
    ];
    await appendToPipeline(bad, f);
    const written = await appendToScanHistory(bad, '2026-11-26', 'added', { historyPath: f.scanHistoryPath, historyPolicy: f.historyPolicy });
    assert.equal(written, 0);
    let text = '';
    try { text = readFileSync(f.pipelinePath, 'utf8'); } catch {}
    assert.doesNotMatch(text, /local:|javascript:/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('two cached files for the same posting link write one row, whatever the query, fragment or host case', async () => {
  const f = fixture();
  try {
    const a = offer({ url: 'local:jds/a-1111111111.md', _remote_url: 'https://mx.linkedin.com/jobs/view/manager-4492212791?trk=x#top' });
    const b = offer({ url: 'local:jds/a-2222222222.md', _remote_url: 'https://MX.LinkedIn.com/jobs/view/manager-4492212791' });
    await appendToPipeline([a, b], f);
    const rows = readFileSync(f.pipelinePath, 'utf8').split('\n').filter(l => l.startsWith('- [ ] '));
    assert.equal(rows.length, 1);
    assert.equal(await appendToScanHistory([a, b], '2026-11-26', 'added', { historyPath: f.scanHistoryPath, historyPolicy: f.historyPolicy }), 1);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('an aged history row releases the posting, so a cached-JD offer is recorded again', async () => {
  const f = fixture();
  try {
    const policy = { recheckAfterDays: 30, today: '2026-11-26' };
    await appendToScanHistory([offer()], '2026-01-01', 'added', { historyPath: f.scanHistoryPath, historyPolicy: policy });
    await appendToPipeline([offer()], { ...f, historyPolicy: policy });
    assert.match(readFileSync(f.pipelinePath, 'utf8'), /local:jds\/clarios-commodity-manager-9d93f8d630\.md/);
    const young = fixture();
    try {
      await appendToScanHistory([offer()], '2026-11-20', 'added', { historyPath: young.scanHistoryPath, historyPolicy: policy });
      assert.equal(await appendToScanHistory([offer()], '2026-11-26', 'added', { historyPath: young.scanHistoryPath, historyPolicy: policy }), 0);
    } finally { rmSync(young.dir, { recursive: true, force: true }); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a finished row under ## Processed is re-queued once history releases the posting, like an http row', async () => {
  const f = fixture();
  try {
    const policy = { recheckAfterDays: 7, today: '2026-11-26' };
    await appendToScanHistory([offer()], '2026-01-01', 'added', { historyPath: f.scanHistoryPath, historyPolicy: { recheckAfterDays: null } });
    const row = '- [ ] local:jds/clarios-commodity-manager-9d93f8d630.md | Clarios | Commodity Manager';
    writeFileSync(f.pipelinePath, `# Pipeline\n\n## Pending\n\n## Processed\n\n${row}\n`);
    await appendToPipeline([offer()], { ...f, historyPolicy: policy });
    assert.equal((readFileSync(f.pipelinePath, 'utf8').match(/- \[ \] local:jds\//g) ?? []).length, 2);
    // Inside the recheck window the processed row still pins the offer.
    writeFileSync(f.pipelinePath, `# Pipeline\n\n## Pending\n\n## Processed\n\n${row}\n`);
    await appendToPipeline([offer()], { ...f, historyPolicy: { recheckAfterDays: 7, today: '2026-01-03' } });
    assert.equal((readFileSync(f.pipelinePath, 'utf8').match(/- \[ \] local:jds\//g) ?? []).length, 1);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('the seen gate matches a cached-JD offer against the history row of its posting', () => {
  const history = `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n${REMOTE}\t2026-11-26\tapify\tCommodity Manager\tClarios\tadded\n`;
  const { seen } = collectSeenUrls({ scanHistoryText: history, pipelineText: '', applicationsText: '' }, { recheckAfterDays: null });
  assert.equal(isOfferSeen({ url: REMOTE, title: 'x', company: 'y' }, seen), true);
  assert.equal(isOfferSeen(offer(), seen), true);
  // An unsafe local reference still has no posting identity.
  assert.equal(isOfferSeen(offer({ url: 'local:../x.md' }), seen), false);
});

test('a struck-through finished row still pins its local reference', async () => {
  const f = fixture();
  try {
    const row = '## Processed\n\n- [ ] ~~local:jds/clarios-commodity-manager-9d93f8d630.md | Clarios | Commodity Manager~~\n';
    writeFileSync(f.pipelinePath, row);
    await appendToPipeline([offer()], f);
    assert.equal(readFileSync(f.pipelinePath, 'utf8'), row);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a pending cached-JD row holds back the same role from another cached file', async () => {
  const f = fixture();
  try {
    await appendToPipeline([offer()], f);
    const seen = collectSeenCompanyRoles({ pipelineText: readFileSync(f.pipelinePath, 'utf8') });
    const key = companyRoleDedupKey('Clarios', 'Commodity Manager');
    assert.equal(matchesSeenCompanyRole({ key, baseKey: key, seen, requisitions: new Map(), locatedRequisitions: new Map() }, null), true);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
