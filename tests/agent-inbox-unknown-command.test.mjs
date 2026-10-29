// tests/agent-inbox-unknown-command.test.mjs — a subcommand agent-inbox does
// not know is an error, not a help screen.
//
// `node agent-inbox.mjs ad "evaluate https://..."` (a typo for `add`) printed
// the usage text on stdout and exited 0. Nothing was queued, and every caller
// that checks the exit status (a dashboard, cron, an agent's shell tool) read
// that as "queued". Asking for help, with `--help`, `-h` or no arguments at
// all, still prints usage and exits 0.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const dir = mkdtempSync(join(tmpdir(), 'agent-inbox-unknown-'));
const inbox = join(dir, 'agent-inbox.md');
try {
  const run = (...args) => {
    const r = spawnSync(NODE, [join(ROOT, 'agent-inbox.mjs'), ...args], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_INBOX: inbox },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  console.log('\nagent-inbox — unknown subcommand');

  ok('a mistyped subcommand exits 1 and names the word', () => {
    const r = run('ad', 'evaluate https://acme.example/jobs/42');
    assert.strictEqual(r.status, 1, `exit ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /unknown command "ad"/, r.stderr);
    assert.match(r.stderr, /Usage:/, 'the usage text goes to stderr with the error');
  });

  ok('the mistyped subcommand queued nothing', () => {
    assert.strictEqual(existsSync(inbox), false, 'a queue file appeared');
  });

  ok('--help, -h and no arguments still print usage and exit 0', () => {
    for (const args of [['--help'], ['-h'], []]) {
      const r = run(...args);
      assert.strictEqual(r.status, 0, `${args.join(' ') || '(none)'}: exit ${r.status}\n${r.stderr}`);
      assert.match(r.stdout, /Usage:/, r.stdout);
    }
  });

  ok('premise: a real subcommand still works', () => {
    const r = run('add', 'evaluate https://acme.example/jobs/42');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(existsSync(inbox), true);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
