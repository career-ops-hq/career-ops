// tests/scan-ats-full-resume.test.mjs — parallelEach resume-index tracking,
// withTimeout watchdog, and (Task 3) checkpoint compatibility rules.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — resume machinery');

const mod = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { parallelEach, withTimeout, datasetFingerprint } = mod;

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

// withTimeout: a loser that rejects AFTER the race is over must not surface as
// an unhandled rejection — Node terminates the process on those, so the
// watchdog meant to cost one company would take down the whole sweep.
//
// This passes against the current implementation and is meant to: Promise.race
// attaches a rejection handler to every participant (ECMA-262 PerformPromiseRace),
// so the losers cannot leak. It is a regression guard for a future refactor that
// replaces the race with a hand-rolled then-chain, where they could.
//
// The control arm is load-bearing. Without it, a listener that silently stopped
// working would make the real assertion pass vacuously — the failure mode that
// makes "no event fired" a weak signal on its own.
{
  const seen = [];
  const onUnhandled = (err) => seen.push(err.message);
  process.on('unhandledRejection', onUnhandled);
  const settle = () => new Promise((r) => setTimeout(r, 160));

  // CONTROL: a genuinely orphaned rejection. Detection must see this one.
  { new Promise((_, reject) => setTimeout(() => reject(new Error('ORPHAN')), 20)); }
  await settle();
  const controlFired = seen.includes('ORPHAN');

  // SUBJECT: the timeout wins, then the loser rejects well afterwards.
  seen.length = 0;
  const late = new Promise((_, reject) => setTimeout(() => reject(new Error('LATE_LOSER')), 40));
  try {
    await withTimeout(late, 15, 'acme/board');
    fail('withTimeout resolved when the timeout should have won');
  } catch (err) {
    if (!/acme\/board: timed out after/.test(err.message)) fail(`unexpected error: ${err.message}`);
  }
  await settle();
  process.off('unhandledRejection', onUnhandled);

  if (!controlFired) fail('unhandledRejection listener never fired on the control — test is vacuous');
  else if (seen.length === 0) pass('withTimeout: late rejection from the losing promise stays handled');
  else fail(`losing promise leaked an unhandled rejection: ${seen.join(', ')}`);
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
  // Anchored to ROOT, not CWD: run from anywhere else and a relative path would
  // create — and then rmSync — a directory outside the project.
  const dir = join(ROOT, 'data/cache/.test-checkpoint');
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

  // A malformed `current` is worse than no checkpoint: resumeAt is consumed
  // unchecked, so it rescans from zero and then writes NaN offsets forever.
  for (const [label, current] of [
    ['missing resumeAt', { name: 'workday', datasetLen: 10 }],
    ['non-numeric resumeAt', { name: 'workday', resumeAt: 'x', datasetLen: 10 }],
    ['negative resumeAt', { name: 'workday', resumeAt: -1, datasetLen: 10 }],
    ['missing name', { resumeAt: 5, datasetLen: 10 }],
  ]) {
    writeFileSync(p, JSON.stringify({ version: 1, current }), 'utf-8');
    if (loadCheckpoint(p) === null) pass(`loadCheckpoint rejects malformed current (${label})`);
    else fail(`malformed current accepted (${label})`);
  }

  writeFileSync(p, JSON.stringify({ version: 1, current: { name: 'workday', resumeAt: 500, datasetLen: 12884 } }), 'utf-8');
  if (loadCheckpoint(p)?.current?.resumeAt === 500) pass('loadCheckpoint accepts a well-formed current');
  else fail('well-formed current rejected');

  // current: null is the legitimate "source finished" marker, not malformed.
  writeFileSync(p, JSON.stringify({ version: 1, current: null }), 'utf-8');
  if (loadCheckpoint(p)?.version === 1) pass('loadCheckpoint accepts current: null');
  else fail('current: null rejected');

  rmSync(dir, { recursive: true, force: true });
}

// datasetFingerprint: same content → same hash; any drift → different hash.
// Guards --resume against a same-length dataset regenerated with different
// members (which a bare length check would miss and silently mis-resume).
{
  const a = ['acme', 'globex', 'initech'];
  if (datasetFingerprint(a) === datasetFingerprint(['acme', 'globex', 'initech'])) pass('datasetFingerprint stable for identical lists');
  else fail('datasetFingerprint not stable for identical content');

  // Same length, swapped member — the case a length-only check misses.
  if (datasetFingerprint(a) !== datasetFingerprint(['acme', 'globex', 'umbrella'])) pass('datasetFingerprint detects same-length content drift');
  else fail('datasetFingerprint missed same-length content drift');

  // Reordering is drift too — resume offsets are order-dependent.
  if (datasetFingerprint(a) !== datasetFingerprint(['globex', 'acme', 'initech'])) pass('datasetFingerprint detects reordering');
  else fail('datasetFingerprint missed reordering');
}

// ── icims SOURCES wiring (Task 8) ───────────────────────────────────
{
  const { SOURCES } = mod;
  if (!SOURCES) {
    fail('SOURCES not exported from scan-ats-full.mjs');
  } else if (!SOURCES.icims) {
    fail('SOURCES.icims missing');
  } else {
    const good = SOURCES.icims.toEntry('acmefreight');
    if (good && good.careers_url === 'https://careers-acmefreight.icims.com/jobs/search?ss=1&in_iframe=1' && good.name === 'acmefreight') {
      pass('icims toEntry builds canonical portal URL');
    } else {
      fail(`icims toEntry: ${JSON.stringify(good)}`);
    }
    if (SOURCES.icims.toEntry('evil/..%2f') === null) pass('icims toEntry rejects non-slug input');
    else fail('icims toEntry accepted a hostile slug');
    if (SOURCES.icims.provider?.id === 'icims') pass('icims source wired to icims provider');
    else fail('icims source provider mismatch');
  }
}

// ── cappedBoards reaches the --json payload ─────────────────────────
// The --json object exists so a caller can tell a *degraded* sweep apart from
// an empty one. A page-capped board is exactly that: coverage is partial, so a
// consumer reading postingsKept alone would mistake it for a fully-walked
// board that simply had nothing fresh. The counter is a local in main(), so
// this asserts on the source of the payload literal rather than a run.
{
  const src = readFileSync(join(ROOT, 'scan-ats-full.mjs'), 'utf-8');
  const start = src.indexOf('if (opts.json) {');
  const end = src.indexOf('offers: offers.map(', start);

  if (start === -1 || end === -1 || end <= start) {
    fail('could not locate the --json payload literal in scan-ats-full.mjs');
  } else {
    const payload = src.slice(start, end);
    // Control arm: if the slice ever stops covering the payload, this sibling
    // counter goes missing too and the real assertion below can't pass vacuously.
    if (/\bunreachableBoards\b/.test(payload)) {
      if (/\bcappedBoards\b/.test(payload)) pass('--json payload reports cappedBoards');
      else fail('--json payload omits cappedBoards — capped coverage is invisible to consumers');
    } else {
      fail('--json payload slice missed unreachableBoards — the control arm broke, assertion would be vacuous');
    }
  }
}
