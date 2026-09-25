// Run the real CLI with separate code, data and cwd roots. Each root has a
// different story and CV figure, so reading either wrong file changes a bucket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNestedCheckout } from '../lib/mjs-files.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUCKETS = ['existing', 'supportedByResume', 'derivedUnverified', 'userCannotConfirm'];

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-provenance-root-')));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const f = { dir };
  for (const [name, figure] of [['code', 71], ['data', 63], ['other', 94], ['cwd', 82]]) {
    const root = join(dir, name);
    mkdirSync(join(root, 'interview-prep'), { recursive: true });
    const story = join(root, 'interview-prep', 'story-bank.md');
    const cv = join(root, 'cv.md');
    writeFileSync(story, [
      `### [Impact] ${name} uncertain costs`,
      '**Result:** Reduced infrastructure costs by 40%.',
      '**Provenance:** user-cannot-confirm',
      '',
      `### [Performance] ${name} latency improvement`,
      `**Result:** Reduced service latency by ${figure}%.`,
      '',
    ].join('\n'));
    writeFileSync(cv, `# CV\n\nReduced infrastructure costs by 40%.\nReduced service latency by ${figure}%.\n`);
    f[name] = { root, story, cv, figure, name };
  }
  // Copy the actual dependency closure, without personal files or node_modules.
  mkdirSync(join(f.code.root, 'lib'));
  for (const file of ['story-provenance-check.mjs', 'path-resolver.mjs', 'lib/cli-flags.mjs', 'lib/is-main-module.mjs']) {
    copyFileSync(join(ROOT, file), join(f.code.root, file));
  }
  return f;
}

function snapshot(root) {
  const entries = {};
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      entries[relative(root, path)] = entry.isDirectory() ? null : readFileSync(path, 'utf8');
      if (entry.isDirectory()) {
        if (isNestedCheckout(path)) continue;
        visit(path);
      }
    }
  }
  visit(root);
  return entries;
}

function run(f, args, env) {
  const before = snapshot(f.dir);
  const result = spawnSync(process.execPath, [join(f.code.root, 'story-provenance-check.mjs'), ...args], {
    cwd: f.cwd.root,
    env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '', ...env },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  assert.deepEqual(snapshot(f.dir), before, 'the checker must not write source files or create artifacts');
  return result.stdout;
}

function check(f, { env = {}, args = [], source = f.data, storyPath = source.story, cvPath = source.cv, bucket = 'existing', missing = null } = {}) {
  const report = JSON.parse(run(f, args, env));
  assert.deepEqual(Object.keys(report).sort(), [...BUCKETS, 'lowConfidence'].sort());
  const expected = Object.fromEntries(BUCKETS.map((key) => [key, []]));
  if (missing !== 'no-story-bank') {
    expected.userCannotConfirm.push({ story: `${source.name} uncertain costs`, claim: '40%', pattern: 'percent' });
    expected[bucket].push({ story: `${source.name} latency improvement`, claim: `${source.figure}%`, pattern: 'percent' });
  }
  for (const key of BUCKETS) {
    assert.deepEqual(report[key].map(({ story, claim, pattern }) => ({ story, claim, pattern })), expected[key], key);
  }
  if (missing) {
    const path = missing === 'no-story-bank' ? storyPath : cvPath;
    assert.equal(report.lowConfidence.reason, missing);
    assert.ok(report.lowConfidence.message.startsWith(`${path} not found`));
  } else {
    assert.equal(report.lowConfidence, null);
    assert.match(report.userCannotConfirm[0].reason, /durable, never reclassified/);
  }

  const summary = run(f, [...args, '--summary'], env);
  assert.ok(summary.includes(`Story bank: ${storyPath}${missing === 'no-story-bank' ? ' (not found)' : ''}`));
  assert.ok(summary.includes(`CV:         ${cvPath}${missing === 'no-cv' ? ' (not found)' : ''}`));
  assert.match(summary, new RegExp(`Claims checked: ${missing === 'no-story-bank' ? 0 : 2}\\b`));
  for (const [key, label] of [
    ['existing', 'existing'], ['supportedByResume', 'supportedByResume'],
    ['derivedUnverified', 'derived-unverified'], ['userCannotConfirm', 'user-cannot-confirm'],
  ]) {
    assert.match(summary, new RegExp(`${label} \\([^\\n]*\\) \\(${expected[key].length}\\)`));
    for (const claim of expected[key]) assert.ok(summary.includes(`[${claim.story}] "${claim.claim}"`));
  }
  if (missing) assert.ok(summary.includes(`(reason: ${missing})`));
  else assert.doesNotMatch(summary, /LOW CONFIDENCE/);
}

for (const name of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR']) {
  for (const relativePath of [false, true]) {
    test(`${name} reads both files from the ${relativePath ? 'code-relative' : 'absolute'} data root`, (t) => {
      const f = fixture(t);
      check(f, { env: { [name]: relativePath ? relative(f.code.root, f.data.root) : f.data.root } });
    });
  }
}

for (const relativePath of [false, true]) {
  test(`the ${relativePath ? 'relative' : 'absolute'} marker selects the data root`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.code.root, '.career-ops-data'), `${relativePath ? relative(f.code.root, f.data.root) : f.data.root}\n`);
    check(f);
  });
}

