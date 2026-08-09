// Thin client for api.surakshith.com/immigration/v1.
// Uses global fetch + AbortController. Handles the 429/Retry-After retry-once
// policy specified in the plugin contract. Self-contained — no imports from
// career-ops core (so this plugin can later ship as its own npm package).

export const BASE = 'https://api.surakshith.com/immigration/v1';
const USER_AGENT = 'career-ops-plugin-h1b-sponsor/1.0';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_WAIT_MS = 10_000;
const MAX_REDIRECTS = 3;

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

async function fetchWithTimeout(url, headers, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const baseHost = new URL(BASE).host;
  try {
    // Egress guard: redirects are followed manually so an off-host target is
    // rejected BEFORE the request (and its query string) is issued to it.
    // Letting fetch follow redirects itself would send the request first and
    // only let us notice afterwards.
    let requestUrl = url;
    for (let hop = 0; ; hop++) {
      const res = await fetch(requestUrl, { headers, signal: controller.signal, redirect: 'manual' });
      if (res.status < 300 || res.status > 399) return res;

      const loc = res.headers.get('location');
      // A 3xx without a Location header is not actionable (e.g. 304) — hand it
      // back to the caller unchanged.
      if (!loc) return res;

      const next = new URL(loc, requestUrl);
      // Host AND scheme must match: an http:// downgrade on the same host
      // would resend the Authorization header in cleartext.
      if (next.host !== baseHost || next.protocol !== new URL(BASE).protocol) {
        const e = new Error(`H-1B API redirected off-host: ${next.protocol}//${next.host}`);
        e.code = 'REDIRECT_OFF_HOST';
        throw e;
      }
      if (hop >= MAX_REDIRECTS) {
        const e = new Error(`H-1B API exceeded ${MAX_REDIRECTS} redirects: ${url}`);
        e.code = 'REDIRECT_LOOP';
        throw e;
      }
      requestUrl = next.href;
    }
  } finally {
    clearTimeout(t);
  }
}

async function requestJson(url, opts, { allow404 } = {}) {
  const token = opts.token;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const headers = buildHeaders(token);

  let res;
  try {
    res = await fetchWithTimeout(url, headers, timeoutMs);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const e = new Error(`H-1B API timeout after ${timeoutMs}ms: ${url}`);
      e.code = 'TIMEOUT';
      throw e;
    }
    throw err;
  }

  if (res.status === 429) {
    const waitMs = Math.min(parseRetryAfter(res), MAX_RETRY_WAIT_MS);
    await sleep(waitMs);
    try {
      res = await fetchWithTimeout(url, headers, timeoutMs);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const e = new Error(`H-1B API timeout on retry after ${timeoutMs}ms: ${url}`);
        e.code = 'TIMEOUT';
        throw e;
      }
      throw err;
    }
    if (res.status === 429) {
      const e = new Error(`H-1B API rate limited: ${url}`);
      e.code = 'RATE_LIMIT';
      throw e;
    }
  }

  if (allow404 && res.status === 404) return null;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`H-1B API ${res.status} ${res.statusText}: ${url}${body ? ` -- ${body.slice(0, 200)}` : ''}`);
    e.code = 'HTTP_ERROR';
    e.status = res.status;
    throw e;
  }

  try {
    return await res.json();
  } catch (err) {
    const e = new Error(`H-1B API returned non-JSON body: ${url}`);
    e.code = 'BAD_JSON';
    throw e;
  }
}

function normalize(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Guard against the search endpoint's nearest-neighbour behavior: it returns
// its closest hit even for garbage input. A fallback (non-exact) match is
// accepted only when one name's token list is a prefix of the other's, token
// for token: "IBM" matches "IBM Corporation", and "Microsoft Corporation"
// matches "Microsoft", but "Meta" does not match "Metabolic Diagnostics Inc"
// (substring tests did, which cached a confidently wrong employer for 90
// days). No plausible candidate -> no match, and the CLI reports unknown.
function plausibleMatch(query, candidateName) {
  // A leading "the" is brand styling, not identity ("Home Depot" must match
  // "The Home Depot Inc"), so it never participates in the prefix test.
  const tokens = s => {
    const t = String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return t[0] === 'the' ? t.slice(1) : t;
  };
  const q = tokens(query);
  const c = tokens(candidateName);
  if (q.length === 0 || c.length === 0) return false;
  const isPrefix = (shorter, longer) =>
    shorter.length <= longer.length && shorter.every((t, i) => t === longer[i]);
  return isPrefix(q, c) || isPrefix(c, q);
}

function pickBestMatch(name, results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const target = normalize(name);
  // 1. Exact normalized match.
  const exact = results.find(r => r && normalize(r.name) === target);
  if (exact) return exact;
  // 2. First result (API already ranks) — but only if it plausibly matches.
  const first = results[0];
  if (first && plausibleMatch(name, first.name)) return first;
  return null;
}

export async function resolveEmployer(name, opts = {}) {
  const q = String(name || '').trim();
  if (q.length < 2) return null;

  const url = `${BASE}/employers/search?q=${encodeURIComponent(q)}`;
  const body = await requestJson(url, opts, { allow404: true });
  if (!body) return null;

  const results = Array.isArray(body.results) ? body.results : [];
  const match = pickBestMatch(q, results);
  if (!match || !match.id) return null;

  return { id: String(match.id), displayName: String(match.name || q) };
}

// Number(null) === 0 and Number(' ') === 0, so a null or blank field would
// otherwise look like a real zero.
function num(v) {
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

  // A missing/null year stays null — it must never collapse to year 0.
  const firstYear = num(years.first);
  const lastYear = num(years.last);

  // LCA volume is a separate track from the green_card block (an employer can
  // be LCA-active with zero GC filings). Prefer the certified count — that is
  // what the Block G bullet reports — falling back to the total filing count.
  // The fallback runs on null, so a null `certified` no longer masks a real
  // `lca` total the way `Number(null) === 0` did.
  const nCertified = num(filings.certified);
  const nLcaTotal = num(filings.lca);
  const nLca = nCertified ?? nLcaTotal ?? 0;

  return {
    n_lca: nLca ?? 0,
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
  const url = `${BASE}/employers/${encodeURIComponent(sanitized)}`;
  const raw = await requestJson(url, opts, { allow404: false });
  return normalizeProfile(raw);
}
