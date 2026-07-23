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
