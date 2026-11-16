import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobSource, sourceIndex, sourceName } from '../../src/lib/job-source.mjs';
import { parseInbox } from '../../src/lib/pipeline-table.mjs';

test('a saved source tag stays distinct from the employer hosting the job', () => {
  const rows = parseInbox('- [ ] https://employer.example/jobs/123 | Acme | AI Student | source: Fixture careers');
  assert.equal(rows[0].location, undefined);
  assert.equal(rows[0].compensation, undefined);
  assert.equal(rows[0].source, 'Fixture careers');
  assert.deepEqual(jobSource(rows[0]), { label: 'Fixture careers', inferred: false });
});

test('legacy postings recover their real discovery source from notices and added scan history', () => {
  const job = { url: 'https://employer.example/jobs/123?utm_source=jobboard' };
  const other = { url: 'https://example.com/jobs/456' };
  const history = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n'
    + 'https://employer.example/jobs/123\t2026-10-20\tworkday-full\tAI\tAcme\tadded\n'
    + 'https://example.com/jobs/456\t2026-10-20\tlever-full\tAI\tAcme\tskipped_title\n'
    + 'https://example.com/jobs/456\t2026-10-21\tgreenhouse-full\tAI\tAcme\tadded\n';
  const monitors = { notices: [{ name: 'Fixture careers', jobs: [{ url: 'https://employer.example/jobs/123' }] }] };
  const index = sourceIndex({ history, monitors });
  assert.deepEqual(jobSource(job, index), { label: 'Fixture careers', inferred: false });
  assert.deepEqual(jobSource(other, index), { label: 'Greenhouse', inferred: false });
});

test('explicit labels win; absent history uses an honest host-based fallback', () => {
  const job = { url: 'https://tenant.myworkdayjobs.com/en/job/1', source: 'Fixture careers' };
  const index = sourceIndex({ history: 'url\tportal\tstatus\nhttps://tenant.myworkdayjobs.com/en/job/1\tworkday-full\tadded\n' });
  assert.equal(jobSource(job, index).label, 'Fixture careers');
  assert.deepEqual(jobSource({ url: job.url }), { label: 'Workday', inferred: true });
  assert.deepEqual(jobSource({ url: 'https://www.linkedin.com/jobs/view/123456' }), { label: 'LinkedIn', inferred: true });
  assert.deepEqual(jobSource({ url: 'https://employer.example/jobs/1' }), { label: 'employer.example', inferred: true });
  assert.deepEqual(jobSource({ url: '' }), { label: 'Unknown source', inferred: true });
  assert.equal(sourceName('plugin:linkedin-alerts'), 'LinkedIn');
  assert.equal(sourceName('workday-api'), 'Workday');
});

test('source metadata cannot shift the location and compensation fields', () => {
  const [job] = parseInbox('- [ ] https://jobs.example/1 | Acme | Intern | London | 20 EUR | posted: 2026-10-27 | source: Careers Board | note: useful');
  assert.equal(job.location, 'London');
  assert.equal(job.compensation, '20 EUR');
  assert.equal(job.postedAt, '2026-10-27');
  assert.equal(job.source, 'Careers Board');
});
