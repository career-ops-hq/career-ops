// Local backend for the H-1B sponsorship check: same three functions as
// lib/api.mjs, answered from a gzipped NDJSON index on disk instead of an HTTP
// endpoint. This is the default path, and the reason is the query rather than
// the answer: asking whether a company sponsors says that the person asking
// needs a visa and names the employers they are considering. Over HTTP that
// leaves the machine and reaches whoever runs the endpoint. Here it does not
// leave the machine at all.
//
// The data is the same public DOL disclosure material the API serves, built
// into one file per release. Matching rules are imported from lib/api.mjs
// rather than restated, so both backends resolve a name identically.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { normalize, num, pickBestMatch, plausibleMatch } from './api.mjs';

// Anchored to the repo root for the same reason lib/cache.mjs is: running the
// CLI from another directory must find the one installed index rather than
// report it missing. lib/ sits three levels below the root.
//
// Its own directory, deliberately not the data/cache/h1b/ tree the lookup cache
// lives in. That tree is documented as safe to delete at any time and it is:
// every file in it is a disposable answer the next lookup would rebuild. The
// index is not disposable in that sense. It is an 8 MiB artifact the user chose
// to install, over the network, in a command they had to run themselves, and
// re-creating it means doing that again. Filing it under "cache" invites a
// cleanup that silently disables the plugin.
const DEFAULT_INDEX = fileURLToPath(new URL('../../../data/h1b/index.ndjson.gz', import.meta.url));

// The staffing-shop numbers in an index record are the secondary-worksite
// counts the API reports under this basis. It is a constant here because the
// index carries one measure; the field exists so a consumer can tell which.
const STAFFING_BASIS = 'secondary_entity_share';

// What --search shows at once. Mirrors the page the HTTP endpoint serves, so
// the CLI's "narrow the query to see the rest" header means the same thing on
// both backends.
const SEARCH_PAGE = 50;

// Ceiling on how many non-exact candidates a resolve keeps. Without it a bare
// query like "American" would hold every employer with that leading token in
// memory to pick one (1,401 for "New" in the shipped index). What the cap drops
// is decided by rank, not by arrival: see boundedTop.
const MAX_CANDIDATES = 500;

/**
 * The order the API publishes its search buckets in: descending sponsorship
 * evidence, then name, then key. The HTTP backend's results arrive already
 * sorted this way and pickBestMatch leans on it, taking the first exact match
 * and otherwise the first plausible one, so the highest-volume match is what it
 * lands on.
 *
 * Records come off the index in the publisher's NAME order instead, so without
 * this the alphabet decides the answer and a zero-filing lookalike beats the
 * company being asked about: "Meta" resolved to "META 4 LLC" (0 LCAs) over
 * "Meta Platforms, Inc" (38,117), "Google" to "Google Client Services LLC" (2)
 * over "Google LLC" (70,985). A tier of `none` for an employer that filed
 * 38,117 LCAs is precisely the confident wrong answer this plugin exists to
 * prevent, so the local candidate list is sorted into the server's order and
 * both backends resolve a name identically again.
 *
 * The key is the same sum classifyTier adds up, filings plus the two green card
 * steps, and etl/publish.py's search_volume() now ranks the server's buckets by
 * that same sum. Ranking on any narrower number lets resolution seat an entity
 * ahead of a same-named sibling that has more evidence than it does: measured
 * on the 2026Q2 build, grouped the way this file matches names, ranking by
 * certified alone did that for 6,929 shared-name groups and by raw LCA count
 * alone for 6,617 (the publisher counts the same failure against its own bucket
 * normalization, which is why its numbers differ). Most of them are the 156,616
 * employers with green card filings and no LCA rows at all, which carry zero
 * volume under either single number and rank correctly under this one.
 *
 * Plain `<` on the tie-breakers rather than localeCompare: the publisher sorts
 * in Python, whose string comparison is by code point and does not move with a
 * locale.
 */
