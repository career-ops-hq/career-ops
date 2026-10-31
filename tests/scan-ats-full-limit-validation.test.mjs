// tests/scan-ats-full-limit-validation.test.mjs — a malformed --limit is a
// usage error, never an unbounded sweep.
//
// scan-ats-full.mjs read --limit as `Number(valueOf('--limit')) || Infinity`,
// the pattern the --since comment right above it retired (#2498) because it
// "silently swallowed every malformed operand". `--limit abc`, `--limit 0`, a
// typo like `--limit 1O` and a bare `--limit` all became Infinity: a sweep of
// every company in every ATS directory, while the user believed they had
// capped it at a handful.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseArgs } from '../scan-ats-full.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

console.log('\nscan-ats-full — --limit must be a positive whole number');

// All digits, so both pass the pattern alone: the first converts to Infinity,
// the unbounded sweep again; the second stays finite but is the first integer
// past the safe range, which an isFinite check would wave through.
const INFINITE = '9'.repeat(400);
const UNSAFE = '9007199254740992';

// An empty data root: if validation ever let a value through, the run would
// stop at the missing portals.yml rather than reach the network.
const root = mkdtempSync(join(tmpdir(), 'ats-full-limit-'));
try {
  for (const args of [['--limit', 'abc'], ['--limit', '0'], ['--limit', '-5'], ['--limit', '1O'], ['--limit', '2.5'], ['--limit=x'], ['--limit'], ['--limit', INFINITE], ['--limit', UNSAFE]]) {
    ok(`${args.join(' ').slice(0, 40)} is refused`, () => {
      const r = spawnSync(NODE, [join(ROOT, 'scan-ats-full.mjs'), ...args], {
        cwd: root, encoding: 'utf-8', timeout: 30000,
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' },
      });
      assert.strictEqual(r.status, 1, `exit ${r.status}: ${r.stderr}`);
      assert.match(r.stderr, /--limit expects a positive whole number of companies/, r.stderr);
    });
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

ok('a valid --limit is read, in both spellings, and an absent one means no cap', () => {
  assert.strictEqual(parseArgs(['node', 'scan-ats-full.mjs', '--limit', '25']).limit, 25);
  assert.strictEqual(parseArgs(['node', 'scan-ats-full.mjs', '--limit=7']).limit, 7);
  assert.strictEqual(parseArgs(['node', 'scan-ats-full.mjs']).limit, Infinity);
});
