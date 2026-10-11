// tests/set-status-archives-jd.test.mjs — the transition into Interview is
// the last reliable moment to archive a JD automatically (#4506 direction 2).
//
// A row entered through `add` (a referral, a recruiter reach-out, a posting
// that skipped `oferta`/`pdf`) never gets a JD archived, and interview-prep's
// last resort once the posting has closed is "ask the user to paste the JD
// text instead" — which fails if the user never kept a copy either.
//
// This exercises the gating logic and the child-process boundary. Archive
// attempts use a copied code root with a deterministic archive-posting probe,
// so report-number selection, workspace propagation, and JSON stdout purity
// are covered without launching Chromium or making a live network request.
//
// Run:  node --test tests/set-status-archives-jd.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|';

function sandbox({ status = 'Evaluated', url = 'https://boards.greenhouse.io/acme/jobs/1', reportCell = '[7](../reports/007-acme-2026-02-01.md)' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-jd-archive-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker', '', HEADER, SEP,
    `| 7 | 2026-02-01 | Acme | Backend Engineer | 4.4/5 | ${status} | ✅ | ${reportCell} | notes | ${url} |`,
    '',
  ].join('\n'));
  return dir;
}

function setStatus(dir, args, { codeRoot = ROOT, env = {} } = {}) {
  const r = spawnSync(process.execPath, [join(codeRoot, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'), ...env },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function fakeArchiveCodeRoot() {
  // Copy the set-status import closure under the real repo so bare package
  // imports still resolve from ROOT/node_modules, then replace only the
  // archive executable with a deterministic no-network probe.
  const codeRoot = mkdtempSync(join(ROOT, '.tmp-set-status-archive-'));
  for (const sub of ['lib', 'templates']) mkdirSync(join(codeRoot, sub), { recursive: true });
  for (const file of [
    'set-status.mjs', 'path-resolver.mjs', 'tracker-utils.mjs', 'pipeline-lock.mjs',
    'tracker-parse.mjs', 'lib/local-today.mjs', 'role-matcher.mjs',
    'session-activity.mjs', 'lib/is-main-module.mjs', 'check-jd-archive.mjs',
    'jd-capture.mjs', 'lib/cli-flags.mjs', 'templates/states.yml',
    'tracker-aliases.json',
  ]) copyFileSync(join(ROOT, file), join(codeRoot, file));
  writeFileSync(join(codeRoot, 'archive-posting.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "if (process.env.FAKE_ARCHIVE_HANG === '1') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);",
    "console.log('child stdout must not contaminate JSON');",
    "writeFileSync(join(process.env.CAREER_OPS_ROOT, 'archive-invocation.json'), JSON.stringify({ args: process.argv.slice(2), root: process.env.CAREER_OPS_ROOT }));",
  ].join('\n'));
  return codeRoot;
}

const jsonOf = (r) => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 10 });

test('an already-embedded JD is never re-archived', () => {
  const dir = sandbox();
  writeFileSync(join(dir, 'reports', '007-acme-2026-02-01.md'),
    '# Eval\n\n## Job Description (archived verbatim)\n\nWe are looking for a Senior Backend Engineer to join our platform team and own the checkout service end to end.\n\n## Machine Summary\n');
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.jdArchiveTriggered?.attempted, false);
    assert.equal(r.jdArchiveTriggered?.reason, 'already-embedded');
  } finally { cleanup(dir); }
});

test('a plain report path resolves before the embedded-JD check', () => {
  const dir = sandbox({ reportCell: '../reports/007-acme-2026-02-01.md' });
  writeFileSync(join(dir, 'reports', '007-acme-2026-02-01.md'),
    '# Eval\n\n## Job Description\n\nWe are looking for a Backend Engineer to own our platform services and production reliability end to end.\n');
  try {
    const r = JSON.parse(setStatus(dir, ['--row', '7', 'Interview', '--json']).stdout);
    assert.equal(r.jdArchiveTriggered?.attempted, false);
    assert.equal(r.jdArchiveTriggered?.reason, 'already-embedded');
  } finally { cleanup(dir); }
});

test('an already-captured JD (jds/ has a matching file) is never re-archived', () => {
  const dir = sandbox();
  writeFileSync(join(dir, 'reports', '007-acme-2026-02-01.md'), '# Eval\n\n## Job Description (archived verbatim)\n\nTBD\n');
  mkdirSync(join(dir, 'jds'), { recursive: true });
  writeFileSync(join(dir, 'jds', '007-acme.pdf'), 'not a real pdf, existence is all that matters');
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.jdArchiveTriggered?.attempted, false);
    assert.equal(r.jdArchiveTriggered?.reason, 'already-captured');
  } finally { cleanup(dir); }
});

