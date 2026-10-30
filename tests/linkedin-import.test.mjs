import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  linkedInJobsFromText,
  planLinkedInImport,
  linkedInOffers,
  MAX_FIELD_LENGTH,
  LINKEDIN_DOCTOR_LABEL,
  linkedInPluginFix,
} from '../lib/linkedin-import.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'linkedin-import.mjs');
const DOCTOR = join(ROOT, 'doctor.mjs');
const PLAYWRIGHT_STUB = join(ROOT, 'tests', 'fixtures', 'playwright-stub.mjs');

const A = '1000000001';
const B = '1000000002';
const C = '1000000004';
const D = '1000000005';
const E = '1000000006';

const ALERT = [
  'From: jobs-noreply' + '@' + 'linkedin.example',
  'Subject: Jobs for you at Northwind',
  '',
  `https://www.linkedin.com/comm/jobs/view/${A}?trk=eml-job_alert&trkEmail=eml-x`,
  `https://uk.linkedin.com/jobs/view/staff-analyst-northwind-${B}/`,
  'https://www.linkedin.com/in/northwind-recruiter',
  'https://example.com/jobs/view/1000000003',
  `https://www.linkedin.com/jobs/search/?currentJobId=${C}&keywords=analyst`,
  `https://www.google.com/url?q=https%3A%2F%2Fwww.linkedin.com%2Fjobs%2Fview%2F${D}`,
  `https://www.linkedin.com/jobs/view/${A}`,
  'https://linkedin.com.evil.example/jobs/view/1000000009',
  'https://notlinkedin.com/jobs/view/1000000010',
].join('\n');

const FOLDED = [
  'https://www.linkedin.com/comm/jobs/view/=',
  `${E}?trk=eml`,
].join('\n');

test('a pasted alert becomes canonical linkedin.com/jobs/view ids, once each', () => {
  const jobs = linkedInJobsFromText(ALERT);
  assert.deepEqual(jobs.map((job) => job.id), [A, B, C, D]);
  assert.deepEqual(jobs.map((job) => job.url), [
    `https://www.linkedin.com/jobs/view/${A}`,
    `https://www.linkedin.com/jobs/view/${B}`,
    `https://www.linkedin.com/jobs/view/${C}`,
    `https://www.linkedin.com/jobs/view/${D}`,
  ]);
});

test('a saved email with a quoted-printable line break still yields the job', () => {
  const jobs = linkedInJobsFromText(FOLDED);
  assert.deepEqual(jobs, [{ id: E, url: `https://www.linkedin.com/jobs/view/${E}` }]);
});

test('bare and full links keep the order they appear in', () => {
  const text = `linkedin.com/jobs/view/${A}\nhttps://www.linkedin.com/jobs/view/${B}\nwww.linkedin.com/jobs/view/${C}`;
  assert.deepEqual(linkedInJobsFromText(text).map((job) => job.id), [A, B, C]);
});

test('a linkedin.com path inside another site\'s URL is not a job', () => {
  assert.deepEqual(linkedInJobsFromText('https://example.com/linkedin.com/jobs/view/1000000011'), []);
  assert.deepEqual(linkedInJobsFromText('https://example.com/?u=linkedin.com/jobs/view/1000000012'), []);
});

test('jobs already in the pipeline or the tracker are not added again', () => {
  const pipeline = `# Pipeline\n\n## Pending\n\n- [ ] https://www.linkedin.com/comm/jobs/view/${A}?trk=eml | LinkedIn | Job alert\n`;
  const tracker = `| 1 | 2026-01-02 | Northwind | Analyst | 4.0/5 | Evaluated | no | - | https://www.linkedin.com/jobs/view/${B} |\n`;
  const plan = planLinkedInImport(ALERT, `${pipeline}\n${tracker}`);
  assert.deepEqual(plan.added.map((job) => job.id), [C, D]);
  assert.deepEqual(plan.already.map((job) => job.id), [A, B]);
  assert.equal(plan.found, 4);
  assert.equal(plan.message, '2 LinkedIn jobs added. Open Pipeline to review them. 2 were already in your list.');
});

test('the success line names the count of jobs added', () => {
  const plan = planLinkedInImport(`https://www.linkedin.com/jobs/view/${A}`, '');
  assert.equal(plan.message, '1 LinkedIn job added. Open Pipeline to review it.');
  const many = planLinkedInImport(ALERT, '');
  assert.equal(many.message, '4 LinkedIn jobs added. Open Pipeline to review them.');
});

test('a title above the link is kept, and a slug fills in when the paste has no title', () => {
  const text = [
    'Customer Success Lead',
    'Quillfeather Labs',
    'Austin, TX',
    `https://www.linkedin.com/jobs/view/${A}`,
    `https://www.linkedin.com/jobs/view/staff-analyst-quill-${B}/`,
  ].join('\n');
  const offers = linkedInOffers(linkedInJobsFromText(text), text);
  assert.equal(offers[0].title, 'Customer Success Lead');
  assert.equal(offers[0].company, 'Quillfeather Labs');
  assert.equal(offers[1].title, 'Staff Analyst Quill');
  assert.equal(offers[1].company, 'LinkedIn');
  assert.equal(offers[1].url, `https://www.linkedin.com/jobs/view/${B}`);
});

test('a pasted title or company longer than the bound is cut, and one at the bound is kept', () => {
  const atLimit = 'T'.repeat(MAX_FIELD_LENGTH);
  const tooLong = `Northwind Market ${'operations '.repeat(40)}`.trim();
  const text = [atLimit, tooLong, `https://www.linkedin.com/jobs/view/${A}`].join('\n');
  const [offer] = linkedInOffers(linkedInJobsFromText(text), text);
  assert.equal(offer.title, atLimit);
  assert.equal(offer.company.length, MAX_FIELD_LENGTH);
  assert.ok(offer.company.startsWith('Northwind Market operations'));
  assert.ok(offer.company.endsWith('…'));
});

