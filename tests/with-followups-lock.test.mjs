// tests/with-followups-lock.test.mjs
//
// The point of #3034 is not that follow-ups.md had no lock. It had one, and one
// of its three writers took it. The other two — the web dashboard's log and
// override routes — took an in-process queue instead, which serialises a
// process against itself and is blind to every other one.
//
// What makes "just take a lock too" insufficient is that the lock DIRECTORY is
// derived (sha256 of the resolved path, under tmpdir). Two writers holding
// separately computed locks exclude nothing, and nothing about that failure is
// visible: both succeed, and one write disappears.
//
// So these tests assert the two things a caller outside this file actually
// depends on: that the same path lands on the same lock, and that holding it
// really does exclude a second holder.

import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail } from './helpers.mjs';
import { withFollowupsLock } from '../followup-seed.mjs';

console.log('\n🔗 withFollowupsLock — the lock other codebases have to share');

const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'folk-'));
const followups = join(dir, 'follow-ups.md');
writeFileSync(followups, '# Follow-ups\n');

// ── It actually excludes: the whole point ────────────────────────────
// Two overlapping read-modify-write cycles. Without exclusion the second read
// happens before the first write lands and one append is lost — the exact
// lost-update shape the tracker had before #2903.
{
  const rmw = async (line, holdMs) => withFollowupsLock(followups, async () => {
    const before = readFileSync(followups, 'utf-8');
    await sleep(holdMs);              // the window a lost update needs
    writeFileSync(followups, `${before}${line}\n`);
  });

  await Promise.all([rmw('first', 60), rmw('second', 10)]);

  const text = readFileSync(followups, 'utf-8');
  ok(text.includes('first'), 'the slow writer\'s line survived');
  ok(text.includes('second'), 'the fast writer\'s line survived');
  ok(
    text.split('\n').filter((l) => l === 'first' || l === 'second').length === 2,
    'both writes are present — the second did not read a snapshot the first was about to replace',
  );
}

// ── Released on a throw, or the next caller waits out staleMs ────────
{
  let threw = false;
  try {
    await withFollowupsLock(followups, () => { throw new Error('boom'); });
  } catch (err) {
    threw = err.message === 'boom';
  }
  ok(threw, 'the error from fn reaches the caller unchanged');

  // If the lock leaked, this second acquisition would block until timeout.
  let reacquired = false;
  await withFollowupsLock(followups, () => { reacquired = true; }, { timeoutMs: 3_000 });
  ok(reacquired, 'and the lock was released anyway, so the next caller gets it immediately');
}

// ── Same path, same lock — including via a different spelling ────────
// The derivation runs on the RESOLVED path, so a caller that passes a
// differently-spelled route to the same file must still collide. A second
// implementation recomputing the hash is what this export exists to prevent.
{
  const spelled = join(dir, '.', 'follow-ups.md');
  let inner = 'not attempted';
  await withFollowupsLock(followups, async () => {
    try {
      await withFollowupsLock(spelled, () => { inner = 'acquired'; }, { timeoutMs: 400, retryMs: 25 });
    } catch {
      inner = 'blocked';
    }
  });
  ok(inner === 'blocked', 'a differently-spelled path to the same file hits the same lock (and is therefore not reentrant)');
}

// ── The return value passes through ──────────────────────────────────
{
  const got = await withFollowupsLock(followups, () => 'value');
  ok(got === 'value', 'whatever fn returns is what the caller gets');
}

rmSync(dir, { recursive: true, force: true });
ok(!existsSync(dir), 'fixture cleaned up');