function evidence(rec) {
  return (num(rec && rec.filed) ?? 0) + (num(rec && rec.pwd) ?? 0) + (num(rec && rec.perm) ?? 0);
}

function byRank(a, b) {
  const av = evidence(a);
  const bv = evidence(b);
  if (av !== bv) return bv - av;
  const an = String((a && a.n) ?? '');
  const bn = String((b && b.n) ?? '');
  if (an !== bn) return an < bn ? -1 : 1;
  const ak = String((a && a.k) ?? '');
  const bk = String((b && b.k) ?? '');
  if (ak === bk) return 0;
  return ak < bk ? -1 : 1;
}

/**
 * A list that keeps only the top `limit` records under byRank as a scan runs.
 *
 * Bounded because a broad query can match a large share of the file: the
 * two-character "in" is inside 193,292 of the shipped index's normalized names.
 * Trimmed by rank rather than by arrival because arrival order is name order,
 * and keeping the first N would put the alphabet back in charge of which
 * matches survive to be ranked, which is the defect byRank exists to remove.
 */
function boundedTop(limit) {
  const items = [];
  const trim = () => {
    items.sort(byRank);
    if (items.length > limit) items.length = limit;
  };
  return {
    push(rec) {
      items.push(rec);
      if (items.length >= limit * 2) trim();
    },
    drain() {
      trim();
      return items;
    },
  };
}

/**
 * Where the index lives. H1B_INDEX_PATH relocates it (a shared read-only copy,
 * a scratch fixture in the test suite). Present-but-blank is a misconfiguration
 * rather than "unset", exactly as H1B_API_BASE treats it: silently falling back
 * would read an index the user believed they had replaced.
 */
export function indexPath() {
  const raw = process.env.H1B_INDEX_PATH;
  if (raw === undefined) return DEFAULT_INDEX;
  const trimmed = String(raw).trim();
  if (!trimmed) {
    throw new Error('H1B_INDEX_PATH is set but empty. Unset it to use the default index location.');
  }
  return trimmed;
}

/** The sidecar install-h1b-index.mjs writes beside the index. */
export function metaPath(file = indexPath()) {
  return `${file}.meta.json`;
}

/** Whether a local index is installed. Decides the backend, so it never throws on a missing file. */
export function hasIndex(file = indexPath()) {
  return existsSync(file);
}

const SHA256_RE = /^[0-9a-f]{64}$/;
let cachedDigest = null;

/**
 * Digest of the installed index, used as the provenance stamp on cached
 * answers. The sidecar carries the digest install-h1b-index.mjs verified before it
 * moved the file into place, which saves re-hashing 8 MiB on every lookup; it
 * is trusted only when it still describes a file of that size, so an index
 * swapped underneath a stale sidecar gets hashed rather than mislabelled.
 */
export async function indexDigest(file = indexPath()) {
  if (cachedDigest && cachedDigest.file === file) return cachedDigest.digest;

  let size;
  try {
    size = statSync(file).size;
  } catch {
    const e = new Error(`H-1B index not found: ${file}`);
    e.code = 'INDEX_MISSING';
    throw e;
  }

  let digest = null;
  try {
    const meta = JSON.parse(await readFile(metaPath(file), 'utf8'));
    if (meta && SHA256_RE.test(String(meta.sha256)) && Number(meta.bytes) === size) {
      digest = String(meta.sha256);
    }
  } catch { /* no sidecar, or an unreadable one: hash the file instead */ }

  if (!digest) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    digest = hash.digest('hex');
  }

  cachedDigest = { file, digest };
  return digest;
}

/**
 * How an answer from this backend is labelled: in the `source` field of the
 * CLI output, and as the provenance key on its cache entry. Naming the digest
 * rather than the file path is what makes a refreshed index invalidate the
 * answers the previous one produced.
 */
export async function indexSource(file = indexPath()) {
  return `local:h1b-index@sha256-${(await indexDigest(file)).slice(0, 12)}`;
}

