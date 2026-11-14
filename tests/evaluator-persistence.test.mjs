// Real CLI persistence checks for OpenAI-compatible and Ollama evaluators.
// Fetch is replaced before startup; no model calls or user data are involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractStrippedJdSection } from '../check-jd-archive.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const JD = 'Synthetic job: build reliable software with a team of engineers.\n\n## Responsibilities\nWrite tests for café systems.';
const SUMMARY = '---SCORE_SUMMARY---\nCOMPANY: Example\nROLE: Engineer\nSCORE: 4.2\nARCHETYPE: IC\nLEGITIMACY: High Confidence\n---END_SUMMARY---';

function fixture(t, engine, scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'co-eval-persistence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'cv.md'), '# Synthetic candidate\nWrites reliable software.\n');
  writeFileSync(join(dir, 'config/profile.yml'), 'language:\n  output: en\n');
  if (scenario === 'blocked report' || scenario === 'no-save') {
    writeFileSync(join(dir, 'reports'), 'report blocker');
  }
  if (scenario === 'blocked tracker addition') {
    mkdirSync(join(dir, 'batch'));
    writeFileSync(join(dir, 'batch/tracker-additions'), 'addition blocker');
  }
  // An existing capture belongs to the user, even when this evaluation receives
  // the same report number. Embedding the source must leave it untouched.
  mkdirSync(join(dir, 'jds'));
  writeFileSync(join(dir, 'jds/001-existing.md'), 'previous capture');
  const reply = 'Synthetic evaluation.\n'
    + (scenario === 'no summary' ? '' : SUMMARY)
    + (scenario === 'model paraphrase'
      ? '\n\n## Job Description (archived verbatim)\n\nA model paraphrase, not the source.\n' : '');
  const hook = join(dir, 'fetch.mjs');
  writeFileSync(hook, `
const text = ${JSON.stringify(reply)};
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/api/tags')) return new Response('{"models":[]}');
  const openai = String(url).includes('/chat/completions');
  const body = openai
    ? 'data: ' + JSON.stringify({choices:[{delta:{content:text}}]}) + '\\n\\n'
      + 'data: ' + JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]}) + '\\n\\ndata: [DONE]\\n\\n'
    : JSON.stringify({message:{content:text},done:false}) + '\\n'
      + JSON.stringify({message:{content:''},done:true,done_reason:'stop'}) + '\\n';
  return new Response(body, {headers:{'content-type':openai ? 'text/event-stream' : 'application/x-ndjson'}});
};
`);
  const env = {
    PATH: process.env.PATH, HOME: dir, USERPROFILE: dir,
    SystemRoot: process.env.SystemRoot, TEMP: dir, TMP: dir,
    CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: dir,
    OPENAI_API_KEY: 'fixture-key', OLLAMA_NUM_CTX: '32768',
  };
  const args = ['--import', pathToFileURL(hook).href, join(ROOT, `${engine}-eval.mjs`),
    '--url', engine === 'openai' ? 'http://127.0.0.1:11434/v1' : 'http://127.0.0.1:11434',
    '--model', 'synthetic-test'];
  if (scenario === 'no-save') args.push('--no-save');
  if (scenario === 'file input') {
    const path = join(dir, 'jd.txt');
    writeFileSync(path, JD);
    args.push('--file', path);
  } else args.push(JD);
  const result = spawnSync(process.execPath, args, {cwd: dir, env, encoding: 'utf8', timeout: 30_000});
  return {dir, env, result};
}

for (const engine of ['openai', 'ollama']) {
  for (const scenario of ['successful save', 'file input', 'model paraphrase', 'no summary',
    'blocked report', 'blocked tracker addition', 'no-save']) {
    test(`${engine}: ${scenario}`, (t) => {
      const {dir, env, result} = fixture(t, engine, scenario);
      const failed = scenario.startsWith('blocked');
      assert.equal(result.status, failed ? 1 : 0, describeSpawn(result, 'unexpected evaluator exit: '));
      assert.equal(readFileSync(join(dir, 'jds/001-existing.md'), 'utf8'), 'previous capture');
      assert.deepEqual(readdirSync(join(dir, 'jds')), ['001-existing.md']);
      if (scenario === 'blocked report' || scenario === 'no-save') {
        assert.equal(readFileSync(join(dir, 'reports'), 'utf8'), 'report blocker');
        assert.equal(existsSync(join(dir, 'batch')), false);
        if (failed) assert.match(result.stderr, /Could not save evaluation \(report\)/);
        return;
      }
      const files = readdirSync(join(dir, 'reports'));
      const reports = files.filter(f => f.endsWith('.md'));
      assert.equal(reports.length, 1, 'one report, with no leftover reservation');
      assert.equal(files.some(f => f.startsWith('.') || f.includes('RESERVED')), false);
      const report = readFileSync(join(dir, 'reports', reports[0]), 'utf8');
      assert.equal(extractStrippedJdSection(report), JD, 'archive is the actual JD, not model text');
      assert.doesNotMatch(report, /A model paraphrase/);
      // Check the report itself without allowing an older jds capture to mask
      // a missing embedded section. No fixed filename or UTC-day assumption.
      const checked = spawnSync(process.execPath, [join(ROOT, 'check-jd-archive.mjs'),
        '--no-tracker', '--reports-dir', join(dir, 'reports'), '--jds-dir', join(dir, 'no-captures')],
      {cwd: dir, env, encoding: 'utf8', timeout: 30_000});
      assert.equal(checked.status, 0, describeSpawn(checked, 'archive checker failed: '));
      if (scenario === 'blocked tracker addition') {
        assert.match(result.stderr, /Could not save evaluation \(tracker addition\)/);
        assert.equal(readFileSync(join(dir, 'batch/tracker-additions'), 'utf8'), 'addition blocker');
        // The saved report and its archive survive a later failure: this is not
        // a multi-file transaction and does not claim rollback.
      } else if (scenario === 'no summary') {
        assert.equal(existsSync(join(dir, 'batch')), false, 'untrackable replies must not add a row');
      } else {
        assert.equal(readdirSync(join(dir, 'batch/tracker-additions')).length, 1);
      }
    });
  }
}
