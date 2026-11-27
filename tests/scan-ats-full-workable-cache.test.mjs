// tests/scan-ats-full-workable-cache.test.mjs — the copy of Workable's job
// feed: kept only after a complete read, revalidated with If-Modified-Since
// on every run, read as stale when a request is refused before it started.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — Workable feed copy');

const { workableFeedCache, drainOrFailure } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { createGzip } = await import('node:zlib');
const { Writable } = await import('node:stream');
const { loadWorkableFeed } = await import(pathToFileURL(join(ROOT, 'providers/workable.mjs')).href);

const check = (ok, label, detail) => (ok ? pass(label) : fail(detail ? `${label} — ${detail}` : label));
const cdata = (v) => `<![CDATA[${v}]]>`;
const job = (title, code) => `<job><title>${cdata(title)}</title><date>${cdata('Mon, 09 Nov 2026 10:00:00 UTC')}</date><url>${cdata(`https://apply.workable.com/j/${code}`)}</url><company>${cdata('Acme GmbH')}</company><city>${cdata('Berlin')}</city><country>${cdata('DE')}</country></job>`;
const feed = (...jobs) => `<?xml version="1.0"?><source><publisher>Workable</publisher>${jobs.join('')}</source>`;
const CUTOFF = Date.parse('2026-11-01T00:00:00Z');
const LM1 = 'Tue, 10 Nov 2026 05:16:04 GMT';
const LM2 = 'Tue, 10 Nov 2026 06:16:04 GMT';

/**
 * A network stand-in. Answers 304 when the request carries
 * If-Modified-Since equal to `lastModified`; otherwise hands `text` over in
 * pieces, or fails as told. Records the headers of every request.
 */
function network({ text = '', lastModified = LM1, failWith = null, failAfter = -1 } = {}) {
  const fn = async (_url, opts, onText) => {
    fn.calls.push(opts?.headers ?? {});
    if (failWith && failAfter < 0) throw failWith;
    const since = opts?.headers?.['if-modified-since'];
    if (since && opts?.acceptNotModified && since === lastModified) return { bytes: 0, complete: true, notModified: true, lastModified };
    let sent = 0;
    for (let i = 0; i < text.length; i += 50) {
      if (failWith && sent === failAfter) throw failWith;
      await onText(text.slice(i, i + 50));
      sent++;
    }
    return { bytes: Buffer.byteLength(text), complete: true, notModified: false, lastModified };
  };
  fn.calls = [];
  return fn;
}

async function load(cache) {
  try {
    const { companies } = await loadWorkableFeed({ cutoffMs: CUTOFF, titleFilter: () => true, fetchStream: cache.fetchStream });
    cache.commit();
    return companies.flatMap((c) => c.jobs.map((j) => j.title));
  } catch (err) {
    cache.discard();
    throw err;
  }
}
const http429 = (retryAfter) => Object.assign(new Error('HTTP 429'), { status: 429, retryAfter });
const files = (d) => readdirSync(d).sort().join(',');

