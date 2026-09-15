// Verifies every interview action can begin from one canonical opportunity context.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openOpportunityStore } from '../src/opportunities/store.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-interview-context-'));
try {
  const db = join(root, 'data', 'opportunities.sqlite'); const sessions = join(root, 'sessions'); mkdirSync(sessions);
  const store = await openOpportunityStore(db); const row = store.ingest({ url: 'https://example.com/jobs/1', company: 'Acme', role: 'Engineer', source: 'test', payload: {} });
  store.claim(row.id, 'test'); store.recordEligibility(row.id, { status: 'pass', evidence: {} }); store.recordEvaluation(row.id, { lower: 4, upper: 5, coverage: 1, reportHash: 'report' }); store.recordArtifact(row.id, { kind: 'report', path: 'reports/acme.md', sha256: 'hash' }); store.close();
  writeFileSync(join(sessions, 'acme.md'), '---\ncompany: Acme\nrole: Engineer\ndate: 2026-09-15\n---\n');
  const result = spawnSync(process.execPath, [join(process.cwd(), 'interview-context.mjs'), String(row.id), '--db', db, '--sessions', sessions], { encoding: 'utf8' });
  assert.equal(result.status, 0); const out = JSON.parse(result.stdout); assert.equal(out.opportunity.id, row.id); assert.deepEqual(out.sessions, ['acme.md']); assert.ok(out.candidateFacts.includes('cv.md'));
  assert.match(readFileSync(join(process.cwd(), '.agents/skills/career-ops/SKILL.md'), 'utf8'), /Interview preparation/);
  console.log('interview context: canonical opportunity, evidence, facts, and sessions passed');
} finally { rmSync(root, { recursive: true, force: true }); }
