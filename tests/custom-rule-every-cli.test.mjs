// The _custom.md read rule must reach every agent, not only English sessions.
//
// modes/_custom.md holds the user's standing house rules. The rule that says to
// read and honor it lived in modes/_shared.md, and only 2 of the 20 localized
// modes/{lang}/_shared.md files carry it. A session in another language, or a
// batch worker that never loads _shared.md, never learns the file exists.
// AGENTS.md is the one file every CLI loads, so the rule belongs there, and the
// batch prompt lists the file with the other sources a worker reads.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, pass, ROOT } from './helpers.mjs';

console.log('\nThe _custom.md read rule reaches every agent');

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (error) {
    fail(`${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('AGENTS.md tells every agent to read _custom.md after _profile.md in every mode', () => {
  const rule = read('AGENTS.md')
    .split('\n')
    .find((line) => /read `modes\/_custom\.md`/i.test(line));
  assert.ok(rule, 'AGENTS.md has no line that says to read `modes/_custom.md`');
  assert.match(rule, /after `modes\/_profile\.md`/i);
  assert.match(rule, /every mode/i);
  assert.match(rule, /never introduces? factual claims/i);
});

test('the CLI entry files load AGENTS.md', () => {
  for (const file of ['CLAUDE.md', 'CODEX.md']) {
    assert.match(read(file), /^@AGENTS\.md$/m, `${file} does not import AGENTS.md`);
  }
});

test('the batch prompt lists _custom.md as a source every worker reads', () => {
  const row = read('batch/batch-prompt.md')
    .split('\n')
    .find((line) => line.startsWith('|') && line.includes('`modes/_custom.md`'));
  assert.ok(row, 'the Sources of Truth table has no `modes/_custom.md` row');
  assert.match(row, /\|\s*Always\b/);
  assert.match(row, /never (adds|introduces?) factual claims/i);
});
