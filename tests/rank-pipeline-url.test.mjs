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
import { RANK_EXIT, pendingSection, selectByUrl } from '../rank-pipeline.mjs';

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
  // The fake CLI logs every launch, version probes included, saves each
  // ranking prompt it is given, and scores every row the prompt lists.
  writeFakeCli(join(root, 'bin'), 'claude', [
    "const fs = require('node:fs');",
    'fs.appendFileSync(process.env.RANK_CALLS, process.argv.slice(2, 3).join(" ") + "\\n");',
    "if (process.argv[2] === '--version') return; // CommonJS: a top-level return ends the script",
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
    RANK_CALLS: join(root, 'calls.txt'),
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

test('selectByUrl takes only the first of two rows with the same URL', () => {
  const entries = [{ url: 'https://example.test/1', index: 3 }, { url: 'https://example.test/1', index: 7 }];
  assert.deepEqual(selectByUrl(entries, 'https://example.test/1'), [entries[0]]);
});

test('pendingSection is the first Pending section, or the whole file without one', () => {
  const lines = ['- [ ] a', '## Pending', '- [ ] b', '##\tProcessed', '- [ ] c'];
  assert.deepEqual(pendingSection(lines), { start: 2, end: 3 });
  assert.deepEqual(pendingSection(['- [ ] a', '- [ ] b']), { start: 0, end: 2 });
  assert.deepEqual(pendingSection(['## Offen', '- [ ] a']), { start: 1, end: 2 });
});

test('--url ranks only the first of two rows with the same URL', t => {
  const twice = ROWS.replace('- [ ] https://example.test/12 | Beta | Designer', '- [ ] https://example.test/1 | Acme | Engineer (again)');
  const { run, pipeline, env } = setup(t, twice);
  const result = run('--url=https://example.test/1');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const lines = readFileSync(pipeline, 'utf8').split('\n');
  assert.match(lines[3], /Engineer \| rank: 4\.2\/5/);
  assert.equal(lines[4], '- [ ] https://example.test/1 | Acme | Engineer (again)');
  assert.equal((readFileSync(env.RANK_PROMPTS, 'utf8').match(/url: https:\/\/example\.test\/1$/gm) ?? []).length, 1);
});

test('--url finds rows only in the Pending section; a run without it reads every row', t => {
  const outside = [
    '- [ ] https://example.test/above | Above | Row',
    '## Pending',
    '- [ ] https://example.test/1 | Acme | Engineer',
    '## Notes',
    '- [ ] https://example.test/note | Note | Row',
    '',
  ].join('\n');
  const { run, pipeline, env } = setup(t, outside);
  const miss = run('--url=https://example.test/note');
  assert.equal(miss.status, RANK_EXIT.NOT_PENDING, miss.stdout + miss.stderr);
  assert.equal(existsSync(env.RANK_CALLS), false, 'a row outside Pending called the CLI');
  const all = run();
  assert.equal(all.status, 0, all.stdout + all.stderr);
  const lines = readFileSync(pipeline, 'utf8').split('\n');
  assert.deepEqual(lines.map(line => line.includes('| rank: ')), [true, false, true, false, true, false],
    'without --url the run is unchanged: every unchecked row is ranked, as the web inbox lists them');
});

test('--url on a missing row exits 4 even when Hermes is asked for', t => {
  const { run, pipeline } = setup(t);
  const result = run('--url=https://example.test/9', '--cli=hermes');
  assert.equal(result.status, RANK_EXIT.NOT_PENDING, result.stdout + result.stderr);
  assert.equal(readFileSync(pipeline, 'utf8'), ROWS);
  const hit = run('--url=https://example.test/1', '--cli=hermes');
  assert.equal(hit.status, 1, hit.stdout + hit.stderr);
  assert.match(hit.stderr, /Hermes is not supported/);
});

test('--url on a missing row exits 4 even when no CLI is installed', t => {
  const { root, pipeline } = setup(t);
  const emptyPath = join(root, 'empty-bin');
  mkdirSync(emptyPath);
  const result = spawnSync(process.execPath, [join(ROOT, 'rank-pipeline.mjs'), '--url=https://example.test/3'], {
    env: { CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, PATH: emptyPath, CAREER_OPS_RANK_CLI: '' },
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, RANK_EXIT.NOT_PENDING, result.stdout + result.stderr);
  assert.equal(readFileSync(pipeline, 'utf8'), ROWS);
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
    assert.equal(existsSync(env.RANK_CALLS), false, 'the CLI was launched, if only for a version probe');
    assert.equal(existsSync(env.RANK_PROMPTS), false, 'the CLI was given a ranking prompt');
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
    assert.equal(existsSync(env.RANK_CALLS), false);
    assert.equal(readFileSync(pipeline, 'utf8'), ROWS);
  });
}

test('without --url the run still ranks every unranked row', t => {
  const { run, pipeline } = setup(t);
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((readFileSync(pipeline, 'utf8').match(/rank: 4\.2\/5/g) ?? []).length, 2);
});
