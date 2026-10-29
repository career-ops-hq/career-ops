import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, ftruncateSync, mkdtempSync, mkdirSync, openSync, readdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importMailDrop } from '../lib/linkedin-mail-drop.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const JOB_ID = '5151515151';

// The env for a spawned runner. Every CAREER_OPS_* value inherited from a
// developer shell is removed, then the fixture root is set. One leftover, such
// as CAREER_OPS_SCHEDULED_JOBS_PATH, would make the child claim a real job.
function runnerEnv(root) {
  const env = { ...process.env, NO_COLOR: '1' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CAREER_OPS_')) delete env[key];
  }
  env.CAREER_OPS_ROOT = root;
  return env;
}

// importMailDrop reads these on every call. Point them at the test's own root
// so nothing lands in this checkout's data/. It passes the scan history path to
// scan.mjs per call, so a later test does not reuse the first test's path.
function withDataEnv(root, fn) {
  const keys = ['CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_TRACKER'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.CAREER_OPS_SCAN_HISTORY = join(root, 'data', 'scan-history.tsv');
  process.env.CAREER_OPS_PIPELINE = '';
  process.env.CAREER_OPS_TRACKER = '';
  return Promise.resolve().then(fn).finally(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test('a drop folder of eml files becomes canonical pipeline rows once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-drop-'));
  const dir = join(root, 'data', 'linkedin-alerts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n## Processed\n');
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
  writeFileSync(join(dir, 'alert.eml'), [
    `From: ${['jobs-noreply', 'linkedin.example'].join('@')}`,
    'Subject: Jobs for you',
    '',
    `https://www.linkedin.com/comm/jobs/view/${JOB_ID}?trackingId=abc&trk=eml`,
  ].join('\n'));
  try {
    await withDataEnv(root, async () => {
      const first = await importMailDrop({ root, dir });
      assert.equal(first.added, 1);
      assert.ok(existsSync(join(root, 'data', 'scan-history.tsv')), 'scan history stays in the test root');
      const pipeline = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
      assert.match(pipeline, new RegExp(`https://www.linkedin.com/jobs/view/${JOB_ID}`));
      assert.doesNotMatch(pipeline, /\/comm\/jobs\/view\//);
      const second = await importMailDrop({ root, dir });
      assert.equal(second.added, 0);
      assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), pipeline);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dry run says nothing was saved, names a file too large to read, and honors CAREER_OPS_PIPELINE', async () => {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-drop-dry-'));
  const dir = join(root, 'data', 'linkedin-alerts');
  mkdirSync(dir, { recursive: true });
  const lane = join(root, 'lane-pipeline.md');
  writeFileSync(lane, `- [ ] https://www.linkedin.com/jobs/view/${JOB_ID}\n`);
  writeFileSync(join(dir, 'a.eml'), `https://www.linkedin.com/jobs/view/${JOB_ID}\nhttps://www.linkedin.com/jobs/view/6161616161\n`);
  writeFileSync(join(dir, 'big.mbox'), 'x'.repeat(2_000_001));
  try {
    await withDataEnv(root, async () => {
      process.env.CAREER_OPS_PIPELINE = lane;
      const result = await importMailDrop({ root, dir, dryRun: true });
      assert.equal(result.added, 1);
      assert.equal(result.already, 1);
      assert.deepEqual(result.skipped, ['big.mbox']);
      assert.match(result.message, /^1 LinkedIn job found\. Nothing was saved\./);
      assert.match(result.message, /too large to read: big\.mbox/);
      assert.deepEqual(readdirSync(dir).sort(), ['a.eml', 'big.mbox']);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable tracker stops the import instead of adding its jobs again', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-drop-locked-'));
  const dir = join(root, 'data', 'linkedin-alerts');
  mkdirSync(dir, { recursive: true });
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, `| 1 | 2026-01-01 | Example Co | Analyst | 4.0 | Applied | | | https://www.linkedin.com/jobs/view/${JOB_ID} |\n`);
  chmodSync(tracker, 0o000);
  writeFileSync(join(dir, 'a.eml'), `https://www.linkedin.com/jobs/view/${JOB_ID}\n`);
  try {
    await withDataEnv(root, async () => {
      await assert.rejects(importMailDrop({ root, dir }), (err) => err.code === 'EACCES');
      assert.deepEqual(readdirSync(dir), ['a.eml']);
    });
  } finally {
    chmodSync(tracker, 0o600);
    rmSync(root, { recursive: true, force: true });
  }
});

function dropRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dir = join(root, 'data', 'linkedin-alerts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n## Processed\n');
  return { root, dir };
}

test('a temporary name is not imported until it has a final mail extension', async () => {
  const { root, dir } = dropRoot('linkedin-drop-partial-');
  const body = `https://www.linkedin.com/jobs/view/${JOB_ID}\n`;
  writeFileSync(join(dir, 'alert.eml.part'), body);
  writeFileSync(join(dir, 'alert.tmp'), body);
  try {
    await withDataEnv(root, async () => {
      const result = await importMailDrop({ root, dir });
      assert.equal(result.added, 0);
      assert.equal(result.found, 0);
      assert.ok(existsSync(join(dir, 'alert.eml.part')));
      assert.ok(existsSync(join(dir, 'alert.tmp')));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a base64 MIME part is decoded before its job links are read', async () => {
  const { root, dir } = dropRoot('linkedin-drop-base64-');
  const html = Buffer.from(`<a href="https://www.linkedin.com/comm/jobs/view/${JOB_ID}?trk=eml">Analyst</a>`).toString('base64');
  writeFileSync(join(dir, 'alert.eml'), [
    `From: ${['jobs-noreply', 'linkedin.example'].join('@')}`,
    'Subject: Jobs for you',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    ...html.match(/.{1,76}/g),
    '--b1--',
    '',
  ].join('\r\n'));
  try {
    await withDataEnv(root, async () => {
      const result = await importMailDrop({ root, dir });
      assert.equal(result.added, 1);
      assert.match(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), new RegExp(`https://www.linkedin.com/jobs/view/${JOB_ID}`));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a base64 MIME part with a trailing space on each line is decoded before its job links are read', async () => {
  const { root, dir } = dropRoot('linkedin-drop-base64-pad-');
  const html = Buffer.from(`<a href="https://www.linkedin.com/comm/jobs/view/${JOB_ID}?trk=eml">Analyst</a>`).toString('base64');
  writeFileSync(join(dir, 'alert.eml'), [
    `From: ${['jobs-noreply', 'linkedin.example'].join('@')}`,
    'Subject: Jobs for you',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    ...html.match(/.{1,76}/g).map((line) => `${line} `),
    '--b1--',
    '',
  ].join('\r\n'));
  try {
    await withDataEnv(root, async () => {
      const result = await importMailDrop({ root, dir });
      assert.equal(result.added, 1);
      assert.match(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), new RegExp(`https://www.linkedin.com/jobs/view/${JOB_ID}`));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable alert file is reported and the files after it still import', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const { root, dir } = dropRoot('linkedin-drop-unreadable-');
  writeFileSync(join(dir, 'a.eml'), 'https://www.linkedin.com/jobs/view/6161616161\n');
  chmodSync(join(dir, 'a.eml'), 0o000);
  writeFileSync(join(dir, 'b.eml'), `https://www.linkedin.com/jobs/view/${JOB_ID}\n`);
  try {
    await withDataEnv(root, async () => {
      const result = await importMailDrop({ root, dir });
      assert.equal(result.added, 1);
      assert.deepEqual(result.unreadable, ['a.eml']);
      assert.deepEqual(result.skipped, []);
      assert.match(result.message, /Could not read a\.eml/);
      assert.doesNotMatch(result.message, /too large/);
      assert.ok(existsSync(join(dir, 'a.eml')), 'the unreadable file stays for the next run');
      assert.match(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), new RegExp(JOB_ID));
      const { pollLinkedInInbox } = await import('../lib/linkedin-auto.mjs');
      const lines = [];
      await pollLinkedInInbox(root, { log: (line) => lines.push(line) });
      assert.match(lines.join('\n'), /^linkedin drop: .*Could not read a\.eml/, 'the scheduled poll logs it too');
    });
  } finally {
    chmodSync(join(dir, 'a.eml'), 0o600);
    rmSync(root, { recursive: true, force: true });
  }
});

test('each import writes scan history under its own root, not an earlier test\'s', async () => {
  for (const name of ['first', 'second']) {
    const root = mkdtempSync(join(tmpdir(), `linkedin-history-${name}-`));
    const dir = join(root, 'data', 'linkedin-alerts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n## Processed\n');
    writeFileSync(join(dir, 'alert.eml'), `https://www.linkedin.com/jobs/view/${JOB_ID}\n`);
    try {
      await withDataEnv(root, async () => {
        assert.equal((await importMailDrop({ root, dir })).added, 1);
      });
      assert.match(readFileSync(join(root, 'data', 'scan-history.tsv'), 'utf8'), new RegExp(JOB_ID), name);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('two imports of the same folder at once add each job once', async () => {
  const { root, dir } = dropRoot('linkedin-drop-overlap-');
  writeFileSync(join(dir, 'alert.eml'), `https://www.linkedin.com/jobs/view/${JOB_ID}\n`);
  try {
    await withDataEnv(root, async () => {
      const results = await Promise.all([importMailDrop({ root, dir }), importMailDrop({ root, dir })]);
      assert.deepEqual(results.map((r) => r.added).sort(), [0, 1]);
      const rows = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8').split(JOB_ID).length - 1;
      assert.equal(rows, 1, 'one pipeline row');
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the scan schedule drains the alert folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-schedule-'));
  const dir = join(root, 'data', 'linkedin-alerts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n## Processed\n');
  writeFileSync(join(dir, 'alert.eml'), `https://www.linkedin.com/jobs/view/${JOB_ID}\n`);
  try {
    const result = spawnSync(process.execPath, ['web/scripts/scheduled-jobs-runner.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: runnerEnv(root),
    });
    const pipeline = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    assert.match(pipeline, new RegExp(`https://www.linkedin.com/jobs/view/${JOB_ID}`), result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('running one scheduled job by hand leaves the alert folder alone', () => {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-manual-'));
  const dir = join(root, 'data', 'linkedin-alerts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n## Processed\n');
  writeFileSync(join(dir, 'alert.eml'), `https://www.linkedin.com/jobs/view/${JOB_ID}\n`);
  try {
    spawnSync(process.execPath, ['web/scripts/scheduled-jobs-runner.mjs', '--job', 'no-such-job'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: runnerEnv(root),
    });
    assert.deepEqual(readdirSync(dir), ['alert.eml']);
    assert.doesNotMatch(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), new RegExp(JOB_ID));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the scheduled inbox poll holds the same lock as the job run', () => {
  const src = readFileSync(join(ROOT, 'web', 'scripts', 'scheduled-jobs-runner.mjs'), 'utf8');
  const lockAt = src.indexOf('return withResourceLock(');
  const pollAt = src.indexOf('await pollLinkedInInbox(');
  assert.ok(lockAt > 0 && pollAt > lockAt, 'poll runs inside the runner lock');
  const callback = src.slice(lockAt, src.indexOf('timeoutMs:', lockAt));
  assert.match(callback, /if \(!manualJobId\) \{[\s\S]*await pollLinkedInInbox\(/);
});

test('a base64 line with a space and a tab in the middle still yields the job', async () => {
  const { root, dir } = dropRoot('linkedin-drop-base64-gap-');
  const html = Buffer.from(`<a href="https://www.linkedin.com/jobs/view/${JOB_ID}?trk=eml">Analyst</a>`).toString('base64');
  const wrapped = html.match(/.{1,76}/g);
  wrapped[0] = `${wrapped[0].slice(0, 8)} \t${wrapped[0].slice(8)}`;
  writeFileSync(join(dir, 'alert.eml'), [
    'Content-Transfer-Encoding: base64',
    '',
    ...wrapped,
    '',
  ].join('\n'));
  try {
    await withDataEnv(root, async () => {
      const result = await importMailDrop({ root, dir });
      assert.equal(result.added, 1);
      assert.deepEqual(result.skipped, []);
      assert.ok(existsSync(join(dir, 'imported', 'alert.eml')));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CJK text larger than twice the character limit still imports', async () => {
  const { LINKEDIN_IMPORT_MAX_CHARS } = await import('../lib/linkedin-import.mjs');
  const { root, dir } = dropRoot('linkedin-drop-cjk-');
  const url = `https://www.linkedin.com/jobs/view/${JOB_ID}\n`;
  const text = url + '\u4e00'.repeat(1_400_000);
  assert.ok(Buffer.byteLength(text) > LINKEDIN_IMPORT_MAX_CHARS * 2);
  assert.ok(text.length <= LINKEDIN_IMPORT_MAX_CHARS);
  writeFileSync(join(dir, 'wide.eml'), text);
  try {
    await withDataEnv(root, async () => {
      const result = await importMailDrop({ root, dir });
      assert.equal(result.added, 1);
      assert.deepEqual(result.skipped, []);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a file that cannot fit the character limit is skipped before it is read', async () => {
  const { LINKEDIN_IMPORT_MAX_CHARS } = await import('../lib/linkedin-import.mjs');
  const { root, dir } = dropRoot('linkedin-drop-huge-');
  const file = join(dir, 'huge.mbox');
  const fd = openSync(file, 'w');
  try {
    ftruncateSync(fd, LINKEDIN_IMPORT_MAX_CHARS * 3 + 1);
  } finally {
    closeSync(fd);
  }
  try {
    await withDataEnv(root, async () => {
      const result = await importMailDrop({ root, dir });
      assert.deepEqual(result.skipped, ['huge.mbox']);
      assert.deepEqual(result.unreadable, []);
      assert.match(result.message, /too large to read: huge\.mbox/);
      assert.ok(existsSync(file));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runnerEnv drops every inherited CAREER_OPS path', () => {
  const keys = ['CAREER_OPS_SCHEDULED_JOBS_PATH', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_ROOT'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.CAREER_OPS_SCHEDULED_JOBS_PATH = '/tmp/not-the-fixture.json';
  process.env.CAREER_OPS_DATA_DIR = '/tmp/not-the-fixture';
  process.env.CAREER_OPS_PIPELINE = '/tmp/not-the-fixture.md';
  process.env.CAREER_OPS_ROOT = '/tmp/not-the-fixture';
  try {
    const env = runnerEnv('/tmp/fixture-root');
    assert.equal(env.CAREER_OPS_ROOT, '/tmp/fixture-root');
    assert.equal(env.CAREER_OPS_SCHEDULED_JOBS_PATH, undefined);
    assert.equal(env.CAREER_OPS_DATA_DIR, undefined);
    assert.equal(env.CAREER_OPS_PIPELINE, undefined);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('a size error from the read is skipped, and a permission error stays unreadable', async () => {
  const { mailReadFailure } = await import('../lib/linkedin-mail-drop.mjs');
  assert.equal(mailReadFailure({ code: 'ERR_FS_FILE_TOO_LARGE' }), 'skipped');
  assert.equal(mailReadFailure({ code: 'ERR_STRING_TOO_LONG' }), 'skipped');
  assert.equal(mailReadFailure({ code: 'EACCES' }), 'unreadable');
});

test('the scheduled poll logs alert files it had to skip', async () => {
  const { pollLinkedInInbox } = await import('../lib/linkedin-auto.mjs');
  const root = mkdtempSync(join(tmpdir(), 'linkedin-auto-skip-'));
  const dir = join(root, 'data', 'linkedin-alerts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'big.mbox'), 'x'.repeat(2_000_001));
  const lines = [];
  try {
    await withDataEnv(root, async () => {
      const report = await pollLinkedInInbox(root, { log: (line) => lines.push(line) });
      assert.deepEqual(report.drop.skipped, ['big.mbox']);
    });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^linkedin drop: .*too large to read: big\.mbox/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
