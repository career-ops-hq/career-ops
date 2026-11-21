import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'node:url';
import {
  MAX_FIELD_LENGTH,
  NAUKRI_IMPORT_MAX_CHARS,
  naukriImportMessage,
  naukriJobsFromText,
  naukriOfferFields,
  naukriOffers,
  naukriSlugWords,
  planNaukriImport,
} from '../lib/naukri-import.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'naukri-import.mjs');

const A = '011026501721';
const B = '111126007773';
const C = '191026019260';
const D = '061026502596';

const url = (id, slug = `some-role-pune-2-to-5-years-${id}`) => `https://www.naukri.com/job-listings-${slug}`;

// The shape Naukri's alert mail sends: the title on the link, the employer on
// the next line, then where it is.
const ALERT = [
  'From: info' + '@' + 'naukri.example',
  'Subject: 12 new jobs for you',
  '',
  '<a href="https://www.naukri.com/job-listings-manager-technology-nasscomm-noida-5-to-8-years-' + A + '?src=alert">Manager Technology</a>',
  'Nasscomm',
  'Noida, Uttar Pradesh',
  '',
  `<a href="${url(B, `direct-tax-executive-one-source-recruitment-advisory-kolkata-noida-1-to-6-years-${B}`)}">Direct Tax Executive</a>`,
  'One Source Recruitment Advisory',
  'Kolkata',
  '',
  `https://www.naukri.com/job-listings-legal-manager-white-force-outsourcing-services-noida-6-to-11-years-${C}`,
  `https://www.naukri.com/job-listings-manager-technology-nasscomm-noida-5-to-8-years-${A}`,
  'https://www.naukri.com/python-jobs',
  'https://www.naukri.com/company/nasscomm',
  'https://naukri.com.evil.example/job-listings-x-999999999999',
].join('\n');

test('every posting in the paste is read once, in order, and non-postings are dropped', () => {
  const jobs = naukriJobsFromText(ALERT);
  assert.deepEqual(jobs.map((job) => job.id), [A, B, C]);
  assert.deepEqual(jobs.map((job) => job.url), [url(A, `manager-technology-nasscomm-noida-5-to-8-years-${A}`), jobs[1].url, url(C, `legal-manager-white-force-outsourcing-services-noida-6-to-11-years-${C}`)]);
});

test('a look-alike host, a search page and a company page are never postings', () => {
  assert.deepEqual(naukriJobsFromText('https://naukri.com.evil.example/job-listings-x-999999999999'), []);
  assert.deepEqual(naukriJobsFromText('https://notnaukri.com/job-listings-x-999999999999'), []);
  assert.deepEqual(naukriJobsFromText('https://www.naukri.com/python-jobs'), []);
  assert.deepEqual(naukriJobsFromText('https://www.naukri.com/job-listings-manager-technology-011'), []);
  assert.deepEqual(naukriJobsFromText('https://www.naukri.com/python-jobs-in-delhi-2'), []);
});

test('a redirect wrapper and a tracking param are both unwrapped', () => {
  const wrapped = `https://www.google.com/url?q=${encodeURIComponent(url(D))}&sa=D`;
  assert.deepEqual(naukriJobsFromText(wrapped).map((job) => job.id), [D]);
  assert.deepEqual(naukriJobsFromText(`https://www.naukri.com/job-listings-x-2-years-${D}?jd=1`).map((job) => job.id), [D]);
});

test('a saved .eml with a quoted-printable break still yields the posting', () => {
  const folded = [
    'https://www.naukri.com/job-listings-manager-technology-nasscomm-noida-5-to-8-years-=',
    A,
  ].join('\n');
  assert.deepEqual(naukriJobsFromText(folded).map((job) => job.id), [A]);
  const equals = `https://www.naukri.com/job-listings-x-2-years-${A}?src=3Dalert`;
  assert.deepEqual(naukriJobsFromText(equals).map((job) => job.id), [A]);
});

test('the anchor text is the title, and the lines under it are the employer and the place', () => {
  const jobs = naukriJobsFromText(ALERT);
  const offers = naukriOffers(jobs, ALERT);
  assert.equal(offers[0].title, 'Manager Technology');
  assert.equal(offers[0].company, 'Nasscomm');
  assert.equal(offers[0].location, 'Noida, Uttar Pradesh');
  assert.equal(offers[1].title, 'Direct Tax Executive');
  assert.equal(offers[1].company, 'One Source Recruitment Advisory');
  // C carries no anchor and no line of its own: the slug words are the title,
  // and the employer stays unknown rather than being guessed out of the slug
  // (which has no delimiter between the title and the employer).
  assert.equal(offers[2].title, 'Legal Manager White Force Outsourcing Services Noida');
  assert.equal(offers[2].company, 'Naukri');
  assert.equal(offers[0].source, 'naukri-import');
});

test('a plain-text paste with no anchor reads the title from the line above the link', () => {
  const text = ['Customer Success Lead', 'Quillfeather Labs', url(A)].join('\n');
  const [offer] = naukriOffers(naukriJobsFromText(text), text);
  assert.equal(offer.title, 'Customer Success Lead');
  assert.equal(offer.company, 'Quillfeather Labs');
});

