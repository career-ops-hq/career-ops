import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { spawn, spawnSync } from 'node:child_process';
import { captureJd, captureName, commitCapture, deriveLabels, appendPendingRow, urlAlreadyPresent, today } from '../capture-jd.mjs';
import { captureIdentity, findCaptureForUrl } from '../jd-capture.mjs';
import { ensureToken, createServer } from '../capture-server.mjs';

// Isolate every Git subprocess, including production calls inheriting process.env.
for (const key of Object.keys(process.env)) {
  if (/^GIT_/i.test(key)) delete process.env[key];
}
const sandbox = mkdtempSync(path.join(tmpdir(), 'capture-jd-suite-'));
const hooks = path.join(sandbox, 'empty-hooks');
mkdirSync(hooks);
Object.assign(process.env, {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(sandbox, 'no-global-config'),
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: hooks,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ALLOW_PROTOCOL: 'file',
  // A broken server-side guard must never launch a real, potentially paid CLI.
  CAREER_OPS_CLI: path.join(sandbox, 'forbidden-evaluation'),
});
test.after(() => rmSync(sandbox, { recursive: true, force: true }));

function scratch({ pipeline = '# Pipeline\n\n## Pending\n\n## Processed\n' } = {}) {
  const root = mkdtempSync(path.join(sandbox, 'data-'));
  mkdirSync(path.join(root, 'data'), { recursive: true });
  writeFileSync(path.join(root, 'data', 'pipeline.md'), pipeline);
  return root;
}

const readPipeline = (root) => readFileSync(path.join(root, 'data', 'pipeline.md'), 'utf-8');
const rowLines = (root) => readPipeline(root).split(/\r?\n/).filter((l) => /^\s*-\s*\[[ xX!]\]/.test(l));

// --- labels ---------------------------------------------------------------

test('deriveLabels reads "role at company"', () => {
  const { company, role } = deriveLabels('https://acme.com/jobs/1', 'Senior Backend Engineer at Acme');
  assert.equal(company, 'Acme');
  assert.equal(role, 'Senior Backend Engineer');
});

test('deriveLabels reads "role | company" and "role - company"', () => {
  assert.deepEqual(deriveLabels('https://x.test', 'Staff Engineer | Acme'), { company: 'Acme', role: 'Staff Engineer' });
  assert.deepEqual(deriveLabels('https://x.test', 'Staff Engineer - Globex'), { company: 'Globex', role: 'Staff Engineer' });
});

test('deriveLabels takes the tenant slug on a multi-tenant ATS, not "Boards"', () => {
  assert.equal(deriveLabels('https://boards.greenhouse.io/acme/jobs/123').company, 'Acme');
  assert.equal(deriveLabels('https://jobs.lever.co/globex/1').company, 'Globex');
  assert.equal(deriveLabels('https://jobs.ashbyhq.com/vercel/abc').company, 'Vercel');
});

test('deriveLabels drops a generic jobs./careers. prefix and the TLD', () => {
  assert.equal(deriveLabels('https://jobs.siemens-energy.com/en/jobs/1').company, 'Siemens Energy');
  assert.equal(deriveLabels('https://www.sapira.ai/careers/x').company, 'Sapira');
});

test('deriveLabels leaves the role empty rather than inventing one', () => {
  assert.equal(deriveLabels('https://acme.com/jobs/1').role, '');
});

// --- naming ---------------------------------------------------------------

test('captureName uses the same URL identity archive-posting.mjs writes', () => {
  const url = 'https://acme.com/jobs/1';
  const name = captureName({ company: 'Acme', role: 'Staff Engineer', url, date: '2026-11-12' });
  assert.equal(name, `2026-11-12_acme_staff-engineer_${captureIdentity(url)}.md`);
  assert.match(name, /^2026-11-12_acme_staff-engineer_[0-9a-f]{16}\.md$/);
});

test('findCaptureForUrl resolves a capture from the URL alone', async () => {
  const root = scratch();
  const url = 'https://boards.greenhouse.io/acme/jobs/456';
  await captureJd({ url, text: 'JD body', title: 'Engineer at Acme', dataRoot: root, date: '2026-11-12' });

  const found = findCaptureForUrl(path.join(root, 'jds'), url);
  assert.ok(found, 'capture should be found by URL');
  assert.match(found.filename, /_acme_engineer_[0-9a-f]{16}\.md$/);
  assert.equal(found.ext, '.md');
});

test('findCaptureForUrl returns null for a URL never captured, and for non-http', () => {
  const root = scratch();
  assert.equal(findCaptureForUrl(path.join(root, 'jds'), 'https://nowhere.test/1'), null);
  assert.equal(findCaptureForUrl(path.join(root, 'jds'), 'chrome://extensions'), null);
});

