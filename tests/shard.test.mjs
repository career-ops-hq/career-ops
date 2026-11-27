// tests/shard.test.mjs — `node test-all.mjs --shard i/n` (tests/shard.mjs).
//
// CI splits the slow macOS and Windows legs of the merge queue across
// machines. The one property that matters: the shards of a run, together, run
// every suite exactly once, and the inline sections exactly once. Checked on
// the pure split and on the real runner in a sandbox.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_SHARDS, parseShard, pickShard, runsInlineSections } from './shard.mjs';
import { createRunnerSandbox, helpers } from './test-all-sandbox.mjs';
import { ROOT } from './helpers.mjs';

// ── the split ───────────────────────────────────────────────────────────────

test('i/n is read, and anything else is an error that names the form', () => {
  assert.deepEqual(parseShard('2/3'), { index: 2, count: 3 });
  assert.deepEqual(parseShard(' 1/1 '), { index: 1, count: 1 });
  for (const bad of ['', '3', '0/2', '3/2', '2/0', '1/2/3', 'a/b', '-1/2', '1.5/2', `1/${MAX_SHARDS + 1}`]) {
    assert.ok(parseShard(bad).error, `"${bad}" must be refused`);
  }
});

test('the shards of a list are disjoint, keep its order, and add up to it', () => {
  const files = Array.from({ length: 1430 }, (_, i) => `tests/f${String(i).padStart(4, '0')}.test.mjs`);
  for (const count of [1, 2, 3, 4, 7]) {
    const shards = Array.from({ length: count }, (_, i) => pickShard(files, { index: i + 1, count }));
    const seen = shards.flat();
    assert.equal(seen.length, files.length, `${count} shards: every file once`);
    assert.deepEqual([...seen].sort(), [...files].sort(), `${count} shards: the same files`);
    for (const shard of shards) {
      assert.deepEqual(shard, [...shard].sort(), 'discovery order kept inside a shard');
      assert.ok(shard.length >= Math.floor(files.length / count) && shard.length <= Math.ceil(files.length / count), 'shards differ by one suite at most');
    }
  }
});

test('neighbours in discovery order go to different shards', () => {
  // Alike suites sort together (all updater-*); interleaving spreads them.
  const files = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
  assert.deepEqual(pickShard(files, { index: 1, count: 3 }), ['a1', 'b1']);
  assert.deepEqual(pickShard(files, { index: 2, count: 3 }), ['a2', 'b2']);
});

test('only shard 1 runs the inline sections', () => {
  assert.equal(runsInlineSections({ index: 1, count: 3 }), true);
  assert.equal(runsInlineSections({ index: 2, count: 3 }), false);
});

// ── the real runner ─────────────────────────────────────────────────────────

// This file runs under `node --test`; a fixture inheriting NODE_TEST_CONTEXT
// would report to this runner (tests/ci-gemini-check.test.mjs).
delete process.env.NODE_TEST_CONTEXT;

const box = createRunnerSandbox('career-ops-shard-test-');
after(() => box.remove());

// The real inline sections scan the real repository; the sandbox gets one
// fixture section in their place, between the same markers
// (tests/test-all-inline-jobs.test.mjs does the same).
{
  const real = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8').replace(/\r\n/g, '\n');
  const begin = /^\/\/ ── INLINE SECTIONS: BEGIN ─+$/m.exec(real);
  const end = /^\/\/ ── INLINE SECTIONS: END ─+$/m.exec(real);
  assert.ok(begin && end && begin.index < end.index, 'test-all.mjs marks its inline sections');
  const section = ["console.log('\\n🧪 fixture suite\\n');", "pass('inline: the one section');"];
  writeFileSync(join(box.sandbox, 'test-all.mjs'),
    `${real.slice(0, begin.index + begin[0].length)}\n${section.join('\n')}\n${real.slice(end.index)}`, 'utf-8');
}
const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
for (const n of NAMES) box.suite(`fx/${n}-suite.test.mjs`, [helpers(1), `pass('suite ${n}');`]);

const run = (args) => box.runner(args, { CAREER_OPS_TEST_JOBS: '3' });
const ran = (r) => r.verdicts.filter((l) => /^✅ suite [a-g]$/.test(l)).map((l) => l.slice(-1));

test('three shards together run every suite once, and the inline section once', () => {
  const shards = [1, 2, 3].map((i) => run(['--quick', '--shard', `${i}/3`]));
  for (const r of shards) assert.equal(r.status, 0, r.all);
  assert.deepEqual(shards.map(ran), [['a', 'd', 'g'], ['b', 'e'], ['c', 'f']]);
  assert.deepEqual(shards.flatMap(ran).sort(), NAMES);
  assert.deepEqual(shards.map((r) => r.verdicts.includes('✅ inline: the one section')), [true, false, false]);
  assert.match(shards[1].stdout, /🧪 shard 2\/3: 2 of 7 discovered suites; the inline sections run in shard 1/);
});

test('an unsharded run is what it was: every suite and the inline section', () => {
  const r = run(['--quick']);
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(ran(r).sort(), NAMES);
  assert.ok(r.verdicts.includes('✅ inline: the one section'));
  assert.doesNotMatch(r.stdout, /🧪 shard/);
});

test('a shard with nothing to run fails instead of passing', () => {
  const r = run(['--quick', '--shard', '8/8']);
  assert.equal(r.status, 1, r.all);
  assert.match(r.stdout, /shard 8\/8 has no suites to run \(7 discovered\)/);
});

test('--shard is refused with --only, --needs, --jobs 1 or a malformed value', () => {
  for (const args of [['--shard', '1/2', '--only', 'fx/'], ['--shard', '1/2', '--needs', 'browser'], ['--shard', '1/2', '--jobs', '1'], ['--shard', '3/2'], ['--shard']]) {
    const r = run(args);
    assert.equal(r.status, 1, `${args.join(' ')}\n${r.all}`);
    assert.match(r.stdout, /❌ .*--shard/, args.join(' '));
    assert.doesNotMatch(r.stdout, /✅ suite/, `${args.join(' ')} ran suites`);
  }
});
