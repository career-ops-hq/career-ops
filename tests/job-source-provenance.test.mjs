import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatPipelineOffer } from '../scan.mjs';
import { addMonitor, checkMonitor, deliverMonitorSearch } from '../portal-monitor.mjs';

test('pipeline records an explicit source without shifting location or permitting metadata injection', () => {
  const row = formatPipelineOffer({ url: 'https://employer.example/job/1', company: 'Acme', title: 'AI Engineer',
    source: 'workday-api', sourceLabel: 'Fixture careers | extra\nline' });
  assert.match(row, /source: Fixture careers \/ extra line$/);
  assert.equal(formatPipelineOffer({ url: 'https://example.com/1', company: 'A', title: 'B' }), '- [ ] https://example.com/1 | A | B');
});

test('automatic and scheduled website deliveries retain the source name, including forwarded URLs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-source-tag-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const provider = { id: 'greenhouse', fetch: async () => [{ title: 'AI Intern', company: 'Acme', url: 'https://employer.example/job/1' }] };
  const source = await addMonitor(root, { url: 'https://boards.greenhouse.io/fixture-primary', name: 'Fixture careers', includeExisting: true }, { provider });
  const first = await checkMonitor(root, source.id, { fetchJobs: async () => ({ jobs: [{ title: 'AI Intern', company: 'Acme', url: 'https://employer.example/job/1' }], total: 1 }) });
  assert.equal(first.added, 1);
  const file = path.join(root, 'data/pipeline.md');
  assert.match(fs.readFileSync(file, 'utf8'), /source: Fixture careers/);
  const next = await deliverMonitorSearch(root, [{ sourceId: source.id, title: 'AI Engineer', company: 'Acme', url: 'https://employer.example/job/2' }]);
  assert.equal(next.added, 1);
  assert.equal((fs.readFileSync(file, 'utf8').match(/source: Fixture careers/g) || []).length, 2);
});
