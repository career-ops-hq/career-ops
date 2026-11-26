import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBambooHrJob, normalizeHimalayasJob, TRUNCATION_NOTICE } from '../fetch-jd.mjs';

const POSTING = 'https://acme.bamboohr.com/careers/12';
const bamboo = (over = {}) => ({
  result: { jobOpening: {
    jobOpeningStatus: 'Open',
    jobOpeningShareUrl: `${POSTING}/`,
    jobOpeningName: 'Backend Engineer',
    description: '<p>Build things.</p><ul><li>Go</li></ul>',
    ...over,
  } },
});

test('normalizeBambooHrJob shapes an open posting', () => {
  const jd = normalizeBambooHrJob(bamboo(), POSTING, POSTING);
  assert.equal(jd.title, 'Backend Engineer');
  assert.match(jd.text, /Build things\./);
  assert.match(jd.text, /- Go/);
});

test('normalizeBambooHrJob refuses a closed posting, another posting, or no body', () => {
  assert.equal(normalizeBambooHrJob(bamboo({ jobOpeningStatus: 'Closed' }), POSTING, POSTING), null);
  assert.equal(normalizeBambooHrJob(bamboo({ jobOpeningShareUrl: 'https://acme.bamboohr.com/careers/99' }), POSTING, POSTING), null);
  assert.equal(normalizeBambooHrJob(bamboo({ description: '' }), POSTING, POSTING), null);
  assert.equal(normalizeBambooHrJob({}, POSTING, POSTING), null);
});

test('normalizeBambooHrJob marks a cut JD with the truncation notice', () => {
  const jd = normalizeBambooHrJob(bamboo({ description: `<p>${'word '.repeat(500)}</p>` }), POSTING, POSTING, 100);
  assert.ok(jd.text.endsWith(TRUNCATION_NOTICE(100)));
});

test('normalizeHimalayasJob needs the publisher to list the posting as open', () => {
  const job = { title: 'Data Engineer', description: '<p>Own the pipelines.</p>' };
  const jd = normalizeHimalayasJob({ publisherStatus: 'open', job }, 'https://himalayas.app/x');
  assert.deepEqual([jd.title, jd.text], ['Data Engineer', 'Own the pipelines.']);
  assert.equal(normalizeHimalayasJob({ publisherStatus: 'closed', job }, 'https://himalayas.app/x'), null);
  assert.equal(normalizeHimalayasJob({ publisherStatus: 'open', job: { ...job, description: '' } }, 'https://himalayas.app/x'), null);
});
