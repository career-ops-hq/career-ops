// A plugin that caches the JD (apify with field_map.description) hands the
// scanner `url: local:jds/<file>.md` plus the posting link in `_remote_url`.
// Those offers must still reach pipeline.md and scan-history.tsv (#7740), while
// every other non-http(s) url stays refused.
//
// Run:  node --test tests/scan-local-jd-offers.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendToPipeline, appendToScanHistory, collectSeenCompanyRoles, collectSeenUrls, isOfferSeen, matchesSeenCompanyRole, companyRoleDedupKey, verifyOffers, requisitionIdsForDedup, unrecordedOffers } from '../scan.mjs';

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

test('--verify checks the posting url of a cached-JD offer, not the local reference', async () => {
  const seen = [];
  const active = { result: 'active', code: 'api_ok', reason: 'live' };
  const result = await verifyOffers([offer()], {}, { checkApi: async (url) => { seen.push(url); return active; } });
  assert.deepEqual(seen, [REMOTE]);
  assert.equal(result.invalid.length, 0);
  assert.equal(result.verified.length, 1);
  // The offer keeps its local reference for the pipeline row.
  assert.equal(result.verified[0].url, offer().url);
});

test('--verify still rejects a cached-JD offer with no safe posting url, without a history row', async () => {
  const f = fixture();
  try {
    const bad = offer({ _remote_url: 'javascript:alert(1)' });
    const result = await verifyOffers([bad], {}, { checkApi: async () => assert.fail('must not be checked') });
    assert.equal(result.invalid.length, 1);
    assert.equal(await appendToScanHistory(result.invalid, '2026-11-26', 'skipped_invalid_url', { historyPath: f.scanHistoryPath, historyPolicy: f.historyPolicy }), 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a pending cached-JD row resolves to its posting, so another requisition is not held back', () => {
  const history = `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\trequisition_id\n${REMOTE}\t2026-11-26\tapify\tCommodity Manager\tClarios\tadded\tREQ-100\n`;
  const row = '- [ ] local:jds/clarios-commodity-manager-9d93f8d630.md | Clarios | Commodity Manager\n';
  const decide = (resolveLocalRef) => {
    const reqs = new Map(); const located = new Map();
    const seenRoles = collectSeenCompanyRoles({ scanHistoryText: history, pipelineText: row, applicationsText: '' }, { recheckAfterDays: null }, undefined,
      { requisitionsByBase: reqs, locatedRequisitionsByBase: located, resolveLocalRef });
    const key = companyRoleDedupKey('Clarios', 'Commodity Manager');
    const other = requisitionIdsForDedup({ url: 'https://example.com/j/2', requisitionId: 'REQ-200' });
    return matchesSeenCompanyRole({ key, baseKey: key, seen: seenRoles, requisitions: reqs, locatedRequisitions: located }, other);
  };
  assert.equal(decide(null), true, 'unresolved row stays conservative');
  assert.equal(decide((ref) => (ref.startsWith('local:jds/') ? REMOTE : null)), false);
});

test('the same posting cached under two filenames writes one observational history row across scans', async () => {
  const f = fixture();
  try {
    writeFileSync(f.scanHistoryPath, '');
    const second = offer({ url: 'local:jds/clarios-commodity-manager-other0000.md' });
    for (let scan = 0; scan < 2; scan++) {
      const fresh = unrecordedOffers([offer(), second], 'skipped_title', readFileSync(f.scanHistoryPath, 'utf8'));
      await appendToScanHistory(fresh, '2026-11-26', 'skipped_title', { historyPath: f.scanHistoryPath, historyPolicy: f.historyPolicy });
    }
    const rows = readFileSync(f.scanHistoryPath, 'utf8').split('\n').filter((line) => line.includes('skipped_title'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].split('\t')[0], REMOTE);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a verified cached-JD offer reaches the pipeline once, and one the guard rejects writes nothing', async () => {
  const f = fixture();
  try {
    const active = { result: 'active', code: 'api_ok', reason: 'live' };
    const unsafe = offer({ url: 'local:jds/clarios-unsafe-0000000000.md', _remote_url: 'file:///etc/passwd' });
    const result = await verifyOffers([offer(), unsafe], {}, { checkApi: async () => active });
    assert.deepEqual([result.verified.length, result.invalid.length], [1, 1]);
    await appendToPipeline(result.verified, f);
    await appendToScanHistory(result.verified, '2026-11-26', 'added', { historyPath: f.scanHistoryPath, historyPolicy: f.historyPolicy });
    await appendToScanHistory(result.invalid, '2026-11-26', 'skipped_invalid_url', { historyPath: f.scanHistoryPath, historyPolicy: f.historyPolicy });
    const history = readFileSync(f.scanHistoryPath, 'utf8');
    assert.ok(!history.includes('skipped_invalid_url'));
    assert.ok(!history.includes('file:'));
    assert.equal((readFileSync(f.pipelinePath, 'utf8').match(/- \[ \] local:jds\//g) ?? []).length, 1);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('an unwritable history does not lose the cached-JD pipeline row', async () => {
  const f = fixture();
  try {
    mkdirSync(f.scanHistoryPath);
    await appendToPipeline([offer()], f);
    assert.match(readFileSync(f.pipelinePath, 'utf8'), /- \[ \] local:jds\/clarios-commodity-manager-9d93f8d630\.md/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a cached JD whose frontmatter has no safe posting url stays unresolved, never trusted', () => {
  const root = mkdtempSync(join(tmpdir(), 'local-jd-root-'));
  try {
    mkdirSync(join(root, 'data')); mkdirSync(join(root, 'jds'));
    const body = (front) => `---\n${front}\n---\n\nbody\n`;
    writeFileSync(join(root, 'jds', 'ok-0000000001.md'), body(`url: ${REMOTE}`));
    writeFileSync(join(root, 'jds', 'nourl-0000000002.md'), body('title: x'));
    writeFileSync(join(root, 'jds', 'unsafe-0000000003.md'), body('url: javascript:alert(1)'));
    writeFileSync(join(root, 'jds', 'nofront-0000000004.md'), 'no frontmatter at all\n');
    writeFileSync(join(root, 'data', 'scan-history.tsv'), `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n${REMOTE}\t2026-11-26\tapify\tCommodity Manager\tClarios\tadded\n`);
    const seeds = (name) => {
      writeFileSync(join(root, 'data', 'pipeline.md'), `# Pipeline\n\n## Pending\n\n- [ ] local:jds/${name} | Clarios | Commodity Manager\n`);
      const script = "import('" + join(process.cwd(), 'scan.mjs') + "').then((m) => { const s = m.loadDedupSnapshot({ recheckAfterDays: null }); console.log(JSON.stringify([...(s.seenCompanyRoleRequisitions.get(m.companyRoleDedupKey('Clarios', 'Commodity Manager')) ?? [])])); });";
      return JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, CAREER_OPS_ROOT: root }, encoding: 'utf8' }).trim().split('\n').pop());
    };
    assert.ok(!seeds('ok-0000000001.md').includes('?'));
    for (const name of ['nourl-0000000002.md', 'unsafe-0000000003.md', 'nofront-0000000004.md', 'absent-0000000005.md']) {
      assert.ok(seeds(name).includes('?'), name);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the same posting cached under another filename is not queued a second time', async () => {
  const f = fixture();
  try {
    const resolveLocalRef = (ref) => (ref.startsWith('local:jds/') ? REMOTE : null);
    const other = offer({ url: 'local:jds/clarios-commodity-manager-other0000.md' });
    await appendToPipeline([offer()], { ...f, resolveLocalRef });
    await appendToPipeline([other], { ...f, resolveLocalRef });
    assert.equal((readFileSync(f.pipelinePath, 'utf8').match(/- \[ \] local:jds\//g) ?? []).length, 1);
    // A different posting is still queued.
    const different = offer({ url: 'local:jds/clarios-planner-1111111111.md', title: 'Planner', _remote_url: 'https://mx.linkedin.com/jobs/view/planner-1' });
    await appendToPipeline([different], { ...f, resolveLocalRef: (ref) => (ref.includes('planner') ? different._remote_url : REMOTE) });
    assert.equal((readFileSync(f.pipelinePath, 'utf8').match(/- \[ \] local:jds\//g) ?? []).length, 2);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
