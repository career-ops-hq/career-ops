// Verifies a migration never writes on dry-run and rejects ambiguous legacy data.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigration, buildMigrationPlan, discardUnmapped } from '../migrate-opportunities.mjs';
import { openOpportunityStore } from '../src/opportunities/store.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-ops-migrate-'));
mkdirSync(join(root, 'data'));
mkdirSync(join(root, 'reports'));
writeFileSync(join(root, 'data/scan-history.tsv'), 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://jobs.test/1\t2026-09-15\tTest\tEngineer\tAcme\tadded\n');
writeFileSync(join(root, 'data/pipeline.md'), '- [ ] https://jobs.test/1\n');
writeFileSync(join(root, 'data/applications.md'), '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-09-15 | Acme | Engineer | 4/5 | Applied | — | — | — |\n');
const plan = buildMigrationPlan(root);
assert.equal(plan.summary.mappings, 1);
assert.equal(plan.unmapped.length, 0);
assert.equal(plan.mappings[0].applications.length, 1);
const database = join(root, 'data/opportunities.db');
assert.equal(existsSync(database), false);
assert.equal((await applyMigration(plan, database)).imported, 1);
assert.equal(existsSync(database), true);
writeFileSync(join(root, 'data/pipeline.md'), '- [ ] https://jobs.test/missing\n');
await assert.rejects(() => applyMigration(buildMigrationPlan(root), database), /unresolved/);
writeFileSync(join(root, 'data/pipeline.md'), '- [ ] https://jobs.test/1\n');
const repeated = await applyMigration(buildMigrationPlan(root), database);
assert.ok(repeated.backup && existsSync(repeated.backup));
const scoredDatabase = join(root, 'data/scored-opportunities.db');
await applyMigration({ collisions: [], unmapped: [], mappings: [{
  url: 'https://jobs.test/scored', company: 'Acme', role: 'Scored Engineer', observations: [], applications: [],
  artifacts: [{ path: 'reports/scored.md', sha256: 'score-hash' }],
  evaluation: { lower: 2.5, upper: 4.5, coverage: 0.5, reportHash: 'score-hash', gates: { location: 'Pass' } },
}] }, scoredDatabase);
const store = await openOpportunityStore(scoredDatabase);
assert.equal(store.evaluation(1).lower, 2.5);
assert.equal(store.evaluation(1).upper, 4.5);
assert.equal(store.evaluation(1).coverage, 0.5);
assert.equal(store.evaluation(1).reportHash, 'score-hash');
assert.equal(store.artifacts(1)[0].path, 'reports/scored.md');
store.close();
writeFileSync(join(root, 'data/scan-history.tsv'), 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://jobs.test/keep\t2026-09-15\tTest\tEngineer\tAcme\tadded\nhttps://jobs.test/drop\t2026-09-15\tTest\t\t\tadded\n');
writeFileSync(join(root, 'data/pipeline.md'), '- [ ] https://jobs.test/keep\n- [ ] https://jobs.test/drop\n');
const discarded = discardUnmapped(root, { unmapped: [{ type: 'scan-metadata', url: 'https://jobs.test/drop' }, { type: 'pipeline-url', url: 'https://jobs.test/drop' }] });
assert.equal(discarded.length, 2);
assert.equal(readFileSync(join(root, 'data/scan-history.tsv'), 'utf8').includes('https://jobs.test/drop'), false);
assert.equal(readFileSync(join(root, 'data/pipeline.md'), 'utf8').includes('https://jobs.test/drop'), false);
console.log('migrate-opportunities: passed');
