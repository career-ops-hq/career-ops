import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import greenhouse from '../providers/greenhouse.mjs';

const script = fileURLToPath(new URL('../prepare-application.mjs', import.meta.url));
function prepare(url) {
  const root = mkdtempSync(join(tmpdir(), 'prepare-greenhouse-'));
  try {
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, 'output'));
    const profile = 'full_name: Alex Example\nemail: alex@example.invalid\n';
    const pdf = '%PDF-fictional-fixture';
    writeFileSync(join(root, 'config', 'profile.yml'), profile);
    writeFileSync(join(root, 'output', 'cv.pdf'), pdf);
    const result = spawnSync(process.execPath, [script, '--url', url, '--pdf', 'output/cv.pdf'], {
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '' },
      encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(readFileSync(join(root, 'config', 'profile.yml'), 'utf8'), profile);
    assert.equal(readFileSync(join(root, 'output', 'cv.pdf'), 'utf8'), pdf);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const host of ['job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io']) {
  test(`prepare accepts the ${host} job URL returned by the existing provider`, async () => {
    const url = `https://${host}/fictional/jobs/1234?gh_src=fixture`;
    const jobs = await greenhouse.fetchListing({ name: 'Fictional', careers_url: `https://${host}/fictional` }, {
      fetchJson: async () => ({ jobs: [{ id: 1234, title: 'Data Engineer', absolute_url: url }] }),
    });
    assert.equal(jobs.length, 1);
    const result = prepare(jobs[0].url);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Greenhouse · fictional · job 1234'));
    assert.match(result.stdout, /first_name\s+Alex\n/);
    assert.ok(result.stdout.includes('alex@example.invalid'));
    assert.ok(result.stdout.includes(`Open:   ${url}`));
  });
}

for (const host of ['boards.greenhouse.io', 'greenhouse.io']) {
  test(`prepare retains the existing ${host} URL form`, () => {
    const result = prepare(`https://${host}/fictional/jobs/1234`);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Greenhouse · fictional · job 1234'));
  });
}

for (const url of [
  'http://job-boards.greenhouse.io/fictional/jobs/1234',
  'https://job-boards.greenhouse.io.example.invalid/fictional/jobs/1234',
  'https://example.invalid/fictional/jobs/1234?next=https://job-boards.greenhouse.io',
]) {
  test(`prepare still refuses an unsupported URL: ${url}`, () => {
    const result = prepare(url);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /URL must use https|not a supported ATS host/);
  });
}
