// Two writers must not leave two rows for one posting. The check reads the
// file again under the pipeline lock, so the second writer sees the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendToPipeline, collectSeenUrls, seenJobKey } from '../scan.mjs';
import { localToday } from '../lib/local-today.mjs';

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
    ], { pipelinePath: pipeline, scanHistoryPath: join(root, 'no-history.tsv') });
    const lines = checkboxLines(readFileSync(pipeline, 'utf8'));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[x\].*boards\.greenhouse\.io/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const RELEASED = { recheckAfterDays: 30, today: '2026-11-05' };
const POSTING = 'https://jobs.example/open?gh_jid=42';
const POSTING_ALIAS = 'https://careers.example/role?gh_jid=42&utm_source=li';
const PROCESSED = 'https://jobs.example/posting/9';

function pipelineFile(pendingLines, processedLines = []) {
  return [
    '# Pipeline', '',
    '## Pending', '',
    ...pendingLines, '',
    '## Processed', '',
    ...processedLines, '',
  ].join('\n');
}

function historyFile(rows) {
  return ['url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation', ...rows, ''].join('\n');
}

function historyRow(url, firstSeen, status) {
  return `${url}\t${firstSeen}\ttest\tEngineer\tAcme\t${status}\tRemote`;
}

test('a TTL-released finished row is queued again under an alias URL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-one-job-'));
  const pipeline = join(root, 'pipeline.md');
  const history = join(root, 'scan-history.tsv');
  try {
    const pipelineText = pipelineFile(
      [`- [x] ${POSTING} | Acme | Engineer`],
      [`- [ ] ${PROCESSED} | Acme | Analyst`],
    );
    writeFileSync(pipeline, pipelineText);
    writeFileSync(history, historyFile([
      historyRow(POSTING, '2020-01-01', 'added'),
      historyRow(PROCESSED, '2020-01-01', 'added'),
    ]));
    const seen = collectSeenUrls({
      scanHistoryText: readFileSync(history, 'utf8'),
      pipelineText,
      applicationsText: '',
    }, RELEASED).seen;
    assert.equal(seen.has(seenJobKey(POSTING_ALIAS)), false);
    assert.equal(seen.has(seenJobKey(PROCESSED)), false);
    await appendToPipeline([
      offer(POSTING_ALIAS, 'Engineer'),
      offer(`${PROCESSED}?utm_source=li`, 'Analyst'),
    ], { pipelinePath: pipeline, scanHistoryPath: history, historyPolicy: RELEASED });
    const lines = checkboxLines(readFileSync(pipeline, 'utf8'));
    assert.equal(lines.length, 4, lines.join('\n'));
    assert.equal(lines.filter((line) => line.includes('careers.example')).length, 1, lines.join('\n'));
    assert.equal(lines.filter((line) => line.includes('posting/9?utm_source=li')).length, 1, lines.join('\n'));
    assert.equal(lines.filter((line) => line.startsWith('- [x]')).length, 1, lines.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a finished row with no released history candidate stays one pipeline row', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-one-job-'));
  const pipeline = join(root, 'pipeline.md');
  const history = join(root, 'scan-history.tsv');
  try {
    writeFileSync(pipeline, pipelineFile(
      [`- [ ] ${POSTING} | Acme | Engineer`],
      ['- [x] https://jobs.example/posting/7 | Acme | Analyst'],
    ));
    writeFileSync(history, historyFile([
      historyRow(POSTING, '2020-01-01', 'added'),
      historyRow('https://jobs.example/posting/7', '2026-11-01', 'added'),
    ]));
    await appendToPipeline([
      offer(POSTING_ALIAS, 'Engineer'),
      offer('https://jobs.example/posting/7?utm_source=li', 'Analyst'),
    ], { pipelinePath: pipeline, scanHistoryPath: history, historyPolicy: RELEASED });
    const lines = checkboxLines(readFileSync(pipeline, 'utf8'));
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.equal(lines.filter((line) => line.includes('[ ]')).length, 1);
    assert.equal(lines.filter((line) => /\[x\]/i.test(line)).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runHistoryWriter(root, historyPath, status, urls, { date = '2026-11-05', portalsPath = '' } = {}) {
  const source = `
    const { appendToScanHistory } = await import(${JSON.stringify(SCAN_URL)});
    const urls = ${JSON.stringify(urls)};
    await appendToScanHistory(urls.map((url) => ({
      url, source: 'test', title: 'Engineer', company: 'Acme', location: 'Remote',
    })), ${JSON.stringify(date)}, ${JSON.stringify(status)});
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
        CAREER_OPS_PORTALS: portalsPath,
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

function recheckPortals(root) {
  const portals = join(root, 'portals.yml');
  writeFileSync(portals, 'scan_history:\n  recheck_after_days: 30\n');
  return portals;
}

test('a released added row still records the next time the posting is added', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-one-job-hist-'));
  mkdirSync(join(root, 'data'));
  const history = join(root, 'data', 'scan-history.tsv');
  const portals = recheckPortals(root);
  try {
    writeFileSync(history, historyFile([
      historyRow(POSTING, '2020-01-01', 'added'),
    ]));
    await runHistoryWriter(root, history, 'added', [POSTING_ALIAS], {
      date: localToday(),
      portalsPath: portals,
    });
    const rows = historyRows(readFileSync(history, 'utf8'));
    assert.equal(rows.filter((line) => line.includes('\tadded\t')).length, 2, rows.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a relisting still records a later skipped_expired row', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-one-job-hist-'));
  mkdirSync(join(root, 'data'));
  const history = join(root, 'data', 'scan-history.tsv');
  const portals = recheckPortals(root);
  try {
    writeFileSync(history, historyFile([
      historyRow(POSTING, '2020-01-01', 'skipped_expired'),
      historyRow(POSTING_ALIAS, '2020-06-01', 'added'),
    ]));
    await runHistoryWriter(root, history, 'skipped_expired', [POSTING], {
      date: localToday(),
      portalsPath: portals,
    });
    const rows = historyRows(readFileSync(history, 'utf8'));
    assert.equal(rows.filter((line) => line.includes('skipped_expired')).length, 2, rows.join('\n'));
    assert.equal(rows.filter((line) => line.includes('\tadded\t')).length, 1, rows.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a still-pinning added row and a skip bucket stay one history row', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-one-job-hist-'));
  mkdirSync(join(root, 'data'));
  const history = join(root, 'data', 'scan-history.tsv');
  const portals = recheckPortals(root);
  const today = localToday();
  try {
    writeFileSync(history, historyFile([
      historyRow(POSTING, today, 'added'),
      historyRow('https://jobs.example/posting/7', '2020-01-01', 'skipped_title'),
    ]));
    await runHistoryWriter(root, history, 'added', [POSTING_ALIAS], {
      date: today,
      portalsPath: portals,
    });
    await runHistoryWriter(root, history, 'skipped_title', ['https://jobs.example/posting/7?utm_source=li'], {
      date: today,
      portalsPath: portals,
    });
    const rows = historyRows(readFileSync(history, 'utf8'));
    assert.equal(rows.filter((line) => line.includes('\tadded\t')).length, 1, rows.join('\n'));
    assert.equal(rows.filter((line) => line.includes('skipped_title')).length, 1, rows.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
