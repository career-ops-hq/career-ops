/**
 * tests/jev-gatekeeper-decide.test.mjs — the gatekeeper's open `--questions`
 * decide mode (scripts/jev_gatekeeper.py).
 *
 * The CLI contract under test:
 *   - `--questions` accepts either inline JSON or `@path` and reaches the
 *     provider layer with an arbitrary payload (proven by failing at the
 *     missing-API-key gate, NOT at argument parse time).
 *   - Malformed questions and missing state are rejected with the SAME
 *     stdout-JSON error contract as every other failure, so callers read one
 *     shape.
 *   - The legacy 3-positional triage/linter invocation is untouched: two args
 *     still prints usage, three still proceeds.
 *   - decode_decision surfaces the raw confidence score and probability vector
 *     alongside the argmax.
 *
 * Hermetic: no network. Every live path runs with both Jev API keys unset so
 * it stops at the well-defined missing-env error. Skipped when python3 or the
 * `requests` package is unavailable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const GATEKEEPER = join(ROOT, 'scripts', 'jev_gatekeeper.py');

function cleanEnv() {
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  delete env.AI_GATEWAY_API_KEY;
  return env;
}

function run(args, { cwd = ROOT } = {}) {
  try {
    const out = execFileSync('python3', args, { encoding: 'utf-8', cwd, env: cleanEnv() });
    return { code: 0, out: out.trim() };
  } catch (err) {
    return { code: err.status ?? -1, out: `${err.stdout || ''}${err.stderr || ''}`.trim() };
  }
}

function hasPython() {
  try {
    execFileSync('python3', ['--version'], { encoding: 'utf-8' });
    execFileSync('python3', ['-c', 'import requests'], { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

const SKIP = !hasPython();

const NO_KEY = 'Missing OPENROUTER_API_KEY or AI_GATEWAY_API_KEY env variable.';
const N = (t, fn) => { if (SKIP) { t.skip('python3 or requests unavailable'); return; } fn(); };

const VALID_Q = '{"x":{"type":"noul","instructions":"does an opening exist?"}}';

test('decide with an arbitrary --questions payload reaches the provider layer', (t) => {
  N(t, () => {
    const r = run([GATEKEEPER, '--questions', VALID_Q, '--state', 'RESUME: a']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Missing OPENROUTER_API_KEY/);
  });
});

test('--questions accepts @file refs', (t) => {
  N(t, () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-decide-'));
    const qfile = join(dir, 'questions.json');
    writeFileSync(qfile, '{"q":{"type":"choice","instructions":"pick","criteria":{"a":"A","b":"B"}}}');
    const r = run([GATEKEEPER, '--questions', `@${qfile}`, '--state', 'RESUME: a']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Missing OPENROUTER_API_KEY/);
  });
});

test('decide reuses positional resume+job as state', (t) => {
  N(t, () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-decide-'));
    const resume = join(dir, 'cv.md');
    const job = join(dir, 'job.txt');
    writeFileSync(resume, '# resume\n');
    writeFileSync(job, 'job description\n');
    const r = run([GATEKEEPER, resume, job, '--questions', VALID_Q]);
    assert.equal(r.code, 1);
    assert.match(r.out, /Missing OPENROUTER_API_KEY/, 'two positionals must build the state string, not usage');
  });
});

test('invalid --questions JSON fails with the stdout error contract', (t) => {
  N(t, () => {
    const r = run([GATEKEEPER, '--questions', '{"x":', '--state', 'RESUME: a']);
    assert.equal(r.code, 1);
    assert.match(r.out, /was not valid JSON/);
  });
});

test('a question without a string type is rejected by name', (t) => {
  N(t, () => {
    const r = run([GATEKEEPER, '--questions', '{"x":{"instructions":"test"}}', '--state', 'RESUME: a']);
    assert.equal(r.code, 1);
    assert.match(r.out, /needs a string 'type'/);
  });
});

test('decide without state or positional inputs explains what it needs', (t) => {
  N(t, () => {
    const r = run([GATEKEEPER, '--questions', VALID_Q]);
    assert.equal(r.code, 1);
    assert.match(r.out, /decide mode needs --state/);
  });
});

test('the legacy 3-arg invocation is unchanged: usage on 2 args, provider on 3', (t) => {
  N(t, () => {
    const two = run([GATEKEEPER, 'cv.md', 'job.txt']);
    assert.equal(two.code, 1);
    assert.match(two.out, /Usage: /, 'two args must still print usage');

    const dir = mkdtempSync(join(tmpdir(), 'jev-legacy-'));
    const resume = join(dir, 'cv.md');
    const job = join(dir, 'job.txt');
    writeFileSync(resume, '# resume\n');
    writeFileSync(job, 'job description\n');
    const three = run([GATEKEEPER, resume, job, 'triage']);
    assert.equal(three.code, 1);
    assert.match(three.out, /Missing OPENROUTER_API_KEY/, 'three args must proceed past parsing');
    assert.doesNotMatch(three.out, /Usage: /);
  });
});

test('decode_decision surfaces confidence, probabilities and raw answers', (t) => {
  N(t, () => {
    const script = [
      'import importlib.util, json',
      'spec = importlib.util.spec_from_file_location("jg", "scripts/jev_gatekeeper.py")',
      'jg = importlib.util.module_from_spec(spec); spec.loader.exec_module(jg)',
      's = jg.decode_decision("s", {"type":"score"}, {"score":3,"probabilities":{"2":0.1,"3":0.9},"providerMetadata":{"typesafe":{"confidence":0.92}}})',
      'b = jg.decode_decision("b", {"type":"noul"}, {"noul":0.81})',
      'c = jg.decode_decision("c", {"type":"choice"}, {"choice":"x","confidence":0.4})',
      'print(json.dumps(s))',
      'print(json.dumps(b))',
      'print(json.dumps(c))',
    ].join('\n');
    const r = run(['-c', script]);
    assert.equal(r.code, 0, r.out);
    const [s, b, c] = r.out.split('\n').map((line) => JSON.parse(line));
    assert.equal(s.value, 3.0);
    assert.deepEqual(s.probabilities, { 2: 0.1, 3: 0.9 });
    assert.equal(s.confidence, 0.92);
    assert.equal(s.raw.score, 3);
    assert.equal(b.value, true);
    assert.equal(b.probability, 0.81);
    assert.equal(c.value, 'x');
    assert.equal(c.confidence, 0.4);
  });
});

// --- the --micro single-key escalation channel ---

test('--micro reaches the provider layer with the same missing-key gate', (t) => {
  N(t, () => {
    const r = run([GATEKEEPER, '--micro', '--questions', VALID_Q, '--state', 'RESUME: a']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Missing OPENROUTER_API_KEY/, '--micro is routed to a run, not to usage');
  });
});

test('--micro without state explains what it needs', (t) => {
  N(t, () => {
    const r = run([GATEKEEPER, '--micro', '--questions', VALID_Q]);
    assert.equal(r.code, 1);
    assert.match(r.out, /decide mode needs --state/);
  });
});

test('run_micro prints exactly the envelope --micro channel via a patched provider', (t) => {
  N(t, () => {
    const script = [
      'import importlib.util, io, json, sys',
      'spec = importlib.util.spec_from_file_location("jg", "scripts/jev_gatekeeper.py")',
      'jg = importlib.util.module_from_spec(spec); spec.loader.exec_module(jg)',
      'def fake(payload_for):',
      '    return ({"answers": {"q": {"choice": "b", "confidence": 0.93}}}, {"name": "fake", "model": "fake-model"}, 12, 12)',
      'jg.post_to_providers = fake',
      'buf = io.StringIO(); old = sys.stdout; sys.stdout = buf',
      'try:',
      '    jg.main(["--micro", "--questions", \'{"q":{"type":"choice","instructions":"pick","criteria":{"a":"A","b":"B"}}}\', "--state", "RESUME: a"])',
      'finally:',
      '    sys.stdout = old',
      'print(buf.getvalue().strip())',
    ].join('\n');
    const r = run(['-c', script]);
    assert.equal(r.code, 0, r.out);
    const out = JSON.parse(r.out);
    assert.equal(out.decision, 'b');
    assert.equal(out.confidence, 0.93);
    assert.equal(out.provider, 'fake');
    assert.equal(out.model, 'fake-model');
    assert.ok(!('answers' in out), 'raw answers never leak into the channel by default');
  });
});