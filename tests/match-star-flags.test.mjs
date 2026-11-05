// tests/match-star-flags.test.mjs — match-star reads --jd=<file> and --top=<n>,
// and refuses a flag it does not know.
//
// The flags were looked up with indexOf(), which finds `--jd jds/acme.md` but
// not `--jd=jds/acme.md`. The second form matched without the JD, `--top=2`
// printed one match, and a misspelled `--jdd jds/acme.md` was dropped while
// `jds/acme.md` joined the question. The answer is pasted into an application
// form as it stands, so none of these said anything was wrong.
//
// Run:  node --test tests/match-star-flags.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const QUESTION = 'Tell me about a time you improved how your team worked';

const STORY_BANK = [
  '# Story Bank',
  '',
  '### [Delivery] Moved billing to Postgres',
  '**Situation:** Billing ran on a database nobody could upgrade.',
  '**Task:** Move it without downtime.',
  '**Action:** Ran both databases side by side and switched reads table by table.',
  '**Result:** Finished the migration with no outage.',
  '**Tags:** postgres, migration',
  '',
  '### [Collaboration] Settled a customer escalation',
  '**Situation:** A large customer threatened to leave over late fixes.',
  '**Task:** Rebuild their trust.',
  '**Action:** Set up a weekly call and a shared fix list.',
  '**Result:** They renewed for two more years.',
  '**Tags:** stakeholder, customer',
  '',
].join('\n');

/** Runs match-star in a fresh data root holding the story bank and a JD. */
function run(args) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-match-star-'));
  try {
    mkdirSync(join(dir, 'interview-prep'));
    mkdirSync(join(dir, 'jds'));
    writeFileSync(join(dir, 'interview-prep', 'story-bank.md'), STORY_BANK);
    writeFileSync(join(dir, 'jds', 'acme.md'), 'We are moving our Postgres databases. Migration experience required.\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'match-star.mjs'), ...args], {
      cwd: dir, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
    return r;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('--jd=<file> reads the JD, the same as --jd <file>', () => {
  const spaced = run([QUESTION, '--jd', 'jds/acme.md']);
  assert.equal(spaced.status, 0, describeSpawn(spaced));
  assert.match(spaced.stdout, /^JD: +jds\/acme\.md$/m, 'the premise: the spaced form reads the JD');
  const equals = run([QUESTION, '--jd=jds/acme.md']);
  assert.equal(equals.status, 0, describeSpawn(equals));
  assert.equal(equals.stdout, spaced.stdout);
});

test('--top=<n> prints that many matches, the same as --top <n>', () => {
  const equals = run([QUESTION, '--top=2']);
  assert.equal(equals.status, 0, describeSpawn(equals));
  assert.match(equals.stdout, /Match 2 of 2/);
  assert.equal(equals.stdout, run([QUESTION, '--top', '2']).stdout);
});

test('a misspelled flag is refused, not dropped with its value left in the question', () => {
  const r = run([QUESTION, '--jdd', 'jds/acme.md']);
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /unrecognized flag\(s\): --jdd/);
  assert.doesNotMatch(r.stdout, /Question:/, 'nothing was matched');
});

test('--jd without a file is a usage error, not a match without the JD', () => {
  const r = run([QUESTION, '--jd']);
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /--jd requires a value/);
  assert.doesNotMatch(r.stdout, /Question:/);
});
