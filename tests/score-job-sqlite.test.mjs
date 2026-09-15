// Proves the Hermes prepare boundary can claim an SQLite opportunity without pipeline.md.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openOpportunityStore } from '../src/opportunities/store.mjs';
import { createHash } from 'node:crypto';

const root = mkdtempSync(join(tmpdir(), 'score-job-sqlite-'));
const dbPath = join(root, 'data/career-ops.db');
try {
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'modes'), { recursive: true });
  writeFileSync(join(root, 'cv.md'), '# CV\n');
  writeFileSync(join(root, 'config/profile.yml'), 'attractiveness:\n  model: attractiveness-v1\n  alert_line: 3.5\n  weights: { direction: 0.25, compensation: 0.25, team: 0.25, company: 0.25 }\n');
  writeFileSync(join(root, 'modes/_profile.md'), '# Targeting\n');
  writeFileSync(join(root, 'modes/_custom.md'), '### Scoring Rules\nA\n### Review and decision gate\nB\n### Scoring Rules\nC\n');
  const store = await openOpportunityStore(dbPath);
  const opportunity = store.ingest({ url: 'https://jobs.example.com/1', company: 'Example', role: 'Engineer', source: 'scan', payload: { description: 'A complete job description' } });
  const selected = store.ingest({ url: 'https://jobs.example.com/2', company: 'Selected', role: 'Engineer', source: 'scan', payload: { description: 'Another complete job description' } });
  store.close();
  process.env.CAREER_OPS_OPPORTUNITY_DB = dbPath;
  const { prepare, renderReport, publish, claimDiscordDelivery, releaseDiscordDelivery, completeDiscordDelivery } = await import(`../score-job.mjs?sqlite-test=${Date.now()}`);
  const packet = await prepare(root);
  assert.equal(packet.opportunity_id, opportunity.id);
  assert.equal(packet.url, opportunity.url);
  assert.equal(packet.scan_snapshot.text, 'A complete job description');
  assert.equal((await prepare(root)).opportunity_id, opportunity.id);
  assert.equal((await prepare(root, selected.url)).opportunity_id, selected.id);
  const assessment = {
    sources: [{ id: 'web1', text: 'Market research excerpt.' }],
    research: { searched_at: '2026-09-11', queries: ['pay', 'team', 'company'], dimensions: Object.fromEntries(['compensation', 'team', 'company'].map((key, index) => [key, { queries: [index], conclusion: 'Unknown.', next_step: 'Confirm.' }])), findings: [{ id: 'f1', url: 'https://example.com/research', entity: 'Example', scope: 'market', status: 'retrieved', published_at: null, limitation: 'Market only.', source: 'web1', quote: 'Market research excerpt.' }] },
    dimensions: Object.fromEntries(['direction', 'compensation', 'team', 'company'].map(key => [key, { score: 4, rationale: 'Evidence supports this rating.', evidence: [{ source: 'jd', quote: 'A complete job description' }] }])),
    sections: Object.fromEntries(['overview', 'capabilities', 'compensation', 'questions', 'legitimacy', 'risks', 'checklist'].map(key => [key, 'Complete evidence mapping with an explicit next action.'])),
  };
  const rendered = renderReport(packet, { company: 'Example', role: 'Engineer', complete_jd: true, liveness: 'active', jd: 'A complete job description' }, assessment);
  const review = { reviewer: 'test', report_sha256: createHash('sha256').update(rendered.report).digest('hex'), verdict: 'approve', ready: true, gates: Object.fromEntries(['location', 'employment', 'size', 'compensation', 'eligibility', 'liveness'].map(key => [key, 'Pass'])), checks: Object.fromEntries(['jd_complete', 'source_grounding', 'dimension_support', 'capability_coverage', 'no_double_count', 'gate_evidence'].map(key => [key, { status: 'pass', finding: 'Reviewed evidence.' }])) };
  writeFileSync(join(packet.directory, 'report.md.review.json'), JSON.stringify(review));
  assert.equal((await publish(packet)).status, 'published');
  assert.equal((await claimDiscordDelivery(packet)).claimed, true);
  assert.equal((await releaseDiscordDelivery(packet)).released, true);
  assert.equal((await claimDiscordDelivery(packet)).claimed, true);
  assert.equal((await completeDiscordDelivery(packet)).completed, true);
  assert.equal((await claimDiscordDelivery(packet)).claimed, false);
  const verified = await openOpportunityStore(dbPath);
  assert.deepEqual(verified.shortlist().map(row => row.id), [opportunity.id]);
  verified.close();
} finally {
  delete process.env.CAREER_OPS_OPPORTUNITY_DB;
  rmSync(root, { recursive: true, force: true });
}