const dir = mkdtempSync(join(tmpdir(), 'career-ops-workable-cache-'));
try {
  // 1. A first run downloads the feed; the copy and its Last-Modified are kept after commit().
  const first = network({ text: feed(job('QA Engineer', 'A1'), job('QA Lead', 'A2')) });
  const c1 = workableFeedCache({ cacheDir: dir, fetchStream: first });
  const titles1 = await load(c1);
  check(first.calls.length === 1 && !first.calls[0]['if-modified-since'] && c1.from === 'network' && titles1.join() === 'QA Engineer,QA Lead', 'a first run downloads the feed, with no conditional header');
  check(files(dir) === 'workable.meta.json,workable.xml.gz' && JSON.parse(readFileSync(join(dir, 'workable.meta.json'), 'utf-8')).lastModified === LM1,
    'a complete download is kept with its Last-Modified, and no temporary file is left');

  // 2. The feed has not changed: a 304, and the copy is read.
  const same = network({ text: feed(job('Should not be read', 'X1')), lastModified: LM1 });
  const c2 = workableFeedCache({ cacheDir: dir, fetchStream: same });
  const titles2 = await load(c2);
  check(same.calls[0]['if-modified-since'] === LM1 && c2.from === 'cache' && titles2.join() === 'QA Engineer,QA Lead', 'the next run asks If-Modified-Since, gets 304 and reads the copy');

  // 3. The feed has changed: the new download replaces the copy and its date.
  const changed = network({ text: feed(job('SDET', 'C1')), lastModified: LM2 });
  const c3 = workableFeedCache({ cacheDir: dir, fetchStream: changed });
  const titles3 = await load(c3);
  check(c3.from === 'network' && titles3.join() === 'SDET' && JSON.parse(readFileSync(join(dir, 'workable.meta.json'), 'utf-8')).lastModified === LM2,
    'a changed feed (200) replaces the copy and its Last-Modified');

  // 4. Refused before any byte: the copy, reported as stale.
  const refused = network({ failWith: http429('3600') });
  const c4 = workableFeedCache({ cacheDir: dir, fetchStream: refused });
  const titles4 = await load(c4);
  check(c4.from === 'stale-cache' && titles4.join() === 'SDET', 'a refused request falls back to the copy, reported as stale');

  // 5. A download that breaks after part of the feed arrived never falls back.
  const broken = network({ text: feed(job('QA Engineer', 'B1'), job('QA Lead', 'B2')), lastModified: 'Tue, 10 Nov 2026 07:16:04 GMT', failWith: new Error('socket hang up'), failAfter: 2 });
  const c5 = workableFeedCache({ cacheDir: dir, fetchStream: broken });
  let err5 = null;
  try { await load(c5); } catch (e) { err5 = e; }
  check(err5?.message === 'socket hang up' && files(dir) === 'workable.meta.json,workable.xml.gz', 'a download that fails mid-feed is an error, not a fallback, and leaves no temporary file');

  // 6. A response the reader refuses does not replace the copy.
  const notAFeed = network({ text: '<html>Attention Required</html>', lastModified: 'Tue, 10 Nov 2026 08:16:04 GMT' });
  let err6 = null;
  try { await load(workableFeedCache({ cacheDir: dir, fetchStream: notAFeed })); } catch (e) { err6 = e; }
  const stillThere = await load(workableFeedCache({ cacheDir: dir, fetchStream: network({ lastModified: LM2 }) }));
  check(/no <source> element/.test(err6?.message ?? '') && stillThere.join() === 'SDET', 'a response the reader refuses does not replace the copy or its date');

  // 7. A copy whose date file is missing is not trusted for a conditional request.
  rmSync(join(dir, 'workable.meta.json'));
  const noDate = network({ text: feed(job('QA Engineer', 'D1')), lastModified: LM2 });
  await load(workableFeedCache({ cacheDir: dir, fetchStream: noDate }));
  check(!noDate.calls[0]['if-modified-since'] && existsSync(join(dir, 'workable.meta.json')), 'without its date file the copy is downloaded again, and the date is written back');

  // 8. No copy at all and a 429: the error says when to try again.
  const empty = mkdtempSync(join(tmpdir(), 'career-ops-workable-cache-empty-'));
  try {
    const at = Date.parse('2026-11-10T03:00:00Z');
    let err8 = null;
    try { await load(workableFeedCache({ cacheDir: empty, now: () => at, fetchStream: network({ failWith: http429('3600') }) })); } catch (e) { err8 = e; }
    check(/about once an hour/.test(err8?.message ?? '') && err8.message.includes('2026-11-10T04:00:00.000Z') && readdirSync(empty).length === 0,
      'with no copy, a 429 says when to try again and writes nothing', err8?.message);
    let err8b = null;
    try { await load(workableFeedCache({ cacheDir: empty, now: () => at, fetchStream: network({ failWith: http429(null) }) })); } catch (e) { err8b = e; }
    check(/try again later$/.test(err8b?.message ?? ''), 'a 429 without Retry-After does not name the current time as the retry time', err8b?.message);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  const quiet = async (fn) => {
    const real = console.error;
    const warnings = [];
    console.error = (m) => warnings.push(String(m));
    try { return { result: await fn(), warnings }; } finally { console.error = real; }
  };

  // 9. The copy cannot be kept (a directory sits where the copy goes): the feed read still counts.
  const blocked = mkdtempSync(join(tmpdir(), 'career-ops-workable-cache-blocked-'));
  try {
    mkdirSync(join(blocked, 'workable.xml.gz'));
    const { result, warnings } = await quiet(() => load(workableFeedCache({ cacheDir: blocked, fetchStream: network({ text: feed(job('QA Engineer', 'K1')) }) })));
    check(result.join() === 'QA Engineer' && warnings.some((w) => w.includes('could not keep the feed copy')) && !readdirSync(blocked).some((f) => f.includes('.tmp-')),
      'a copy that cannot be kept warns and leaves no temporary file, and the feed already read is still returned');
  } finally {
    rmSync(blocked, { recursive: true, force: true });
  }

  // 10. The copy file fails while gzip waits for room: the read goes on and does not stall.
  const badFile = mkdtempSync(join(tmpdir(), 'career-ops-workable-cache-badfile-'));
  try {
    mkdirSync(join(badFile, `workable.xml.gz.tmp-${process.pid}`));
    const big = feed(...Array.from({ length: 300 }, (_, i) => job(`QA Engineer ${i}`, `L${i}`).replace('</title>', `</title><description>${cdata(randomBytes(4096).toString('hex'))}</description>`)));
    const run = load(workableFeedCache({ cacheDir: badFile, fetchStream: network({ text: big }) }));
    const timeout = new Promise((r) => setTimeout(() => r('timeout'), 15_000).unref());
    const outcome = await Promise.race([run, timeout]);
    check(Array.isArray(outcome) && outcome.length === 300, 'a copy file that fails during backpressure does not stall the read of the feed', String(outcome).slice(0, 80));
  } finally {
    rmSync(badFile, { recursive: true, force: true });
  }

  // 11. The file breaks while gzip already waits for room: the wait ends, and its listeners go.
  {
    // gzip is not read, so its buffer fills; `out` stands for the file and is
    // not piped, so only the listeners of the wait itself are on both streams.
    const gzip = createGzip({ level: 1 });
    const out = new Writable({ write(_chunk, _enc, cb) { cb(); } });
    out.on('error', () => {});
    gzip.on('error', () => {});
    const count = () => ['drain', 'error', 'close'].map((e) => gzip.listenerCount(e)).concat(['error', 'close'].map((e) => out.listenerCount(e))).join();
    const before = count();
    let full = false;
    for (let i = 0; i < 200 && !full; i++) full = !gzip.write(randomBytes(64 * 1024));
    const waiting = drainOrFailure(gzip, out);
    setTimeout(() => out.destroy(new Error('ENOSPC')), 20);
    const outcome = await Promise.race([waiting.then(() => 'ended'), new Promise((r) => setTimeout(() => r('stalled'), 3000).unref())]);
    check(full && outcome === 'ended', 'a file that fails while gzip waits for room ends the wait instead of stalling', `full=${full} ${outcome}`);
    check(count() === before, 'the wait removes every listener it added', `${before} → ${count()}`);
    gzip.destroy();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
