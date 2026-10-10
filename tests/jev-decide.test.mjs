/**
 * tests/jev-decide.test.mjs — the Envelope B System One screen (jev-decide.mjs).
 *
 * jev-decide.mjs runs the Block A/D/G question set through the gatekeeper's
 * decide mode and emits a Machine Summary envelope. Under test here:
 *   - the envelope carries the deterministic machine fields (legitimacy_tier,
 *     archetype, ...) mapped from the decoded decisions, plus a Jev-derived
 *     confidence and human-readable facts;
 *   - the whole seam is FAIL-OPEN: missing jd/report/gatekeeper or a crashing
 *     gatekeeper exits 0 with {"status":"unavailable"} and never throws;
 *   - the CLI end-to-end path (--jd --out, JEV_GATEKEEPER_PY override) prints
 *     the envelope on stdout and persists it.
 *
 * The gatekeeper is a stub Python script (via JEV_GATEKEEPER_PY) that answers
 * every question deterministically, so the suite is hermetic and needs no API
 * key and no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDecide, envelopeQuestions } from '../jev-decide.mjs';

const ROOT = join(import.meta.dirname, '..');

const STUB_SRC = `
import json, sys
argv = sys.argv[1:]
def arg_for(flag):
    for i, a in enumerate(argv):
        if a == flag and i + 1 < len(argv):
            return argv[i + 1].lstrip('@')
    return None
questions = json.load(open(arg_for('--questions')))
decisions = {}
for name, q in questions.items():
    t = q.get('type')
    if t == 'score':
        d = {'score': 4, 'probabilities': {'4': 1.0}}
    elif t == 'noul':
        d = {'noul': 0.9}
    else:
        d = {'choice': next(iter(q.get('criteria', {'x': 'X'})))}
    d['confidence'] = 0.9
    d['type'] = t
    decisions[name] = d
print(json.dumps({'decisions': decisions, 'provider': 'stub', 'model': 'stub-model'}))
`;

const FAIL_STUB_SRC = 'import sys; print("boom", file=sys.stderr); sys.exit(1)\n';

let tmp;
function fixture() {
  tmp = mkdtempSync(join(tmpdir(), 'jev-decide-'));
  const jd = join(tmp, 'job.txt');
  const cv = join(tmp, 'cv.md');
  const stub = join(tmp, 'stub.py');
  const fail = join(tmp, 'fail.py');
  writeFileSync(jd, '# Senior Applied AI Engineer at Acme Corp\nWe own model serving at scale.\n');
  writeFileSync(cv, '# Candidate CV\nBackend engineering, applied AI.\n');
  writeFileSync(stub, STUB_SRC);
  writeFileSync(fail, FAIL_STUB_SRC);
  return { jd, cv, stub, fail };
}

test.afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

test('decide over the full A/D/G set returns a System One envelope', () => {
  const { jd, cv, stub } = fixture();
  const env = runDecide({ jdFile: jd, resumeFile: cv, gatekeeperPath: stub });
  assert.equal(env.status, 'ok');
  assert.equal(env.question_names.length, Object.keys(envelopeQuestions()).length);
  assert.equal(env.decision_count, env.question_names.length);
  assert.equal(typeof env.machine, 'object');
  assert.equal(env.machine.legitimacy_tier, 'High Confidence');
  assert.ok(env.machine.archetype, 'archetype decided');
  assert.equal(env.confidence, 'High');
  assert.equal(env.provider, 'stub');
  assert.match(env.facts, /Block G legitimacy: High Confidence/);
});

test('envelope facts surface every decided bounded enum', () => {
  const { jd, cv, stub } = fixture();
  const env = runDecide({ jdFile: jd, resumeFile: cv, gatekeeperPath: stub });
  for (const value of Object.values(env.machine)) {
    assert.ok(env.facts.includes(`${value}`), `facts mention ${value}`);
  }
});

test('fail-open: missing jd file is unavailable', () => {
  const { cv, stub } = fixture();
  const env = runDecide({ jdFile: join(tmp, 'nope.txt'), resumeFile: cv, gatekeeperPath: stub });
  assert.equal(env.status, 'unavailable');
  assert.match(env.reason, /not readable/);
});

test('fail-open: unreadable gatekeeper is unavailable', () => {
  const { jd, cv } = fixture();
  const env = runDecide({ jdFile: jd, resumeFile: cv, gatekeeperPath: join(tmp, 'missing.py') });
  assert.equal(env.status, 'unavailable');
  assert.match(env.reason, /gatekeeper not readable/);
});

test('fail-open: a crashing gatekeeper is unavailable', () => {
  const { jd, cv, fail } = fixture();
  const env = runDecide({ jdFile: jd, resumeFile: cv, gatekeeperPath: fail });
  assert.equal(env.status, 'unavailable');
  assert.match(env.reason, /gatekeeper exited 1/);
});

test('fail-open: non-JSON gatekeeper stdout is unavailable', () => {
  const { jd, cv } = fixture();
  const stub = join(tmp, 'garbage.py');
  writeFileSync(stub, 'print("not json at all")\n');
  const env = runDecide({ jdFile: jd, resumeFile: cv, gatekeeperPath: stub });
  assert.equal(env.status, 'unavailable');
  assert.match(env.reason, /was not JSON/);
});

test('CLI end-to-end: --jd --resume --out prints the envelope and persists it', () => {
  const { jd, cv, stub } = fixture();
  const out = join(tmp, 'envelope.json');
  const env = { ...process.env, JEV_GATEKEEPER_PY: stub };
  const stdout = execFileSync(process.execPath, ['jev-decide.mjs', '--jd', jd, '--resume', cv, '--out', out], {
    cwd: ROOT,
    encoding: 'utf-8',
    env,
  });
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.status, 'ok');
  assert.equal(JSON.parse(readFileSync(out, 'utf-8')).status, 'ok');
});

test('CLI fail-open: missing jd exits 0 with unavailable', () => {
  const { stub } = fixture();
  const env = { ...process.env, JEV_GATEKEEPER_PY: stub };
  const stdout = execFileSync(process.execPath, ['jev-decide.mjs', '--jd', join(tmp, 'none.txt')], {
    cwd: ROOT,
    encoding: 'utf-8',
    env,
  });
  assert.equal(JSON.parse(stdout.trim()).status, 'unavailable');
});

test('CLI usage error exits 2', () => {
  assert.throws(
    () => execFileSync(process.execPath, ['jev-decide.mjs', '--bogus'], { cwd: ROOT, encoding: 'utf-8' }),
    (err) => err.status === 2,
  );
});