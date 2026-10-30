// tests/fingerprint-core.test.mjs — the popcount rewrite of similarity() and
// findCrossListings() (#2381) must be a pure speedup, never a re-scoring.
//
// The old implementation re-parsed both 16-hex fingerprints into BigInts on
// every pair and counted bits one at a time, inside a loop over
// offers × recent-history rows: 500 × 20k measured at 53.6 s. The rewrite
// hoists the per-fingerprint work out of the inner loop and counts bits from a
// preallocated table, which measured 484x faster — but a 484x speedup that
// moves a single match across the threshold is a bug, not an optimization.
//
// So the assertions below are differential: a reference copy of the ORIGINAL
// BigInt implementation is inlined here and both are run over the same inputs.
// The reference is intentionally a verbatim transcription, not a refactor, and
// must not be "cleaned up" — its whole value is being the code that shipped.
//
// The seams that actually break under this rewrite, and what covers each:
//   - the 0..1 threshold → maximum-bit-distance conversion (off-by-one at a
//     bit boundary): pinned exactly at every boundary, and differentially at
//     all 65 of them;
//   - hoisted per-row state going stale across offers (companyKey, fingerprint
//     halves): multi-offer, multi-company differential corpus;
//   - the malformed/empty-fingerprint guard being optimized away: fed rows and
//     offers with junk fingerprints, including at threshold <= 0 where a score
//     of 0 is a legitimate match;
//   - match ORDER changing (callers read matches[0] as the best candidate):
//     compared as an ordered sequence, never as a set.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

// ── Reference implementation (verbatim pre-#2381 behaviour) ────────────────

/** The shipped similarity(): BigInt parse + one-bit-at-a-time popcount. */
function refSimilarity(a, b) {
  if (!/^[0-9a-f]{16}$/.test(a || '') || !/^[0-9a-f]{16}$/.test(b || '')) return 0;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let dist = 0;
  while (x) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return 1 - dist / 64;
}

