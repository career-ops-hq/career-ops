import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendToPipeline, extractPipelineCompanyRole } from '../scan.mjs';

const URL = 'https://jobs.example.com/role/123';

test('a capital X checkbox is the same posting scan already has', async () => {
  const role = extractPipelineCompanyRole(`- [X] ${URL} | Acme | Engineer`);
  assert.equal(role?.company, 'Acme');
  assert.equal(role?.role, 'Engineer');

  const dir = mkdtempSync(join(tmpdir(), 'career-ops-capital-x-'));
  const pipeline = join(dir, 'pipeline.md');
  try {
    writeFileSync(pipeline, `# Pipeline\n\n## Pending\n\n- [X] ${URL} | Acme | Engineer\n`);
    await appendToPipeline(
      [{ url: URL, company: 'Acme', title: 'Engineer' }],
      { pipelinePath: pipeline, scanHistoryPath: join(dir, 'missing-history.tsv') },
    );
    const lines = readFileSync(pipeline, 'utf8').split('\n').filter((line) => line.startsWith('- ['));
    assert.deepEqual(lines, [`- [X] ${URL} | Acme | Engineer`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed-fetch checkbox is not a posting scan already has', () => {
  assert.equal(extractPipelineCompanyRole(`- [!] ${URL} | Acme | Engineer`), null);
});
