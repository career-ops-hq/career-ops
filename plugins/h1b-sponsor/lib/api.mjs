// Thin client for the H-1B sponsorship API.
// Uses global fetch + AbortController. Handles the 429/Retry-After retry-once
// policy specified in the plugin contract. Self-contained: no imports from
// career-ops core (so this plugin can later ship as its own npm package).

const DEFAULT_BASE = 'https://api.surakshith.com/immigration/v1';

/**
 * Where the plugin sends lookups. Defaults to the maintained instance and is
 * overridable with H1B_API_BASE, so a bundled plugin is never a hard
 * dependency on one host: the dataset is public DOL disclosure data and the
 * worker that serves it is open source, so anyone can run their own. Which
 * companies a person checks says both that they need a visa and who they are
 * applying to, and that is theirs to route.
 *
 * Resolved on first use rather than at import. An invalid value must fail the
 * command that needed it, not the act of loading the module: this file is
 * imported by the repo's own test runner, and a throw at import time took the
 * whole suite down with a stack trace instead of one red test.
 *
 * Everything downstream follows this, including the redirect guard in
 * fetchWithTimeout, so pointing at a private instance narrows egress rather
 * than widening it.
 */
let resolvedBase;

export function apiBase() {
  // Only a successful resolve is memoized; a bad value keeps throwing so the
  // failure cannot be masked by an earlier call that happened to succeed.
  if (resolvedBase === undefined) resolvedBase = resolveBase();
  return resolvedBase;
}

function resolveBase() {
  const raw = process.env.H1B_API_BASE;
  // Absent means "use the default". Present but blank is a misconfiguration
  // (an unset shell variable, an empty .env line, a CI secret that did not
  // populate), and silently falling back would send someone's shortlist and
  // their token to a host they believed they had replaced.
  if (raw === undefined) return DEFAULT_BASE;
  const trimmed = String(raw).trim();
  if (!trimmed) {
    throw new Error('H1B_API_BASE is set but empty. Unset it to use the default endpoint.');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`H1B_API_BASE is not a valid URL: ${trimmed}`);
  }
  if (parsed.username || parsed.password) {
    // Undici refuses a credentialed Request anyway, and the value reaches
    // stdout through the source field, so this would print a password.
    throw new Error('H1B_API_BASE must not embed credentials.');
  }
  if (parsed.search || parsed.hash) {
    // Paths are appended, so a query or fragment swallows them: the request
    // would go to the base itself and answer about a company never asked for.
    throw new Error('H1B_API_BASE must not contain a query string or a fragment.');
  }
  // Plain http would put an Authorization header on the wire in the clear.
  // Loopback is exempt so a self-hoster can develop against a local worker,
  // but only for http. Exempting every scheme on a loopback host let
  // ftp://localhost and ws://localhost past validation, and those die later
  // inside fetch as a bare "fetch failed", which is the opaque failure this
  // check exists to replace with a named configuration error.
  const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i.test(parsed.hostname);
  const allowedScheme = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback);
  if (!allowedScheme) {
    throw new Error(`H1B_API_BASE must use https, or http on loopback: ${trimmed}`);
  }
  // Appended as `${base}/employers/...`, so a trailing slash would double up.
  return trimmed.replace(/\/+$/, '');
}
const USER_AGENT = 'career-ops-plugin-h1b-sponsor/1.0';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_WAIT_MS = 10_000;
const MAX_REDIRECTS = 3;
// The largest real employer profile this API serves is about 13 KB and a search
// page is about 4 KB, so a megabyte is ~80x headroom for future growth while
// still refusing to buffer a runaway or hostile body.
const MAX_READ_BYTES = 1024 * 1024;

function buildHeaders(token) {
  const h = { 'Accept': 'application/json', 'User-Agent': USER_AGENT };
  if (typeof token === 'string' && token.trim()) {
    h['Authorization'] = `Bearer ${token.trim()}`;
  }
  return h;
}

