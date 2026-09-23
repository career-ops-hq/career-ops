import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { filterOffersForPipeline } from '../scan.mjs';
import { pass, fail } from './helpers.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

const dir = mkdtempSync(join(tmpdir(), 'co-filter-pipeline-'));
mkdirSync(join(dir, 'data'), { recursive: true });
const pipelinePath = join(dir, 'data/pipeline.md');
const applicationsPath = join(dir, 'data/applications.md');

writeFileSync(pipelinePath, `# Pipeline

## Pending

## Processed
`);

writeFileSync(applicationsPath, `# Applications

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-01 | Leena AI | Solution Consultant | 3.8/5 | Evaluated | ✅ | [1](reports/001.md) | |
`);

const opts = { pipelinePath, applicationsPath, scanHistoryPath: join(dir, 'data/scan-history.tsv') };

const r1 = filterOffersForPipeline([
  { url: 'https://jobs.example.com/leena', company: 'Leena AI', title: 'Solution Consultant' },
], opts);
ok('blocks company+role already in tracker', r1.toAdd.length === 0 && r1.skippedRole === 1);

writeFileSync(pipelinePath, `# Pipeline

## Pending
- [ ] https://jobs.example.com/acme | Acme | Engineer

## Processed
`);

const r2 = filterOffersForPipeline([
  { url: 'https://jobs.example.com/acme', company: 'Acme', title: 'Engineer' },
  { url: 'https://jobs.example.com/acme?utm=1', company: 'Acme', title: 'Engineer' },
], opts);
ok('blocks duplicate URL in pipeline', r2.toAdd.length === 0 && r2.skipped >= 1);