// --- capture --------------------------------------------------------------

test('URL only writes a pipeline row and no capture file', async () => {
  const root = scratch();
  const result = await captureJd({ url: 'https://acme.com/jobs/1', title: 'Engineer at Acme', dataRoot: root, date: '2026-11-12' });

  assert.equal(result.ok, true);
  assert.equal(result.capture, null);
  assert.equal(result.appended, true);
  assert.equal(existsSync(path.join(root, 'jds')), false);
  assert.deepEqual(rowLines(root), ['- [ ] https://acme.com/jobs/1 | Acme | Engineer | note: url only']);
});

test('JD text writes a capture beside the row, with provenance', async () => {
  const root = scratch();
  const result = await captureJd({
    url: 'https://acme.com/jobs/2',
    text: 'We are hiring.\nSecond line.',
    title: 'Staff Engineer at Acme',
    dataRoot: root,
    date: '2026-11-12',
  });

  assert.equal(result.hasText, true);
  const body = readFileSync(result.capture, 'utf-8');
  assert.match(body, /\*\*URL:\*\* https:\/\/acme\.com\/jobs\/2/);
  assert.match(body, /We are hiring\.\nSecond line\./);
  assert.match(body, /Untrusted external content/);
  assert.equal(readdirSync(path.join(root, 'jds')).length, 1);
});

test('the same URL twice is a no-op', async () => {
  const root = scratch();
  await captureJd({ url: 'https://acme.com/jobs/3', dataRoot: root, date: '2026-11-12' });
  const second = await captureJd({ url: 'https://acme.com/jobs/3', text: 'again', dataRoot: root, date: '2026-11-12' });

  assert.equal(second.duplicate, true);
  assert.equal(second.appended, false);
  assert.equal(second.committed, false);
  assert.equal(rowLines(root).length, 1);
});

test('a trailing slash does not defeat deduplication', async () => {
  const root = scratch();
  await captureJd({ url: 'https://acme.com/jobs/4', dataRoot: root, date: '2026-11-12' });
  const second = await captureJd({ url: 'https://acme.com/jobs/4/', dataRoot: root, date: '2026-11-12' });
  assert.equal(second.duplicate, true);
});

test('a non-http URL is refused', async () => {
  const result = await captureJd({ url: 'javascript:alert(1)', dataRoot: scratch() });
  assert.equal(result.ok, false);
});

test('rows are appended one per line, under the Pending heading', async () => {
  const root = scratch({ pipeline: '# Pipeline\n\n## Pending\n\n## Processed\n' });
  await captureJd({ url: 'https://a.test/1', dataRoot: root, date: '2026-11-12' });
  await captureJd({ url: 'https://b.test/2', dataRoot: root, date: '2026-11-12' });

  const lines = readPipeline(root).split(/\r?\n/);
  const firstRow = lines.findIndex((l) => l.startsWith('- [ ] https://a.test/1'));
  assert.equal(lines[firstRow], '- [ ] https://a.test/1 | A |  | note: url only');
  assert.equal(lines[firstRow + 1], '- [ ] https://b.test/2 | B |  | note: url only');
  assert.equal(lines[firstRow - 1], '');
  assert.equal(lines[firstRow - 2], '## Pending');
});

