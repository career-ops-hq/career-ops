// Two writers must not leave two rows for one posting. The check reads the
// file again under the pipeline lock, so the second writer sees the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendToPipeline } from '../scan.mjs';

const SCAN_URL = new URL('../scan.mjs', import.meta.url).href;

function checkboxLines(text) {
  return text.split('\n').filter((line) => /^\s*- \[[ x]\]/.test(line));
}

function offer(url, title) {
  return { url, company: 'Acme', title, location: 'Remote' };
}

test('concurrent pipeline writes keep one row for one Greenhouse posting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-one-job-'));
  const pipeline = join(root, 'pipeline.md');
  try {
    await Promise.all([
      appendToPipeline([
        offer('https://boards.greenhouse.io/acme/jobs/42', 'Engineer'),
        offer('https://jobs.example.com/other-99', 'Analyst'),
      ], { pipelinePath: pipeline }),
      appendToPipeline([
        offer('https://job-boards.greenhouse.io/acme/jobs/42?gh_src=abc', 'Engineer'),
        offer('https://careers.acme.example/open?gh_jid=42&utm_source=li', 'Engineer'),
      ], { pipelinePath: pipeline }),
    ]);
    const lines = checkboxLines(readFileSync(pipeline, 'utf8'));
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.equal(lines.filter((line) => line.includes('42')).length, 1);
    assert.equal(lines.filter((line) => line.includes('other-99')).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a posting already in Processed is not queued again under an alias URL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-one-job-'));
  const pipeline = join(root, 'pipeline.md');
  try {
    writeFileSync(pipeline, [
      '# Pipeline',
      '',
      '## Pending',
      '',
      '## Processed',
      '',
      '- [x] https://boards.greenhouse.io/acme/jobs/42 | Acme | Engineer',
      '',
    ].join('\n'));
    await appendToPipeline([
      offer('https://job-boards.eu.greenhouse.io/acme/jobs/42', 'Engineer'),
    ], { pipelinePath: pipeline });
    const lines = checkboxLines(readFileSync(pipeline, 'utf8'));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[x\].*boards\.greenhouse\.io/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runHistoryWriter(root, historyPath, status, urls) {
  const source = `
    const { appendToScanHistory } = await import(${JSON.stringify(SCAN_URL)});
    const urls = ${JSON.stringify(urls)};
    await appendToScanHistory(urls.map((url) => ({
      url, source: 'test', title: 'Engineer', company: 'Acme', location: 'Remote',
    })), '2026-11-05', ${JSON.stringify(status)});
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      cwd: root,
      env: {
        ...process.env,
        CAREER_OPS_ROOT: root,
        CAREER_OPS_DATA_DIR: '',
        CAREER_OPS_SCAN_HISTORY: historyPath,
        CAREER_OPS_PIPELINE: '',
        CAREER_OPS_PORTALS: '',
        CAREER_OPS_PROFILE: '',
        CAREER_OPS_TRACKER: '',
      },
    });
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `history writer exited ${code}`));
    });
  });
}

function historyRows(text) {
  return text.split('\n').filter((line) => line && !line.startsWith('url\t'));
}

test('concurrent scan-history writes keep one added row per posting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-one-job-hist-'));
  mkdirSync(join(root, 'data'));
  const history = join(root, 'data', 'scan-history.tsv');
  try {
    await Promise.all([
      runHistoryWriter(root, history, 'added', [
        'https://boards.greenhouse.io/acme/jobs/42',
        'https://jobs.example.com/other-99',
      ]),
      runHistoryWriter(root, history, 'added', [
        'https://job-boards.greenhouse.io/acme/jobs/42?utm_source=li',
        'https://careers.acme.example/open?gh_jid=42',
      ]),
    ]);
    const added = historyRows(readFileSync(history, 'utf8'));
    assert.equal(added.length, 2, added.join('\n'));
    assert.equal(added.filter((line) => line.includes('42')).length, 1);
    assert.equal(added.filter((line) => line.includes('other-99')).length, 1);

    await runHistoryWriter(root, history, 'skipped_expired', [
      'https://job-boards.eu.greenhouse.io/acme/jobs/42',
    ]);
    const after = historyRows(readFileSync(history, 'utf8'));
    assert.equal(after.length, 3, after.join('\n'));
    assert.equal(after.filter((line) => line.includes('skipped_expired')).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
