import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync, utimesSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { spawn, spawnSync } from 'node:child_process';
import { atomicWrite, captureJd, captureName, commitCapture, deriveLabels, appendPendingRow, urlAlreadyPresent, today } from '../capture-jd.mjs';
import { captureIdentity, findCaptureForUrl } from '../jd-capture.mjs';
import { ensureToken, createServer, startEvaluation, isLoopbackHost } from '../capture-server.mjs';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

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
// The URL cell of a pipeline row, compared whole (never as a substring).
const rowUrl = (line) => /^\s*-\s*\[[ xX!]\]\s+(\S+)/.exec(line)?.[1];

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
    console.log(JSON.stringify(await captureJd(JSON.parse(process.env.CAPTURE_INPUT))));`;
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => new Promise((resolve, reject) => {
    const input = { url: 'https://acme.test/jobs/process-race', text: `process ${i}`,
      company: `Company ${i}`, role: `Role ${i}`, date: `2026-11-${12 + i}`,
      dataRoot: root, commit: false, push: false };
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, env: { ...process.env, CAPTURE_INPUT: JSON.stringify(input) }, stdio: ['ignore', 'pipe', 'pipe'],
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

// --- R2 URL and capture-file boundary regressions --------------------------

test('invalid capture URLs are refused before any filesystem or Git activity', async () => {
  const invalidUrls = [
    'https://', 'https:///acme.test/jobs/1', 'https://[bad', 'https://acme.test:999999/1',
    'file:///etc/passwd', 'https:/acme.test/jobs/1',
    'https://user:pass@acme.test/jobs/1', 'https://user@acme.test/1', 'https://@acme.test/1',
    'https://acme.test/job s/1', 'https://acme.test/jobs/\n1', 'https://acme.test/jobs/\t1',
    'https://acme.test/jobs/\u00001', 'https://acme.test/jobs/\u007f1',
    'https:\\\\acme.test\\jobs\\1', 'https://acme.test/jobs/1\\next',
    'https://acme.test/jobs/1|other', 'https://acme.test/jobs/%ZZ', 'https://acme.test/jobs/%2',
  ];

  for (const url of invalidUrls) {
    const root = path.join(sandbox, `invalid-${captureIdentity(url)}`);
    const result = await captureJd({
      url, text: 'must not write', dataRoot: root, commit: true,
      get title() { throw new Error('invalid URL reached label derivation'); },
    });
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(url)}`);
    assert.equal(existsSync(root), false, `unexpected filesystem write for ${JSON.stringify(url)}`);
  }
});

test('outer URL whitespace is trimmed while valid raw URL identity is preserved', async () => {
  const root = scratch();
  const rawUrl = 'HTTPS://Acme.Test:443/jobs/a%2fb?source=career-ops#Here';
  const result = await captureJd({ url: `  ${rawUrl} \t`, text: 'JD', dataRoot: root, date: '2026-11-12' });

  assert.equal(result.ok, true);
  assert.equal(result.url, rawUrl);
  assert.ok(result.capture.endsWith(`_${captureIdentity(rawUrl)}.md`));
  assert.ok(readPipeline(root).includes(`- [ ] ${rawUrl} | Acme | `));
});

test('captureName rejects impossible dates and unsupported or unsafe extensions', () => {
  const base = { company: 'Acme', role: 'Engineer', url: 'https://acme.test/jobs/1' };
  for (const date of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-11-00', '2026-2-03', '../2026-11-12', '2026-11-12/..']) {
    assert.throws(() => captureName({ ...base, date }), `date ${date}`);
  }
  for (const ext of ['exe', '../md', '.md', 'md/../../x']) {
    assert.throws(() => captureName({ ...base, date: '2026-11-12', ext }), `extension ${ext}`);
  }
  assert.equal(captureName({ ...base, date: '2024-02-29' }), `2024-02-29_acme_engineer_${captureIdentity(base.url)}.md`);
  const safe = captureName({ ...base, date: '2026-11-12', company: '../../Acme\\evil', role: '../Engineer:role' });
  assert.equal(path.basename(safe), safe);
  assert.match(safe, /^2026-11-12_[a-z0-9-]+_[a-z0-9-]+_[a-f0-9]{16}\.md$/);
});

