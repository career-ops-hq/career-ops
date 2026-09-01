// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// MokaHR (Moka, 国内 HR SaaS/ATS) careers provider. No official third-party
// developer API — this reverse-engineers the tenant careers-site frontend's
// own private endpoint. Verified 2026-08 live against three real tenants:
// DeepSeek ("high-flyer"/140576), Moonshot AI ("moonshot"/148506), and Zhipu
// AI ("zphz"/148983) — all three sharing the exact same request/response
// shape and the same AES IV (see below), so one provider covers all of them
// (and any future tenant on the same platform) via portals.yml config alone.
//
//   POST /api/outer/ats-apply/website/jobs/v2
//   { "siteId": <int>, "orgId": "<slug>", "locale": "zh-CN",
//     "limit": <=50, "offset": N }
//   → { "data": "<base64 AES-128-CBC ciphertext>", "necromancer": "<16-byte hex key>" }
//
// The response body is ENCRYPTED, not plain JSON — this is the one thing
// that makes this provider unlike every other provider in this directory.
// Decryption (verified live, Node's built-in crypto, no new dependency):
//   key = Buffer.from(necromancer, 'utf8')        // 16 bytes, changes per request
//   iv  = Buffer.from('de7c21ed8d6f50fe', 'utf8')  // fixed, see IV note below
//   aes-128-cbc decrypt + PKCS7 unpad → JSON: { code, data: { jobs: [...] }, success }
//
// IV note: the IV is technically exposed per-tenant via each tenant's HTML
// (`<input id="init-data" ... value="{...,"aesIv":"..."}">`), but all three
// tenants checked returned the IDENTICAL value — de7c21ed8d6f50fe. Hardcoded
// here rather than fetched per-run to avoid a second request per tenant (the
// HTML page is also gated behind an aliyun WAF cookie challenge — see next
// paragraph — so skipping it is a real cost saving, not just convenience).
// If a future tenant 400/decrypt-fails, that tenant likely has a different
// IV; the fix is a per-tenant iv override in portals.yml, not a rewrite.
//
// Quirks (all verified live):
//   - The tenant HTML page (e.g. app.mokahr.com/social-recruitment/{org}/{id})
//     sits behind an Aliyun WAF challenge: the FIRST request returns a
//     2-byte body and an `acw_tc` Set-Cookie; only a SECOND request that
//     replays that cookie gets real content. This provider never needs the
//     HTML page at all (see IV note above) — it goes straight to the JSON
//     API, which is NOT behind this challenge and answers on the first try
//     with no cookie required (verified live, zero-cookie fetchJson calls
//     succeed).
//   - `limit` has a hard server-side ceiling of 50 — 51+ is rejected with
//     `{code:102, success:false, msg:"参数错误。{0}"}` (verified: 50 succeeds,
//     60/70/80/90 all fail identically). This provider always requests 50.
//   - `page`/`pageSize` params (used by the tenant's OWN frontend for a
//     different, non-paginating code path) are SILENTLY IGNORED by this
//     endpoint — passing them returns the same first N jobs regardless of
//     page number (verified: page=1 and page=2 returned byte-identical job
//     lists). The real pagination params are `limit`/`offset`, found by
//     reverse-engineering the tenant frontend's JS bundle
//     (`getJobsListPaging` call site) — do not "simplify" this back to
//     page/pageSize, it silently breaks pagination without erroring.
//   - There is no reliable total-count field: `data.jobStats.total` stays 0
//     even when jobs are clearly present and paginating correctly (verified
//     across all three tenants) — it is not wired to job count. Pagination
//     therefore stops the same way meituan.mjs does: when a page returns fewer
//     jobs than requested, not via a total field.
//   - The list payload's `jobDescription` field already carries the full JD
//     as HTML — no per-job detail request needed (same idiom as
//     alibaba/tencent/meituan/feishu-jobs).
//
// portals.yml entry example (one entry per tenant — this provider does not
// enumerate tenants on its own):
//   - name: DeepSeek
//     careers_url: https://app.mokahr.com/social-recruitment/high-flyer/140576
//     keywords: ["AI", "大模型", "Agent"]
//
//   - name: 月之暗面
//     careers_url: https://app.mokahr.com/apply/moonshot/148506
//     keywords: ["AI", "大模型", "Agent"]
//
//   - name: 智谱AI
//     careers_url: https://app.mokahr.com/social-recruitment/zphz/148983
//     keywords: ["AI", "大模型", "Agent"]

