// community-asks.mjs: each ask at most once, never two in one run, never in
// an unattended run, and nothing ever leaves the machine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, NODE } from './helpers.mjs';
import {
  askOutput, askText, countReports, decideAsk, unattendedReason,
  STAR_ART, STAR_URL, MANIFESTO_URL, MANIFESTO_MIN_REPORTS, MANIFESTO_MIN_DAYS_AFTER_STAR, VETERAN_MIN_REPORTS,
} from '../community-asks.mjs';
import { SYSTEM_PATHS } from '../lib/update-manifest.mjs';

const SCRIPT = join(ROOT, 'community-asks.mjs');
const execFileAsync = promisify(execFile);
const DAY = 86_400_000;
const T0 = new Date('2026-11-01T10:00:00Z');
const at = (days) => new Date(T0.getTime() + days * DAY).toISOString();

// This suite may itself run in CI or under a headless agent. A child that
// inherited that environment would (correctly) never ask, so each child gets
// an attended environment and opts into the unattended cases one by one.
const UNATTENDED_VARS = [
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'TRAVIS', 'TF_BUILD', 'JENKINS_URL',
  'TEAMCITY_VERSION', 'BITBUCKET_BUILD_NUMBER', 'CODEBUILD_BUILD_ID', 'DRONE', 'APPVEYOR',
  'CAREER_OPS_NO_ASKS', 'CAREER_OPS_HEADLESS', 'CAREER_OPS_BATCH_STATE', 'CLAUDE_CODE_ENTRYPOINT',
  'CAREER_OPS_REPORTS_DIR',
];
function childEnv(extra = {}) {
  const env = { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '' };
  for (const name of UNATTENDED_VARS) delete env[name];
  return { ...env, ...extra };
}