function parseRetryAfter(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return 1_000;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return 1_000;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Exported so the mint CLI (token.mjs) sends its POST through the same egress
// guard the read path uses, rather than a bare fetch that would follow a
// redirect off-host with the freshly minted credential in the response.
// maxRedirects: same-host redirects re-issue the request with the SAME method
// and body, which is what a GET wants and what a mint POST must never do
// (each re-POST could spend mint budget again). The mint passes 0.
//
// allowedOrigins names where the request may end up. It defaults to the
// configured API base, so every existing caller keeps the same one-host guard;
// install-h1b-index.mjs passes its own list because a GitHub release download is
// answered by a different host than the one that serves the release metadata,
// and hard-coding apiBase() there would both refuse that hop and drag an
// unrelated H1B_API_BASE misconfiguration into a download that never touches
// the API. Resolved lazily inside the call so a caller that supplies the list
// never reads H1B_API_BASE at all.
//
// consume runs INSIDE the abort-timer window: a server that sends headers and
// then stalls the body would otherwise hang the caller forever, because the
// timer is cleared before the caller could parse. Callers that read the body
// must pass consume; the no-consume form returns the raw Response and is only
// safe when the body is never read.
export async function fetchWithTimeout(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, method = 'GET', body, maxRedirects = MAX_REDIRECTS, allowedOrigins } = {}, consume) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const allowed = (Array.isArray(allowedOrigins) && allowedOrigins.length > 0 ? allowedOrigins : [apiBase()])
    .map(o => new URL(o));
  try {
    // Egress guard: redirects are followed manually so an off-host target is
    // rejected BEFORE the request (and its query string) is issued to it.
    // Letting fetch follow redirects itself would send the request first and
    // only let us notice afterwards.
    let requestUrl = url;
    for (let hop = 0; ; hop++) {
      const res = await fetch(requestUrl, { method, headers, body, signal: controller.signal, redirect: 'manual' });
      if (res.status < 300 || res.status > 399) {
        return consume ? await consume(res) : res;
      }

      const loc = res.headers.get('location');
      // A 3xx without a Location header is not actionable (e.g. 304): hand it
      // back to the caller unchanged.
      if (!loc) return consume ? await consume(res) : res;

      const next = new URL(loc, requestUrl);
      // Host AND scheme must match: an http:// downgrade on the same host
      // would resend the Authorization header in cleartext.
      if (!allowed.some(a => a.host === next.host && a.protocol === next.protocol)) {
        const e = new Error(`H-1B API redirected off-host: ${next.protocol}//${next.host}`);
        e.code = 'REDIRECT_OFF_HOST';
        throw e;
      }
      if (hop >= maxRedirects) {
        const e = new Error(`H-1B API exceeded ${maxRedirects} redirects: ${url}`);
        e.code = 'REDIRECT_LOOP';
        throw e;
      }
      requestUrl = next.href;
    }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Read a response body with a hard byte ceiling.
 *
 * `res.text()` and `res.json()` buffer the whole body first, so a size check
 * after the fact rejects an oversized value but never bounds what was already
 * allocated. This streams instead: it counts bytes as they arrive and cancels
 * the moment the total would exceed `maxBytes`, so peak memory stays bounded no
 * matter what the server sends. A Content-Length that already exceeds the cap
 * short-circuits the read, but the streaming count still runs because that
 * header can be absent or wrong.
 *
 * `maxBytes` is required and inclusive: a body of exactly `maxBytes` comes
 * back, one byte more does not. Returns `{ text }` when the body was read
 * whole, else `{ oversized: true }`, which marks a refused body, covering both
 * one past the ceiling and a chunk that cannot report a usable size, since
 * neither yields text a caller may trust. Read failures (including an
 * AbortError from the caller's timeout) propagate to the caller.
 */
export async function readBoundedText(res, maxBytes) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    // Nothing here will be read, so release the body instead of leaving the
    // connection pinned until garbage collection.
    try { await res.body?.cancel?.(); } catch { /* nothing to release */ }
    return { oversized: true };
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    // Nothing to stream: a 204, or a response shim without a body. Measure the
    // buffered text in BYTES rather than UTF-16 units, because a length check
    // in code units lets a multibyte body past a byte ceiling, which is the
    // defect this function exists to close.
    const text = typeof res.text === 'function' ? await res.text() : '';
    const bytes = new TextEncoder().encode(text).byteLength;
    return bytes > maxBytes ? { oversized: true } : { text };
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const size = Number(value.byteLength);
      // A chunk that cannot report its own size would make the running total
      // NaN, and NaN never trips the ceiling below, so the read would run to
      // completion and hand back a truncated body as if it were whole. Refuse
      // it instead.
      if (!Number.isFinite(size)) {
        await reader.cancel().catch(() => {});
        return { oversized: true };
      }
      total += size;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { oversized: true };
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released by cancel */ }
  }

  // Decode once over the joined bytes. Decoding per chunk would corrupt any
  // multibyte character split across a chunk boundary.
  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  return { text: new TextDecoder('utf-8').decode(joined) };
}

