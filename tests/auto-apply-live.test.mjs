import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../auto-apply.mjs';

test('dry-run appends ordered live run boundaries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-apply-live-'));
  try {
    mkdirSync(join(root, 'config'), { recursive: true }); mkdirSync(join(root, 'data')); mkdirSync(join(root, 'reports'));
    writeFileSync(join(root, 'config/auto-apply.yml'), readFileSync(new URL('../config/auto-apply.example.yml', import.meta.url), 'utf8'));
    writeFileSync(join(root, 'data/applications.md'), '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
    const result = await run({ dataRoot: root, dryRun: true });
    assert.equal(result.dryRun, true);
    const events = readFileSync(join(root, 'output/auto-apply/live.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.deepEqual(events.map(event => event.type), ['run_start', 'run_end']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