const roots = [];
after(() => {
  for (const root of roots) {
    try { chmodSync(join(root, 'data'), 0o755); } catch { /* already writable or gone */ }
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(reports = 0) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-asks-')));
  roots.push(root);
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  for (let i = 1; i <= reports; i++) {
    writeFileSync(join(root, 'reports', `${String(i).padStart(3, '0')}-acme-2026-11-01.md`), '# Evaluation\n');
  }
  return root;
}

function run(root, args = ['next'], extra = {}) {
  const r = spawnSync(NODE, [SCRIPT, ...args, '--root', root], { cwd: root, env: childEnv(extra), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const marker = (root, name) => join(root, 'data', '.community-asks', name);

test('with no report yet, nothing is asked and nothing is written', () => {
  const root = workspace(0);
  const r = run(root);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.equal(existsSync(marker(root, 'star')), false);
});

test('the first report asks for the star, once', () => {
  const root = workspace(1);
  const first = run(root);
  assert.equal(first.code, 0);
  assert.equal(first.out, `${askOutput('star', { reports: 1 })}\n`);
  assert.ok(first.out.includes(STAR_URL));
  assert.ok(existsSync(marker(root, 'star')));
  const second = run(root);
  assert.equal(second.code, 0);
  assert.equal(second.out, '');
});

test('two sessions at once still ask once', async () => {
  for (let round = 0; round < 5; round++) {
    const root = workspace(1);
    const opts = { cwd: root, env: childEnv() };
    const outs = await Promise.all([
      execFileAsync(NODE, [SCRIPT, 'next', '--root', root], opts),
      execFileAsync(NODE, [SCRIPT, 'next', '--root', root], opts),
    ]);
    assert.equal(outs.filter(({ stdout }) => stdout.trim() !== '').length, 1, `round ${round}`);
  }
});

test('an unattended run never asks and leaves no marker', () => {
  const cases = [
    ['CI', 'true'], ['GITHUB_ACTIONS', 'true'], ['GITLAB_CI', 'true'],
    ['CAREER_OPS_HEADLESS', '1'], ['CAREER_OPS_BATCH_STATE', join(tmpdir(), 'batch-state.tsv')],
    ['CLAUDE_CODE_ENTRYPOINT', 'sdk-cli'], ['CLAUDE_CODE_ENTRYPOINT', 'sdk-ts'], ['CLAUDE_CODE_ENTRYPOINT', 'mcp'],
    ['CAREER_OPS_NO_ASKS', '1'],
  ];
  for (const [name, value] of cases) {
    const root = workspace(1);
    const r = run(root, ['next'], { [name]: value });
    assert.equal(r.code, 0, `${name}=${value}`);
    assert.equal(r.out, '', `${name}=${value}`);
    assert.equal(existsSync(marker(root, 'star')), false, `${name}=${value}`);
  }
});

test('an interactive session asks, whatever the terminal', () => {
  for (const extra of [{}, { CLAUDE_CODE_ENTRYPOINT: 'cli' }, { CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' }, { CI: 'false' }, { CI: '0' }]) {
    const root = workspace(1);
    assert.equal(run(root, ['next'], extra).out, `${askOutput('star', { reports: 1 })}\n`, JSON.stringify(extra));
  }
});

test('a data folder it cannot write means no ask, and the run still exits 0', {
  skip: process.platform === 'win32' || process.getuid?.() === 0,
}, () => {
  const root = workspace(1);
  chmodSync(join(root, 'data'), 0o555);
  const r = run(root);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('off turns every ask off', () => {
  const root = workspace(MANIFESTO_MIN_REPORTS);
  const off = run(root, ['off']);
  assert.equal(off.code, 0);
  assert.match(off.out, /off/);
  assert.equal(run(root, ['next', '--now', at(0)]).out, '');
  assert.equal(run(root, ['next', '--now', at(30)]).out, '');
});

test('the manifesto comes a week after the star, with five reports, once', () => {
  const root = workspace(MANIFESTO_MIN_REPORTS);
  assert.equal(run(root, ['next', '--now', at(0)]).out, `${askOutput('star', { reports: MANIFESTO_MIN_REPORTS })}\n`);
  assert.equal(run(root, ['next', '--now', at(0)]).out, '', 'never two asks in one run');
  assert.equal(run(root, ['next', '--now', at(MANIFESTO_MIN_DAYS_AFTER_STAR - 1)]).out, '');
  const manifesto = run(root, ['next', '--now', at(MANIFESTO_MIN_DAYS_AFTER_STAR)]);
  assert.equal(manifesto.out, `${askOutput('manifesto')}\n`);
  assert.ok(manifesto.out.includes(MANIFESTO_URL));
  assert.ok(!manifesto.out.includes('```'), 'the drawing goes with the star only');
  assert.equal(run(root, ['next', '--now', at(60)]).out, '');
});

test('the manifesto waits for five reports', () => {
  const root = workspace(MANIFESTO_MIN_REPORTS - 1);
  assert.equal(run(root, ['next', '--now', at(0)]).out, `${askOutput('star', { reports: MANIFESTO_MIN_REPORTS - 1 })}\n`);
  assert.equal(run(root, ['next', '--now', at(60)]).out, '');
});

test('whoever saw the old scan note is not asked for the manifesto', () => {
  const root = workspace(MANIFESTO_MIN_REPORTS);
  writeFileSync(join(root, '.manifesto-noted'), `${at(-30)}\n`);
  assert.equal(run(root, ['next', '--now', at(0)]).out, `${askOutput('star', { reports: MANIFESTO_MIN_REPORTS })}\n`);
  assert.equal(run(root, ['next', '--now', at(30)]).out, '');
});

test('decideAsk follows the ladder and never returns two asks', () => {
  const now = new Date(at(30));
  const longAgo = new Date(at(0));
  assert.equal(decideAsk({ reports: 0, now }), null);
  assert.equal(decideAsk({ reports: 1, now }), 'star');
  assert.equal(decideAsk({ reports: 40, now }), 'star', 'the small ask always comes first');
  assert.equal(decideAsk({ reports: 40, star: longAgo, now }), 'manifesto');
  assert.equal(decideAsk({ reports: 40, star: longAgo, manifesto: now, now }), null);
  assert.equal(decideAsk({ reports: 40, star: longAgo, legacyManifesto: true, now }), null);
  assert.equal(decideAsk({ reports: 40, off: true, now }), null);
});

test('only evaluation reports count', () => {
  const root = workspace(0);
  const dir = join(root, 'reports');
  writeFileSync(join(dir, '001-acme-2026-11-01.md'), '');
  writeFileSync(join(dir, '12-short-number.md'), '');
  writeFileSync(join(dir, 'README.md'), '');
  writeFileSync(join(dir, '.gitkeep'), '');
  mkdirSync(join(dir, '002-a-folder.md'));
  assert.equal(countReports(dir), 1);
  assert.equal(countReports(join(root, 'missing')), 0);
});

test('unattendedReason reads only what it should', () => {
  assert.equal(unattendedReason({}), null);
  assert.equal(unattendedReason({ CI: 'false' }), null);
  assert.equal(unattendedReason({ CAREER_OPS_HEADLESS: '0' }), null);
  assert.equal(unattendedReason({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), null);
  assert.ok(unattendedReason({ CI: '1' }));
  assert.ok(unattendedReason({ CLAUDE_CODE_ENTRYPOINT: 'sdk-py' }));
});

test('open takes a known ask and never opens a browser in an unattended run', () => {
  const root = workspace(0);
  assert.equal(run(root, ['open', 'star'], { CI: 'true' }).out, `Open this page: ${STAR_URL}\n`);
  assert.equal(run(root, ['open', 'manifesto'], { CI: 'true' }).out, `Open this page: ${MANIFESTO_URL}\n`);
  const bad = run(root, ['open', 'everything'], { CI: 'true' });
  assert.equal(bad.code, 1);
  assert.equal(bad.out, '');
});

test('status shows the state as JSON', () => {
  const root = workspace(1);
  const before = JSON.parse(run(root, ['status']).out);
  assert.equal(before.reports, 1);
  assert.equal(before.due, 'star');
  assert.equal(before.shown.star, null);
  run(root);
  const afterAsk = JSON.parse(run(root, ['status']).out);
  assert.equal(afterAsk.due, null);
  assert.ok(afterAsk.shown.star);
});

test('the script makes no request of its own', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(src, /from\s+['"](?:node:)?(?:https?|http2|net|tls|dgram|undici)['"]/);
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /\b(?:gh|curl)\b[^\n]*starred/, 'never stars for the user');
  assert.equal((src.match(/execFileSync\(/g) || []).length, 1, 'only the browser opener runs a program');
});

test('the texts keep their promises', () => {
  const first = askText('star', { reports: 1 });
  const veteran = askText('star', { reports: 12 });
  assert.ok(first.startsWith('If this report saved you some time'));
  assert.ok(veteran.startsWith("You've run 12 evaluations with career-ops so far."));
  assert.equal(askText('star', { reports: VETERAN_MIN_REPORTS - 1 }), first);
  for (const star of [first, veteran]) {
    assert.ok(star.includes(STAR_URL));
    assert.ok(star.includes('A Star on GitHub \u{1F31F} (the button at the top right of the page)'), 'names the button the user clicks');
    assert.ok(!star.includes('\u2b50'), 'never U+2B50: some terminals draw it as a text "*" plus a space');
    assert.ok(star.endsWith("I won't ask for a star again."));
  }
  const manifesto = askText('manifesto');
  assert.ok(manifesto.includes(MANIFESTO_URL));
  assert.ok(manifesto.endsWith("I won't ask about the manifesto again."));
  assert.doesNotMatch(manifesto, /\d/, 'the manifesto ask carries no count');
  // "collects nothing about you" is only true while the disclaimer says so.
  if ([first, veteran].some((star) => star.includes('collects nothing'))) {
    const legal = readFileSync(join(ROOT, 'LEGAL_DISCLAIMER.md'), 'utf8');
    assert.match(legal, /We do not collect analytics, telemetry, or usage data of any kind/,
      'LEGAL_DISCLAIMER.md changed: revisit the star line in community-asks.mjs in the same PR');
  }
});

test('the star drawing is printed whole, in its own block, and only with the star', () => {
  assert.equal(STAR_ART.length, 8);
  for (const line of STAR_ART) {
    // Plain ASCII keeps every column aligned in any terminal; an emoji may only
    // close a row, where drawing it a column wider shifts nothing.
    const m = /^([\x20-\x7e]*?)(\u{1F31F}|\u2728|\u{1F4AB})?$/u.exec(line);
    assert.ok(m, `only ASCII, or one emoji at the end: ${JSON.stringify(line)}`);
    assert.ok(m[1].length + (m[2] ? 2 : 0) <= 21, `too wide: ${JSON.stringify(line)}`);
  }
  assert.ok(STAR_ART[1].endsWith('\u{1F31F}'));
  // Never U+2B50: Claude Code on macOS drew it as a text "*" plus a space (9-nov).
  assert.ok(!STAR_ART.join('').includes('\u2b50'), 'no U+2B50 in the drawing');
  // No U+FE0F selector: it adds nothing and some terminals draw it as boxes.
  assert.ok(!STAR_ART.join('').includes('\ufe0f'), 'no variation selector after the emoji');
  const star = askOutput('star', { reports: 1 }).split('\n');
  assert.deepEqual(star.slice(0, STAR_ART.length + 2), ['```', ...STAR_ART, '```']);
  assert.equal(star[STAR_ART.length + 2], askText('star', { reports: 1 }));
  assert.ok(!askOutput('manifesto').includes('```'));
});

test('the markers are user data that updates never ship or replace', () => {
  assert.ok(SYSTEM_PATHS.includes('community-asks.mjs'), 'the updater must ship the script');
  assert.equal(SYSTEM_PATHS.some((p) => p.replace(/\\/g, '/').startsWith('data/')
    && !p.endsWith('.gitkeep')), false);
  assert.match(readFileSync(join(ROOT, 'DATA_CONTRACT.md'), 'utf8'), /`data\/\.community-asks\/`/);
});