test('invalid capture date is rejected before creating the data root', async () => {
  const root = path.join(sandbox, 'invalid-date-root');
  const result = await captureJd({ url: 'https://acme.test/jobs/date', text: 'JD', date: '../escape', dataRoot: root });
  assert.equal(result.ok, false);
  assert.equal(existsSync(root), false);
});

test('findCaptureForUrl only resolves a hash suffix and known archive extensions', () => {
  const root = scratch();
  const jds = path.join(root, 'jds');
  mkdirSync(jds);
  const url = 'https://acme.test/jobs/exact-suffix';
  const hash = captureIdentity(url);
  const names = [
    `2026-11-12_acme_engineer_${hash}.md`,
    `064-2026-11-12_acme_engineer_${hash}-2.pdf`,
    `2026-11-12_acme_${hash}_engineer.md`,
    `2026-11-12_acme_engineer_${hash}.docx`,
    `2026-11-12_acme_engineer_x${hash}.txt`,
    `2026-11-12_acme_engineer_${hash}0.html`,
    `2026-11-12_acme_engineer_${hash}-extra.md`,
    `2026-11-12_acme_engineer_${hash}-1.md`,
  ];
  for (const name of names) writeFileSync(path.join(jds, name), 'capture');

  const found = findCaptureForUrl(jds, url);
  assert.equal(found.filename, names[0]);
  assert.deepEqual(found.candidates, names.slice(0, 2));
  assert.equal(findCaptureForUrl(jds, url, { extensions: ['.pdf', '.md'] }).filename, names[1]);
  assert.equal(findCaptureForUrl(jds, url, { extensions: ['.docx'] }), null);
});

test('findCaptureForUrl rejects invalid URLs even when a matching hash file exists', () => {
  const root = scratch();
  const jds = path.join(root, 'jds');
  mkdirSync(jds);
  for (const url of ['https://', 'https://user:pass@acme.test/1', 'https://acme.test/%zz']) {
    writeFileSync(path.join(jds, `2026-11-12_acme_role_${captureIdentity(url)}.md`), 'capture');
    assert.equal(findCaptureForUrl(jds, url), null);
  }
});

test('findCaptureForUrl ignores directories', () => {
  const root = scratch();
  const jds = path.join(root, 'jds');
  mkdirSync(jds);
  const url = 'https://acme.test/jobs/file-types';
  const hash = captureIdentity(url);
  const directoryName = `2026-11-12_acme_engineer_${hash}.md`;
  mkdirSync(path.join(jds, directoryName));
  assert.equal(findCaptureForUrl(jds, url), null);
});

