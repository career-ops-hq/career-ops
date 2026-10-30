// tests/split-root.test.mjs — entry points that read both layers, run with the
// data root outside the checkout (#5115).
//
// CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR / a .career-ops-data marker move the
// user layer out of the checkout. An entry point then has two roots to keep
// apart: system-layer files (modes/_shared.md, modes/oferta.md, the .mjs
// scripts) ship with the code, user-layer files (cv.md, config/profile.yml,
// modes/_profile.md, reports/, batch/tracker-additions/) follow the data root.
// Two entry points got that wrong, in opposite directions:
//
//   openrouter-runner.mjs   read the system modes from the DATA root, found
//                           none, and evaluated on a prompt with no shared
//                           rules and no evaluation mode.
//   batch/batch-runner.sh   built every path from the CHECKOUT, so workers were
//                           scored against the checkout's template profile and
//                           their reports and tracker lines were looked for in
//                           directories reserve-report-num.mjs and
//                           merge-tracker.mjs never read.
//
// Every data root here holds user-layer files ONLY. The existing
// openrouter-runner data-root test planted modes/apply.md inside its data root,
// which is the one thing a real data root never has and exactly what hid the
// first bug.
//
// Both entry points are driven through their real CLI, with the network and the
// worker replaced: a preloaded fetch stub stands in for OpenRouter, a `claude`
// stub on PATH stands in for the batch worker.
//
// Run:  node --test tests/split-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getBash, rmSync, ROOT, toBashPath } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];

/**
 * A data root with user-layer files only: reports 001-003, a tracker whose
 * highest row is 3, and a profile/_profile/_custom/cv each carrying a marker no
 * shipped file contains.
 */
