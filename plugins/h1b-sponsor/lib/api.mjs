// Thin client for api.surakshith.com/immigration/v1.
// Uses global fetch + AbortController. Handles the 429/Retry-After retry-once
// policy specified in the plugin contract. Self-contained — no imports from
// career-ops core (so this plugin can later ship as its own npm package).

export const BASE = 'https://api.surakshith.com/immigration/v1';
const USER_AGENT = 'career-ops-plugin-h1b-sponsor/1.0';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_WAIT_MS = 10_000;

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
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    // Egress guard: global fetch follows redirects by default, so a
    // compromised or misconfigured server could bounce the request (and its
    // query string) to another host. Refuse any response that ended up
    // off-host rather than trusting it.
    if (res.url && new URL(res.url).host !== new URL(BASE).host) {
      const e = new Error(`H-1B API redirected off-host: ${new URL(res.url).host}`);
      e.code = 'REDIRECT_OFF_HOST';
      throw e;
    }
    return res;
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
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

// Guard against the search endpoint's nearest-neighbour behavior: it returns
// its closest hit even for garbage input, so a fallback (non-exact) match must
// either contain the whole normalized query (or vice versa — covers short
// names like "IBM" -> "IBM Corporation") or share at least one meaningful
// token (>= 4 chars) with it. Otherwise we report no match rather than a
// confidently wrong employer.
function plausibleMatch(query, candidateName) {
  const nq = normalize(query);
  const nc = normalize(candidateName);
  if (!nq || !nc) return false;
  if (nc.includes(nq) || nq.includes(nc)) return true;
  const tokens = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4);
  const cand = new Set(tokens(candidateName));
  return tokens(query).some(t => cand.has(t));
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

// Normalizes the nested API envelope into the flat shape that tier.mjs and
// check.mjs expect. Keeps the untouched upstream payload under _raw so no
// data is thrown away. Missing fields stay null / 0 -- never invented.
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

  const nPwd = Number(gc.pwd);
  const nPerm = Number(gc.perm);
  const evidence = gc.evidence;
  // does_gc: true when the API reports green-card evidence 'present', or when
  // any GC filings exist (pwd/perm > 0). Anything else is false, not null,
  // because tier.mjs compares strictly against `=== true`.
  const doesGc = evidence === 'present'
    || (Number.isFinite(nPwd) && nPwd > 0)
    || (Number.isFinite(nPerm) && nPerm > 0);

  const firstYear = Number.isFinite(Number(years.first)) ? Number(years.first) : null;
  const lastYear = Number.isFinite(Number(years.last)) ? Number(years.last) : null;

  // LCA volume is a separate track from the green_card block (an employer can
  // be LCA-active with zero GC filings). Prefer the certified count — that is
  // what the Block G bullet reports — falling back to the total filing count.
  const nCertified = Number(filings.certified);
  const nLcaTotal = Number(filings.lca);
  const nLca = Number.isFinite(nCertified) ? nCertified : (Number.isFinite(nLcaTotal) ? nLcaTotal : 0);

  return {
    n_lca: nLca,
    n_pwd: Number.isFinite(nPwd) ? nPwd : 0,
    n_perm: Number.isFinite(nPerm) ? nPerm : 0,
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
    _raw: raw,
  };
}

export async function getEmployerProfile(id, opts = {}) {
  const sanitized = String(id || '').trim();
  if (!sanitized) throw new Error('getEmployerProfile: id is required');
  const url = `${BASE}/employers/${encodeURIComponent(sanitized)}`;
  const raw = await requestJson(url, opts, { allow404: false });
  return normalizeProfile(raw);
}