/**
 * Stream the index one record at a time.
 *
 * Whole-file scan by design, and the name-matching callers read to the end.
 * The index is a single gzip member, so there is no seeking into it, and
 * neither resolve nor search can stop
 * early: the file is ordered by the publisher's normalizer rather than this
 * one, so passing the query alphabetically proves nothing, and a match found
 * part-way through can still be beaten on filing volume by one further down
 * (see byRank). Measured on the shipped 335,626-record index, a lookup costs
 * ~1.9s against a ~0.95s floor for decompressing and splitting lines with no
 * work on top. Parsing every line is inside that floor's noise (~1.1s), which
 * is why there is no substring pre-filter ahead of JSON.parse: every cheap one
 * is either unsound (a raw-text filter
 * drops "I.B.M." for a query of "IBM", because normalization removes the dots
 * that the raw text still has) or, once made sound by normalizing the line
 * first, slower than the parse it was avoiding.
 *
 * A line that does not parse is skipped rather than fatal: a truncated tail is
 * a reason to lose one employer, not to fail the lookup. A source or gunzip
 * failure is fatal and surfaces as INDEX_UNREADABLE.
 *
 * A record without a `filed` field is skipped by the same rule. That is what a
 * line in the pre-release index shape looks like, the one that carried a single
 * `lca` field resolved to the certified count: reading its numbers into the
 * current fields would report an employer's certifications as its filings and
 * every green card only employer as having no evidence. Nothing has to migrate
 * such a file, because the source stamp is the index digest and the digest of a
 * rebuilt index is different, so its cached answers are already invalid.
 */
async function* readRecords(file) {
  const source = createReadStream(file);
  const gunzip = createGunzip();
  // .pipe() does not forward errors, so without this a missing or unreadable
  // file leaves gunzip waiting for an end that never comes and the iterator
  // below hangs instead of failing.
  source.on('error', err => gunzip.destroy(err));
  const rl = createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec && typeof rec === 'object' && typeof rec.n === 'string' && num(rec.filed) !== null) yield rec;
    }
  } catch (err) {
    const e = new Error(`H-1B index unreadable (${file}): ${err && err.message ? err.message : err}`);
    e.code = 'INDEX_UNREADABLE';
    throw e;
  } finally {
    // A caller that breaks out of the loop lands here. Closing the interface
    // alone leaves the file handle open, so tear down the whole chain.
    rl.close();
    gunzip.destroy();
    source.destroy();
  }
}

// Records already read this process. check.mjs resolves a name and then reads
// that employer's profile; without this the second call would scan the same
// file again for a record the first call already had. Keyed by file as well as
// id: a process that reads two different indexes (the test suite does) must not
// answer from the wrong one.
const seen = new Map();
const memoKey = (file, id) => `${file}\u0000${id}`;

function indexFile(opts) {
  return opts.indexPath || indexPath();
}

// The same flat profile lib/api.mjs produces from the HTTP envelope, so
// classifyTier and the CLI's output builder cannot tell the backends apart.
// The index publishes the two filing numbers separately, `filed` and `cert`,
// which is the same pair the API reports as filings.lca and filings.certified;
// the tier reads the first and the report prints both.
function recordToProfile(rec) {
  const nPwd = num(rec.pwd) ?? 0;
  const nPerm = num(rec.perm) ?? 0;
  return {
    n_lca: num(rec.filed) ?? 0,
    // Null, not 0, when the record does not carry it: "not reported" is not
    // "none certified". Every published build carries it.
    n_certified: num(rec.cert) ?? null,
    n_pwd: nPwd,
    n_perm: nPerm,
    // The same belt the HTTP path wears in normalizeProfile: the gc flag, or
    // any GC filing at all. Every published build already satisfies the
    // implication (zero rows carry filings without the flag), so this changes
    // no answer today; it keeps the backends agreeing by construction if the
    // upstream flag ever drifts from the counts it summarizes.
    does_gc: rec.gc === true || nPwd > 0 || nPerm > 0,
    first_year: num(rec.fy),
    last_year: num(rec.ly),
    red_flags: {
      staffing_shop: {
        value: rec.sv === true,
        share: typeof rec.sh === 'number' ? rec.sh : null,
        n_secondary: num(rec.ns),
        // The share's denominator is the filing count, so the index stopped
        // shipping it a second time under its own field: sql/03_populate.sql
        // builds the block as n_secondary / n_lca, and `filed` IS n_lca.
        n_total: num(rec.filed),
        basis: STAFFING_BASIS,
      },
    },
    employer_name: rec.n ?? null,
    employer_id: rec.k ?? null,
  };
}

