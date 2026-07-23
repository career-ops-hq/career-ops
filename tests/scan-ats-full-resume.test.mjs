// tests/scan-ats-full-resume.test.mjs — parallelEach resume-index tracking,
// withTimeout watchdog, and (Task 3) checkpoint compatibility rules.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — resume machinery');

const mod = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { parallelEach, withTimeout } = mod;

// withTimeout: passes a fast promise through untouched.
{
  const v = await withTimeout(Promise.resolve(42), 1_000, 'fast');
  if (v === 42) pass('withTimeout passes fast resolution through');
  else fail(`withTimeout returned ${v}`);
}

// withTimeout: rejects a hung promise with a labeled error.
{
  try {
    await withTimeout(new Promise(() => {}), 100, 'acme/board');
    fail('withTimeout resolved a never-settling promise');
  } catch (err) {
    if (/acme\/board: timed out after/.test(err.message)) pass('withTimeout rejects with labeled timeout');
    else fail(`withTimeout error message: ${err.message}`);
  }
}

// parallelEach: resumeAt is the lowest UNFINISHED index — a slow early item
// holds resumeAt down even while later items complete (resuming at plain
// `done` count would skip the slow item's work).
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const events = [];
  const p = parallelEach(
    [...Array(10).keys()], 2,
    async (item) => { if (item === 2) await gate; },
    (e) => events.push({ ...e }),
  );
  await new Promise((r) => setTimeout(r, 100)); // let everything except item 2 finish
  const held = events[events.length - 1];
  if (held && held.done === 9 && held.resumeAt === 2) {
    pass('resumeAt pinned to slow in-flight index 2 while 9 others finished');
  } else {
    fail(`expected {done:9, resumeAt:2}, got ${JSON.stringify(held)}`);
  }
  release();
  await p;
  const last = events[events.length - 1];
  if (last.done === 10 && last.resumeAt === 10) pass('resumeAt reaches items.length on completion');
  else fail(`final event ${JSON.stringify(last)}`);
}

// ── Checkpoint compatibility rules (Task 3) ─────────────────────────
const { loadCheckpoint, checkpointCompatible } = mod;

{
  const cp = { version: 1, cutoffMs: 1, ats: ['workday'], limit: null, includeUndated: false };
  const opts = { ats: ['workday'], limit: Infinity, includeUndated: false, shuffle: false };
  if (checkpointCompatible(cp, opts)) pass('checkpoint compatible with identical settings');
  else fail('identical settings judged incompatible');

  if (!checkpointCompatible(cp, { ...opts, ats: ['greenhouse'] })) pass('ats mismatch rejected');
  else fail('ats mismatch accepted');

  if (!checkpointCompatible(cp, { ...opts, shuffle: true })) pass('--shuffle rejected for resume (order not reproducible)');
  else fail('shuffle accepted');

  if (!checkpointCompatible(cp, { ...opts, limit: 200 })) pass('limit mismatch rejected');
  else fail('limit mismatch accepted');

  if (!checkpointCompatible(null, opts)) pass('null checkpoint rejected');
  else fail('null checkpoint accepted');
}

// loadCheckpoint: garbage and wrong-version files → null, never a throw.
{
  const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const dir = 'data/cache/.test-checkpoint';
  mkdirSync(dir, { recursive: true });
  const p = `${dir}/cp.json`;
  writeFileSync(p, 'not json', 'utf-8');
  if (loadCheckpoint(p) === null) pass('loadCheckpoint returns null on garbage JSON');
  else fail('garbage JSON not rejected');
  writeFileSync(p, JSON.stringify({ version: 99 }), 'utf-8');
  if (loadCheckpoint(p) === null) pass('loadCheckpoint returns null on unknown version');
  else fail('unknown version not rejected');
  writeFileSync(p, JSON.stringify({ version: 1, cutoffMs: 5 }), 'utf-8');
  if (loadCheckpoint(p)?.cutoffMs === 5) pass('loadCheckpoint reads a valid checkpoint');
  else fail('valid checkpoint not read');
  rmSync(dir, { recursive: true, force: true });
}