test('findCaptureForUrl ignores symlink captures', (t) => {
  const root = scratch();
  const jds = path.join(root, 'jds');
  mkdirSync(jds);
  const url = 'https://acme.test/jobs/symlink';
  const hash = captureIdentity(url);
  const target = path.join(root, 'target.md');
  const linkName = `2026-11-12_acme_engineer_${hash}-2.md`;
  writeFileSync(target, 'not a capture');
  try {
    symlinkSync(target, path.join(jds, linkName));
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOSYS', 'UNKNOWN'].includes(error.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.equal(findCaptureForUrl(jds, url), null);
});

test('malformed percent-encoded ATS tenant does not throw during label derivation', () => {
  for (const tenant of ['%E0%A4%A', '%FF']) {
    assert.doesNotThrow(() => deriveLabels(`https://boards.greenhouse.io/${tenant}/jobs/123`));
    assert.equal(deriveLabels(`https://boards.greenhouse.io/${tenant}/jobs/123`).company, '');
  }
});

test('JD output refuses a pre-existing symlink without changing its target or pipeline', async (t) => {
  const root = scratch();
  const jds = path.join(root, 'jds');
  mkdirSync(jds);
  const input = { url: 'https://acme.test/jobs/output-link', company: 'Acme', role: 'Engineer',
    date: '2026-11-12', text: 'replacement JD', dataRoot: root, commit: false, push: false };
  const output = path.join(jds, captureName(input));
  const target = path.join(root, 'outside-jds.md');
  writeFileSync(target, 'untouched external target');
  const pipeline = readPipeline(root);
  const targetMtime = statSync(target).mtimeMs;
  try {
    symlinkSync(target, output);
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOSYS', 'UNKNOWN'].includes(error.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  let failure;
  try { await captureJd(input); } catch (error) { failure = error; }
  assert.equal(readFileSync(target, 'utf8'), 'untouched external target');
  assert.equal(statSync(target).mtimeMs, targetMtime);
  assert.equal(readPipeline(root), pipeline);
  assert.equal(lstatSync(output).isSymbolicLink(), true);
  assert.deepEqual(readdirSync(jds), [path.basename(output)]);
  assert.match(failure?.message || '', /refus.*symlink/i);
});

test('pipeline atomic writing retains intentional symlink semantics', async (t) => {
  const root = scratch();
  const pipeline = path.join(root, 'data', 'pipeline.md');
  const target = path.join(root, 'pipeline-target.md');
  writeFileSync(target, readPipeline(root));
  rmSync(pipeline);
  try {
    symlinkSync(target, pipeline);
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOSYS', 'UNKNOWN'].includes(error.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const result = await captureJd({ url: 'https://acme.test/jobs/pipeline-link', dataRoot: root, commit: false });
  assert.equal(result.appended, true);
  assert.equal(lstatSync(pipeline).isSymbolicLink(), true);
  const targetRowUrls = readFileSync(target, 'utf8').split(/\r?\n/)
    .map((line) => /^\s*-\s*\[[ xX!]\]\s+(\S+)/.exec(line)?.[1])
    .filter(Boolean);
  assert.deepEqual(targetRowUrls, ['https://acme.test/jobs/pipeline-link'], 'the row was written through the symlink');
});

// --- review follow-ups ------------------------------------------------------

test('a capture commit works when the data root is reached through a symlink', async (t) => {
  const real = scratch();
  const git = initRepo(real);
  git('add', '--', 'data/pipeline.md');
  assert.equal(git('commit', '-qm', 'init').status, 0, 'initial commit');
  const link = path.join(sandbox, `link-${path.basename(real)}`);
  try {
    symlinkSync(real, link, 'junction');
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOSYS', 'UNKNOWN'].includes(error.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const result = await captureJd({
    url: 'https://acme.com/jobs/symlinked-root',
    text: 'JD',
    title: 'Engineer at Acme',
    dataRoot: link,
    date: '2026-11-12',
    commit: true,
    push: false,
  });
  assert.equal(result.committed, true, JSON.stringify(result));
});

test('a failed atomic write leaves no temp file behind', () => {
  const root = scratch();
  const target = path.join(root, 'jds');
  mkdirSync(target);
  assert.throws(() => atomicWrite(target, 'text'));
  assert.deepEqual(readdirSync(root).filter((name) => name.includes('.tmp-')), []);
});

test('--flag=value keeps every = after the first one', () => {
  const root = scratch();
  const script = path.join(import.meta.dirname, '..', 'capture-jd.mjs');
  const run = spawnSync(process.execPath, [script, '--url=https://acme.test/jobs?id=5', '--json'], {
    cwd: root, encoding: 'utf-8', input: '',
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).url, 'https://acme.test/jobs?id=5');
});

test('startEvaluation on win32 keeps the URL on one quoted command-line argument', () => {
  const root = scratch();
  const calls = [];
  const fakeSpawn = (bin, args, options) => {
    calls.push({ bin, args, options });
    return { on() { return this; }, unref() {} };
  };
  const url = 'https://acme.test/jobs/42?id=5';
  const result = startEvaluation({ url, dataRoot: root, cli: 'opencode', platform: 'win32', spawnFn: fakeSpawn });
  assert.equal(result.started, true, JSON.stringify(result));
  assert.equal(calls.length, 1);
  const { args, options } = calls[0];
  assert.equal(options.shell, true);
  assert.ok(args.every((arg) => !/[\r\n]/.test(arg)), 'no newline survives to cmd.exe');
  const prompt = args[args.length - 1];
  assert.ok(prompt.startsWith('"') && prompt.endsWith('"'), 'prompt is one quoted argument');
  assert.ok(prompt.split(/[\s"]+/).some((token) => token === url), 'the URL reaches the spawned CLI as a whole token');
});

test('startEvaluation on win32 refuses a URL with cmd.exe metacharacters', () => {
  const root = scratch();
  for (const url of ['https://acme.test/jobs?a=1&b=2', 'https://acme.test/%PATH%', 'https://acme.test/a"b', 'https://acme.test/a^b', 'https://acme.test/<x>']) {
    const calls = [];
    const result = startEvaluation({ url, dataRoot: root, cli: 'opencode', platform: 'win32', spawnFn: (...a) => { calls.push(a); return { on() { return this; }, unref() {} }; } });
    assert.equal(result.started, false, url);
    assert.match(result.reason, /cmd\.exe|unsafe/i);
    assert.equal(calls.length, 0, `${url} must not spawn`);
  }
});

test('startEvaluation off win32 spawns without a shell and passes the URL unquoted', () => {
  const root = scratch();
  const calls = [];
  const url = 'https://acme.test/jobs?a=1&b=2';
  const result = startEvaluation({ url, dataRoot: root, cli: 'claude', platform: 'linux', spawnFn: (bin, args, options) => { calls.push({ args, options }); return { on() { return this; }, unref() {} }; } });
  assert.equal(result.started, true);
  assert.notEqual(calls[0].options.shell, true);
  assert.ok(calls[0].args[1].split(/\s+/).some((token) => token === url), 'the URL reaches the spawned CLI as a whole token');
  assert.ok(!/\n/.test(calls[0].args[1]));
});

// The suite traps CAREER_OPS_CLI at the top of this file (`forbidden-evaluation`),
// so a broken guard would launch it for real. doctor.mjs only *warns* about an
// unrecognized value, so the spawn site re-checks the same allow-list.
test('startEvaluation refuses a CLI outside the known agent list, from an explicit cli or the environment', () => {
  const root = scratch();
  const calls = [];
  const spawnSpy = (...a) => { calls.push(a); return { on() { return this; }, unref() {} }; };
  const explicit = startEvaluation({ url: 'https://acme.test/jobs/1', dataRoot: root, cli: path.join(sandbox, 'forbidden-evaluation'), platform: 'linux', spawnFn: spawnSpy });
  assert.equal(explicit.started, false, JSON.stringify(explicit));
  assert.match(explicit.reason, /recognized CLI/i);
  const fromEnv = startEvaluation({ url: 'https://acme.test/jobs/1', dataRoot: root, platform: 'linux', spawnFn: spawnSpy });
  assert.equal(fromEnv.started, false, JSON.stringify(fromEnv));
  assert.match(fromEnv.reason, /recognized CLI/i);
  assert.equal(calls.length, 0, 'neither call may spawn');
});

// --- R3 maintainer follow-ups ----------------------------------------------

function initRepoWithRemote() {
  const root = scratch();
  const git = initRepo(root);
  const remote = mkdtempSync(path.join(sandbox, 'remote-'));
  assert.equal(spawnSync('git', ['init', '-q', '--bare', remote], { encoding: 'utf-8' }).status, 0, 'bare remote');
  git('add', '--', 'data/pipeline.md');
  assert.equal(git('commit', '-qm', 'init').status, 0, 'initial commit');
  git('remote', 'add', 'origin', remote);
  assert.equal(git('push', '-q', '-u', 'origin', 'HEAD').status, 0, 'initial push');
  const remoteHead = () => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: remote, encoding: 'utf-8' }).stdout.trim();
  return { root, git, remoteHead };
}

test('captureJd commits without pushing unless push is requested', async () => {
  const { root, remoteHead } = initRepoWithRemote();
  const before = remoteHead();
  const result = await captureJd({ url: 'https://acme.test/jobs/no-push', dataRoot: root, commit: true });
  assert.equal(result.committed, true, JSON.stringify(result));
  assert.equal(result.pushed, false);
  assert.equal(result.gitReason, 'push-skipped');
  assert.equal(remoteHead(), before, 'the remote did not move');
});

test('the capture endpoint commits without pushing unless the request asks for it', async () => {
  const { root, git, remoteHead } = initRepoWithRemote();
  const token = ensureToken(root);
  const server = createServer({ dataRoot: root, token, evalEnabled: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const post = (payload) => fetch(`http://127.0.0.1:${port}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Capture-Token': token },
    body: JSON.stringify(payload),
  }).then((res) => res.json());

  try {
    const before = remoteHead();
    const quiet = await post({ url: 'https://acme.test/jobs/server-no-push', evaluate: false });
    assert.equal(quiet.committed, true, JSON.stringify(quiet));
    assert.equal(quiet.pushed, false);
    assert.equal(remoteHead(), before, 'no push without an explicit request');

    const pushed = await post({ url: 'https://acme.test/jobs/server-push', push: true, evaluate: false });
    assert.equal(pushed.pushed, true, JSON.stringify(pushed));
    assert.equal(remoteHead(), git('rev-parse', 'HEAD').stdout.trim());
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('the CLI pushes only with --push', () => {
  const { root, git, remoteHead } = initRepoWithRemote();
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' };
  const run = (...args) => spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'capture-jd.mjs'), ...args, '--json'], { cwd: root, encoding: 'utf-8', env, input: '' });

  const before = remoteHead();
  const quiet = run('--url', 'https://acme.test/jobs/cli-no-push', '--commit');
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(JSON.parse(quiet.stdout).pushed, false);
  assert.equal(remoteHead(), before);

  const pushed = run('--url', 'https://acme.test/jobs/cli-push', '--commit', '--push');
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(JSON.parse(pushed.stdout).pushed, true);
  assert.equal(remoteHead(), git('rev-parse', 'HEAD').stdout.trim());
});

test('startEvaluation keeps the server alive when the spawned child emits error', async () => {
  const { EventEmitter } = await import('node:events');
  const root = scratch();
  const child = Object.assign(new EventEmitter(), { unref() {} });
  const result = startEvaluation({ url: 'https://acme.test/jobs/1', dataRoot: root, cli: 'claude', platform: 'linux', spawnFn: () => child });
  assert.equal(result.started, true);
  assert.ok(child.listenerCount('error') > 0, 'an error listener is attached');
  assert.doesNotThrow(() => child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })));
  assert.match(readFileSync(path.join(root, 'data', 'capture-evals.log'), 'utf-8'), /ENOENT/);
});

// --- R4 review follow-ups ---------------------------------------------------

const captureCli = (root, args, extra = {}) => spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'capture-jd.mjs'), ...args], {
  cwd: root, encoding: 'utf-8', input: '', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' }, ...extra,
});

test('URL dedup trims trailing slashes from the path only, never from the query or fragment', () => {
  assert.equal(urlAlreadyPresent('- [ ] https://acme.test/jobs/4/ | Acme | Eng\n', 'https://acme.test/jobs/4'), true);
  assert.equal(urlAlreadyPresent('- [ ] https://acme.test/jobs/4 | Acme | Eng\n', 'https://acme.test/jobs/4/'), true);
  assert.equal(urlAlreadyPresent('- [ ] https://acme.test/jobs?id=alpha/ | Acme | Eng\n', 'https://acme.test/jobs?id=alpha'), false);
  assert.equal(urlAlreadyPresent('- [ ] https://acme.test/jobs#a/ | Acme | Eng\n', 'https://acme.test/jobs#a'), false);
});

test('a Pending row lands before the next heading even when it uses a tab after ##', async () => {
  const root = scratch({ pipeline: '# Pipeline\n\n## Pending\n\n##\tProcessed\n\n- [x] https://acme.test/jobs/old | Acme | Old\n' });
  await captureJd({ url: 'https://acme.test/jobs/tab', dataRoot: root, commit: false });
  const lines = readPipeline(root).split('\n');
  const row = lines.findIndex((l) => rowUrl(l) === 'https://acme.test/jobs/tab');
  const processed = lines.indexOf('##\tProcessed');
  assert.ok(row !== -1 && row < processed, readPipeline(root));
});

test('the CLI validates --url before reading --text-file', () => {
  const root = scratch();
  const run = captureCli(root, ['--url', 'ftp://acme.test/x', '--text-file', path.join(root, 'missing.txt')]);
  assert.equal(run.status, 2);
  assert.doesNotMatch(run.stderr, /cannot read --text-file/);
  assert.match(run.stderr, /url|http/i);
});

test('the CLI reports a failed push and exits non-zero, keeping the capture and the commit', () => {
  const root = scratch();
  const git = initRepo(root);
  git('add', '--', 'data/pipeline.md');
  assert.equal(git('commit', '-qm', 'init').status, 0);
  git('remote', 'add', 'origin', path.join(sandbox, 'no-such-remote'));
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  git('config', `branch.${branch}.remote`, 'origin');
  git('config', `branch.${branch}.merge`, `refs/heads/${branch}`);

  const run = captureCli(root, ['--url', 'https://acme.test/jobs/push-fails', '--commit', '--push']);
  assert.ok(exitedNonZero(run), describeSpawn(run, 'a requested push that failed must fail the run'));
  assert.match(run.stderr, /push-failed/);
  assert.match(run.stderr, /saved/i);
  assert.ok(rowLines(root).some((l) => rowUrl(l) === 'https://acme.test/jobs/push-fails'));
  assert.match(git('log', '-1', '--format=%s').stdout, /chore\(capture\)/);

  const localOnly = captureCli(root, ['--url', 'https://acme.test/jobs/local-only', '--commit']);
  assert.equal(localOnly.status, 0, localOnly.stderr);
});

test('captureJd resolves a relative data root before committing', async () => {
  const root = scratch();
  const git = initRepo(root);
  git('add', '--', 'data/pipeline.md');
  assert.equal(git('commit', '-qm', 'init').status, 0);
  const cwd = process.cwd();
  process.chdir(path.dirname(root));
  try {
    const result = await captureJd({ url: 'https://acme.test/jobs/relative', text: 'JD', dataRoot: path.basename(root), commit: true });
    assert.equal(result.committed, true, JSON.stringify(result));
    assert.ok(path.isAbsolute(result.pipeline));
  } finally {
    process.chdir(cwd);
  }
});

test('the server answers 400 to a request target new URL() cannot parse, and keeps serving', async () => {
  const http = await import('node:http');
  const root = scratch();
  const server = createServer({ dataRoot: root, token: ensureToken(root), evalEnabled: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '//', method: 'GET' }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.setTimeout(3000, () => req.destroy(new Error('no response: the handler threw')));
      req.end();
    });
    assert.equal(status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('isLoopbackHost accepts only complete loopback hosts', () => {
  for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ['localhost.example', '127.example', '127.0.0.1.example', '::1abc', '::', '0.0.0.0', '192.168.1.2', '']) assert.equal(isLoopbackHost(host), false, host);
});