import { createDecipheriv } from 'crypto';
import { htmlToText } from './_html-to-text.mjs';

const API = 'https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2';
const DETAIL_HOST = 'app.mokahr.com';
// See "IV note" above — identical across every tenant checked live.
const AES_IV = Buffer.from('de7c21ed8d6f50fe', 'utf8');
const MAX_LIMIT = 50; // hard server-side ceiling — see "Quirks" above
const DEFAULT_KEYWORDS = ['']; // empty keyword = whole board, no topical bias
const DEFAULT_MAX_PAGES = 10;  // 10 * MAX_LIMIT = 500 postings/keyword ceiling
// Every request after the first pays it (same idiom as avature/workday/alibaba).
const INTER_PAGE_DELAY_MS = 400;

// `careers_url` in portals.yml is a human-navigable tenant URL — either
// `/social-recruitment/{orgId}/{siteId}`, `/campus-recruitment/{orgId}/{siteId}`,
// or `/apply/{orgId}/{siteId}` (all three path prefixes seen live across
// tenants). Only orgId + siteId are load-bearing for the API; the prefix is
// cosmetic and ignored here.
const TENANT_PATH_RE = /^\/(?:social-recruitment|campus-recruitment|apply)\/([^/]+)\/(\d+)\/?$/;
// Exact paths excluded by app.mokahr.com/robots.txt (checked 2026-08-26).
// Keep this pathname-scoped: robots.txt does not exclude other routes.
const ROBOTS_EXCLUDED_PATHS = new Set([
  '/social-recruitment/lingjuninvest/46355',
  '/social-recruitment/shopee/74378',
]);

/**
 * @param {string} url
 * @returns {{ orgId: string, siteId: number, baseUrl: string } | null}
 */
function parseTenantUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== DETAIL_HOST) return null;
  const m = TENANT_PATH_RE.exec(u.pathname);
  if (!m) return null;
  const siteId = Number(m[2]);
  if (!Number.isSafeInteger(siteId) || siteId <= 0) return null;
  const pathname = u.pathname.replace(/\/$/, '');
  if (ROBOTS_EXCLUDED_PATHS.has(pathname)) return null;
  return { orgId: m[1], siteId, baseUrl: `${u.origin}${pathname}` };
}

/**
 * Decrypt one `{data, necromancer}` envelope into the plaintext response.
 * Exported for tests — deliberately separate from the HTTP call so tests
 * never need a real network round-trip to exercise the crypto.
 * @param {{ data?: string, necromancer?: string }} envelope
 * @returns {any}
 */
