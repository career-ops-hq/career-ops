// tests/dead-boards-later-page-failure.test.mjs — a failure on a later page of a
// board that had just answered is not a miss.
//
// scan-ats-full.mjs retires a board after three 404s in a row and skips it for
// 30 days (dead-boards.mjs, #2840). The iCIMS provider walks a board page by
// page and already draws the line itself: only a FIRST-page 404 means "no board
// here" (providers/icims.mjs, and tests/providers/icims-host-fallback.test.mjs
// pins that a later-page 404 does not switch hosts). The sweep did not draw it.
// It passed `err?.status` to recordBoardResult(), so a 404 on page 2 of a board
// that had answered page 1 with postings counted exactly like a missing board.
//
// The provider now marks every page failure (`firstPage` true or false), and
// the sweep hands the error to recordBoardFailure(), which reads the mark.
//
// The provider and the cache below are the real ones; only the HTTP layer is a
// stub. The last section reads scan-ats-full.mjs's source, because the two
// catch blocks that feed the cache are only reachable through a whole sweep.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nDead-board memory — a later-page failure is not a miss');

const load = (file) => import(pathToFileURL(join(ROOT, file)).href);
const { boardKey, recordBoardFailure, recordBoardResult, shouldSkipDeadBoard, DEAD_BOARD_MISSES } = await load('dead-boards.mjs');
const icims = (await load('providers/icims.mjs')).default;

const ORIGIN = 'https://careers-acmefreight.icims.com';
const entry = { name: 'acmefreight', careers_url: `${ORIGIN}/jobs/search?ss=1&in_iframe=1` };
const board = boardKey(entry);
const now = Date.parse('2026-10-11T00:00:00Z');
const card = (id) => `<li class="iCIMS_JobCardItem"><div class="col-xs-12 title">
<a href="${ORIGIN}/jobs/${id}/role-${id}/job?in_iframe=1" class="iCIMS_Anchor"><h3>Role ${id}</h3></a></div></li>`;
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

// A board whose page `failOn` answers `status`; every earlier page has one posting.
const ctxFailingOn = (failOn, status) => ({
  transport: 'http',
  sleep: async () => {},
  fetchJson: async () => { throw new Error('fetchJson should not be called'); },
  fetchText: async (url) => {
    const pr = Number(new URL(url).searchParams.get('pr'));
    if (pr === failOn) throw httpError(status);
    return `<ul class="iCIMS_JobsTable">${card(pr + 1)}</ul>`;
  },
});

async function failureFrom(failOn, status) {
  try {
    await icims.fetch(entry, ctxFailingOn(failOn, status));
  } catch (err) {
    return err;
  }
  throw new Error(`icims.fetch resolved although page ${failOn} answers ${status}`);
}

const sweeps = (err, times, rows = new Map()) => {
  for (let i = 0; i < times; i++) recordBoardFailure(rows, 'icims', board, err, now);
  return rows;
};

