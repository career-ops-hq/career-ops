// modes/retro.md tells the agent which learn.mjs commands to run and what
// candidates file to write. These cases run exactly those commands, copied
// out of the mode file, against a fictional data root.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, NODE, pass, rmSync, ROOT } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

console.log('\nretro mode drives learn.mjs');

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (error) {
    fail(`${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

const MODE = join(ROOT, 'modes', 'retro.md');
const mode = existsSync(MODE) ? readFileSync(MODE, 'utf8').replace(/\r\n/g, '\n') : '';
const blocks = (lang) => [...mode.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]);
const commands = blocks('bash').flatMap((b) => b.split('\n')).filter((line) => line.startsWith('node learn.mjs'));
const checkCommand = commands.find((c) => c.startsWith('node learn.mjs check'));
const applyCommand = commands.find((c) => c.startsWith('node learn.mjs apply'));

const FILES = {
  'modes/_custom.md': '# Custom Instructions\n\n## House Rules\n\n- Write dates as YYYY-MM-DD.\n\n## Output Preferences\n\n(none yet)\n\n## Off-Limits\n\n(none yet)\n',
  'modes/_profile.md': '# Profile customization\n\n## Your Location Policy\n\n- Remote first.\n',
  'cv.md': '# Example Person\n\n- Built a fictional demo app.\n',
  'article-digest.md': '# Digest\n\n- A fictional article.\n',
  'config/profile.yml': 'candidate:\n  full_name: Example Person\n',
};
const PROTECTED = ['cv.md', 'article-digest.md', 'config/profile.yml'];
const REPLY = 'accept 1, reject 2. "Thanks" $(touch pwned) `id`, it\'s fine';

function scratchRoot() {
  const root = mkdtempSync(join(tmpdir(), 'retro-mode-'));
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function argv(line, root, fill) {
  let text = line.replaceAll('{DATA_ROOT}', root);
  for (const [slot, value] of Object.entries(fill)) text = text.replaceAll(slot, value);
  assert(!/["'`]/.test(text), `split on whitespace only works with no quoted words: ${line}`);
  const words = text.trim().split(/\s+/);
  assert(words[0] === 'node' && words[1] === 'learn.mjs', `not a learn.mjs command: ${line}`);
  return words.slice(2);
}

function run(root, args, extraEnv = {}) {
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', ...extraEnv };
  for (const key of ['CAREER_OPS_HEADLESS', 'CAREER_OPS_BATCH_STATE']) {
    if (!(key in extraEnv)) delete env[key];
  }
  return spawnSync(NODE, [join(ROOT, 'learn.mjs'), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
}

function writeExample(root) {
  const [example] = blocks('json');
  assert(example, 'modes/retro.md has no json example of the candidates file');
  const path = checkCommand.match(/\{DATA_ROOT\}\/(\S+\.json)/)?.[1];
  assert(path, `the check command does not read a candidates file under {DATA_ROOT}: ${checkCommand}`);
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), example);
  return JSON.parse(example).candidates;
}

test('modes/retro.md names a learn.mjs check and a learn.mjs apply command', () => {
  assert(mode, 'modes/retro.md does not exist');
  assert(checkCommand, 'no `node learn.mjs check` line in a bash block');
  assert(applyCommand, 'no `node learn.mjs apply` line in a bash block');
});

if (checkCommand && applyCommand) {
  test('the documented check and apply write only the accepted candidate, and only to the rule files', () => {
    const root = scratchRoot();
    try {
      const candidates = writeExample(root);
      assert(candidates.length === 2, `the example should show 2 candidates so one can be accepted and one rejected, got ${candidates.length}`);
      const checked = run(root, argv(checkCommand, root, {}));
      assert(checked.status === 0, describeSpawn(checked, 'documented check should succeed'));
      assert(!/^\[\d+\] blocked/m.test(checked.stdout), `the example candidates should pass the gate:\n${checked.stdout}`);
      const pending = checked.stdout.match(/Pending: (\S+)/)?.[1];
      assert(pending, `the check output names no pending file:\n${checked.stdout}`);

      const replyFile = applyCommand.match(/--reply-file \{DATA_ROOT\}\/(\S+)/)?.[1];
      assert(replyFile, `the apply command does not read the reply from a file under {DATA_ROOT}: ${applyCommand}`);
      writeFileSync(join(root, replyFile), `${REPLY}\n`);
      const applied = run(root, argv(applyCommand, root, { '{pending}': pending, '{accepted ids}': '1', '{rejected ids}': '2' }));
      assert(applied.status === 0, describeSpawn(applied, 'documented apply should succeed'));
      const after = Object.fromEntries(Object.keys(FILES).map((rel) => [rel, readFileSync(join(root, rel), 'utf8')]));
      const [first, second] = candidates.map((c) => c.change.text);
      const custom = after['modes/_custom.md'] + after['modes/_profile.md'];
      assert(custom.includes(first), 'the accepted candidate is not in the rule files');
      assert(!custom.includes(second), 'the rejected candidate reached the rule files');
      for (const rel of PROTECTED) assert(after[rel] === FILES[rel], `${rel} changed`);
      const ledger = readFileSync(join(root, 'data/learning/ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert(ledger.map((e) => `${e.id}:${e.decision}`).join(' ') === '1:accepted 2:rejected', `ledger: ${JSON.stringify(ledger)}`);
      assert(ledger.every((e) => e.reply === `${REPLY}\n`), `the ledger does not carry the reply verbatim: ${JSON.stringify(ledger[0].reply)}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('run headless, the documented check refuses and writes no pending file', () => {
    const root = scratchRoot();
    try {
      writeExample(root);
      const r = run(root, argv(checkCommand, root, {}), { CAREER_OPS_HEADLESS: '1' });
      assert(r.status !== 0, 'check ran headless');
      const dir = join(root, 'data/learning/pending');
      assert(!existsSync(dir) || readdirSync(dir).length === 0, 'a pending file was written');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('an unattended retro ends on one needs_confirmation line in the {gate} {detail} - {resume} shape', () => {
  const lines = mode.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('needs_confirmation:'));
  assert(lines.length === 1, `expected one needs_confirmation line in modes/retro.md, found ${lines.length}`);
  assert(/^needs_confirmation: retro \S[^\n]* - \S/.test(lines[0]), `bad shape: ${lines[0]}`);
});