export function decryptMokaHrEnvelope(envelope) {
  if (!envelope?.data || !envelope?.necromancer) {
    throw new Error('mokahr: response missing data/necromancer — not the expected envelope shape');
  }
  const key = Buffer.from(envelope.necromancer, 'utf8');
  if (key.length !== 16) {
    throw new Error(`mokahr: necromancer key is ${key.length} bytes, expected 16 (aes-128-cbc)`);
  }
  const ciphertext = Buffer.from(envelope.data, 'base64');
  const decipher = createDecipheriv('aes-128-cbc', key, AES_IV);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

/**
 * @param {any} decrypted - Already-decrypted response body.
 * @param {string} companyName
 * @param {string} tenantBaseUrl - Validated tenant careers URL without a trailing slash.
 * @returns {import('./_types.js').Job[]}
 */
export function parseMokaHrJobs(decrypted, companyName, tenantBaseUrl) {
  const list = decrypted?.data?.jobs;
  if (!Array.isArray(list)) return [];

  const jobs = [];
  for (const j of list) {
    const title = j?.title;
    const id = j?.id;
    if (!title || id == null) continue;
    const encodedId = encodeURIComponent(String(id));
    // locations[].cityName is DISTRICT-level ("海淀区", "拱墅区"), not the
    // city/province — a plain cityName join produces a location string with
    // no "北京"/"China" substring at all, which portals.yml's location_filter
    // (allow-list matches on province/country names) then silently drops the
    // whole posting on. provinceName ("北京市", "浙江") is what carries that
    // signal — pair each district with its province so the filter has
    // something to match (verified live against all three tenants: every
    // location record here does carry provinceName).
    const cities = Array.isArray(j.locations)
      ? j.locations
        .map((l) => [l?.provinceName, l?.cityName].filter(Boolean).join(' '))
        .filter(Boolean)
        .join('/')
      : '';
    // Moka sometimes omits the timezone. Date.parse() would then interpret the
    // same value differently on every machine, so only publish deterministic
    // timestamps that carry an explicit Z or numeric offset.
    const createdAt = typeof j.createdAt === 'string' ? j.createdAt.trim() : '';
    const ts = /(?:Z|[+-]\d{2}:\d{2})$/i.test(createdAt) ? Date.parse(createdAt) : NaN;
    jobs.push({
      title,
      // The tenant frontend links each posting through its hash router. The
      // scanner/tracker normalizers recognize this exact Moka route and promote
      // its ID into their internal comparison keys before dropping the fragment.
      url: `${tenantBaseUrl}#/job/${encodedId}`,
      company: companyName,
      location: cities,
      description: [
        j.commitment && `类型: ${j.commitment}`,
        j.department?.name && `部门: ${j.department.name}`,
        htmlToText(j.jobDescription),
      ].filter(Boolean).join('\n').slice(0, 4000),
      postedAt: Number.isFinite(ts) ? ts : undefined,
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'mokahr',

  detect(entry) {
    const url = entry.careers_url;
    if (typeof url !== 'string') return null;
    if (!parseTenantUrl(url)) return null;
    return { url };
  },

  async fetch(entry, ctx) {
    const tenant = parseTenantUrl(entry.careers_url);
    if (!tenant) {
      throw new Error('mokahr: careers_url must be an allowed HTTPS app.mokahr.com tenant URL with a positive site ID');
    }

    const keywords = Array.isArray(entry.keywords) && entry.keywords.length
      ? entry.keywords
      : DEFAULT_KEYWORDS;
    const entryMaxPages = Number(entry.max_pages) > 0 ? Number(entry.max_pages) : DEFAULT_MAX_PAGES;
    const maxPages = Math.min(entryMaxPages, Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity);

    /** @type {Map<string, import('./_types.js').Job>} */
    const seen = new Map();
    const sleep = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    let firstRequest = true;
    let succeededOnce = false;

    for (const keyword of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        if (firstRequest) firstRequest = false;
        else await sleep(INTER_PAGE_DELAY_MS);
        const offset = (page - 1) * MAX_LIMIT;

        let envelope;
        try {
          envelope = /** @type {any} */ (await ctx.fetchJson(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              siteId: tenant.siteId,
              orgId: tenant.orgId,
              locale: 'zh-CN',
              limit: MAX_LIMIT,
              offset,
              ...(keyword ? { keyword } : {}),
            }),
            redirect: 'error',
          }));
        } catch (err) {
          if (!succeededOnce) throw err;
          console.error(`  ⚠ mokahr: keyword "${keyword}" page ${page} failed (${err.message}) — keeping the ${seen.size} jobs collected so far`);
          return [...seen.values()];
        }

        let decrypted;
        try {
          decrypted = decryptMokaHrEnvelope(envelope);
          if (decrypted?.success === false) {
            throw new Error(`API error: ${decrypted.msg || decrypted.code || 'success=false'}`);
          }
        } catch (err) {
          if (!succeededOnce) throw err;
          console.error(`  ⚠ mokahr: keyword "${keyword}" page ${page} failed (${err.message}) — keeping the ${seen.size} jobs collected so far`);
          return [...seen.values()];
        }

        succeededOnce = true;
        const rawJobs = Array.isArray(decrypted?.data?.jobs) ? decrypted.data.jobs : [];
        if (rawJobs.length === 0) break;
        const jobs = parseMokaHrJobs(decrypted, entry.name || tenant.orgId, tenant.baseUrl);

        for (const job of jobs) {
          if (!seen.has(job.url)) seen.set(job.url, job);
        }

        // Stop on the raw API page length, not the normalized job count: the
        // parser may drop one malformed row from an otherwise-full page, which
        // must not hide every later page.
        if (rawJobs.length < MAX_LIMIT) break;
      }
    }

    return [...seen.values()];
  },
};