try {
  // ── what the provider throws ──
  const firstPage404 = await failureFrom(0, 404);
  const laterPage404 = await failureFrom(1, 404);
  const laterPage429 = await failureFrom(2, 429);

  if (firstPage404.status === 404 && firstPage404.firstPage === true) pass('a first-page 404 is marked firstPage: true');
  else fail(`first-page 404: status=${firstPage404.status} firstPage=${firstPage404.firstPage}`);

  // The status is left alone: the host-fallback suite reads it.
  if (laterPage404.status === 404 && laterPage404.firstPage === false) pass('a later-page 404 keeps its status and is marked firstPage: false');
  else fail(`later-page 404: status=${laterPage404.status} firstPage=${laterPage404.firstPage}`);

  // ── what three sweeps of each do to the cache ──
  // Control first: a board that is really gone must still be retired, or the
  // assertions after it would pass on a cache that retires nothing.
  if (shouldSkipDeadBoard(sweeps(firstPage404, DEAD_BOARD_MISSES), 'icims', board, now)) {
    pass(`${DEAD_BOARD_MISSES} first-page 404s still retire the board`);
  } else {
    fail('a missing board is no longer retired');
  }

  const afterLater = sweeps(laterPage404, DEAD_BOARD_MISSES);
  if (!shouldSkipDeadBoard(afterLater, 'icims', board, now) && afterLater.size === 0) {
    pass(`${DEAD_BOARD_MISSES} later-page 404s leave no record of the board`);
  } else {
    fail(`a board that answered its first page was recorded: ${JSON.stringify([...afterLater.values()])}`);
  }

  // A board on its way to being retired that then answers its first page is
  // alive: the count starts over, as it does after a clean fetch.
  const mixed = sweeps(firstPage404, DEAD_BOARD_MISSES - 1);
  sweeps(laterPage404, 1, mixed);
  sweeps(firstPage404, 1, mixed);
  if (!shouldSkipDeadBoard(mixed, 'icims', board, now)) pass('a later-page failure between first-page 404s resets the count');
  else fail('first-page 404s on either side of a board that answered were added together');

  // A retired board whose re-probe gets a first page and then fails further on
  // is back. Reading that failure as "unknown" would leave it retired.
  const retired = sweeps(firstPage404, DEAD_BOARD_MISSES);
  sweeps(laterPage429, 1, retired);
  if (!shouldSkipDeadBoard(retired, 'icims', board, now)) pass('a retired board that answers its first page again is no longer skipped');
  else fail('a retired board stayed retired after its first page answered');

  // ── errors with no mark are read exactly as before ──
  const unmarked = new Map();
  for (let i = 0; i < DEAD_BOARD_MISSES; i++) recordBoardFailure(unmarked, 'lever', board, httpError(404), now);
  const viaStatus = new Map();
  for (let i = 0; i < DEAD_BOARD_MISSES; i++) recordBoardResult(viaStatus, 'lever', board, 404, now);
  if (shouldSkipDeadBoard(unmarked, 'lever', board, now) && JSON.stringify([...unmarked]) === JSON.stringify([...viaStatus])) {
    pass('an unmarked 404 is recorded the same as recordBoardResult(…, 404)');
  } else {
    fail(`unmarked 404 drifted: ${JSON.stringify([...unmarked])}`);
  }

  const throttled = sweeps(httpError(429), 1, sweeps(firstPage404, DEAD_BOARD_MISSES));
  if (shouldSkipDeadBoard(throttled, 'icims', board, now)) pass('an unmarked 429 still neither creates nor clears a record');
  else fail('an unmarked 429 cleared a retired board');

  for (const odd of [undefined, null, 'timeout', new Error('socket hang up')]) {
    const rows = new Map();
    recordBoardFailure(rows, 'icims', board, odd, now);
    if (rows.size !== 0) fail(`a failure without a status created a record: ${String(odd)}`);
  }
  pass('a failure with no status at all creates no record');

  // ── the sweep hands over the error, not a status picked off it ──
  const sweep = readFileSync(join(ROOT, 'scan-ats-full.mjs'), 'utf-8');
  // [^;\n]* rather than [^)]*: one of the two calls has boardKey(entry) inside.
  const byStatus = [...sweep.matchAll(/recordBoardResult\([^;\n]*\berr\??\.status[^;\n]*\)/g)].map((m) => m[0]);
  const byError = [...sweep.matchAll(/recordBoardFailure\(\s*deadBoards\s*,[^;\n]*\berr\s*\)/g)].length;
  if (byStatus.length === 0 && byError === 2) pass('both catch blocks in scan-ats-full.mjs record the failure through recordBoardFailure()');
  else fail(`scan-ats-full.mjs: ${byError} recordBoardFailure(…, err) call(s), expected 2; still passing a status: ${JSON.stringify(byStatus)}`);
} catch (err) {
  fail(`later-page failure tests could not run: ${err.message}`);
}