test('a Remote title stays a title, and Remote US or Remote Europe stays a place', () => {
  const titled = [
    'Remote Software Engineer',
    'Northwind Market',
    `https://www.linkedin.com/jobs/view/${A}`,
  ].join('\n');
  const titledOffers = linkedInOffers(linkedInJobsFromText(titled), titled);
  assert.equal(titledOffers[0].title, 'Remote Software Engineer');
  assert.equal(titledOffers[0].company, 'Northwind Market');

  const placed = [
    'Floor lead',
    'Northwind Market',
    'Remote US',
    `https://www.linkedin.com/jobs/view/${A}`,
    'Shift lead',
    'Sundial Pharmacy',
    'Remote Europe',
    `https://www.linkedin.com/jobs/view/${B}`,
    'Counter lead',
    'Northwind Market',
    'Remote',
    `https://www.linkedin.com/jobs/view/${C}`,
  ].join('\n');
  const placedOffers = linkedInOffers(linkedInJobsFromText(placed), placed);
  assert.equal(placedOffers[0].title, 'Floor lead');
  assert.equal(placedOffers[0].company, 'Northwind Market');
  assert.equal(placedOffers[1].title, 'Shift lead');
  assert.equal(placedOffers[1].company, 'Sundial Pharmacy');
  assert.equal(placedOffers[2].title, 'Counter lead');
  assert.equal(placedOffers[2].company, 'Northwind Market');
});

test('the CLI writes the title from the line above the link', () => {
  const root = sandbox();
  try {
    const text = [
      'Customer Success Lead',
      'Quillfeather Labs',
      `https://www.linkedin.com/jobs/view/${A}`,
    ].join('\n');
    const result = runCli(root, ['--json'], text);
    assert.equal(result.status, 0, result.stderr);
    const pipeline = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    assert.match(pipeline, /Customer Success Lead/);
    assert.match(pipeline, /Quillfeather Labs/);
    assert.match(JSON.parse(result.stdout).message, /Open Pipeline to review it/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an empty paste explains what to copy', () => {
  const plan = planLinkedInImport('   ', '');
  assert.equal(plan.added.length, 0);
  assert.equal(plan.found, 0);
  assert.match(plan.message, /No LinkedIn jobs found/);
});

test('a second import of the same alert adds nothing', () => {
  const first = planLinkedInImport(ALERT, '');
  const pipeline = first.added.map((job) => `- [ ] ${job.url} | LinkedIn | Job alert`).join('\n');
  const second = planLinkedInImport(ALERT, pipeline);
  assert.equal(second.added.length, 0);
  assert.equal(second.already.length, first.found);
  assert.match(second.message, /already in your list/);
});

test('doctor tells you to paste an alert and skip Google', () => {
  assert.match(LINKEDIN_DOCTOR_LABEL, /paste an alert email/);
  assert.match(LINKEDIN_DOCTOR_LABEL, /node linkedin-import\.mjs/);
  assert.match(LINKEDIN_DOCTOR_LABEL, /No Google account/);
  assert.match(linkedInPluginFix('gmail'), /skip Google setup/);
  assert.equal(linkedInPluginFix('linkedin-alerts'), null);
  assert.equal(linkedInPluginFix('notion'), null);
});

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-import-'));
  mkdirSync(join(root, 'data'));
  const pipeline = join(root, 'data', 'pipeline.md');
  writeFileSync(pipeline, '# Pipeline\n\n## Pending\n\n## Processed\n');
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
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

test('the CLI writes canonical rows and a second run does not duplicate them', () => {
  const root = sandbox();
  try {
    const first = runCli(root, ['--json'], ALERT);
    assert.equal(first.status, 0, first.stderr);
    const parsed = JSON.parse(first.stdout);
    assert.equal(parsed.added, 4);
    assert.equal(parsed.message, '4 LinkedIn jobs added. Open Pipeline to review them.');
    const pipeline = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    assert.match(pipeline, new RegExp(`https://www.linkedin.com/jobs/view/${A}`));
    assert.doesNotMatch(pipeline, /\/comm\/jobs\/view\//);
    assert.equal(pipeline.split(A).length - 1, 1);

    const second = runCli(root, ['--json'], ALERT);
    assert.equal(second.status, 0, second.stderr);
    const again = JSON.parse(second.stdout);
    assert.equal(again.added, 0);
    const after = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    assert.equal(after, pipeline);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a root with no data directory still receives the jobs', () => {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-import-empty-'));
  try {
    const result = runCli(root, ['--json'], `https://www.linkedin.com/jobs/view/${A}\n`);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const pipeline = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    assert.match(pipeline, new RegExp(`https://www.linkedin.com/jobs/view/${A}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable tracker stops the import before anything is written', () => {
  const root = sandbox();
  try {
    const applications = join(root, 'data', 'applications.md');
    rmSync(applications);
    mkdirSync(applications);
    const before = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    const result = runCli(root, ['--json'], `https://www.linkedin.com/jobs/view/${A}\n`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Nothing was saved/);
    assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run prints the count and leaves the pipeline untouched', () => {
  const root = sandbox();
  try {
    const before = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    const result = runCli(root, ['--dry-run'], `https://www.linkedin.com/jobs/view/${A}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 LinkedIn job found/);
    assert.match(result.stdout, /Nothing was saved/);
    assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor output includes the paste path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-linkedin-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture","version":"0.0.0"}\n');
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(PLAYWRIGHT_STUB).href, DOCTOR, '--target', dir], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /LinkedIn jobs: paste an alert email/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
