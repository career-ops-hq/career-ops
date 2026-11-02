// tests/rank-pipeline-reliability.test.mjs — the ranker asks for a one-shot
// answer with no tools, from an empty directory, under a timeout the user can
// raise, and says which rows it could not rank.
//
// Before, each CLI ran as a full agent in the data root. A batch could spend its
// 120 s exploring files and time out, leaving rows unranked, and a dry run where
// every call failed still exited 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { CLI_CANDIDATES, buildPrompt, resolveRankTimeoutMs } from '../rank-pipeline.mjs';

const POSIX = { skip: process.platform === 'win32' && 'POSIX executable fixture' };
const ROWS = Array.from({ length: 12 }, (_, i) => `- [ ] https://example.test/${i} | Example | Engineer ${i}`);

function sandbox(t, cliBody, bin = 'grok') {
  const root = mkdtempSync(join(tmpdir(), 'rank-reliability-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'data', 'pipeline.md'), `${ROWS.join('\n')}\n`);
  const binary = join(root, 'bin', bin);
  writeFileSync(binary, `#!${process.execPath}\nconst fs = require('node:fs');\n${cliBody}\n`);
  chmodSync(binary, 0o755);
  return root;
}

function rank(root, args = [], extra = {}, bin = 'grok') {
  const result = spawnSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--cli', bin, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...extra },
  });
  assert.ifError(result.error);
  return result;
}

const SCORE_ALL = `const n = (process.argv.find(a => a.includes('POSTINGS:')).match(/^\\d+\\./gm) || []).length;
console.log(JSON.stringify(Array.from({ length: n }, (_, id) => ({ id, score: 3, reason: 'Fixture match' }))));`;

test('each CLI is asked for one answer with no tools or extra turns', () => {
  const args = bin => CLI_CANDIDATES.find(c => c.bin === bin).args('PROMPT');
  assert.deepEqual(args('claude'), ['-p', 'PROMPT', '--tools', '', '--disallowedTools', '*']);
  const grok = args('grok');
  assert.deepEqual(grok.slice(0, 3), ['-p', 'PROMPT', '--disable-web-search']);
  const denied = grok[grok.indexOf('--disallowed-tools') + 1].split(',');
  for (const tool of ['run_terminal_command', 'web_fetch', 'use_tool', 'search_tool', 'spawn_subagent']) {
    assert.ok(denied.includes(tool), `grok keeps ${tool}`);
  }
  assert.deepEqual(args('codex'), ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', 'PROMPT']);
  assert.deepEqual(args('pi'), ['--no-tools', '-p', 'PROMPT']);
  const copilot = args('copilot');
  assert.deepEqual(copilot.slice(0, 3), ['-p', 'PROMPT', '-s']);
  const only = copilot.filter(a => a.startsWith('--available-tools=')).map(a => a.split('=')[1]);
  assert.equal(only.length, 1, 'copilot gets one tool allowlist');
  assert.ok(only[0], 'an empty --available-tools= leaves every tool on');
  assert.ok(copilot.includes(`--disable-mcp-server=${only[0]}`), 'an MCP server named like the allowlist entry is turned off');
  assert.ok(copilot.includes('--deny-tool=read,write,shell,url,memory'));
});

test('opencode runs with every permission denied', POSIX, (t) => {
  const root = sandbox(t, `fs.writeFileSync(process.env.RANK_ENV, process.env.OPENCODE_CONFIG_CONTENT ?? '');\n${SCORE_ALL}`, 'opencode');
  const result = rank(root, ['--dry-run'], { RANK_ENV: join(root, 'env.txt'), OPENCODE_CONFIG_CONTENT: '' }, 'opencode');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'env.txt'), 'utf8')), { permission: 'deny' });
});

test('the prompt asks for a score from the listed text, not from fetching the postings', () => {
  const prompt = buildPrompt([{ company: 'Example Co', title: 'Data Analyst', url: 'https://example.test/1' }], 'cv');
  assert.match(prompt, /do not open the URLs/i);
  assert.match(prompt, /no tools/i);
});

test('the CLI runs in an empty temp directory, not the data root, and the directory is removed', POSIX, (t) => {
  const root = sandbox(t, `fs.writeFileSync(process.env.RANK_CWD, JSON.stringify({ cwd: process.cwd(), files: fs.readdirSync('.') }));\n${SCORE_ALL}`);
  const result = rank(root, ['--dry-run'], { RANK_CWD: join(root, 'cwd.json') });
  assert.equal(result.status, 0, result.stderr);
  const seen = JSON.parse(readFileSync(join(root, 'cwd.json'), 'utf8'));
  assert.notEqual(seen.cwd, root);
  assert.ok(!seen.cwd.startsWith(ROOT), seen.cwd);
  assert.deepEqual(seen.files, []);
  assert.equal(existsSync(seen.cwd), false);
});

test('CAREER_OPS_RANK_TIMEOUT_MS bounds each call', POSIX, (t) => {
  const root = sandbox(t, `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);\n${SCORE_ALL}`);
  const result = rank(root, ['--dry-run'], { CAREER_OPS_RANK_TIMEOUT_MS: '300' });
  assert.match(result.stderr, /grok timed out after 0\.3 s/);
  assert.match(result.stderr, /CAREER_OPS_RANK_TIMEOUT_MS/);
});

test('the per-call timeout kills a child that ignores SIGTERM', POSIX, (t) => {
  // A CLI that traps SIGTERM would hang forever under execFileSync's default
  // killSignal. SIGKILL still reaps it so later batches and the unranked report run.
  const root = sandbox(t, `process.on('SIGTERM', () => {});
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);`);
  const started = Date.now();
  const result = rank(root, ['--dry-run'], { CAREER_OPS_RANK_TIMEOUT_MS: '400' });
  assert.ok(Date.now() - started < 15_000, 'SIGTERM-ignoring child must not block the run');
  assert.match(result.stderr, /grok timed out after 0\.4 s/);
});

test('an unset or invalid timeout falls back to the default', () => {
  assert.equal(resolveRankTimeoutMs(''), 180_000);
  assert.equal(resolveRankTimeoutMs('abc'), 180_000);
  assert.equal(resolveRankTimeoutMs('0'), 180_000);
  assert.equal(resolveRankTimeoutMs('90000'), 90_000);
});

test('a dry run where every call fails exits 1', POSIX, (t) => {
  const root = sandbox(t, `console.error('Error: API key expired.'); process.exitCode = 1;`);
  const result = rank(root, ['--dry-run']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Every call to grok failed/);
});

test('a run where no call returns usable JSON exits 1', POSIX, (t) => {
  const root = sandbox(t, `console.log('I could not score these postings.');`);
  const result = rank(root, ['--dry-run']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /no usable JSON/);
});

test('rows the model skipped are named, not left silently unranked', POSIX, (t) => {
  const root = sandbox(t, `const n = (process.argv.find(a => a.includes("POSTINGS:")).match(/^\\d+\\./gm) || []).length;
const ids = n === 10 ? [0, 1, 2] : [0];
console.log(JSON.stringify(ids.map(id => ({ id, score: 4, reason: 'Fixture match' }))));`);
  const result = rank(root, ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /would annotate 4 of 12/);
  assert.match(result.stderr, /8 of 12 selected entr\(ies\) left unranked/);
  assert.match(result.stderr, /https:\/\/example\.test\/3 \(batch 1: no score returned\)/);
  assert.match(result.stderr, /https:\/\/example\.test\/11 \(batch 2: no score returned\)/);
});
