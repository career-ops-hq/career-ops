// tests/scan-ats-full-workable-cache.test.mjs — the one-hour copy of
// Workable's job feed: kept only after a complete read, served inside the
// hour, read as stale when a later download is refused before it started.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — Workable feed copy');

const { workableFeedCache, WORKABLE_FEED_CACHE_TTL_MS } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { loadWorkableFeed } = await import(pathToFileURL(join(ROOT, 'providers/workable.mjs')).href);

const check = (ok, label, detail) => (ok ? pass(label) : fail(detail ? `${label} — ${detail}` : label));
const cdata = (v) => `<![CDATA[${v}]]>`;
const job = (title, code) => `<job><title>${cdata(title)}</title><date>${cdata('Mon, 09 Nov 2026 10:00:00 UTC')}</date><url>${cdata(`https://apply.workable.com/j/${code}`)}</url><company>${cdata('Acme GmbH')}</company><city>${cdata('Berlin')}</city><country>${cdata('DE')}</country></job>`;
const feed = (...jobs) => `<?xml version="1.0"?><source><publisher>Workable</publisher>${jobs.join('')}</source>`;
const CUTOFF = Date.parse('2026-11-01T00:00:00Z');

/** A network stand-in: hands `text` over in pieces, or fails as told. */
function network({ text = '', failWith = null, failAfter = -1 } = {}) {
  const fn = async (_url, _opts, onText) => {
    fn.calls++;
    if (failWith && failAfter < 0) throw failWith;
    let sent = 0;
    for (let i = 0; i < text.length; i += 50) {
      if (failWith && sent === failAfter) throw failWith;
      await onText(text.slice(i, i + 50));
      sent++;
    }
    return { bytes: Buffer.byteLength(text), complete: true };
  };
  fn.calls = 0;
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

const dir = mkdtempSync(join(tmpdir(), 'career-ops-workable-cache-'));
try {
  let clock = Date.parse('2026-11-10T03:00:00Z');
  const now = () => clock;
  const copy = join(dir, 'workable.xml.gz');

  // 1. A fresh download becomes the copy, but only after commit().
  const first = network({ text: feed(job('QA Engineer', 'A1'), job('QA Lead', 'A2')) });
  const c1 = workableFeedCache({ cacheDir: dir, now, fetchStream: first });
  const titles1 = await load(c1);
  check(first.calls === 1 && c1.from === 'network' && titles1.join() === 'QA Engineer,QA Lead', 'a first run downloads the feed');
  check(existsSync(copy) && readdirSync(dir).length === 1, 'a complete download is kept as the copy, with no temporary file left');

  // 2. Inside the hour: the copy, no request.
  clock += 30 * 60 * 1000;
  const second = network({ text: feed(job('Should not be read', 'X1')) });
  const c2 = workableFeedCache({ cacheDir: dir, now: () => Date.now() - 1000, fetchStream: second });
  const titles2 = await load(c2);
  check(second.calls === 0 && c2.from === 'cache' && titles2.join() === 'QA Engineer,QA Lead', 'a second run inside the hour reads the copy and sends no request');

  // 3. Past the hour: download again, refused before any byte → the old copy, stale.
  const later = () => Date.now() + WORKABLE_FEED_CACHE_TTL_MS + 60_000;
  const refused = network({ failWith: http429('3600') });
  const c3 = workableFeedCache({ cacheDir: dir, now: later, fetchStream: refused });
  const titles3 = await load(c3);
  check(refused.calls === 1 && c3.from === 'stale-cache' && titles3.join() === 'QA Engineer,QA Lead', 'a refused download past the hour falls back to the older copy, reported as stale');

  // 4. A download that breaks after part of the feed arrived never falls back.
  const broken = network({ text: feed(job('QA Engineer', 'B1'), job('QA Lead', 'B2')), failWith: new Error('socket hang up'), failAfter: 2 });
  const c4 = workableFeedCache({ cacheDir: dir, now: later, fetchStream: broken });
  let err4 = null;
  try { await load(c4); } catch (e) { err4 = e; }
  check(err4?.message === 'socket hang up' && readdirSync(dir).length === 1, 'a download that fails mid-feed is an error, not a fallback, and leaves no temporary file');

  // 5. A download the reader refuses is not kept.
  const notAFeed = network({ text: '<html>Attention Required</html>' });
  const c5 = workableFeedCache({ cacheDir: dir, now: later, fetchStream: notAFeed });
  let err5 = null;
  try { await load(c5); } catch (e) { err5 = e; }
  const stillOld = await load(workableFeedCache({ cacheDir: dir, now: () => Date.now() - 1000, fetchStream: network() }));
  check(/no <source> element/.test(err5?.message ?? '') && stillOld.join() === 'QA Engineer,QA Lead', 'a response the reader refuses does not replace the copy');

  // 6. No copy at all and a 429: the error says when to try again.
  const empty = mkdtempSync(join(tmpdir(), 'career-ops-workable-cache-empty-'));
  try {
    const at = Date.parse('2026-11-10T03:00:00Z');
    const c6 = workableFeedCache({ cacheDir: empty, now: () => at, fetchStream: network({ failWith: http429('3600') }) });
    let err6 = null;
    try { await load(c6); } catch (e) { err6 = e; }
    check(/about once an hour/.test(err6?.message ?? '') && err6.message.includes('2026-11-10T04:00:00.000Z'), 'with no copy, a 429 says the feed is served about once an hour and when to try again', err6?.message);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