test('with nothing around the link the slug words are the title, never a guessed employer', () => {
  const [offer] = naukriOffers(naukriJobsFromText(url(A)), url(A));
  assert.equal(offer.title, 'Some Role Pune');
  assert.equal(offer.company, 'Naukri');
  assert.equal(offer.location, '');
  assert.equal(naukriSlugWords('analyst-pune-3-years'), 'Analyst Pune');
  assert.equal(naukriSlugWords(''), '');
});

test('a Remote line becomes the place, not the employer', () => {
  const text = ['Floor lead', 'Northwind Market', 'Remote', url(B)].join('\n');
  const [offer] = naukriOffers(naukriJobsFromText(text), text);
  assert.equal(offer.title, 'Floor lead');
  assert.equal(offer.company, 'Northwind Market');
  assert.equal(offer.location, 'Remote');
});

test('a pasted field longer than the bound is cut, and one at the bound is kept', () => {
  const atLimit = 'T'.repeat(MAX_FIELD_LENGTH);
  const tooLong = `Northwind Market ${'operations '.repeat(40)}`.trim();
  const text = [atLimit, tooLong, url(A)].join('\n');
  const [offer] = naukriOffers(naukriJobsFromText(text), text);
  assert.equal(offer.title, atLimit);
  assert.equal(offer.company.length, MAX_FIELD_LENGTH);
  assert.ok(offer.company.endsWith('…'));
});

test('a posting already in the pipeline or the tracker is not added again', () => {
  const pipeline = `# Pipeline\n\n## Pending\n\n- [ ] ${url(A)} | Nasscomm | Manager Technology\n`;
  const tracker = `| 1 | 2026-01-02 | One Source | Direct Tax Executive | 4.0/5 | Evaluated | no | - | ${url(B)} |\n`;
  const plan = planNaukriImport(ALERT, `${pipeline}\n${tracker}`);
  assert.deepEqual(plan.added.map((job) => job.id), [C]);
  assert.deepEqual(plan.already.map((job) => job.id), [A, B]);
  assert.equal(plan.found, 3);
  assert.equal(plan.message, '1 Naukri job added. Open Pipeline to review it. 2 were already in your list.');
});

test('the success line, the empty line and the dry run line say what happened', () => {
  assert.equal(planNaukriImport(url(A), '').message, '1 Naukri job added. Open Pipeline to review it.');
  assert.match(planNaukriImport('   ', '').message, /No Naukri jobs found/);
  assert.equal(
    naukriImportMessage({ added: 2, already: 0, found: 2, dryRun: true }),
    '2 Naukri jobs found. Nothing was saved.',
  );
  assert.equal(naukriImportMessage({ added: 0, already: 1, found: 1 }), 'That Naukri job is already in your list.');
});

test('an over-large paste is refused instead of parsed', () => {
  const plan = planNaukriImport('x'.repeat(NAUKRI_IMPORT_MAX_CHARS + 1), '');
  assert.equal(plan.error, 'too-large');
  assert.equal(plan.added.length, 0);
});

test('a second import of the same alert adds nothing', () => {
  const first = planNaukriImport(ALERT, '');
  const pipeline = first.added.map((job) => `- [ ] ${job.url} | Naukri | Job alert`).join('\n');
  const second = planNaukriImport(ALERT, pipeline);
  assert.equal(second.added.length, 0);
  assert.equal(second.already.length, first.found);
});

test('the CLI writes the row and scan history, and a second run does not duplicate it', () => {
  const root = sandbox();
  try {
    const first = runCli(root, ['--json'], ALERT);
    assert.equal(first.status, 0, first.stderr);
    const parsed = JSON.parse(first.stdout);
    assert.equal(parsed.added, 3);
    assert.equal(parsed.message, '3 Naukri jobs added. Open Pipeline to review them.');
    const pipeline = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    assert.match(pipeline, /Manager Technology/);
    assert.match(pipeline, /Nasscomm/);
    assert.equal(pipeline.split(`-${A}`).length - 1, 1);
    assert.doesNotMatch(pipeline, /\?src=alert/);
    const history = readFileSync(join(root, 'data', 'scan-history.tsv'), 'utf8');
    assert.match(history, /\tadded\t|\tadded$/);

    const second = runCli(root, ['--json'], ALERT);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).added, 0);
    assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), pipeline);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dry run prints the count and writes nothing', () => {
  const root = sandbox();
  try {
    const result = runCli(root, ['--json', '--dry-run'], ALERT);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).added, 3);
    assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), '# Pipeline\n\n## Pending\n\n## Processed\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a paste with no Naukri posting explains what to copy and writes nothing', () => {
  const root = sandbox();
  try {
    const result = runCli(root, ['--json'], 'https://www.naukri.com/python-jobs');
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.added, 0);
    assert.match(parsed.message, /No Naukri jobs found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'naukri-import-'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n## Processed\n');
  writeFileSync(
    join(root, 'data', 'applications.md'),
    '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n',
  );
  return root;
}

function runCli(root, args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_PIPELINE: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_SCAN_HISTORY: '',
      NO_COLOR: '1',
    },
  });
}

test('naukriOfferFields tolerates a job object with no url', () => {
  const fields = naukriOfferFields('', {});
  assert.equal(fields.company, 'Naukri');
  assert.equal(fields.title, 'Naukri posting');
});
