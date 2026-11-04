import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTING_URL = 'https://example.com/jobs/engineer';

function scan({ boardFirst, ownLocation = 'Berlin, Germany', ownFails = false, ownMissing = false, unscanned = false, ownTitle = 'Engineer', ownOld = false, mixedOwn = false, dryRun = false }) {
  const root = mkdtempSync(join(tmpdir(), 'scan-board-location-'));
  try {
    mkdirSync(join(root, 'data'));
    const entry = name => `  - name: ${name}\n    provider: builtin\n    builtin:\n      queries: [Engineer]\n    enabled: true\n`;
    writeFileSync(join(root, 'portals.yml'), `max_posting_age_days: 30\ntitle_filter:\n  positive: [Engineer]\nlocation_filter:\n  allow: [United States, USA]\n  always_allow: [United States, USA]\ntracked_companies:\n${unscanned ? '' : entry('Employer')}job_boards:\n${entry('Portfolio')}`);
    const preload = join(root, 'fixture.mjs');
    writeFileSync(preload, `
import provider from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers/builtin.mjs')).href)};
import { appendFileSync } from 'node:fs';
const options = ${JSON.stringify({ boardFirst, ownLocation, ownFails, ownMissing, ownTitle, ownOld, mixedOwn })};
provider.fetch = async entry => {
  const own = entry.name === 'Employer';
  await new Promise(resolve => setTimeout(resolve, (own === options.boardFirst) ? 150 : 5));
  appendFileSync(${JSON.stringify(join(root, 'order'))}, entry.name + '\\n');
  if (own && options.ownFails) throw new Error('Employer unavailable');
  if (own && options.ownMissing) return [];
  const jobs = [{ title: own ? options.ownTitle : 'Engineer', postedAt: own && options.ownOld ? Date.parse('2000-01-01') : null, company: 'Acme', url: own ? ${JSON.stringify(POSTING_URL)} : ${JSON.stringify(POSTING_URL + '?utm_source=portfolio')}, location: own ? options.ownLocation : 'Berlin, MD, USA', description: '' }];
  if (own && options.mixedOwn) jobs.unshift({ ...jobs[0], location: 'Berlin, Germany' });
  return jobs;
};
globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
`);
    const env = { ...process.env };
    for (const name of ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_PROFILE', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY']) delete env[name];
    Object.assign(env, { CAREER_OPS_ROOT: root, CAREER_OPS_PORTALS: join(root, 'portals.yml'), CAREER_OPS_HTTP_CACHE: '0' });
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'scan.mjs'), '--json', ...(dryRun ? ['--dry-run'] : [])], {
      cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, ownFails ? 2 : 0, result.stderr);
    const order = readFileSync(join(root, 'order'), 'utf8').trim().split('\n');
    assert.deepEqual(order, unscanned ? ['Portfolio'] : boardFirst ? ['Portfolio', 'Employer'] : ['Employer', 'Portfolio']);
    const read = name => existsSync(join(root, 'data', name)) ? readFileSync(join(root, 'data', name), 'utf8') : '';
    const pipeline = read('pipeline.md');
    const pipelineUrls = [...pipeline.matchAll(/^- \[ \] (\S+) \|/gm)].map(match => match[1]);
    return { receipt: JSON.parse(result.stdout), pipeline, pipelineUrls, history: read('scan-history.tsv') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const boardFirst of [false, true]) {
  test(`employer rejection blocks a board copy when ${boardFirst ? 'board' : 'employer'} finishes first`, () => {
    const result = scan({ boardFirst });
    assert.deepEqual(result.pipelineUrls, []);
    const skipped = result.history.trim().split('\n').slice(1);
    // History deduplicates the two copies by normalized URL and status.
    assert.equal(skipped.length, 1);
    assert.ok(skipped.every(row => row.split('\t')[5] === 'skipped_location'));
    assert.equal(skipped[0].split('\t')[0], POSTING_URL);
    assert.equal(result.receipt.filtered, 2);
    assert.equal(result.receipt.added, 0);
  });
  test(`employer accepted copy wins when ${boardFirst ? 'board' : 'employer'} finishes first`, () => {
    const result = scan({ boardFirst, ownLocation: 'United States' });
    assert.deepEqual(result.pipelineUrls, [POSTING_URL]);
    assert.match(result.history, /United States/);
    assert.doesNotMatch(result.history, /Berlin, MD, USA/);
    assert.equal(result.receipt.added, 1);
  });
}
for (const control of ['ownFails', 'ownMissing']) {
  test(`a board copy keeps its own location if the employer ${control === 'ownFails' ? 'fetch fails' : 'does not publish its URL'}`, () => {
    const result = scan({ boardFirst: true, [control]: true });
    assert.deepEqual(result.pipelineUrls, [POSTING_URL + '?utm_source=portfolio']);
    assert.equal(result.receipt.added, 1);
  });
}
test('dry run rejects the board copy without writing history or pipeline', () => {
  const result = scan({ boardFirst: true, dryRun: true });
  assert.equal(result.history, '');
  assert.equal(result.pipeline, '');
  assert.equal(result.receipt.filtered, 2);
  assert.equal(result.receipt.added, 0);
});

test('an unscanned employer leaves the board location decision unchanged', () => {
  const result = scan({ unscanned: true });
  assert.deepEqual(result.pipelineUrls, [POSTING_URL + '?utm_source=portfolio']);
  assert.equal(result.receipt.added, 1);
});
test('employer title rejection does not block the board copy', () => {
  const result = scan({ boardFirst: true, ownTitle: 'Accountant' });
  assert.deepEqual(result.pipelineUrls, [POSTING_URL + '?utm_source=portfolio']);
  assert.equal(result.receipt.added, 1);
});

test('an accepted employer location wins over a rejected variant of its URL', () => {
  const result = scan({ boardFirst: true, ownLocation: 'United States', mixedOwn: true });
  assert.equal(result.receipt.added, 1);
  assert.equal(result.receipt.filtered, 1);
  assert.equal(result.receipt.duplicates, 1);
  assert.match(result.pipeline, /United States/);
});
test('employer age rejection does not block the board copy', () => {
  const result = scan({ boardFirst: true, ownLocation: 'United States', ownOld: true });
  assert.deepEqual(result.pipelineUrls, [POSTING_URL + '?utm_source=portfolio']);
  assert.equal(result.receipt.added, 1);
});