function makeDataRoot(base, name = 'data-root') {
  const dir = join(base, name);
  for (const sub of ['reports', 'data', 'config', 'modes']) mkdirSync(join(dir, sub), { recursive: true });
  for (const n of ['001', '002', '003']) {
    writeFileSync(join(dir, 'reports', `${n}-acme-2026-01-01.md`), `# Evaluation ${n}\n\n**Score:** 4.5/5\n`);
  }
  writeFileSync(join(dir, 'data', 'applications.md'), [
    ...TRACKER_HEADER,
    '| 3 | 2026-01-01 | Acme | Eng | 4.5/5 | Applied | ✅ | [3](../reports/003-acme-2026-01-01.md) | — |',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate:\n  full_name: Data Root Candidate\nspend_tier: economy\n');
  writeFileSync(join(dir, 'modes', '_profile.md'), '# DATA-ROOT-PROFILE-MARKER\n');
  writeFileSync(join(dir, 'modes', '_custom.md'), '# DATA-ROOT-CUSTOM-MARKER\n');
  writeFileSync(join(dir, 'cv.md'), '# DATA-ROOT-CV-MARKER\n');
  return dir;
}

// Every override that outranks the resolved root is blanked, so a developer's
// own exports cannot point these runs at their real data (#3988).
function splitEnv(extra = {}) {
  return {
    ...process.env,
    CAREER_OPS_ROOT: '',
    CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_TRACKER: '',
    CAREER_OPS_REPORTS_DIR: '',
    CAREER_OPS_ADDITIONS: '',
    CAREER_OPS_BATCH_STATE: '',
    CAREER_OPS_PROFILE: '',
    ...extra,
  };
}

// ── openrouter-runner.mjs ───────────────────────────────────────────────────

// Preloaded with --import. Records the request the runner would have sent to
// OpenRouter and answers it; any other request fails, so the test cannot reach
// the network.
const FETCH_STUB = `
import { writeFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).endsWith('/chat/completions')) throw new Error('split-root fixture: unexpected fetch ' + url);
  writeFileSync(process.env.SPLIT_ROOT_CAPTURE, String(init.body));
  const body = { choices: [{ message: { content: '**Legitimacy:** High\\n\\nScore: 4.2/5\\n\\nFixture evaluation.' } }], usage: {} };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
`;

/** Run the real runner CLI under a data root and return the system prompt it sent. */
function sentSystemPrompt(base, dataRoot, args) {
  const stub = join(base, 'fetch-stub.mjs');
  writeFileSync(stub, FETCH_STUB);
  const capture = join(base, `request-${args[0]}.json`);
  const cwd = join(base, 'decoy-cwd');
  mkdirSync(cwd, { recursive: true });
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, join(ROOT, 'openrouter-runner.mjs'), ...args], {
    cwd, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
    // A pinned model skips the free-model listing, the runner's other request.
    env: splitEnv({
      CAREER_OPS_ROOT: dataRoot,
      OPENROUTER_API_KEY: 'split-root-fixture-key',
      CAREER_OPS_MODEL: 'fixture/model',
      SPLIT_ROOT_CAPTURE: capture,
    }),
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  assert.equal(r.status, 0, describeSpawn(r, `openrouter-runner ${args[0]} exited ${r.status}`));
  assert.ok(existsSync(capture), `openrouter-runner ${args[0]} sent no model request:\n${r.stdout}\n${r.stderr}`);
  const request = JSON.parse(readFileSync(capture, 'utf8'));
  return request.messages[0].content[0].text;
}

const systemMode = (name) => readFileSync(join(ROOT, 'modes', name), 'utf8');
// The runner drops the tool sections from the mode text it sends (#5809), so
// compare against the checkout's file as the runner sends it.
const { stripToolInstructions } = await import(pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href);
const sentMode = (name) => stripToolInstructions(systemMode(name));

test('openrouter-runner evaluate: system modes come from the checkout, user files from the data root', () => {
  const base = mkdtempSync(join(tmpdir(), 'split-root-or-eval-'));
  try {
    const dataRoot = makeDataRoot(base);
    for (const mode of ['_shared.md', 'oferta.md', 'auto-pipeline.md', 'apply.md']) {
      assert.ok(!existsSync(join(dataRoot, 'modes', mode)), `fixture error: the data root must not hold modes/${mode}`);
    }

    const prompt = sentSystemPrompt(base, dataRoot, ['evaluate', 'Acme Corp is hiring a Senior Platform Engineer in Berlin.']);

    assert.ok(prompt.includes(sentMode('_shared.md')), 'the system prompt is missing the checkout\'s modes/_shared.md');
    assert.ok(prompt.includes(sentMode('oferta.md')), 'the system prompt is missing the checkout\'s modes/oferta.md');
    assert.ok(prompt.includes('DATA-ROOT-PROFILE-MARKER'), 'the system prompt is missing the data root\'s modes/_profile.md');
    assert.ok(prompt.includes('DATA-ROOT-CV-MARKER'), 'the system prompt is missing the data root\'s cv.md');
    assert.ok(prompt.includes('Data Root Candidate'), 'the system prompt is missing the data root\'s config/profile.yml');

    // The report still follows the data root, numbered after the reports there.
    const written = readdirSync(join(dataRoot, 'reports')).filter((f) => f.startsWith('004-'));
    assert.equal(written.length, 1, `expected report 004 in the data root, found: ${readdirSync(join(dataRoot, 'reports')).join(', ')}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('openrouter-runner apply: modes/apply.md comes from the checkout', () => {
  const base = mkdtempSync(join(tmpdir(), 'split-root-or-apply-'));
  try {
    const dataRoot = makeDataRoot(base);
    const prompt = sentSystemPrompt(base, dataRoot, ['apply', '1']);

    assert.ok(prompt.includes(sentMode('_shared.md')), 'the system prompt is missing the checkout\'s modes/_shared.md');
    assert.ok(prompt.includes(sentMode('apply.md')), 'the system prompt is missing the checkout\'s modes/apply.md');
    assert.ok(prompt.includes('DATA-ROOT-PROFILE-MARKER'), 'the system prompt is missing the data root\'s modes/_profile.md');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ── batch/batch-runner.sh ───────────────────────────────────────────────────

const RUNNER_SRC = readFileSync(join(ROOT, 'batch', 'batch-runner.sh'), 'utf8').replace(/\r\n/g, '\n');

// Runs a real root-level script from this checkout, so the fixture exercises the
// allocator and the merge the runner is supposed to agree with.
const realScriptShim = (name) => [
  "import { spawnSync } from 'node:child_process';",
  `const r = spawnSync(process.execPath, [${JSON.stringify(join(ROOT, name))}, ...process.argv.slice(2)], { stdio: 'inherit' });`,
  'process.exitCode = r.status ?? 1;',
  '',
].join('\n');

// The worker. Like a real one it resolves the prompt's repo-relative paths
// against its working directory unless the system prompt names a data root.
const WORKER_STUB = [
  '#!/usr/bin/env bash',
  'promptfile=""; model=""; prev=""; last=""',
  'for arg in "$@"; do',
  '  [[ "$prev" == "--append-system-prompt-file" ]] && promptfile="$arg"',
  '  [[ "$prev" == "--model" ]] && model="$arg"',
  '  prev="$arg"; last="$arg"',
  'done',
  'cp "$promptfile" "$CAPTURE_DIR/system-prompt.md"',
  'printf \'%s\' "$model" > "$CAPTURE_DIR/model.txt"',
  'field() { printf \'%s\' "$last" | sed -n "s/.*$1: \\([^ ]*\\).*/\\1/p"; }',
  'num="$(field "Report number")"; id="$(field "Batch ID")"; date="$(field "Date")"',
  'root="$(sed -n \'s/^Data root: //p\' "$promptfile" | head -n 1)"',
  '[[ -n "$root" ]] || root="$PWD"',
  '[[ "${WORKER_WRITES:-yes}" == "yes" ]] || exit 1',
  'mkdir -p "$root/reports" "$root/batch/tracker-additions"',
  'printf \'# Evaluation: Acme\\n\\n**Score:** 4.5/5\\n**URL:** https://example.com/one\\n**Legitimacy:** High\\n\\n## Job Description (archived verbatim)\\n\\nFixture JD.\\n\' > "$root/reports/$num-acme-$date.md"',
  'printf \'num\\tdate\\tcompany\\trole\\tstatus\\tscore\\tpdf\\treport\\tnotes\\turl\\n%s\\t%s\\tAcme\\tPlatform Engineer\\tEvaluated\\t4.5/5\\t❌\\t[%s](reports/%s-acme-%s.md)\\tfixture\\thttps://example.com/one\\n\' "$num" "$date" "$num" "$num" "$date" > "$root/batch/tracker-additions/$id.tsv"',
  'printf \'```json\\n{"status":"completed","id":"%s","report_num":"%s","score":4.5}\\n```\\n\' "$id" "$num"',
  '',
].join('\n');

/**
 * A scratch checkout: the real runner and path resolver, the real allocator
 * and merge behind shims, and decoy user files that must never be read. The
 * decoys make a wrong root visible instead of merely absent.
 */
function makeCheckout(base, { realTools }) {
  const dir = join(base, 'checkout');
  const binDir = join(base, 'bin');
  const captureDir = join(base, 'captures');
  for (const d of [join(dir, 'batch'), join(dir, 'config'), join(dir, 'modes'), binDir, captureDir]) mkdirSync(d, { recursive: true });

  writeFileSync(join(dir, 'batch', 'batch-runner.sh'), RUNNER_SRC);
  chmodSync(join(dir, 'batch', 'batch-runner.sh'), 0o755);
  writeFileSync(join(dir, 'batch', 'batch-prompt.md'), 'Fixture worker prompt.\n\nReport: reports/{{REPORT_NUM}}-{company-slug}-{{DATE}}.md\nTracker: batch/tracker-additions/{{ID}}.tsv\n');
  writeFileSync(join(dir, 'batch', 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttps://example.com/one\tfixture\t-\n');
  copyFileSync(join(ROOT, 'path-resolver.mjs'), join(dir, 'path-resolver.mjs'));

  if (realTools) {
    for (const name of ['reserve-report-num.mjs', 'merge-tracker.mjs']) writeFileSync(join(dir, name), realScriptShim(name));
  } else {
    writeFileSync(join(dir, 'reserve-report-num.mjs'), "if (!process.argv.includes('--release')) console.log('001');\n");
    writeFileSync(join(dir, 'merge-tracker.mjs'), '// No merge in this fixture.\n');
  }
  for (const name of ['reconcile-pipeline.mjs', 'verify-pipeline.mjs']) writeFileSync(join(dir, name), '// Not under test here.\n');

  writeFileSync(join(dir, 'config', 'profile.yml'), 'candidate:\n  full_name: Checkout Decoy\nspend_tier: premium\n');
  writeFileSync(join(dir, 'modes', '_profile.md'), '# CHECKOUT-DECOY-PROFILE\n');
  writeFileSync(join(dir, 'modes', '_custom.md'), '# CHECKOUT-DECOY-CUSTOM\n');

  writeFileSync(join(binDir, 'claude'), WORKER_STUB);
  // No network: the JD prefetch falls through to the worker's own fetch.
  writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(join(binDir, 'claude'), 0o755);
  chmodSync(join(binDir, 'curl'), 0o755);
  return { dir, binDir, captureDir };
}

function runBatch(checkout, env) {
  return spawnSync(getBash(), [toBashPath(join(checkout.dir, 'batch', 'batch-runner.sh')), '--parallel', '1', '--max-retries', '0', '--rate-limit-sleep', '0'], {
    cwd: checkout.dir, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: splitEnv({
      PATH: `${checkout.binDir}${delimiter}${process.env.PATH}`,
      CAPTURE_DIR: checkout.captureDir,
      ...env,
    }),
  });
}

const listDir = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

function assertDataRootPersonalization(prompt) {
  for (const marker of ['DATA-ROOT-PROFILE-MARKER', 'Data Root Candidate', 'DATA-ROOT-CUSTOM-MARKER']) {
    assert.ok(prompt.includes(marker), `the worker prompt is missing the data root's personalization (${marker})`);
  }
  for (const decoy of ['CHECKOUT-DECOY-PROFILE', 'Checkout Decoy', 'CHECKOUT-DECOY-CUSTOM']) {
    assert.ok(!prompt.includes(decoy), `the worker prompt carries the checkout's personalization (${decoy})`);
  }
}

test('batch-runner: personalization, spend_tier, reports and tracker additions follow the data root', () => {
  const base = mkdtempSync(join(tmpdir(), 'split-root-batch-'));
  try {
    const dataRoot = makeDataRoot(base);
    const checkout = makeCheckout(base, { realTools: true });

    const r = runBatch(checkout, { CAREER_OPS_ROOT: dataRoot });
    const output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
    assert.equal(r.status, 0, describeSpawn(r, `batch-runner exited ${r.status}:\n${output}`));

    // 1. The worker was briefed with the data root's personalization.
    const promptPath = join(checkout.captureDir, 'system-prompt.md');
    assert.ok(existsSync(promptPath), `the worker was never launched:\n${output}`);
    assertDataRootPersonalization(readFileSync(promptPath, 'utf8'));

    // 2. spend_tier is the data root's (economy), not the checkout's (premium)
    //    or the default (standard). The expected model is read from the
    //    runner's own tier table, so a model bump does not touch this test.
    const economyModel = RUNNER_SRC.match(/^\s*economy\) echo "([^"]+)"/m)?.[1];
    assert.ok(economyModel, 'could not read the economy model out of spend_tier_to_model()');
    assert.equal(readFileSync(join(checkout.captureDir, 'model.txt'), 'utf8'), economyModel,
      'the worker model was not resolved from the data root\'s spend_tier');

    // 3. The runner looked for the report where the allocator numbered it.
    //    Reports 001-003 and tracker row 3 exist only in the data root, so the
    //    real allocator hands out 004; "completed" means the runner then found
    //    a report 004 in its own reports directory.
    const state = readFileSync(join(checkout.dir, 'batch', 'batch-state.tsv'), 'utf8').trim().split('\n');
    const row = state[1]?.split('\t') ?? [];
    assert.deepEqual([row[2], row[5], row[6]], ['completed', '004', '4.5'],
      `expected offer 1 completed as report 004 with score 4.5, got: ${JSON.stringify(row)}\n${output}`);
    assert.equal(listDir(join(dataRoot, 'reports')).filter((f) => f.startsWith('004-acme-')).length, 1,
      'report 004 is not in the data root');
    assert.deepEqual(listDir(join(checkout.dir, 'reports')), [], 'a report was written into the checkout');
    assert.deepEqual(listDir(join(dataRoot, 'reports')).filter((f) => f.includes('RESERVED')), [],
      'the report-number reservation was not released');

    // 4. The tracker line was read from the directory merge-tracker.mjs merges,
    //    by the real merge, into the data root's tracker.
    assert.deepEqual(listDir(join(checkout.dir, 'batch', 'tracker-additions')), [],
      'a tracker addition was left in the checkout, where merge-tracker.mjs never looks');
    const tracker = readFileSync(join(dataRoot, 'data', 'applications.md'), 'utf8');
    const merged = tracker.split('\n').find((line) => /^\|\s*4\s*\|/.test(line)) ?? '';
    assert.ok(/Acme/.test(merged) && /4\.5\/5/.test(merged),
      `the batch result never reached the data root's tracker:\n${tracker}\n${output}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('batch-runner: a .career-ops-data marker with a relative path is honored like the env override', () => {
  const base = mkdtempSync(join(tmpdir(), 'split-root-batch-marker-'));
  try {
    makeDataRoot(base, 'marked-root');
    const checkout = makeCheckout(base, { realTools: false });
    // Relative to the checkout, the way path-resolver.mjs resolves it.
    writeFileSync(join(checkout.dir, '.career-ops-data'), '../marked-root\n');

    const r = runBatch(checkout, { WORKER_WRITES: 'no' });
    const promptPath = join(checkout.captureDir, 'system-prompt.md');
    assert.ok(existsSync(promptPath), `the worker was never launched:\n${r.stdout}\n${r.stderr}`);
    assertDataRootPersonalization(readFileSync(promptPath, 'utf8'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('batch-runner: with no data root configured, nothing about the checkout layout changes', () => {
  const base = mkdtempSync(join(tmpdir(), 'split-root-batch-default-'));
  try {
    const checkout = makeCheckout(base, { realTools: false });

    const r = runBatch(checkout, {});
    const output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, 0, describeSpawn(r, `batch-runner exited ${r.status}:\n${output}`));

    const prompt = readFileSync(join(checkout.captureDir, 'system-prompt.md'), 'utf8');
    assert.ok(prompt.includes('CHECKOUT-DECOY-PROFILE'), 'the default layout no longer injects the checkout\'s modes/_profile.md');
    assert.ok(!/^Data root:/m.test(prompt), 'the default layout prompt gained a data-root section');

    assert.equal(listDir(join(checkout.dir, 'reports')).filter((f) => f.startsWith('001-acme-')).length, 1,
      `the default layout no longer writes reports into the checkout:\n${output}`);
    const row = readFileSync(join(checkout.dir, 'batch', 'batch-state.tsv'), 'utf8').trim().split('\n')[1]?.split('\t') ?? [];
    assert.equal(row[2], 'completed', `expected offer 1 completed, got: ${JSON.stringify(row)}\n${output}`);
    assert.deepEqual(listDir(join(checkout.dir, 'batch', 'tracker-additions')), ['1.tsv']);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