async function requestJson(url, opts, { allow404 } = {}) {
  const token = opts.token;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const headers = buildHeaders(token);

  // Every body read happens inside the fetch timer via consume, so a server
  // that sends headers and then stalls the body times out instead of hanging.
  // What comes back is a plain outcome object, never a live Response.
  const attempt = () => fetchWithTimeout(url, { headers, timeoutMs }, async res => {
    if (res.status === 429) return { kind: 'rate', waitMs: parseRetryAfter(res) };
    if (allow404 && res.status === 404) return { kind: 'missing' };
    if (!res.ok) {
      // An oversized error body is not worth reporting verbatim; the status
      // still tells the caller what happened, so drop the excerpt and continue.
      let text = '';
      try {
        const read = await readBoundedText(res, MAX_READ_BYTES);
        if (!read.oversized) text = read.text;
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
      }
      return { kind: 'http', status: res.status, statusText: res.statusText, text };
    }
    let read;
    try {
      read = await readBoundedText(res, MAX_READ_BYTES);
    } catch (err) {
      // A stalled body aborts on the shared timer and has to surface as the
      // timeout it is. Every other stream failure leaves an unusable body: a
      // reset or truncated response arrives as TypeError: terminated, and the
      // buffered res.json() this replaced reported exactly that case as
      // unparseable rather than letting a raw transport error escape.
      if (err && err.name === 'AbortError') throw err;
      return { kind: 'badjson' };
    }
    if (read.oversized) return { kind: 'toobig' };
    try {
      return { kind: 'json', body: JSON.parse(read.text) };
    } catch {
      return { kind: 'badjson' };
    }
  });

  const timeoutError = (label) => {
    const e = new Error(`H-1B API timeout${label} after ${timeoutMs}ms: ${url}`);
    e.code = 'TIMEOUT';
    return e;
  };

  let out;
  try {
    out = await attempt();
  } catch (err) {
    if (err && err.name === 'AbortError') throw timeoutError('');
    throw err;
  }

  if (out.kind === 'rate') {
    await sleep(Math.min(out.waitMs, MAX_RETRY_WAIT_MS));
    try {
      out = await attempt();
    } catch (err) {
      if (err && err.name === 'AbortError') throw timeoutError(' on retry');
      throw err;
    }
    if (out.kind === 'rate') {
      const e = new Error(`H-1B API rate limited: ${url}`);
      e.code = 'RATE_LIMIT';
      throw e;
    }
  }

  if (out.kind === 'missing') return null;

  if (out.kind === 'toobig') {
    const e = new Error(`H-1B API response exceeded ${MAX_READ_BYTES} bytes: ${url}`);
    e.code = 'BODY_TOO_LARGE';
    throw e;
  }

  if (out.kind === 'http') {
    const e = new Error(`H-1B API ${out.status} ${out.statusText}: ${url}${out.text ? ` -- ${out.text.slice(0, 200)}` : ''}`);
    e.code = 'HTTP_ERROR';
    e.status = out.status;
    throw e;
  }

  if (out.kind === 'badjson') {
    const e = new Error(`H-1B API returned non-JSON body: ${url}`);
    e.code = 'BAD_JSON';
    throw e;
  }

  return out.body;
}

