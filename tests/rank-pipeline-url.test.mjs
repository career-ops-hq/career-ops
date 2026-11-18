// rank-pipeline.mjs --url ranks one Pending row (#5269): the dashboard Inbox's
// `a` key runs it on the selected row. Exact match only, and exit 4 when no
// unranked row has that URL, so the Inbox can say why nothing was ranked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { envWithPathFirst, writeFakeCli } from './helpers/fake-cli.mjs';
import { RANK_EXIT, selectByUrl } from '../rank-pipeline.mjs';

const ROWS = [
  '# Pipeline',
  '',
  '## Pending',
  '- [ ] https://example.test/1 | Acme | Engineer',
  '- [ ] https://example.test/12 | Beta | Designer',
  '- [ ] https://example.test/3 | Gamma | Analyst | rank: 3.0/5 — earlier score',
  '',
].join('\n');

function setup(t, pipeline = ROWS) {
  const root = mkdtempSync(join(tmpdir(), 'rank-url-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'bin'));
  if (pipeline !== null) writeFileSync(join(root, 'data', 'pipeline.md'), pipeline);
  // The fake CLI saves each prompt it is given and scores every row it lists.
  writeFakeCli(join(root, 'bin'), 'claude', [
    "if (process.argv[2] === '--version') return; // CommonJS: a top-level return ends the script",
    "const fs = require('node:fs');",
    'const prompt = process.argv[3] ?? "";',
    'fs.appendFileSync(process.env.RANK_PROMPTS, prompt + "\\n=====\\n");',
    'const ids = [...prompt.matchAll(/^(\\d+)\\. company:/gm)].map(m => Number(m[1]));',
    'console.log(JSON.stringify(ids.map(id => ({ id, score: 4.2, reason: "Fixture match" }))));',
    '',
  ].join('\n'));
  const env = envWithPathFirst(join(root, 'bin'), {
    CAREER_OPS_ROOT: root,
    CAREER_OPS_DATA_DIR: root,
    CAREER_OPS_CLI: 'claude',
    CAREER_OPS_RANK_CLI: '',
    RANK_PROMPTS: join(root, 'prompts.txt'),
  });
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), ...args], {
    env, cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  return { root, env, run, pipeline: join(root, 'data', 'pipeline.md') };
}

test('RANK_EXIT names the --url miss as 4, frozen', () => {
  assert.equal(RANK_EXIT.NOT_PENDING, 4);
  assert.ok(Object.isFrozen(RANK_EXIT));
});

test('selectByUrl matches the URL exactly, never a prefix', () => {
  const entries = [{ url: 'https://example.test/1' }, { url: 'https://example.test/12' }];
  assert.deepEqual(selectByUrl(entries, 'https://example.test/1'), [entries[0]]);
  assert.deepEqual(selectByUrl(entries, 'https://example.test/9'), []);
});

test('--url ranks only that row and sends only that row to the CLI', t => {
  const { run, pipeline, env } = setup(t);
  const result = run('--url=https://example.test/1');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const lines = readFileSync(pipeline, 'utf8').split('\n');
  assert.equal(lines[3], '- [ ] https://example.test/1 | Acme | Engineer | rank: 4.2/5 — Fixture match');
  assert.equal(lines[4], '- [ ] https://example.test/12 | Beta | Designer', 'the row whose URL only starts the same is untouched');
  assert.equal(lines[5], '- [ ] https://example.test/3 | Gamma | Analyst | rank: 3.0/5 — earlier score');
  const prompts = readFileSync(env.RANK_PROMPTS, 'utf8');
  assert.match(prompts, /url: https:\/\/example\.test\/1$/m);
  assert.doesNotMatch(prompts, /example\.test\/12|example\.test\/3/);
});

test('--url also accepts the space-separated form', t => {
  const { run, pipeline } = setup(t);
  const result = run('--url', 'https://example.test/12');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(pipeline, 'utf8'), /example\.test\/12 \| Beta \| Designer \| rank: 4\.2\/5/);
});

for (const [label, url, pipeline] of [
  ['an already ranked row', 'https://example.test/3', ROWS],
  ['a URL no row has', 'https://example.test/9', ROWS],
  ['a skipped row', 'https://example.test/1', ROWS.replace('- [ ] https://example.test/1 ', '- [x] https://example.test/1 ')],
  ['a missing pipeline.md', 'https://example.test/1', null],
]) {
  test(`--url on ${label} exits ${RANK_EXIT.NOT_PENDING} without calling the CLI`, t => {
    const { run, pipeline: path, env } = setup(t, pipeline);
    const result = run(`--url=${url}`);
    assert.equal(result.status, RANK_EXIT.NOT_PENDING, result.stdout + result.stderr);
    assert.equal(existsSync(env.RANK_PROMPTS), false, 'the CLI was not called');
    if (pipeline !== null) assert.equal(readFileSync(path, 'utf8'), pipeline);
  });
}

for (const [label, arg, message] of [
  ['an empty', '--url=', /--url requires a value/],
  ['a blank', '--url=  ', /--url needs the posting URL/],
]) {
  test(`${label} --url is refused before the CLI is called`, t => {
    const { run, pipeline, env } = setup(t);
    const result = run(arg);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, message);
    assert.equal(existsSync(env.RANK_PROMPTS), false);
    assert.equal(readFileSync(pipeline, 'utf8'), ROWS);
  });
}

test('without --url the run still ranks every unranked row', t => {
  const { run, pipeline } = setup(t);
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((readFileSync(pipeline, 'utf8').match(/rank: 4\.2\/5/g) ?? []).length, 2);
});