function refCompanyKey(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The shipped findCrossListings(): companyKey and similarity recomputed per pair. */
function refFindCrossListings(offers, historyRows, opts = {}) {
  const threshold = opts.threshold ?? 0.92;
  const windowDays = opts.windowDays ?? 90;
  const today = opts.today ? new Date(opts.today) : new Date();
  const cutoff = today.getTime() - windowDays * 86400000;

  const recent = historyRows.filter((r) => {
    if (!r.fingerprint) return false;
    const t = Date.parse(r.dateStr);
    return !Number.isNaN(t) && t >= cutoff;
  });

  const matches = [];
  for (const offer of offers) {
    if (!offer.fingerprint) continue;
    const offerCompany = refCompanyKey(offer.company);
    for (const row of recent) {
      if (refCompanyKey(row.company) === offerCompany) continue;
      if (row.url === offer.url) continue;
      const score = refSimilarity(offer.fingerprint, row.fingerprint);
      if (score >= threshold) matches.push({ offer, row, score });
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}

// ── Deterministic corpus ───────────────────────────────────────────────────

/** mulberry32 — seeded so a differential failure reproduces from the log
 * instead of vanishing on the next run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(0x2381);

/** A random well-formed fingerprint (16 lowercase hex chars). */
function randomFingerprint() {
  let s = '';
  for (let i = 0; i < 16; i++) s += '0123456789abcdef'[Math.floor(rand() * 16)];
  return s;
}

/** Flip `n` distinct bits of a fingerprint — the near-duplicate case that
 * actually exercises the threshold, which uniform-random pairs (≈32 bits
 * apart) never reach. */
function flipBits(fp, n) {
  const bits = new Set();
  while (bits.size < n) bits.add(Math.floor(rand() * 64));
  let v = BigInt('0x' + fp);
  for (const b of bits) v ^= 1n << BigInt(b);
  return v.toString(16).padStart(16, '0');
}

/** A fingerprint at exactly `d` bits of Hamming distance from `fp`. */
const atDistance = (fp, d) => (d === 0 ? fp : flipBits(fp, d));

console.log('\nfingerprint-core.mjs — popcount rewrite is score-for-score identical (#2381)');
try {
  const { similarity, findCrossListings, CROSSLIST_THRESHOLD } =
    await import(pathToFileURL(join(ROOT, 'fingerprint-core.mjs')).href);

  // ── 1. similarity(): identical scores over random + near-duplicate pairs ──
  // Strict === , not an epsilon: both paths compute 1 - d/64 from an integer d,
  // so any difference at all means the distances themselves diverged.
  const pairs = [];
  for (let i = 0; i < 2000; i++) {
    const a = randomFingerprint();
    pairs.push([a, randomFingerprint()]);           // far apart: ≈32 bits
    pairs.push([a, atDistance(a, i % 13)]);         // near-duplicate: 0..12 bits
  }
  let simMismatch = null;
  for (const [a, b] of pairs) {
    if (similarity(a, b) !== refSimilarity(a, b)) { simMismatch = [a, b]; break; }
  }
  if (!simMismatch) {
    pass(`similarity matches the BigInt reference on ${pairs.length} random + near-duplicate pairs`);
  } else {
    const [a, b] = simMismatch;
    fail(`similarity diverged on ${a}/${b}: ${similarity(a, b)} vs reference ${refSimilarity(a, b)}`);
  }

  // Distance 0..64 in one hop each: covers both 32-bit halves and the sign bit
  // of each half, which is where a popcount that forgets `>>>` goes wrong.
  const base = 'ffffffffffffffff';
  const zeros = '0000000000000000';
  let sweepBad = null;
  for (let d = 0; d <= 64; d++) {
    const probe = atDistance(zeros, d);
    if (similarity(zeros, probe) !== refSimilarity(zeros, probe)) { sweepBad = d; break; }
    if (similarity(base, probe) !== refSimilarity(base, probe)) { sweepBad = d; break; }
  }
  if (sweepBad === null) pass('similarity matches the reference at every Hamming distance 0..64');
  else fail(`similarity diverged at distance ${sweepBad}`);

  // The top bit of either 32-bit half makes `^` produce a NEGATIVE int32, and
  // a popcount table is only defined over 0..65535. Any index that is not
  // masked back into that range (a raw shift, a divide, a sign-extended value)
  // reads out of bounds, yields undefined, and turns the score into NaN — which
  // compares false against every threshold, so the pair silently stops matching
  // instead of failing loudly. One bit set in each half, checked separately.
  if (similarity('8000000000000000', zeros) === 1 - 1 / 64 &&
      similarity('0000000080000000', zeros) === 1 - 1 / 64) {
    pass('similarity counts a set sign bit in either 32-bit half (table index stays in range)');
  } else {
    fail(`sign-bit halves scored ${similarity('8000000000000000', zeros)} / ${similarity('0000000080000000', zeros)}`);
  }

  // Malformed input must still be 0. The rewrite keeps the same regex guard;
  // if it were dropped, parseInt would return NaN and score NaN, not 0.
  const guards = [[zeros, ''], ['', ''], [zeros, 'zzzz'], [zeros, 'FFFFFFFFFFFFFFFF'], [zeros, '00000000000000000'], [null, zeros], [undefined, undefined]];
  const guardBad = guards.find(([a, b]) => similarity(a, b) !== refSimilarity(a, b) || similarity(a, b) !== 0);
  if (!guardBad) pass('similarity returns 0 for empty/short/uppercase/non-hex/nullish input, as before');
  else fail(`guard diverged on ${JSON.stringify(guardBad)}: got ${similarity(guardBad[0], guardBad[1])}`);

  // ── 2. threshold → maximum bit distance, the off-by-one seam ─────────────
  // 0.92 is the shipped CROSSLIST_THRESHOLD, and 1 - 5/64 = 0.921875 while
  // 1 - 6/64 = 0.90625. A max-distance derivation that rounds the wrong way
  // admits 6-bit pairs (false cross-listings) or rejects 5-bit ones (the
  // agency re-posts this feature exists to catch).
  const anchor = '0f1e2d3c4b5a6978';
  const mkPair = (d) => ({
    offers: [{ url: 'https://agency.example/j/1', company: 'Hays', title: 't', fingerprint: anchor }],
    history: [{ url: 'https://acme.example/j/9', dateStr: '2026-06-20', company: 'Acme', title: 't', fingerprint: atDistance(anchor, d) }],
  });
  const hit = (d, threshold) => {
    const { offers, history } = mkPair(d);
    return findCrossListings(offers, history, { today: '2026-07-06', threshold }).length;
  };
  if (hit(5, CROSSLIST_THRESHOLD) === 1 && hit(6, CROSSLIST_THRESHOLD) === 0) {
    pass('at the shipped 0.92 threshold, 5 differing bits match and 6 do not');
  } else {
    fail(`0.92 threshold admitted the wrong distances: 5 bits → ${hit(5, CROSSLIST_THRESHOLD)}, 6 bits → ${hit(6, CROSSLIST_THRESHOLD)}`);
  }

  // Thresholds sitting exactly ON a bit boundary are where floor()/ceil()
  // derivations break: the comparison is >=, so distance k must still match at
  // threshold 1 - k/64, while k+1 must not.
  let boundaryBad = null;
  for (let k = 0; k <= 63; k++) {
    const t = 1 - k / 64;
    if (hit(k, t) !== 1 || hit(k + 1, t) !== 0) { boundaryBad = k; break; }
  }
  if (boundaryBad === null) {
    pass('every exact bit-boundary threshold (1 - k/64) admits k bits and rejects k+1');
  } else {
    const t = 1 - boundaryBad / 64;
    fail(`threshold ${t} (k=${boundaryBad}) gave ${hit(boundaryBad, t)}/${hit(boundaryBad + 1, t)}, expected 1/0`);
  }

  // ── 3. findCrossListings(): identical matches, identical order ────────────
  // The corpus deliberately mixes everything the hoisting could get wrong:
  // several offers (stale per-offer state), companies that collide only after
  // normalization ("Acme Ltd." vs "acme-ltd"), same-URL pairs, rows outside the
  // 90-day window, unparseable dates, empty and malformed fingerprints, and
  // clusters of near-duplicates so many rows land near the threshold at once.
  const seeds = Array.from({ length: 6 }, () => randomFingerprint());
  const companies = ['Acme', 'Acme Ltd.', 'acme-ltd', 'Hays', 'Globex', 'Initech', 'Umbrella'];
  const offers = [];
  for (let i = 0; i < 40; i++) {
    const seed = seeds[i % seeds.length];
    offers.push({
      url: `https://agency.example/j/${i}`,
      company: companies[i % companies.length],
      title: `Role ${i}`,
      fingerprint: i % 11 === 0 ? '' : i % 17 === 0 ? 'not-a-fingerprint' : atDistance(seed, i % 9),
    });
  }
  const history = [];
  for (let i = 0; i < 400; i++) {
    const seed = seeds[i % seeds.length];
    history.push({
      url: i % 23 === 0 ? `https://agency.example/j/${i % 40}` : `https://board.example/j/${i}`,
      dateStr: i % 29 === 0 ? 'not-a-date' : i % 7 === 0 ? '2025-01-01' : `2026-0${(i % 6) + 1}-1${i % 10}`,
      company: companies[(i + 3) % companies.length],
      title: `Role ${i}`,
      fingerprint: i % 13 === 0 ? '' : i % 19 === 0 ? 'zzzz' : atDistance(seed, i % 10),
    });
  }

  // Identity of the matched objects matters too: callers reach through to
  // match.offer/match.row, so compare the URLs actually referenced, not copies.
  const shape = (ms) => ms.map((m) => `${m.offer.url}|${m.row.url}|${m.score}`).join('\n');
  let corpusBad = null;
  for (const threshold of [0.92, 1, 0.9375, 0.5, 0.984375, 0]) {
    for (const windowDays of [90, 30]) {
      const opts = { today: '2026-07-06', threshold, windowDays };
      const got = shape(findCrossListings(offers, history, opts));
      const want = shape(refFindCrossListings(offers, history, opts));
      if (got !== want) { corpusBad = { threshold, windowDays, got, want }; break; }
    }
    if (corpusBad) break;
  }
  if (!corpusBad) {
    pass('findCrossListings output is identical to the reference across 6 thresholds × 2 windows (same matches, same order)');
  } else {
    const g = corpusBad.got.split('\n');
    const w = corpusBad.want.split('\n');
    const at = g.findIndex((line, i) => line !== w[i]);
    fail(`findCrossListings diverged at threshold=${corpusBad.threshold} windowDays=${corpusBad.windowDays}, row ${at}: got ${g[at]}, want ${w[at]} (${g.length} vs ${w.length} matches)`);
  }

  // The corpus is only meaningful if it actually produces matches — a filter
  // bug that returned nothing would otherwise pass the comparison above.
  const produced = findCrossListings(offers, history, { today: '2026-07-06' }).length;
  if (produced > 0) pass(`differential corpus produces ${produced} real matches at the default threshold`);
  else fail('differential corpus produced 0 matches — it proves nothing');

  // threshold 0 is the one case where a score of 0 is a match, so the
  // malformed-fingerprint pairs the fast path would rather skip must still be
  // emitted. Covered in the sweep above; asserted separately because dropping
  // that branch is the tempting simplification.
  const zeroT = { today: '2026-07-06', threshold: 0 };
  if (shape(findCrossListings(offers, history, zeroT)) === shape(refFindCrossListings(offers, history, zeroT))) {
    pass('at threshold 0, malformed-fingerprint pairs still score 0 and still match, as before');
  } else {
    fail('threshold 0 dropped the zero-score matches the reference emits');
  }
} catch (e) {
  fail(`fingerprint-core popcount equivalence tests crashed: ${e.stack || e.message}`);
}

// ── non-Latin employers are DIFFERENT employers (#2500) ──────────────────
// companyKey used an [a-z0-9] strip, so every non-Latin name keyed to '' and
// compared equal. findCrossListings skips same-key pairs as re-posts, so an
// identical posting shared between two genuinely different non-Latin employers
// was silently never reported — while the Latin equivalent was reported fine.
{
  const { findCrossListings, fingerprintText } = await import(pathToFileURL(join(ROOT, 'fingerprint-core.mjs')).href);
  const jd = 'Senior backend engineer working on distributed payment platforms. You will design and operate high throughput services, own reliability, and mentor other engineers across the payments organisation. Experience with Go, Kubernetes and event driven systems is expected for this role.';
  const f = fingerprintText(jd);
  const today = new Date('2026-08-04T00:00:00Z');
  const offer = (company) => ({ url: 'https://x.test/1', company, title: 'Backend Engineer', fingerprint: f });
  const histRow = (company) => ({ url: 'https://y.test/2', company, title: 'Backend Engineer', fingerprint: f, dateStr: '2026-08-01' });
  const found = (a, b) => findCrossListings([offer(a)], [histRow(b)], { today }).length;

  const differentEmployers = [
    ['アクメ株式会社', 'グロベックス合同会社'],
    ['Яндекс', '北京字节跳动'],
    ['कंपनी', 'कपनी'], // differ only in combining marks
  ];
  if (differentEmployers.every(([a, b]) => found(a, b) === 1)) {
    pass('cross-listings between two different non-Latin employers are detected (#2500)');
  } else {
    fail('a shared posting between different non-Latin employers was skipped as a same-company re-post');
  }
  // The same-company skip must survive: a non-Latin employer re-posting its own
  // listing is a re-post, not a cross-listing.
  if (found('Acme Inc', 'Acme Inc') === 0 && found('アクメ株式会社', 'アクメ株式会社') === 0) {
    pass('same-employer pairs are still skipped as re-posts, Latin and non-Latin alike (#2500)');
  } else {
    fail('same-employer pair was reported as a cross-listing');
  }
}