// normalize, plausibleMatch and pickBestMatch are exported for lib/index.mjs,
// which resolves the same names against the local index. A second copy of these
// rules would drift, and they are the thing that stops "Meta" resolving to
// "Metabolic Diagnostics Inc", so the local backend imports them rather than
// reimplementing them, and a fix lands once for both.
export function normalize(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Long legal-form words folded to their short form, so "corporation" and
// "corp" become one token. Deleting the suffix instead was wrong: it collapsed
// "Acme LLC" and "Acme Inc" to a bare "acme" and matched two distinct entities.
// Canonicalizing keeps the form as a token, so different forms (llc vs inc)
// stay different while a single form's long and short spellings unify, which is
// exactly what the maintainer asked for (fold corp/corporation, nothing more).
const SUFFIX_CANON = new Map([
  ['corporation', 'corp'],
  ['incorporated', 'inc'],
  ['limited', 'ltd'],
  ['company', 'co'],
]);

// Guard against the search endpoint's nearest-neighbour behavior: it returns
// its closest hit even for garbage input. A fallback (non-exact) match is
// accepted only when one name's token list is a prefix of the other's, token
// for token: "IBM" matches "IBM Corporation", and "Microsoft Corporation"
// matches "Microsoft", but "Meta" does not match "Metabolic Diagnostics Inc"
// (substring tests did, which cached a confidently wrong employer for 90
// days). No plausible candidate -> no match, and the CLI reports unknown.
export function plausibleMatch(query, candidateName) {
  // Normalize both names, then compare token for token, one list against the
  // start of the other. A leading "the" is dropped ("Home Depot" must match
  // "The Home Depot"). A trailing long-form legal word is folded to its short
  // form, so "Acme Corp" matches "Acme Corporation" (the JD spells the short
  // form where DOL records the long one, and that miss used to stick in the
  // 30-day negative cache). Folding rather than deleting keeps the form as a
  // token, so "Apple Inc" does not swallow "Apple Bank" and "Acme LLC" stays
  // distinct from "Acme Inc"; the exact-normalized check in pickBestMatch still
  // catches two identical names first.
  const tokens = s => {
    const t = String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    // A dotted or spaced initialism arrives as a run of one-letter tokens
    // ("I.B.M." splits to i, b, m) while the filer spells it joined ("IBM
    // Corporation"), so a run of two or more one-letter tokens folds into
    // one. A lone one-letter token stays as it is: "Meta 4 LLC" keeps its 4
    // and "AT&T" its trailing t, so the fold unifies initialisms without
    // loosening anything else.
    const merged = [];
    for (let i = 0; i < t.length; i++) {
      let j = i;
      while (t[j].length === 1 && j + 1 < t.length && t[j + 1].length === 1) j++;
      if (j > i) { merged.push(t.slice(i, j + 1).join('')); i = j; } else { merged.push(t[i]); }
    }
    const out = merged[0] === 'the' ? merged.slice(1) : merged.slice();
    if (out.length > 0) {
      const canon = SUFFIX_CANON.get(out[out.length - 1]);
      if (canon) out[out.length - 1] = canon;
    }
    return out;
  };
  const q = tokens(query);
  const c = tokens(candidateName);
  if (q.length === 0 || c.length === 0) return false;
  const isPrefix = (shorter, longer) =>
    shorter.length <= longer.length && shorter.every((t, i) => t === longer[i]);
  return isPrefix(q, c) || isPrefix(c, q);
}

export function pickBestMatch(name, results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const target = normalize(name);
  // 1. Exact normalized match.
  const exact = results.find(r => r && normalize(r.name) === target);
  if (exact) return exact;
  // 2. First PLAUSIBLE result, wherever it sits in the list. This used to look
  // at results[0] alone and lean on the search endpoint having ranked the page
  // for us. The local index has no ranking to lean on, since its candidates
  // come out in file order, so a rank-dependent rule would resolve a name over
  // HTTP and fail to resolve the same name locally. plausibleMatch is what
  // keeps this honest: an implausible candidate is still refused no matter
  // where it sits.
  const plausible = results.find(r => r && plausibleMatch(name, r.name));
  if (plausible) return plausible;
  return null;
}

export async function resolveEmployer(name, opts = {}) {
  const q = String(name || '').trim();
  if (q.length < 2) return null;

  const url = `${apiBase()}/employers/search?q=${encodeURIComponent(q)}`;
  const body = await requestJson(url, opts, { allow404: true });
  if (!body) return null;

  const results = Array.isArray(body.results) ? body.results : [];
  const match = pickBestMatch(q, results);
  if (!match || !match.id) return null;

  return { id: String(match.id), displayName: String(match.name || q) };
}

// Every matching employer the API returns, not just the best pick, so a broad
// name like "Amazon" surfaces each distinct filing entity (they file under
// separate FEINs and the numbers differ). Returns { total, results }; total is
// the API's full count, which can exceed the page the endpoint returns, so the
// caller can tell the user to narrow the query. [] results on no match or a
// soft failure.
export async function searchEmployers(name, opts = {}) {
  const q = String(name || '').trim();
  if (q.length < 2) return { total: 0, results: [] };

  const url = `${apiBase()}/employers/search?q=${encodeURIComponent(q)}`;
  const body = await requestJson(url, opts, { allow404: true });
  if (!body || !Array.isArray(body.results)) return { total: 0, results: [] };

  const results = body.results
    .filter(r => r && r.id)
    .map(r => ({ id: String(r.id), name: String(r.name || '') }));
  const total = Number.isFinite(body.total) ? body.total : results.length;
  return { total, results };
}

// Number(null) === 0 and Number(' ') === 0, so a null or blank field would
// otherwise look like a real zero. Exported for the same reason as the matchers
// above: lib/index.mjs builds the identical profile shape from index records,
// and null-vs-zero is exactly the distinction a second copy would get wrong.
export function num(v) {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Normalizes the nested API envelope into the flat shape that tier.mjs and
// check.mjs expect. Missing fields stay null / 0 -- never invented.
function normalizeProfile(raw) {
  if (raw == null || typeof raw !== 'object') return raw;
  const employer = (raw.employer && typeof raw.employer === 'object') ? raw.employer : {};
  const years = (raw.years && typeof raw.years === 'object') ? raw.years : {};
  const filings = (raw.filings && typeof raw.filings === 'object') ? raw.filings : {};
  const gc = (raw.green_card && typeof raw.green_card === 'object') ? raw.green_card : {};
  const redFlagsRaw = (raw.red_flags && typeof raw.red_flags === 'object') ? raw.red_flags : {};
  const staffing = (redFlagsRaw.staffing_shop && typeof redFlagsRaw.staffing_shop === 'object')
    ? redFlagsRaw.staffing_shop
    : null;

  const nPwd = num(gc.pwd);
  const nPerm = num(gc.perm);
  const evidence = gc.evidence;
  // does_gc: true when the API reports green-card evidence 'present', or when
  // any GC filings exist (pwd/perm > 0). Anything else is false, not null,
  // because tier.mjs compares strictly against `=== true`.
  const doesGc = evidence === 'present'
    || (nPwd !== null && nPwd > 0)
    || (nPerm !== null && nPerm > 0);

  // A missing/null year stays null: it must never collapse to year 0.
  const firstYear = num(years.first);
  const lastYear = num(years.last);

  // LCA volume is a separate track from the green_card block (an employer can
  // be LCA-active with zero GC filings). The count is the RAW filing total:
  // filing an LCA is the employer's own act of willingness to sponsor, which
  // is the question being asked here. Whether a given filing was certified is
  // USCIS's decision, and a withdrawal is usually the candidate taking another
  // offer or a cancelled req, so neither says this employer will not sponsor.
  // Preferring `certified`, which is what this used to do, reported 3,777
  // employers in the 2026Q2 data as tier `none` (the phrase the skill prints
  // for "the DOL data shows nothing") despite their having filed.
  //
  // certified stays as the fallback so a payload from an API old enough to
  // omit `lca` still answers. The fallback runs on null, never on 0, so a real
  // zero is not masked the way `Number(null) === 0` did.
  const nCertified = num(filings.certified);
  const nLcaTotal = num(filings.lca);
  const nLca = nLcaTotal ?? nCertified ?? 0;

  return {
    n_lca: nLca ?? 0,
    // The outcome, carried through for display beside the filing count. Null
    // rather than 0 when the payload does not report it: "not reported" and
    // "reported as none certified" are different statements, and the skill
    // prints them differently.
    n_certified: nCertified ?? null,
    n_pwd: nPwd ?? 0,
    n_perm: nPerm ?? 0,
    does_gc: doesGc === true,
    first_year: firstYear,
    last_year: lastYear,
    red_flags: {
      staffing_shop: staffing
        ? {
            value: staffing.value === true,
            share: typeof staffing.share === 'number' ? staffing.share : null,
            n_secondary: staffing.n_secondary ?? null,
            n_total: staffing.n_total ?? null,
            basis: staffing.basis ?? null,
          }
        : null,
    },
    employer_name: employer.name ?? null,
    employer_id: employer.id ?? employer.ein ?? null,
  };
}

export async function getEmployerProfile(id, opts = {}) {
  const sanitized = String(id || '').trim();
  if (!sanitized) throw new Error('getEmployerProfile: id is required');
  const url = `${apiBase()}/employers/${encodeURIComponent(sanitized)}`;
  const raw = await requestJson(url, opts, { allow404: false });
  return normalizeProfile(raw);
}