test('a pipeline with no Pending section gets one, above Processed', async () => {
  const root = scratch({ pipeline: '# Pipeline\n\n## Processed\n\n- [x] old\n' });
  await captureJd({ url: 'https://a.test/9', dataRoot: root, date: '2026-11-12' });
  const text = readPipeline(root);
  assert.ok(text.indexOf('## Pending') < text.indexOf('## Processed'));
  assert.match(text, /## Pending\n\n- \[ \] https:\/\/a\.test\/9/);
});

test('a localized Pending heading is used as-is', async () => {
  const root = scratch({ pipeline: '# Pipeline\n\n## Pendientes\n\n## Procesadas\n' });
  await appendPendingRow(path.join(root, 'data', 'pipeline.md'), '- [ ] https://a.test/10 | A | B', 'https://a.test/10');
  const text = readPipeline(root);
  assert.match(text, /## Pendientes\n\n- \[ \] https:\/\/a\.test\/10 \| A \| B\n\n## Procesadas/);
});

test('urlAlreadyPresent ignores Processed rows mismatch and matches exact cells', () => {
  const text = '- [x] https://a.test/1 | A\n- [ ] https://a.test/2 | B\n';
  assert.equal(urlAlreadyPresent(text, 'https://a.test/1'), true);
  assert.equal(urlAlreadyPresent(text, 'https://a.test/2'), true);
  assert.equal(urlAlreadyPresent(text, 'https://a.test/3'), false);
  assert.equal(urlAlreadyPresent(text, 'https://a.test/'), false);
});

test('company and role overrides win over the title', async () => {
  const root = scratch();
  const result = await captureJd({
    url: 'https://acme.com/jobs/7',
    title: 'Something Else at Somewhere',
    company: 'Acme',
    role: 'Head of AI',
    dataRoot: root,
    date: '2026-11-12',
  });
  assert.equal(result.company, 'Acme');
  assert.equal(result.role, 'Head of AI');
  assert.match(rowLines(root)[0], /\| Acme \| Head of AI( \| note: url only)?$/);
});

// --- R1 duplicate-preservation regressions ---------------------------------

test('duplicate text capture preserves original bytes, mtime and file count', async () => {
  const root = scratch();
  const input = { url: 'https://acme.test/jobs/preserve', text: 'original', company: 'Acme', role: 'Engineer', date: '2026-11-12', dataRoot: root };
  const first = await captureJd(input);
  utimesSync(first.capture, new Date('2020-01-01'), new Date('2020-01-01'));
  const before = readFileSync(first.capture);
  const mtime = statSync(first.capture).mtimeMs;
  const pipeline = readPipeline(root);
  const second = await captureJd({ ...input, text: 'replacement' });
  assert.equal(second.duplicate, true);
  assert.deepEqual(readFileSync(first.capture), before);
  assert.equal(statSync(first.capture).mtimeMs, mtime);
  assert.equal(readdirSync(path.join(root, 'jds')).length, 1);
  assert.equal(readPipeline(root), pipeline);
  assert.equal(second.capture, null);
});

test('duplicate on a different day and labels produces no new archive', async () => {
  const root = scratch();
  const url = 'https://acme.test/jobs/labels';
  await captureJd({ url, text: 'original', company: 'Acme', role: 'Engineer', date: '2026-11-12', dataRoot: root });
  const before = readdirSync(path.join(root, 'jds'));
  const second = await captureJd({ url, text: 'changed', company: 'Other', role: 'Lead', date: '2026-11-13', dataRoot: root });
  assert.equal(second.duplicate, true);
  assert.deepEqual(readdirSync(path.join(root, 'jds')), before);
});

test('URL-only then text duplicate creates no jds directory', async () => {
  const root = scratch();
  const url = 'https://acme.test/jobs/url-only';
  await captureJd({ url, dataRoot: root });
  const before = readPipeline(root);
  const second = await captureJd({ url, text: 'later text', dataRoot: root });
  assert.equal(second.duplicate, true);
  assert.equal(existsSync(path.join(root, 'jds')), false);
  assert.equal(readPipeline(root), before);
});

for (const row of [
  '- [x] #143 | https://acme.test/jobs/processed | Acme | Engineer | 4.2/5 | PDF ✅',
  '- [x] ~~https://acme.test/jobs/processed | Acme | Engineer~~ — posting expired (liveness sweep)',
]) {
  test(`documented Processed row is a genuine no-op: ${row}`, async () => {
    const root = scratch({ pipeline: `# Pipeline\n\n## Pending\n\n## Processed\n\n${row}\n` });
    const before = readPipeline(root);
    const result = await captureJd({ url: 'https://acme.test/jobs/processed/', text: 'must not archive', dataRoot: root });
    assert.equal(result.duplicate, true);
    assert.equal(readPipeline(root), before);
    assert.equal(existsSync(path.join(root, 'jds')), false);
  });
}

test('concurrent same URL distinct texts labels and days keep only winner capture', async () => {
  const root = scratch();
  const url = 'https://acme.test/jobs/race';
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => captureJd({
    url, text: `JD contender ${i}`, company: `Company ${i}`, role: `Role ${i}`,
    date: `2026-11-${12 + i}`, dataRoot: root,
  })));
  const winners = results.filter((r) => r.appended);
  assert.equal(winners.length, 1);
  assert.equal(rowLines(root).length, 1);
  assert.deepEqual(readdirSync(path.join(root, 'jds')), [path.basename(winners[0].capture)]);
  assert.ok(results.filter((r) => r.duplicate).every((r) => r.capture === null));
  assert.ok(readPipeline(root).includes(`| ${winners[0].company} | ${winners[0].role}`));
  assert.ok(readFileSync(winners[0].capture, 'utf8').includes(`JD contender ${results.indexOf(winners[0])}`));
});

