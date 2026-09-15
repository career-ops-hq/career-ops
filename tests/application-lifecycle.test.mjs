// Exercises the canonical lifecycle, reply suggestion, and outcome command paths.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openOpportunityStore } from '../src/opportunities/store.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-lifecycle-'));
const databasePath = join(root, 'opportunities.db');
try {
  const store = await openOpportunityStore(databasePath);
  const opportunity = store.ingest({ url: 'https://example.com/role', company: 'Acme', role: 'Engineer', source: 'test', payload: {} });
  store.claim(opportunity.id, 'test');
  store.recordEligibility(opportunity.id, { status: 'pass', evidence: {} });
  store.recordEvaluation(opportunity.id, { lower: 4, upper: 4, coverage: 1, reportHash: 'report' });
  store.startApplication(opportunity.id);
  store.recordApplicationArtifact(opportunity.id, { kind: 'application-pdf', path: 'output/acme.pdf', sha256: 'pdf' });
  store.recordVerifiedApplicationPdf(opportunity.id, { path: 'output/acme.pdf', sha256: 'pdf' });
  store.confirmSubmitted(opportunity.id, 'submitted');
  store.close();
  const run = args => spawnSync(process.execPath, [join(process.cwd(), args[0]), ...args.slice(1)], { encoding: 'utf8' });
  let result = run(['application-lifecycle.mjs', 'transition', String(opportunity.id), 'responded', '--source', 'candidate-review', '--db', databasePath]);
  assert.equal(result.status, 0, result.stderr);
  result = run(['application-lifecycle.mjs', 'activity', String(opportunity.id), '--type', 'followup_sent', '--confirmed', '--db', databasePath]);
  assert.equal(result.status, 0, result.stderr);
  result = run(['application-lifecycle.mjs', 'followups', '--db', databasePath]);
  assert.equal(JSON.parse(result.stdout)[0].status, 'responded');
  const repliesPath = join(root, 'replies.json');
  writeFileSync(repliesPath, JSON.stringify([{ message_id: 'reply-1', opportunity_id: opportunity.id, subject: 'Offer', body_snippet: 'We are pleased to offer', signal: 'offer' }]));
  result = run(['reply-watch.mjs', repliesPath, '--db', databasePath]);
  assert.equal(JSON.parse(result.stdout).suggestions[0].suggested, 'offer');
  result = run(['application-outcome.mjs', String(opportunity.id), 'hired', '--db', databasePath]);
  assert.notEqual(result.status, 0);
  let check = await openOpportunityStore(databasePath);
  assert.equal(check.events(opportunity.id).filter(event => event.type === 'outcome_recorded').length, 0);
  check.close();
  result = run(['application-outcome.mjs', String(opportunity.id), 'rejected', '--db', databasePath]);
  assert.equal(JSON.parse(result.stdout).status, 'rejected');
  console.log('application lifecycle: canonical transitions, activities, and outcomes passed');
} finally { rmSync(root, { recursive: true, force: true }); }
