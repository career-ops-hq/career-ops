// tests/employers-inbox-only.test.mjs: the mechanical recognition of a pull
// request that only adds files to employers/inbox/
// (classifyInboxDiff in seeds/employers-inbox.mjs, and
// `node seeds/employers-validate.mjs --inbox-only --base <ref>`).
//
// A later fast merge lane depends on this answer, so it must be "yes" only
// when every change is a new (status A), regular, validly named file directly
// under employers/inbox/, and "no" for anything else: a modified, deleted,
// renamed or copied file, a file anywhere else, a bad name, an empty diff.
//
// Run:  node --test tests/employers-inbox-only.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import { classifyInboxDiff, parseRawDiff, renderInboxOnlySummary } from '../seeds/employers-inbox.mjs';

const VALIDATOR = join(ROOT, 'seeds', 'employers-validate.mjs');
const { GITHUB_ACTIONS: _ga, GITHUB_STEP_SUMMARY: _gss, GITHUB_OUTPUT: _go, ...PLAIN_ENV } = process.env;

const IN = 'employers/inbox';
const add = (path, mode = '100644') => ({ status: 'A', path, mode });

// ── classifyInboxDiff ──────────────────────────────────────────────────────

test('yes: new boards files, numbered parts and a manifest, all directly in the inbox', () => {
  const r = classifyInboxDiff([
    add(`${IN}/2026-11-10-acme-hr-002.ndjson`),
    add(`${IN}/2026-11-10-acme-hr-001.ndjson`),
    add(`${IN}/2026-11-10-acme-hr.json`),
    add(`${IN}/2026-11-10-octocat.ndjson`),
  ]);
  assert.deepEqual(r, {
    inboxOnly: true,
    files: [`${IN}/2026-11-10-acme-hr-001.ndjson`, `${IN}/2026-11-10-acme-hr-002.ndjson`, `${IN}/2026-11-10-acme-hr.json`, `${IN}/2026-11-10-octocat.ndjson`],
    rejected: [],
    logins: ['acme-hr', 'octocat'],
  });
});