export async function resolveEmployer(name, opts = {}) {
  const q = String(name || '').trim();
  if (q.length < 2) return null;

  const file = indexFile(opts);
  const target = normalize(q);
  const exact = [];
  const plausible = boundedTop(MAX_CANDIDATES);
  // Read to the end rather than stopping at the first exact name. Distinct
  // employers share a normalized name often (40,635 groups in the shipped
  // index) and the volumes inside a group are not close: stopping at the first
  // one took "Amazon.com Services LLC" at 1 LCA over the 92,132-LCA entity of
  // the same name, and "Bank of America N.A." at 0 over 5,142. The scan has to
  // see every one of them for byRank to pick the same record the API would.
  for await (const rec of readRecords(file)) {
    const isExact = normalize(rec.n) === target;
    if (!isExact && !plausibleMatch(q, rec.n)) continue;
    seen.set(memoKey(file, rec.k), rec);
    // Exact names are kept whole rather than rank-trimmed. There are few of
    // them (58 in the widest group of the shipped index) and one can carry a
    // low filing count, which the plausible pool is right to drop and this one
    // is not: an exact name wins its tier outright in pickBestMatch, so losing
    // it to a volume trim would hand the answer to a merely plausible name.
    if (isExact) exact.push(rec);
    else plausible.push(rec);
  }

  // One list in the order the API publishes its search buckets, so
  // pickBestMatch reaches the same record on both backends: exact normalized
  // name first, else the first plausible one, each now the highest-volume of
  // its kind rather than the alphabetically earliest.
  const candidates = [...exact, ...plausible.drain()].sort(byRank);
  const match = pickBestMatch(q, candidates.map(r => ({ id: String(r.k), name: String(r.n) })));
  if (!match || !match.id) return null;
  return { id: String(match.id), displayName: String(match.name || q) };
}

// Every entity whose name contains the query, not just the best pick, so a
// broad name like "Amazon" surfaces each distinct filing entity (they file
// under separate FEINs and the numbers differ). Substring rather than the
// prefix rule resolveEmployer uses: this is the command someone runs when the
// exact legal name is what they are missing. `total` counts every match so the
// caller can say how much the page is hiding.
export async function searchEmployers(name, opts = {}) {
  const q = String(name || '').trim();
  if (q.length < 2) return { total: 0, results: [] };

  const target = normalize(q);
  const page = boundedTop(SEARCH_PAGE);
  let total = 0;
  for await (const rec of readRecords(indexFile(opts))) {
    if (!normalize(rec.n).includes(target)) continue;
    total++;
    page.push(rec);
  }
  // Same order the endpoint pages in, so the one page a broad query shows holds
  // the entities that actually file rather than the ones that sort first.
  return { total, results: page.drain().map(r => ({ id: String(r.k), name: String(r.n) })) };
}

export async function getEmployerProfile(id, opts = {}) {
  const sanitized = String(id || '').trim();
  if (!sanitized) throw new Error('getEmployerProfile: id is required');

  const file = indexFile(opts);
  const memo = seen.get(memoKey(file, sanitized));
  if (memo) return recordToProfile(memo);

  for await (const rec of readRecords(file)) {
    if (String(rec.k) !== sanitized) continue;
    seen.set(memoKey(file, sanitized), rec);
    return recordToProfile(rec);
  }
  // The HTTP path 404s here and reports the same thing: an id that resolves to
  // no employer is unknown, not an employer with zero filings.
  return null;
}
