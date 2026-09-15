// Verifies one SQLite-backed opportunity lifecycle without legacy workflow files.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openOpportunityStore } from '../src/opportunities/store.mjs';
import { ingestScanOffers } from '../src/discovery/ingest.mjs';
import { loadDatabaseDedupSnapshot } from '../scan.mjs';
import { companyRoleDedupKey } from '../scan.mjs';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync(join(tmpdir(), 'career-ops-opportunity-'));
try {
  const store = await openOpportunityStore(join(directory, 'career-ops.db'));
  await ingestScanOffers(join(directory, 'career-ops.db'), [{ url: 'https://jobs.example.com/scanned', company: 'Scanned', title: 'Engineer', source: 'ashby' }]);
  assert.equal(store.claimNext('scanner-check').url, 'https://jobs.example.com/scanned');
  const first = store.ingest({ url: 'https://jobs.example.com/42', company: 'Example', role: 'AI Engineer', source: 'greenhouse', payload: { id: 42, description: 'Job evidence', fingerprint: 'fingerprint-42' } });
  assert.equal(store.ingest({ url: first.url, company: 'Changed', role: 'Changed', source: 'greenhouse', payload: {} }).id, first.id);
  assert.equal(store.fingerprintHistory()[0].fingerprint, 'fingerprint-42');
  store.recordScanRun('configured', { found: 1 }, [{ timestamp: '2026-09-15T00:00:00Z', company: 'Example', status: 'reachable' }]);
  assert.equal(store.healthRecords()[0].status, 'reachable');
  assert.equal(store.claim(first.id, 'worker-a'), true);
  assert.equal(store.claim(first.id, 'worker-b'), false);
  assert.equal(store.resume('worker-a').id, first.id);
  assert.throws(() => store.recordEvaluation(first.id, { lower: 4.2, upper: 4.6, coverage: 1, reportHash: 'abc' }), /must be eligible/);
  store.recordEligibility(first.id, { status: 'pass', evidence: { location: 'Shanghai' } });
  store.recordEvaluation(first.id, { lower: 4.2, upper: 4.6, coverage: 1, reportHash: 'abc' });
  store.recordArtifact(first.id, { kind: 'report', path: 'reports/example.md', sha256: 'abc' });
  assert.equal(store.startApplication(first.id).applicationState, 'preparing');
  assert.throws(() => store.confirmSubmitted(first.id, 'yes'), /explicit confirmation/);
  assert.throws(() => store.recordApplicationArtifact(first.id, { kind: 'verified-application-pdf', path: 'output/example.pdf', sha256: 'pdf' }), /recordVerifiedApplicationPdf/);
  store.recordApplicationArtifact(first.id, { kind: 'application-pdf', path: 'output/example.pdf', sha256: 'pdf' });
  assert.throws(() => store.recordVerifiedApplicationPdf(first.id, { path: 'output/other.pdf', sha256: 'pdf' }), /must match/);
  store.recordVerifiedApplicationPdf(first.id, { path: 'output/example.pdf', sha256: 'pdf' });
  store.recordApplicationArtifact(first.id, { kind: 'application-pdf', path: 'output/example.pdf', sha256: 'new-pdf' });
  assert.throws(() => store.confirmSubmitted(first.id, 'submitted'), /current verified/);
  store.recordVerifiedApplicationPdf(first.id, { path: 'output/example.pdf', sha256: 'new-pdf' });
  assert.equal(store.confirmSubmitted(first.id, 'submitted').applicationState, 'submitted');
  store.saveCheckpoint(first.id, 'research', 'input-hash', 'output-hash');
  assert.equal(store.checkpoint(first.id, 'research').output_hash, 'output-hash');
  assert.equal(store.claimDelivery(first.id, 'discord', 'abc'), true);
  assert.equal(store.releaseDelivery(first.id, 'discord', 'abc'), true);
  assert.equal(store.claimDelivery(first.id, 'discord', 'abc'), true);
  assert.equal(store.completeDelivery(first.id, 'discord', 'abc'), true);
  assert.equal(store.claimDelivery(first.id, 'discord', 'abc'), false);
  assert.deepEqual(store.shortlist().map(row => row.id), [first.id]);
  const uncertain = store.ingest({ url: 'https://jobs.example.com/unknown', company: 'Example', role: 'Unknown', source: 'greenhouse', payload: {} });
  assert.equal(store.claim(uncertain.id, 'worker-a'), true);
  store.recordEligibility(uncertain.id, { status: 'unknown', evidence: {} });
  store.recordEvaluation(uncertain.id, { lower: 3, upper: 3, coverage: 1, reportHash: 'unknown' });
  assert.throws(() => store.startApplication(uncertain.id), /unstarted shortlist/);
  const rejected = store.ingest({ url: 'https://jobs.example.com/43', company: 'Example', role: 'Other', source: 'greenhouse', payload: {} });
  assert.equal(store.claimNext('worker-a').id, rejected.id);
  store.recordEligibility(rejected.id, { status: 'fail', evidence: { employment: 'contractor' } });
  assert.throws(() => store.startApplication(rejected.id), /unstarted shortlist/);
  assert.deepEqual(store.shortlist().map(row => row.id), [first.id]);
  assert.throws(() => store.recordEligibility(rejected.id, { status: 'pass', evidence: {} }), /must be evaluating/);
  const stalled = store.ingest({ url: 'https://jobs.example.com/44', company: 'Example', role: 'Stalled', source: 'greenhouse', payload: {} });
  assert.equal(store.claim(stalled.id, 'worker-c'), true);
  assert.equal(store.resume('worker-c').id, stalled.id);
  const next = store.ingest({ url: 'https://jobs.example.com/45', company: 'Example', role: 'Next', source: 'greenhouse', payload: {} });
  assert.equal(store.resume('worker-c'), null);
  assert.equal(store.claimNext('worker-c').id, next.id);
  store.recordScanOutcomes([{ url: 'https://jobs.example.com/expired', status: 'skipped_expired' }]);
  assert.ok(store.urls().includes('https://jobs.example.com/expired'));
  const recheckable = store.ingest({ url: 'https://jobs.example.com/46', company: 'Example', role: 'Recheck', source: 'greenhouse', payload: {} });
  const recheck = await loadDatabaseDedupSnapshot(join(directory, 'career-ops.db'), { recheckAfterDays: 0, today: '2099-01-01' });
  assert.equal(recheck.seen.has(first.url), true);
  assert.equal(recheck.seen.has(recheckable.url), false);
  assert.equal(recheck.seen.has('https://jobs.example.com/expired'), true);
  assert.ok(recheck.seenCompanyRoles.has(companyRoleDedupKey('Example', 'AI Engineer')));
  assert.ok(store.events(first.id).some(event => event.type === 'evaluation_recorded'));
  store.close();
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const legacyDirectory = mkdtempSync(join(tmpdir(), 'career-ops-opportunity-legacy-'));
try {
  const databasePath = join(legacyDirectory, 'career-ops.db');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec("CREATE TABLE opportunities (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, company TEXT NOT NULL, role TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered', claimed_by TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);");
  legacy.prepare("INSERT INTO opportunities (url, company, role, source) VALUES (?, ?, ?, ?)").run('https://jobs.example.com/old-1', 'Acme', 'Engineer', 'legacy');
  legacy.prepare("INSERT INTO opportunities (url, company, role, source) VALUES (?, ?, ?, ?)").run('https://jobs.example.com/old-2', 'Acme', 'Engineer', 'legacy');
  legacy.close();
  const store = await openOpportunityStore(databasePath);
  assert.equal(store.ingest({ url: 'https://jobs.example.com/old-2', company: 'Acme', role: 'Engineer', source: 'greenhouse', payload: {} }).url, 'https://jobs.example.com/old-2');
  assert.equal(store.ingest({ url: 'https://jobs.example.com/new', company: 'Acme', role: 'Engineer', source: 'greenhouse', payload: {} }).url, 'https://jobs.example.com/old-1');
  store.close();
} finally {
  rmSync(legacyDirectory, { recursive: true, force: true });
}