test('with no configuration, foreign cwd does not replace the code-root default', (t) => {
  const f = fixture(t);
  check(f, { source: f.code });
});

test('CAREER_OPS_ROOT wins over CAREER_OPS_DATA_DIR and the marker', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.code.root, '.career-ops-data'), f.code.root);
  check(f, { env: { CAREER_OPS_ROOT: f.data.root, CAREER_OPS_DATA_DIR: f.other.root } });
});

test('CAREER_OPS_DATA_DIR wins over the marker when CAREER_OPS_ROOT is blank', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.code.root, '.career-ops-data'), f.other.root);
  check(f, { env: { CAREER_OPS_ROOT: '  ', CAREER_OPS_DATA_DIR: f.data.root } });
});

test('an explicit relative story-bank overrides only that input and stays cwd-relative', (t) => {
  const f = fixture(t);
  const storyPath = join('interview-prep', 'story-bank.md');
  check(f, { env: { CAREER_OPS_ROOT: f.data.root }, args: ['--story-bank', storyPath], source: f.cwd, storyPath, cvPath: f.data.cv, bucket: 'supportedByResume' });
});

test('an explicit relative CV overrides only that input and stays cwd-relative', (t) => {
  const f = fixture(t);
  check(f, { env: { CAREER_OPS_ROOT: f.data.root }, args: ['--cv=cv.md'], cvPath: 'cv.md', bucket: 'supportedByResume' });
});

test('both explicit relative inputs override the configured data root', (t) => {
  const f = fixture(t);
  const storyPath = join('interview-prep', 'story-bank.md');
  check(f, { env: { CAREER_OPS_ROOT: f.data.root }, args: ['--story-bank', storyPath, '--cv', 'cv.md'], source: f.cwd, storyPath, cvPath: 'cv.md' });
});

test('absolute input flags override the configured data root', (t) => {
  const f = fixture(t);
  check(f, { env: { CAREER_OPS_ROOT: f.data.root }, args: [`--story-bank=${f.other.story}`, '--cv', f.other.cv], source: f.other });
});

for (const [input, missing] of [['story', 'no-story-bank'], ['cv', 'no-cv']]) {
  test(`a missing configured ${input} never falls back to the code root or cwd`, (t) => {
    const f = fixture(t);
    rmSync(f.data[input]);
    check(f, { env: { CAREER_OPS_ROOT: f.data.root }, missing, bucket: 'derivedUnverified' });
  });

  test(`a missing explicit ${input} never falls back to the configured default`, (t) => {
    const f = fixture(t);
    const path = `missing-${input}.md`;
    check(f, {
      env: { CAREER_OPS_ROOT: f.data.root },
      args: [input === 'story' ? '--story-bank' : '--cv', path],
      ...(input === 'story' ? { storyPath: path } : { cvPath: path }),
      missing,
      bucket: 'derivedUnverified',
    });
  });
}
