// tests/agent-inbox-flag-spellings.test.mjs — `resolve` reads --expect and
// --result in both spellings, and refuses a flag it does not know.
//
// opt() and optAll() matched only the bare tokens `--expect` and `--result`, and
// resolve had no unknown-flag check. So `--expect=Acme` left the guard empty:
// the wrong item was resolved at exit 0. `--result=...` recorded nothing, and a
// retry is then refused as "already resolved", so the result could only be put
// back by hand. A mistyped `--expct` turned the guard off the same way.
// modes/agent-inbox.md asks for --expect on every resolve because a result
// stamped onto the wrong item is worse than no result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

// A queue with two pending items: #1 names Acme, #2 does not.
function withQueue(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-inbox-flags-'));
  const inbox = join(dir, 'agent-inbox.md');
  const run = (...args) => spawnSync(NODE, [join(ROOT, 'agent-inbox.mjs'), ...args], {
    cwd: dir, encoding: 'utf-8', timeout: 30000,
    env: { ...process.env, CAREER_OPS_INBOX: inbox },
  });
  try {
    for (const text of ['evaluate https://acme.example/jobs/42', 'draft a follow-up for Dana-Farber #7']) {
      const added = run('add', text);
      assert.equal(added.status, 0, describeSpawn(added));
    }
    const items = () => readFileSync(inbox, 'utf-8').split('\n').filter((line) => line.startsWith('- ['));
    fn({ run, items });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('--expect=<s> guards like --expect <s>: the wrong item is refused and nothing is written', () => {
  withQueue(({ run, items }) => {
    const before = items();
    for (const args of [
      ['resolve', '2', '--expect=Acme', '--result=scored 4.3'],
      ['resolve', '2', '--expect=Acme', '--result', 'scored 4.3'],
      ['resolve', '2', '--expect', 'Acme', '--result=scored 4.3'],
    ]) {
      const r = run(...args);
      assert.equal(r.status, 1, describeSpawn(r));
      assert.match(r.stderr, /item #2 does not contain --expect "Acme"/, describeSpawn(r));
      assert.deepEqual(items(), before);
    }
  });
});

test('--result=<s> is recorded on the item', () => {
  withQueue(({ run, items }) => {
    const r = run('resolve', '1', '--expect=Acme', '--result=scored 4.3 — report 012');
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(items()[0], /^- \[x\] .*acme\.example\/jobs\/42 → result: scored 4\.3 — report 012$/);
    assert.match(items()[1], /^- \[ \] /);
  });
});

test('a flag resolve does not know is refused before anything is written', () => {
  withQueue(({ run, items }) => {
    const before = items();
    for (const flag of ['--expct', '--reslt=x']) {
      const r = run('resolve', '2', flag, 'Acme', '--result', 'oops');
      assert.equal(r.status, 1, describeSpawn(r));
      assert.match(r.stderr, /unrecognized flag/, describeSpawn(r));
      assert.deepEqual(items(), before);
    }
  });
});

test('an empty --expect= or a bare --result fails, and the space-separated spellings still work', () => {
  withQueue(({ run, items }) => {
    const before = items();
    for (const [args, flag] of [[['--expect='], '--expect'], [['--expect', 'Dana-Farber', '--result'], '--result']]) {
      const r = run('resolve', '2', ...args);
      assert.equal(r.status, 1, describeSpawn(r));
      assert.match(r.stderr, new RegExp(`${flag} requires a value`), describeSpawn(r));
      assert.deepEqual(items(), before);
    }
    const r = run('resolve', '2', '--expect', 'Dana-Farber', '--result', 'sent');
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(items()[1], /Dana-Farber #7 → result: sent$/);
  });
});