test('independent processes racing one URL keep exactly the winner archive', async () => {
  const root = scratch();
  const moduleUrl = new URL('../capture-jd.mjs', import.meta.url).href;
  const script = `import { captureJd } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(await captureJd(JSON.parse(process.argv[1]))));`;
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => new Promise((resolve, reject) => {
    const input = { url: 'https://acme.test/jobs/process-race', text: `process ${i}`,
      company: `Company ${i}`, role: `Role ${i}`, date: `2026-11-${12 + i}`,
      dataRoot: root, commit: false, push: false };
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], {
      cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`child exited ${code}: ${stderr}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  })));
  const winners = results.filter((r) => r.appended);
  assert.equal(winners.length, 1);
  assert.equal(rowLines(root).length, 1);
  assert.deepEqual(readdirSync(path.join(root, 'jds')), [path.basename(winners[0].capture)]);
  assert.ok(results.filter((r) => r.duplicate).every((r) => r.capture === null));
  assert.ok(readPipeline(root).includes(`| ${winners[0].company} | ${winners[0].role}`));
  assert.ok(readFileSync(winners[0].capture, 'utf8').includes(`process ${results.indexOf(winners[0])}`));
});

test('capture creates a nonexistent data directory within the lock boundary', async () => {
  const root = path.join(scratch(), 'new-root');
  const result = await captureJd({ url: 'https://acme.test/jobs/new-root', text: 'JD', dataRoot: root });
  assert.equal(result.appended, true);
  assert.equal(rowLines(root).length, 1);
  assert.equal(existsSync(result.capture), true);
});

// --- commit guard ---------------------------------------------------------

function initRepo(root) {
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  assert.equal(git('init', '-q').status, 0, 'git init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  return git;
}

test('a data root nested inside another repository is never committed into it', () => {
  const outer = mkdtempSync(path.join(sandbox, 'outer-'));
  initRepo(outer);
  const nested = path.join(outer, 'nested-data');
  mkdirSync(nested, { recursive: true });

  const result = commitCapture({ dataRoot: nested, files: ['anything.md'], message: 'x', push: false });
  assert.equal(result.committed, false);
  assert.equal(result.reason, 'data-root-not-repo-root');
});

test('a capture commit contains only its own two files, leaving the rest dirty', async () => {
  const root = scratch();
  const git = initRepo(root);
  git('add', '--', 'data/pipeline.md');
  assert.equal(git('commit', '-qm', 'init').status, 0, 'initial commit');

  // An unrelated user file that must survive the capture untouched.
  writeFileSync(path.join(root, 'data', 'applications.md'), 'dirty before\n');

  const result = await captureJd({
    url: 'https://acme.com/jobs/21',
    text: 'JD',
    title: 'Engineer at Acme',
    dataRoot: root,
    date: '2026-11-12',
    commit: true,
    push: false,
  });

  assert.equal(result.committed, true, JSON.stringify(result));
  const changed = git('show', '--name-only', '--format=', 'HEAD').stdout.trim().split(/\r?\n/);
  assert.equal(changed.length, 2);
  assert.ok(changed.includes('data/pipeline.md'));
  assert.ok(changed.some((f) => f.startsWith('jds/')));
  assert.match(git('status', '--porcelain').stdout, /data\/applications\.md/);
  assert.equal(readFileSync(path.join(root, 'data', 'applications.md'), 'utf-8'), 'dirty before\n');
});

// --- server ---------------------------------------------------------------

test('ensureToken creates a token once and reuses it', () => {
  const root = scratch();
  const a = ensureToken(root);
  const b = ensureToken(root);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{48}$/);
});

test('the capture endpoint refuses a request without the token', async () => {
  const root = scratch();
  const token = ensureToken(root);
  const server = createServer({ dataRoot: root, token, evalEnabled: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    const noToken = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://acme.com/jobs/8', commit: false, push: false, evaluate: false }),
    });
    assert.equal(noToken.status, 401);
    assert.equal(rowLines(root).length, 0);

    const ok = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Capture-Token': token },
      body: JSON.stringify({ url: 'https://acme.com/jobs/8', title: 'Engineer at Acme', text: 'jd', commit: false, push: false, evaluate: false }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.hasText, true);
    assert.equal(rowLines(root).length, 1);
    assert.equal(existsSync(body.capture), true);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('server-side evaluation disable overrides an evaluate request', async () => {
  const root = scratch();
  const token = ensureToken(root);
  const server = createServer({ dataRoot: root, token, evalEnabled: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Capture-Token': token },
      body: JSON.stringify({ url: 'https://acme.com/jobs/11', commit: false, push: false, evaluate: true }),
    });
    const body = await res.json();
    assert.equal(body.evaluation, null);
    assert.equal(existsSync(path.join(root, 'data', 'capture-evals.log')), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
