// Verifies a migration never writes on dry-run and rejects ambiguous legacy data.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigration, buildMigrationPlan } from '../migrate-opportunities.mjs';

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
console.log('migrate-opportunities: passed');