for (const [label, entries, reason] of [
  ['a modified inbox file (M)', [add(`${IN}/2026-11-10-a.ndjson`), { status: 'M', path: `${IN}/2026-11-09-b.ndjson`, mode: '100644' }], /modifies a file/],
  ['a deleted inbox file (D)', [{ status: 'D', path: `${IN}/2026-11-09-b.ndjson`, mode: '000000' }], /deletes a file/],
  ['a renamed file into the inbox (R)', [{ status: 'R100', path: `${IN}/2026-11-10-a.ndjson`, oldPath: 'notes/a.ndjson', mode: '100644' }], /renames a file/],
  ['a copied file (C)', [{ status: 'C75', path: `${IN}/2026-11-10-a.ndjson`, oldPath: `${IN}/x.ndjson`, mode: '100644' }], /copies a file/],
  ['a type change (T)', [{ status: 'T', path: `${IN}/2026-11-10-a.ndjson`, mode: '120000' }], /changes the type of a file/],
  ['a file added outside the inbox', [add(`${IN}/2026-11-10-a.ndjson`), add('employers/boards/ashby/a.ndjson')], /outside employers\/inbox\//],
  ['a file in a subdirectory of the inbox', [add(`${IN}/sub/2026-11-10-a.ndjson`)], /outside employers\/inbox\//],
  ['a file next to the inbox, not in it', [add('employers/inbox-2026-11-10-a.ndjson')], /outside employers\/inbox\//],
  ['an invalid name', [add(`${IN}/acme.ndjson`)], /inbox files are named/],
  ['an uppercase login', [add(`${IN}/2026-11-10-Acme.ndjson`)], /lowercase/],
  ['a symlink', [add(`${IN}/2026-11-10-a.ndjson`, '120000')], /file mode 120000/],
  ['an executable file', [add(`${IN}/2026-11-10-a.ndjson`, '100755')], /file mode 100755/],
]) {
  test(`no: ${label}`, () => {
    const r = classifyInboxDiff(entries);
    assert.equal(r.inboxOnly, false);
    assert.ok(r.rejected.length >= 1);
    assert.ok(r.rejected.some((x) => reason.test(x.reason)), JSON.stringify(r.rejected));
  });
}

test('no: an empty diff is not an inbox contribution', () => {
  assert.deepEqual(classifyInboxDiff([]), { inboxOnly: false, files: [], rejected: [], logins: [] });
});

test('parseRawDiff reads git diff --raw -z, renames included', () => {
  const z = [
    ':000000 100644 0000000 1111111 A', `${IN}/2026-11-10-a.ndjson`,
    ':100644 100644 2222222 3333333 M', 'README.md',
    ':100644 100644 4444444 4444444 R100', 'old name.txt', `${IN}/2026-11-10-b.ndjson`,
    '',
  ].join('\0');
  assert.deepEqual(parseRawDiff(z), [
    { status: 'A', path: `${IN}/2026-11-10-a.ndjson`, mode: '100644' },
    { status: 'M', path: 'README.md', mode: '100644' },
    { status: 'R100', path: `${IN}/2026-11-10-b.ndjson`, oldPath: 'old name.txt', mode: '100644' },
  ]);
  assert.throws(() => parseRawDiff('garbage\0'), /unexpected git diff output/);
});

test('the step summary says yes with the files, or no with each reason', () => {
  const yes = renderInboxOnlySummary(classifyInboxDiff([add(`${IN}/2026-11-10-a.ndjson`)]));
  assert.match(yes, /\*\*Yes\*\*: this pull request only adds 1 file to `employers\/inbox\/`/);
  const no = renderInboxOnlySummary(classifyInboxDiff([{ status: 'M', path: 'README`x.md', mode: '100644' }]));
  assert.match(no, /\*\*No\*\*: 1 change outside the inbox-only path/);
  assert.ok(no.includes('`README?x.md` (M): modifies a file'), no);
});

// ── The CLI on a real git history ─────────────────────────────────────────

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'co-inbox-only-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'trunk');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(dir, '.git', 'no-hooks'));
  mkdirSync(join(dir, IN), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'base\n');
  writeFileSync(join(dir, IN, '2026-11-01-early.ndjson'), '{"ats":"ashby","board":"early","name":"Early"}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('switch', '-q', '-c', 'pr');
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
  return { dir, git, commit };
}
const cli = (dir, args, env = {}) => spawnSync(process.execPath, [VALIDATOR, '--inbox-only', ...args], { cwd: dir, encoding: 'utf8', env: { ...PLAIN_ENV, ...env } });

test('CLI: a branch that only adds inbox files is recognised, and nothing is validated', () => {
  const { dir, commit } = gitRepo();
  try {
    writeFileSync(join(dir, IN, '2026-11-10-octocat.ndjson'), 'not even json\n');
    commit('add');
    const r = cli(dir, ['--base', 'trunk']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      base: 'trunk', head: 'HEAD', inboxOnly: true, files: [`${IN}/2026-11-10-octocat.ndjson`], rejected: [], logins: ['octocat'],
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: base...head ignores what the base branch did after the branch point', () => {
  const { dir, git, commit } = gitRepo();
  try {
    writeFileSync(join(dir, IN, '2026-11-10-octocat.ndjson'), '{}\n');
    commit('add');
    git('switch', '-q', 'trunk');
    writeFileSync(join(dir, 'README.md'), 'moved on\n');
    commit('trunk moves');
    git('switch', '-q', 'pr');
    assert.equal(JSON.parse(cli(dir, ['--base', 'trunk']).stdout).inboxOnly, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: an edited inbox file, a rename and a file elsewhere each make it "no"', () => {
  for (const [label, change, status] of [
    ['modify', (dir) => writeFileSync(join(dir, IN, '2026-11-01-early.ndjson'), '{"ats":"ashby","board":"early","name":"Early Inc"}\n'), 'M'],
    ['rename', (dir, git) => git('mv', `${IN}/2026-11-01-early.ndjson`, `${IN}/2026-11-10-early.ndjson`), 'R100'],
    ['outside', (dir) => writeFileSync(join(dir, 'README.md'), 'changed\n'), 'M'],
    ['delete', (dir, git) => git('rm', '-q', `${IN}/2026-11-01-early.ndjson`), 'D'],
    ['symlink', (dir) => symlinkSync('../../README.md', join(dir, IN, '2026-11-10-link.ndjson')), 'A'],
  ]) {
    const { dir, git, commit } = gitRepo();
    try {
      writeFileSync(join(dir, IN, '2026-11-10-octocat.ndjson'), '{}\n');
      change(dir, git);
      commit(label);
      const r = cli(dir, ['--base', 'trunk']);
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.inboxOnly, false, `${label}: ${r.stdout}`);
      assert.ok(out.rejected.some((x) => x.status === status), `${label}: ${r.stdout}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('CLI: in GitHub Actions the answer also goes to the step outputs and summary', () => {
  const { dir, commit } = gitRepo();
  try {
    writeFileSync(join(dir, IN, '2026-11-10-octocat.ndjson'), '{}\n');
    commit('add');
    const out = join(dir, '.git', 'out.txt');
    const summary = join(dir, '.git', 'summary.md');
    const r = cli(dir, ['--base', 'HEAD^1'], { GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(out, 'utf8'), `inbox_only=true\ninbox_files=["${IN}/2026-11-10-octocat.ndjson"]\ninbox_logins=["octocat"]\n`);
    assert.match(readFileSync(summary, 'utf8'), /^## Inbox-only check\n/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: usage errors and an unknown ref exit 2', () => {
  const { dir } = gitRepo();
  try {
    assert.equal(spawnSync(process.execPath, [VALIDATOR, '--inbox-only'], { cwd: dir, encoding: 'utf8', env: PLAIN_ENV }).status, 2);
    assert.equal(spawnSync(process.execPath, [VALIDATOR, '--head', 'HEAD'], { cwd: dir, encoding: 'utf8', env: PLAIN_ENV }).status, 2);
    const r = cli(dir, ['--base', 'no-such-ref']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /git diff no-such-ref\.\.\.HEAD failed/);
    assert.equal(cli(dir, ['--base', '--evil']).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
