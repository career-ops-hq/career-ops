// A board controls the URLs it lists, and the scanner copies them into
// data/pipeline.md and data/scan-history.tsv — files the agent then reads back
// as data. Only an absolute http(s) URL is a posting: a `javascript:` href,
// `file:`, a placeholder or free text must never become a row, and the markdown
// cell must not carry characters that break it (a backtick opens inline code,
// `<`/`>` can be read as HTML).
//
// Run:  node --test tests/pipeline-url-safety.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendToPipeline,
  appendToScanHistory,
  formatPipelineOffer,
  formatScanHistoryRow,
  safePostingUrl,
} from '../scan.mjs';

test('safePostingUrl keeps http(s) and refuses every other scheme', () => {
  assert.equal(safePostingUrl('https://boards.example/jobs/1'), 'https://boards.example/jobs/1');
  assert.equal(safePostingUrl('  http://boards.example/jobs/2  '), 'http://boards.example/jobs/2');
  for (const bad of [
    'javascript:alert(document.domain)',
    'file:///etc/passwd',
    'mailto:jobs@example.com',
    'data:text/html,<script>alert(1)</script>',
    '//boards.example/jobs/3',
    '/jobs/4',
    'not a url',
    '',
    '   ',
  ]) {
    assert.equal(safePostingUrl(bad), '', `expected no posting URL for ${JSON.stringify(bad)}`);
  }
});

test('formatPipelineOffer writes no row for a URL that is not a posting', () => {
  assert.equal(formatPipelineOffer({ url: 'javascript:alert(1)', company: 'Acme', title: 'Dev' }), '');
  assert.equal(formatPipelineOffer({ url: 'file:///etc/passwd', company: 'Acme', title: 'Dev' }), '');
  assert.equal(formatPipelineOffer({ company: 'Acme', title: 'Dev' }), '');
});

test('a normal posting row is byte-identical to before', () => {
  assert.equal(
    formatPipelineOffer({ url: 'https://boards.example/jobs/42', company: 'Acme', title: 'Senior Dev' }),
    '- [ ] https://boards.example/jobs/42 | Acme | Senior Dev',
  );
  assert.equal(
    formatPipelineOffer({
      url: 'https://boards.example/jobs/42',
      company: 'Acme | Labs',
      title: 'Dev',
      location: 'Remote',
      salary: { min: 100000, max: 120000, currency: 'USD' },
    }),
    '- [ ] https://boards.example/jobs/42 | Acme / Labs | Dev | Remote | 100000-120000 USD',
  );
});

test('the pipeline cell cannot carry markdown-breaking characters', () => {
  const row = formatPipelineOffer({
    url: 'https://boards.example/a`b<c>d|e[f]',
    company: 'Acme',
    title: 'Dev',
  });
  assert.ok(row.includes('%60'), 'backtick is percent-encoded');
  assert.ok(row.includes('%3C') && row.includes('%3E'), 'angle brackets are percent-encoded');
  assert.ok(row.includes('%7C'), 'pipe is percent-encoded');
  assert.ok(row.includes('\\[f\\]'), 'brackets keep the existing escape');
  assert.ok(!row.includes('`'), 'no raw backtick survives into the row');
  assert.ok(!/[<>]/.test(row), 'no raw angle bracket survives into the row');
});

test('scan-history rows carry only a safe URL', () => {
  const bad = formatScanHistoryRow({ url: 'javascript:alert(1)', company: 'Acme', title: 'Dev' }, '2026-11-22');
  assert.equal(bad.split('\t')[0], '', 'the url cell is empty, so readers skip the row');
  const good = formatScanHistoryRow({ url: 'https://boards.example/jobs/7', company: 'Acme', title: 'Dev' }, '2026-11-22');
  assert.equal(good.split('\t')[0], 'https://boards.example/jobs/7');
});

test('appendToPipeline drops a hostile URL and still writes the valid offers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-url-safety-'));
  try {
    const pipelinePath = join(dir, 'pipeline.md');
    const scanHistoryPath = join(dir, 'scan-history.tsv');
    const offers = [
      { url: 'javascript:alert(document.domain)', company: 'Hostile', title: 'Dev' },
      { url: 'https://boards.example/jobs/9', company: 'Acme', title: 'Dev' },
    ];
    await appendToPipeline(offers, { pipelinePath, scanHistoryPath, historyPolicy: {} });
    const text = readFileSync(pipelinePath, 'utf-8');
    // Exact row equality rather than a substring check: this is the whole set
    // the file may contain, so it also proves the hostile offer never became a
    // line. A URL substring test is both weaker and a CodeQL pattern.
    const rows = text.split(/\r?\n/).filter((line) => line.startsWith('- [ ]'));
    assert.deepEqual(rows, ['- [ ] https://boards.example/jobs/9 | Acme | Dev']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('appendToScanHistory records only a safe URL, and an all-rejected batch leaves the file untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-history-url-safety-'));
  try {
    const historyPath = join(dir, 'scan-history.tsv');
    const written = await appendToScanHistory([
      { url: 'javascript:alert(document.domain)', company: 'Hostile', title: 'Dev' },
      { url: 'https://boards.example/jobs/10', company: 'Acme', title: 'Dev' },
    ], '2026-11-23', 'added', { historyPath, historyPolicy: {} });
    assert.equal(written, 1, 'only the safe offer is recorded');

    const lines = readFileSync(historyPath, 'utf-8').split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 2, 'header plus one data row');
    assert.equal(lines[1].split('\t')[0], 'https://boards.example/jobs/10');

    const before = readFileSync(historyPath);
    const appended = await appendToScanHistory(
      [{ url: 'file:///etc/passwd', company: 'X', title: 'Y' }],
      '2026-11-23',
      'added',
      { historyPath, historyPolicy: {} },
    );
    assert.equal(appended, 0);
    assert.deepEqual(readFileSync(historyPath), before, 'an all-rejected batch writes nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