test('a same-number capture for another company does not suppress archiving', () => {
  const dir = sandbox();
  const codeRoot = fakeArchiveCodeRoot();
  writeFileSync(join(dir, 'reports', '007-acme-2026-02-01.md'), '# Eval\n\n## Job Description\n\nTBD\n');
  mkdirSync(join(dir, 'jds'), { recursive: true });
  writeFileSync(join(dir, 'jds', '007-globex.pdf'), 'belongs to another company');
  try {
    const raw = setStatus(dir, ['--row', '7', 'Interview', '--json'], { codeRoot });
    const result = JSON.parse(raw.stdout);
    assert.equal(result.jdArchiveTriggered?.attempted, true);
    assert.doesNotMatch(raw.stdout, /child stdout/, 'child output leaked into JSON stdout');
  } finally {
    cleanup(dir);
    rmSync(codeRoot, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('archive uses the validated path number, keeps JSON stdout pure, and inherits the tracker workspace', () => {
  const dir = sandbox({ reportCell: '[999](../reports/008-acme-2026-02-01.md)' });
  const codeRoot = fakeArchiveCodeRoot();
  writeFileSync(join(dir, 'reports', '008-acme-2026-02-01.md'), '# Eval\n\n## Job Description\n\nTBD\n');
  try {
    const raw = setStatus(dir, ['--row', '7', 'Interview', '--json'], { codeRoot });
    const result = JSON.parse(raw.stdout);
    assert.equal(result.jdArchiveTriggered?.attempted, true);
    assert.doesNotMatch(raw.stdout, /child stdout/, 'child output leaked into JSON stdout');
    const invocation = JSON.parse(readFileSync(join(dir, 'archive-invocation.json'), 'utf-8'));
    assert.deepEqual(invocation.args, ['--report=8', '--company=Acme', 'https://boards.greenhouse.io/acme/jobs/1']);
    // macOS exposes /var as the /private/var symlink target in child-process
    // real paths. Compare filesystem identity rather than path spelling.
    assert.equal(realpathSync(invocation.root), realpathSync(dir));
  } finally {
    cleanup(dir);
    rmSync(codeRoot, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a hung archive child times out and remains warn-only', () => {
  const dir = sandbox();
  const codeRoot = fakeArchiveCodeRoot();
  writeFileSync(join(dir, 'reports', '007-acme-2026-02-01.md'), '# Eval\n\n## Job Description\n\nTBD\n');
  try {
    const raw = setStatus(dir, ['--row', '7', 'Interview', '--json'], {
      codeRoot,
      env: {
        FAKE_ARCHIVE_HANG: '1',
        CAREER_OPS_JD_ARCHIVE_TIMEOUT_MS: '100',
      },
    });
    assert.equal(raw.status, 0, raw.all);
    const result = JSON.parse(raw.stdout);
    assert.equal(result.changed, true, 'the status transition must survive an archive timeout');
    assert.equal(result.jdArchiveTriggered?.attempted, true);
    assert.match(result.jdArchiveTriggered?.error ?? '', /timed out|ETIMEDOUT/i);
  } finally {
    cleanup(dir);
    rmSync(codeRoot, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a row with no URL is not attempted', () => {
  const dir = sandbox({ url: '' });
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.jdArchiveTriggered?.attempted, false);
    assert.equal(r.jdArchiveTriggered?.reason, 'no-url');
  } finally { cleanup(dir); }
});

test('a row whose report cell resolves to no number is not attempted', () => {
  const dir = sandbox({ reportCell: '—' });
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.jdArchiveTriggered?.attempted, false);
    assert.equal(r.jdArchiveTriggered?.reason, 'no-report-number');
  } finally { cleanup(dir); }
});

test('a transition to any status other than Interview triggers nothing', () => {
  const dir = sandbox();
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Applied', '--json']));
    assert.equal(r.jdArchiveTriggered, undefined, 'jdArchiveTriggered must not appear on a non-Interview transition');
  } finally { cleanup(dir); }
});

test('--dry-run triggers nothing (nothing was written for archive-posting to attach a --report to)', () => {
  const dir = sandbox();
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--dry-run', '--json']));
    assert.equal(r.jdArchiveTriggered, undefined, 'jdArchiveTriggered must not appear on a dry run');
  } finally { cleanup(dir); }
});

test('re-running on an already-Interview row does not retry (statusChanged gates it, same as follow-up seeding)', () => {
  const dir = sandbox();
  writeFileSync(join(dir, 'reports', '007-acme-2026-02-01.md'), '# Eval\n\n## Job Description (archived verbatim)\n\nAlready archived, so the first call resolves cleanly.\n');
  try {
    setStatus(dir, ['--row', '7', 'Interview']);
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.changed, false, 'the second call should be a no-op re-run, not a fresh transition');
    assert.equal(r.jdArchiveTriggered, undefined, 'an idempotent re-run must not re-evaluate the trigger at all');
  } finally { cleanup(dir); }
});
