#!/usr/bin/env node
/**
 * harvest-buildlist.mjs — BuildList (buildlist.xyz) → ATS boards you can track
 *
 * BuildList is an index of startups "building the future" (AI, robotics, space,
 * defense, bio, energy), about 820 companies. It is NOT a job board in its own
 * right: every "Apply" link on the site points straight at the company's own
 * ATS (Ashby, Greenhouse, Lever, Rippling, ...), which is exactly the surface
 * `scan.mjs` already reads at zero token cost.
 *
 * So BuildList's value here is its COMPANY LIST, not its job feed. Wiring it in
 * as a `job_boards:` provider would mean crawling paginated HTML to rediscover
 * postings we can already pull from the source ATS — slower, more fragile, and
 * rude. Instead this script harvests the company roster once and resolves each
 * company to its real ATS board. After that the companies are the user's:
 * scanning no longer touches BuildList at all.
 *
 * ONE OUTPUT: tracked_companies ENTRIES
 * The output is portals.yml `tracked_companies:` entries for every resolved
 * board, with no job-count test. That test (discover-ats.mjs admits a board
 * only if it lists a job today) is right when a slug was GUESSED, since an
 * empty board is then indistinguishable from a wrong guess. Here the board is
 * read off the page, so it is known-good and the job count is only today's
 * weather; tracked_companies is a standing watch whose purpose is catching a
 * role the day it opens, and title_filter does the per-scan filtering.
 *
 * Handing the list to discover-ats instead would lose the board: it probes a
 * slug on every vendor in turn and keeps the first that answers, so a Lever
 * board named `initech` could come back as another company's Greenhouse
 * board of the same name.
 *
 * READING THE BOARD OFF THE PAGE
 * BuildList's own URL slug is frequently NOT the ATS board id — `altos-labs` is
 * Greenhouse `altoslabs`, `altana` is `altanaai`, `agility-robotics` is a
 * Greenhouse embed. Feeding guessed slugs to discover-ats resolved 6 of 20 in
 * testing. Each link on the page is read back to its board by parseBoardUrl
 * (seeds/employers-import.mjs), the reverse of the builders in
 * lib/ats-board-url.mjs that discover-ats and the employer registry use, so a
 * board found here is in exactly the canonical form the rest of career-ops
 * uses: EU Greenhouse and Lever boards keep their region, Ashby ids keep their
 * case, Workday boards keep their three coordinates. Gem, iCIMS, Personio and
 * Teamtailor, which scan.mjs reads but the registry does not cover, are read by
 * a small table below.
 *
 * ROBOTS AND POLITENESS
 * buildlist.xyz/robots.txt is `Allow: /` with `Disallow: /api/` for every
 * user-agent. This script reads ONLY the public sitemap and public company
 * pages, never the JSON API behind them. It runs on the user's machine, but it
 * reads a whole site, so it keeps to the pace the Source Indexing Policy sets
 * for the project's own indexing layer (CONTRIBUTING.md, rule 6): one request
 * at a time, at least a second apart, longer when robots.txt states a
 * Crawl-delay, and a Retry-After is honoured (fetchTextWithRetry). Every
 * request is also checked against the live robots.txt first (robots-check.mjs
 * robotsAllows, read once per run, fail closed), so a policy change on
 * BuildList's side stops the harvest rather than being ignored. A run fetches
 * at most MAX_COMPANIES pages; a full harvest of today's roster takes about
 * 15 minutes, and --resume continues one that was interrupted.
 *
 * SCOPE AND TRUST
 * Preview/handoff only. This script NEVER writes portals.yml — it writes its own
 * output file for the user to review and paste. Page text is untrusted external
 * content, and the output is pasted into a file a scanner acts on, so: a board
 * is emitted only when parseBoardUrl (or the table below) accepts it; names are
 * quoted unless plainly a string; everything else read off a page or a
 * checkpoint is collapsed to one printable line before it reaches a comment or
 * the terminal. Nothing extracted is a scoring input or reaches generated
 * user-facing content.
 *
 * Run: node harvest-buildlist.mjs --out buildlist-portals.yml
 *      node harvest-buildlist.mjs --limit 25 --summary   # quick sample
 *      node harvest-buildlist.mjs --out buildlist-portals.yml --resume
 *      node harvest-buildlist.mjs --self-test
 *
 * Then: review buildlist-portals.yml and paste under `tracked_companies:`.
 */

import { existsSync, readFileSync, realpathSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

import { fetchTextWithRetry, makeHttpCtx } from './providers/_http.mjs';
import { robotsAllows } from './robots-check.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { flagValue, hasFlag, safeIntFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { loadYaml } from './lib/yaml-document.mjs';
import { SLUG_RE } from './lib/ats-board-url.mjs';
import { parseBoardUrl } from './seeds/employers-import.mjs';
import { dedupeAgainstPortals } from './discover-ats.mjs';

const SITEMAP_URL = 'https://buildlist.xyz/sitemaps/companies.xml';
const SITE_ORIGIN = 'https://buildlist.xyz';

/**
 * One request at a time, at least this far apart: the pace rule 6 of the
 * Source Indexing Policy sets for a reader that sweeps a site.
 */
export const MIN_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 25_000;

/**
 * Ceiling on company pages fetched in one run. The roster is ~820 today; the
 * cap keeps the request count to one host bounded even if the sitemap grows
 * or turns hostile, at roughly 2.5× today's size.
 */
export const MAX_COMPANIES = 2000;

/** With --out, progress is saved after this many companies, so a killed run can --resume. */
export const CHECKPOINT_EVERY = 25;

/** Longest --delay accepted, in ms. */
export const MAX_DELAY_MS = 60_000;

/**
 * Longest robots.txt Crawl-delay the script will honour, in seconds. Beyond
 * it a full harvest would run for days, so the script stops and says so
 * rather than either waiting that long or ignoring the request.
 */
export const MAX_CRAWL_DELAY_S = 60;

/**
 * C0 and C1 control characters, DEL, the Unicode line/paragraph separators,
 * and the invisible format characters (zero-width, bidi embeddings, overrides
 * and isolates, the BOM). A page <title> can carry ESC (a terminal escape
 * sequence when the summary is printed), a newline (which ends a YAML comment
 * and starts live YAML), or a right-to-left override that shows a reviewer a
 * different name than the one written.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

/**
 * Collapse untrusted text to one printable line. Applied to everything read off
 * a page or a checkpoint before it reaches the terminal or a YAML comment.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function oneLine(s) {
  return String(s ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Paths on buildlist.xyz that are site sections, not companies. The company
 * sitemap is clean today; this guards against a future sitemap that mixes in
 * landing pages, so a nav slug can never be emitted as a company.
 */
const NON_COMPANY_SLUGS = new Set([
  'jobs', 'companies', 'community', 'matching', 'about', 'privacy', 'terms',
  'sectors', 'metros', 'roles', 'remote', 'stage', 'level', 'search', 'api', 'admin',
]);

/** A BuildList company slug as its sitemap writes it: /mercor, /9-mothers. */
const BUILDLIST_SLUG = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** A tenant hostname for the host-keyed vendors (iCIMS, Personio, Teamtailor). */
const TENANT_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** An Ashby board id with encoded spaces: SLUG_RE's charset plus `%20`. */
const ASHBY_SPACED_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]|%20)*[A-Za-z0-9]$/;

/** A vendor's own subdomains, never a company's board (the same list parseBoardUrl uses). */
const VENDOR_SUBDOMAINS = new Set(['www', 'app', 'api', 'help', 'support', 'status', 'blog', 'docs', 'careers', 'jobs', 'developers', 'marketplace']);

/** Path words that sit where a board id does but are routes, not boards. */
const ROUTE_WORDS = new Set(['api', 'embed', 'jobs', 'careers', 'www', 'null', 'undefined']);

const firstLabel = (host) => host.split('.')[0];

/**
 * Vendors scan.mjs reads that the employer registry (and so parseBoardUrl) does
 * not cover. Host-keyed vendors resolve the tenant from the careers_url host,
 * so the whole hostname is their board id.
 */
const LOCAL_VENDORS = [
  {
    vendor: 'gem',
    test: (h) => h === 'jobs.gem.com',
    board: (u) => pathSegments(u)[0],
    ok: (b) => SLUG_RE.test(b) && !ROUTE_WORDS.has(b.toLowerCase()),
    url: (b) => `https://jobs.gem.com/${b}`,
  },
  {
    vendor: 'icims',
    test: (h) => h.endsWith('.icims.com'),
    board: (u) => u.hostname.toLowerCase(),
    ok: (b) => TENANT_HOST.test(b) && !VENDOR_SUBDOMAINS.has(firstLabel(b)),
    url: (b) => `https://${b}/jobs/search?ss=1`,
  },
  {
    vendor: 'personio',
    test: (h) => /\.jobs\.personio\.(?:de|com)$/.test(h),
    board: (u) => u.hostname.toLowerCase(),
    // One tenant label, exactly as providers/personio.mjs PERSONIO_HOST_RE
    // accepts it: acme.eu.jobs.personio.de would be an entry no provider reads.
    ok: (b) => /^[a-z0-9][a-z0-9-]*\.jobs\.personio\.(?:de|com)$/.test(b) && !VENDOR_SUBDOMAINS.has(firstLabel(b)),
    url: (b) => `https://${b}`,
  },
  {
    vendor: 'teamtailor',
    test: (h) => h.endsWith('.teamtailor.com'),
    board: (u) => u.hostname.toLowerCase(),
    // One tenant label, as providers/teamtailor.mjs TEAMTAILOR_HOST_RE accepts it.
    ok: (b) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.teamtailor\.com$/.test(b) && !VENDOR_SUBDOMAINS.has(firstLabel(b)),
    url: (b) => `https://${b}`,
  },
];

/**
 * Hint-only: recognizable, but no board can be built from what the link says.
 * Comeet's provider needs a careers-api URL carrying a secret ?token= the
 * public page never exposes; a Workday link parseBoardUrl cannot read lacks a
 * site. Both are carried as manual follow-up, never emitted as entries.
 */
const HINT_HOSTS = [
  { vendor: 'comeet', test: (h) => h === 'www.comeet.com' || h === 'comeet.com' || h === 'www.comeet.co' },
  { vendor: 'workday', test: (h) => /\.myworkdayjobs\.com$|\.myworkdaysite\.com$/.test(h) },
];

/** Non-empty path segments of a URL, kept percent-encoded. */
function pathSegments(url) {
  return url.pathname.split('/').map(s => s.trim()).filter(Boolean);
}

const USAGE = `Usage:
  node harvest-buildlist.mjs --out buildlist-portals.yml
                                                  # tracked_companies entries for every resolved board
  node harvest-buildlist.mjs --limit 25 --summary # quick sample, human table
  node harvest-buildlist.mjs --out buildlist-portals.yml --resume
                                                  # continue an interrupted sweep
  node harvest-buildlist.mjs --json               # machine-readable result
  node harvest-buildlist.mjs --self-test          # inline test suite
  node harvest-buildlist.mjs --help

Options:
  --out <file>        Write the YAML here (default: stdout). Progress is saved
                      beside it every ${CHECKPOINT_EVERY} companies as <file>.progress.json
  --limit <n>         Only harvest the next N companies
  --delay <ms>        Pause between requests, ${MIN_DELAY_MS}-${MAX_DELAY_MS} (default ${MIN_DELAY_MS});
                      requests are always made one at a time
  --disabled          Stage entries as enabled: false
  --include-tracked   Keep companies portals.yml already tracks
                      (default: they are skipped, so the file is safe to paste)
  --portals-file <f>  portals.yml to dedup against (default: portals.yml in the
                      career-ops data root)
  --resume            Skip companies already in the --out file's progress file
                      (needs --out)
  --summary           Human-readable table instead of YAML
  --json              JSON result instead of YAML

This script NEVER writes portals.yml: it writes tracked_companies entries for
every resolved board to a file for you to review and paste. A run fetches at
most ${MAX_COMPANIES} company pages and honours a robots.txt Crawl-delay.`;

/**
 * Extract company slugs from BuildList's company sitemap XML.
 *
 * @param {string} xml - Raw sitemap body.
 * @returns {string[]} Deduped, sorted company slugs.
 */
export function parseCompanySitemap(xml) {
  if (typeof xml !== 'string' || !xml.trim()) return [];
  const slugs = new Set();
  for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    let url;
    try {
      url = new URL(m[1]);
    } catch {
      continue;
    }
    if (url.hostname !== 'buildlist.xyz' && url.hostname !== 'www.buildlist.xyz') continue;
    const segs = pathSegments(url);
    // A company lives at the root: /mercor. Anything deeper is a section page.
    if (segs.length !== 1) continue;
    const slug = segs[0].toLowerCase();
    if (!BUILDLIST_SLUG.test(slug) || NON_COMPANY_SLUGS.has(slug)) continue;
    slugs.add(slug);
  }
  return [...slugs].sort();
}

/**
 * Unescape the JS/JSON string escaping that Next.js flight payloads apply to
 * embedded URLs, so a href survives as a parseable URL.
 *
 * @param {string} html
 * @returns {string}
 */
function unescapePayload(html) {
  // One pass, so a `&` this produces is never decoded again (`&amp;`
  // stays `&amp;`, not `&`).
  return html.replace(/\\u0026|\\u002F|&amp;|\\\//gi, (m) => (m.toLowerCase() === '\\u002f' || m === '\\/' ? '/' : '&'));
}

/** The HTML entities BuildList pages use in text, and what they stand for. */
const ENTITIES = { amp: '&', quot: '"', '#x27': "'", '#39': "'", nbsp: ' ', lt: '<', gt: '>' };

/**
 * Decode those entities in one pass. Decoding them one after another, `&amp;`
 * first, turned `&amp;quot;` into `"` instead of the `&quot;` it encodes.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  return String(text).replace(/&(amp|quot|#x27|#39|nbsp|lt|gt);/g, (_, e) => ENTITIES[e]);
}

/**
 * The board one link names, or null.
 *
 * The shape is {vendor, slug, region?, workday_host?, url, hintOnly}: `vendor`
 * is the registry's ATS id, `slug` the board id (a Workday board is
 * tenant/wdN/site), `url` the canonical careers URL.
 *
 * @param {string} raw
 * @returns {{vendor: string, slug: string|null, region?: string, workday_host?: string, url: string, hintOnly: boolean}|null}
 */
export function boardFromUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();

  // Waymo, Databricks and Samsara link only the Greenhouse API host, which
  // parseBoardUrl does not read: name the same board on its board host.
  let link = raw;
  if (host === 'boards-api.greenhouse.io') {
    const segs = pathSegments(u);
    const i = segs.indexOf('boards');
    if (i === -1 || !segs[i + 1]) return null;
    link = `https://job-boards.greenhouse.io/${segs[i + 1]}`;
  }

  const parsed = parseBoardUrl(link);
  if (!('error' in parsed)) {
    return {
      vendor: parsed.ats,
      slug: parsed.board,
      ...(parsed.region ? { region: parsed.region } : {}),
      ...(parsed.workday_host ? { workday_host: parsed.workday_host } : {}),
      url: parsed.careers_url,
      hintOnly: false,
    };
  }

  // Ashby boards whose id holds a space (jobs.ashbyhq.com/hippocratic%20ai,
  // flock%20safety) are live and answer only in that spelling, but SLUG_RE
  // has no space in it, so parseBoardUrl refuses them. Accept exactly that:
  // the shared charset plus encoded spaces, kept encoded as the provider
  // reads them.
  if (host === 'jobs.ashbyhq.com') {
    const id = pathSegments(u)[0] || '';
    // Only an id that HAS a space comes here: anything else parseBoardUrl
    // refused for a reason (a placeholder such as /api, a short id).
    return id.includes('%20') && ASHBY_SPACED_ID.test(id)
      ? { vendor: 'ashby', slug: id, url: `https://jobs.ashbyhq.com/${id}`, hintOnly: false }
      : null;
  }

  for (const v of LOCAL_VENDORS) {
    if (!v.test(host)) continue;
    const board = v.board(u);
    return board && v.ok(board) ? { vendor: v.vendor, slug: board, url: v.url(board), hintOnly: false } : null;
  }

  for (const v of HINT_HOSTS) {
    if (!v.test(host)) continue;
    // Dedup on the tenant part of the path (Comeet: /jobs/<company>/<uid>), not
    // the posting, which would otherwise make every posting a separate "board".
    return { vendor: v.vendor, slug: null, url: oneLine(`${u.origin}/${pathSegments(u).slice(0, 3).join('/')}`), hintOnly: true };
  }
  return null;
}

/**
 * Find every ATS board referenced by a BuildList company page.
 *
 * The page's Apply links are authoritative: they state the vendor and the
 * exact board, which the BuildList URL slug frequently does not match. Where a
 * page references more than one board they are all returned, most-referenced
 * first, so the caller can pick.
 *
 * @param {string} html - Raw company page body.
 * @returns {{vendor: string, slug: string|null, region?: string, workday_host?: string, url: string, hintOnly: boolean, count: number}[]}
 */
export function extractAtsBoards(html) {
  if (typeof html !== 'string' || !html) return [];
  const text = unescapePayload(html);
  const found = new Map();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) {
    const b = boardFromUrl(m[0]);
    if (!b) continue;
    const key = `${b.vendor}:${b.url}`;
    const existing = found.get(key);
    if (existing) existing.count += 1;
    else found.set(key, { ...b, count: 1 });
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.vendor.localeCompare(b.vendor));
}

/**
 * The `api:` field for a portals.yml entry. Only a US Greenhouse board gets
 * one, as discover-ats.mjs writes it; the Greenhouse provider derives the API
 * from careers_url otherwise, EU boards included.
 *
 * @param {{vendor: string, slug: string|null, region?: string}} board
 * @returns {string|null}
 */
export function apiUrl({ vendor, slug, region }) {
  return vendor === 'greenhouse' && region === 'us' && slug
    ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
    : null;
}

/**
 * Boilerplate BuildList appends to a company title. Stripped repeatedly, because
 * the two live title shapes stack it differently:
 *   "Altos Labs Careers & Jobs — 15 Open Roles | BuildList"
 *   "Aigen — Company Profile & Careers | BuildList"
 * Anchored to the end and requiring leading whitespace, so a company genuinely
 * named "… Jobs" only loses the suffix if it also reads as boilerplate.
 */
const TITLE_BOILERPLATE = /\s+(?:Company\s+Profile\s*&\s*Careers|Careers\s*&\s*Jobs|Jobs\s*&\s*Careers|Open\s+Roles|Careers|Jobs)$/i;

/**
 * Best-effort human company name for a BuildList slug: the page's own <title>,
 * which carries real capitalisation and punctuation, else the title-cased slug.
 *
 * @param {string} html
 * @param {string} slug
 * @returns {string}
 */
export function extractCompanyName(html, slug) {
  const m = typeof html === 'string' ? html.match(/<title[^>]*>([^<]{1,200})<\/title>/i) : null;
  if (m) {
    const raw = decodeEntities(m[1]).trim();
    // Drop the "| BuildList" site suffix, then the "— 15 Open Roles" tail.
    const head = raw.split(/\s*[|·]\s*/)[0];
    let name = head.split(/\s+[—–]\s+/)[0].trim();
    let previous;
    do { previous = name; name = name.replace(TITLE_BOILERPLATE, '').trim(); } while (name !== previous);
    name = oneLine(name);
    if (name && !/^buildlist$/i.test(name)) return name;
  }
  return oneLine(titleCaseSlug(slug));
}

/**
 * Flatten a page to readable text: BuildList's profile facts sit in markup
 * whose attributes carry digits, so any regex over raw HTML picks up the wrong
 * numbers (this bit the "Open positions" count once already).
 *
 * @param {string} html
 * @returns {string}
 */
export function flattenHtml(html) {
  if (typeof html !== 'string') return '';
  return decodeEntities(html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * BuildList's own profile facts for a company — sector, one-line description,
 * HQ, headcount, funding, and the count of roles it lists.
 *
 * These are third-party editorial claims, carried through as descriptive
 * context for a portals.yml `notes:` field only. Nothing here is a scoring
 * input and none of it reaches generated user-facing content.
 *
 * @param {string} html - Raw company page.
 * @param {string} name - Company name, used to anchor the description.
 * @returns {{sector: string, blurb: string, hq: string, employees: string, raised: string, founded: string, openRoles: number|null}}
 */
export function extractProfile(html, name) {
  const txt = flattenHtml(html);
  const grab = (re) => { const m = txt.match(re); return m ? m[1].trim() : ''; };

  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let blurb = grab(new RegExp(esc + '\\s+(.{3,220}?)\\s+Save\\s+Website'));
  if (!blurb) blurb = grab(/Updated\s+\w{3}\s+\d{4}\s+.{0,60}?\s+(.{3,220}?)\s+Save\s+Website/);

  const openM = txt.match(/Open positions\s+([\d,]+)/);

  return {
    sector: grab(/Company profile\s*\/\s*([^/]{2,40}?)\s+Updated\s+\w{3}\s+\d{4}/),
    blurb,
    hq: grab(/\bHQ\s+(.{2,40}?)\s+(?:Founded|Employees|Total Raised|Last Round)\b/),
    employees: grab(/\bEmployees\s+([\d,]+(?:-[\d,]+|\+)?)\s/),
    raised: grab(/\bTotal Raised\s+(\$[\d.]+[BMK]?)\s/),
    founded: grab(/\bFounded\s+(\d{4})\b/),
    openRoles: openM ? Number(openM[1].replace(/,/g, '')) : null,
  };
}

/** Title-case a hyphenated slug: `aalo-atomics` → `Aalo Atomics`. */
export function titleCaseSlug(slug) {
  return String(slug).split('-')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Fetch one BuildList URL as text, after robots.txt permits it.
 *
 * robotsAllows fails closed and caches the policy per origin, so the whole run
 * reads robots.txt once. The page itself goes through the shared provider
 * transport (career-ops UA, timeout, body cap, private-address guard, no
 * redirects followed), retried on a 429 or 5xx with the shared policy, which
 * waits out a Retry-After.
 *
 * @param {string} url
 * @param {number} [minGapMs] - The run's pause between requests (a stated
 *   Crawl-delay included); a retry never comes sooner than this.
 * @returns {Promise<string>}
 */
async function fetchPage(url, minGapMs = MIN_DELAY_MS) {
  const robots = await robotsAllows(url);
  if (!robots.allowed) throw new Error(`robots.txt ${robots.reason}`);
  return fetchTextWithRetry(pacedRetryCtx(HTTP_CTX, minGapMs), url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml' },
  }, retryPolicy(minGapMs));
}

/**
 * A transport context whose waits are never shorter than the run's pause.
 * providers/_http.mjs withRetry sleeps through ctx.sleep, and it uses a
 * Retry-After in place of the backoff, so a `Retry-After: 1` under a
 * 10-second Crawl-delay would otherwise retry after one second.
 *
 * @param {object} base - The transport context (HTTP_CTX, or a test double).
 * @param {number} minGapMs
 * @returns {object}
 */
export function pacedRetryCtx(base, minGapMs) {
  const gap = Math.max(MIN_DELAY_MS, Number(minGapMs) || 0);
  const wait = typeof base.sleep === 'function' ? base.sleep : (ms) => new Promise(r => setTimeout(r, ms));
  return { ...base, sleep: (ms) => wait(Math.max(Number(ms) || 0, gap)) };
}

/**
 * The shared retry policy, held to the run's pace: the first backoff is the
 * pause between requests, and the ceiling grows with it. A Retry-After is
 * honoured up to four times the ceiling (providers/_http.mjs withRetry), and
 * pacedRetryCtx keeps a shorter one from undercutting the pause.
 *
 * @param {number} minGapMs
 * @returns {{retries: number, baseDelayMs: number, maxDelayMs: number}}
 */
export function retryPolicy(minGapMs) {
  const gap = Math.max(MIN_DELAY_MS, Number(minGapMs) || 0);
  return { retries: 2, baseDelayMs: gap, maxDelayMs: Math.max(15_000, gap * 2) };
}

const HTTP_CTX = makeHttpCtx();

/** The Crawl-delay BuildList's robots.txt states for career-ops, in seconds, or null. */
async function readCrawlDelay() {
  const robots = await robotsAllows(SITEMAP_URL);
  return robots.allowed && Number.isFinite(robots.crawlDelay) ? robots.crawlDelay : null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Harvest the BuildList company roster and resolve each company's ATS board.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {number} [opts.delay]
 * @param {string[]} [opts.skip] - Slugs already harvested (--resume).
 * @param {(done: number, total: number) => void} [opts.onProgress]
 * @param {(partial: {resolved: object[], hintOnly: object[], unresolved: object[], errors: object[]}) => void} [opts.onCheckpoint]
 *   Called every CHECKPOINT_EVERY companies with what has been harvested so far.
 * @param {(url: string, minGapMs: number) => Promise<string>} [opts.fetchImpl] - Injected for tests;
 *   receives the run's pause so its retries keep the same pace.
 * @param {() => Promise<number|null>} [opts.crawlDelayImpl] - Injected for tests.
 * @returns {Promise<{resolved: object[], hintOnly: object[], unresolved: object[], errors: object[], total: number, capped: number, pending: number, crawlDelay: number|null}>}
 *   `capped` is the count the sitemap listed when it exceeded MAX_COMPANIES
 *   (else 0); `pending` is how many roster companies this run did not reach.
 */
export async function harvest(opts = {}) {
  const {
    limit,
    delay = MIN_DELAY_MS,
    skip = [],
    onProgress,
    onCheckpoint,
    fetchImpl = fetchPage,
    crawlDelayImpl = readCrawlDelay,
  } = opts;

  const crawlDelay = await crawlDelayImpl();
  if (crawlDelay > MAX_CRAWL_DELAY_S) {
    // Honouring it would take days for the roster; asking is the polite answer.
    throw new Error(`BuildList's robots.txt asks for ${crawlDelay}s between requests, more than the ${MAX_CRAWL_DELAY_S}s this script will wait; not harvesting`);
  }
  // One request at a time: the pause, not parallelism, sets the pace.
  let pause = Math.min(delay, MAX_DELAY_MS);
  if (crawlDelay > 0) pause = Math.max(pause, Math.ceil(crawlDelay * 1000));

  const sitemapXml = await fetchImpl(SITEMAP_URL, pause);
  const roster = parseCompanySitemap(sitemapXml);
  // An empty roster is a failed read (a soft-error page served with HTTP 200),
  // not an empty BuildList: carrying on would overwrite --out with nothing and
  // discard the saved progress.
  if (roster.length === 0) throw new Error('the BuildList sitemap listed no companies; not harvesting');
  const total = roster.length;
  if (pause > 0) await sleep(pause);

  const skipSet = new Set(skip);
  const todo = roster.filter(s => !skipSet.has(s));
  let slugs = Number.isFinite(limit) && limit > 0 ? todo.slice(0, limit) : todo;
  // Bounded requests per host, whatever the sitemap claims.
  const capped = slugs.length > MAX_COMPANIES ? slugs.length : 0;
  if (capped) slugs = slugs.slice(0, MAX_COMPANIES);
  const pending = todo.length - slugs.length;

  const resolved = [];
  const hintOnly = [];
  const unresolved = [];
  const errors = [];
  let done = 0;
  let cursor = 0;
  let checkpointFailed = false;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= slugs.length) return;
      const slug = slugs[i];
      try {
        const html = await fetchImpl(`${SITE_ORIGIN}/${slug}`, pause);
        const name = extractCompanyName(html, slug);
        const profile = extractProfile(html, name);
        const boards = extractAtsBoards(html);
        // A wirable board always beats a hint-only one, however often the
        // hint-only vendor is referenced: a Comeet link that wins on count
        // would otherwise mask a scannable board on the page.
        const best = boards.find(b => !b.hintOnly) || boards[0];
        if (best && !best.hintOnly) {
          const { count: _count, hintOnly: _hint, url, ...coords } = best;
          resolved.push({
            name, buildlistSlug: slug, profile, ...coords, board: url,
            alternates: boards.filter(b => b !== best).map(b => b.url),
          });
        } else if (best) {
          hintOnly.push({ name, buildlistSlug: slug, profile, vendor: best.vendor, board: best.url });
        } else {
          unresolved.push({
            name, buildlistSlug: slug, profile,
            reason: profile.openRoles === 0
              ? 'no open roles listed'
              : 'no recognized ATS link on page (custom careers site, or JS-rendered)',
          });
        }
      } catch (err) {
        errors.push({ buildlistSlug: slug, error: oneLine(err?.message ?? err) });
      }
      done += 1;
      onProgress?.(done, slugs.length);
      if (onCheckpoint && done % CHECKPOINT_EVERY === 0) {
        // A progress file that cannot be written (a locked file on Windows, a
        // full disk) costs the ability to resume, never the run itself.
        try {
          onCheckpoint({ resolved: [...resolved], hintOnly: [...hintOnly], unresolved: [...unresolved], errors: [...errors] });
        } catch (err) {
          if (!checkpointFailed) console.error(`⚠️  could not save progress (${oneLine(err?.message ?? err)}); the harvest carries on`);
          checkpointFailed = true;
        }
      }
      if (pause > 0) await sleep(pause);
    }
  }

  await worker();

  const byName = (a, b) => a.name.localeCompare(b.name);
  resolved.sort(byName);
  hintOnly.sort(byName);
  unresolved.sort(byName);
  return { resolved, hintOnly, unresolved, errors, total, capped, pending, crawlDelay };
}

/**
 * Split resolved companies so each board appears once. Two BuildList companies
 * can link the same board (a parent and a subsidiary), and portals.yml has no
 * dedup pass, so emitting both would scan that board twice. The first by name
 * keeps the entry; the rest are reported as sharing it.
 *
 * @param {object[]} resolved - Already sorted by name.
 * @returns {{unique: object[], shared: {name: string, board: string, sameAs: string}[]}}
 */
export function dedupeBoards(resolved) {
  const firstByBoard = new Map();
  const unique = [];
  const shared = [];
  for (const c of resolved) {
    const key = String(c.board).toLowerCase().replace(/\/+$/, '');
    const first = firstByBoard.get(key);
    if (first) {
      shared.push({ name: c.name, board: c.board, sameAs: first.name });
    } else {
      firstByBoard.set(key, c);
      unique.push(c);
    }
  }
  return { unique, shared };
}

/** Comment lines naming companies whose board is already emitted under another name. */
function sharedBoardLines(shared, indent) {
  if (!shared.length) return [];
  return [
    `${indent}# ${shared.length} companies link a board already listed above under another name:`,
    ...shared.map(s => `${indent}#   ${oneLine(s.name)} → same board as ${oneLine(s.sameAs)} (${oneLine(s.board)})`),
  ];
}

/**
 * A careers URL as a YAML scalar. Every URL this script builds is plain-safe;
 * anything else (only possible from a hand-edited input) is quoted.
 */
function yamlUrl(url) {
  const s = String(url ?? '');
  return /^https:\/\/[A-Za-z0-9._~/?=&%-]+$/.test(s) ? s : JSON.stringify(s);
}

/**
 * The tracked_companies entries of a portals.yml, ready for
 * discover-ats.mjs dedupeAgainstPortals. Each entry's careers_url is also read
 * back to its canonical board, so an entry written on a legacy host
 * (boards.greenhouse.io) or as a posting link still matches the board it names.
 *
 * @param {string} portalsPath
 * @returns {{entries: object[], warning: string|null}}
 */
export function loadTrackedEntries(portalsPath) {
  if (!existsSync(portalsPath)) return { entries: [], warning: null };
  let doc;
  try {
    doc = loadYaml(readFileSync(portalsPath, 'utf8'));
  } catch (err) {
    return {
      entries: [],
      warning: `could not read ${portalsPath} (${oneLine(err.message).slice(0, 160)}), so companies it already tracks are not skipped`,
    };
  }
  const list = Array.isArray(doc?.tracked_companies) ? doc.tracked_companies : [];
  const entries = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    entries.push(e);
    const b = typeof e.careers_url === 'string' ? boardFromUrl(e.careers_url) : null;
    if (b && !b.hintOnly && b.url !== e.careers_url) entries.push({ careers_url: b.url });
  }
  return { entries, warning: null };
}

/**
 * Render harvested companies as portals.yml `tracked_companies` entries.
 *
 * discover-ats.mjs admits a company only if its board lists ≥1 job right now.
 * That is the right test when GUESSING a slug. Here the board was read off the
 * page, so this renderer admits every resolved board and lets `title_filter`,
 * which runs per scan on live postings, do the filtering.
 *
 * Entries are grouped by BuildList sector and carry its one-line description,
 * so the file stays readable at ~600 companies. Hint-only vendors and companies
 * with no recognized board are listed as comments for manual follow-up.
 *
 * @param {{resolved: object[], hintOnly?: object[], unresolved?: object[]}} result
 * @param {{enabled?: boolean, tracked?: object[]|null, trackedWarning?: string|null}} [opts]
 *   `enabled: false` stages entries without widening the next scan. `tracked`
 *   is portals.yml's entries (loadTrackedEntries); companies it already holds,
 *   by name or by board, are left out.
 * @returns {string}
 */
export function renderPortalsYaml(result, opts = {}) {
  const enabled = opts.enabled !== false;
  const today = new Date().toISOString().slice(0, 10);
  const { unique, shared } = dedupeBoards(result.resolved || []);
  let resolved = unique;
  let already = [];
  if (opts.tracked) {
    // One company at a time against portals.yml only: passed as a list,
    // dedupeAgainstPortals also folds harvested companies that share a NAME
    // into one, so a page title could knock another company's board out and
    // have it reported as "already tracked". Shared boards are handled above.
    resolved = [];
    for (const c of unique) {
      const { fresh } = dedupeAgainstPortals([{ ...c, careers_url: c.board, api: apiUrl(c) ?? undefined }], opts.tracked);
      (fresh.length ? resolved : already).push(c);
    }
  }

  const lines = [
    '# BuildList companies — paste into portals.yml under `tracked_companies:`',
    `# Harvested ${today} by harvest-buildlist.mjs from https://buildlist.xyz`,
    `# ${resolved.length} companies, each resolved to a board scan.mjs can read.`,
    ...(already.length
      ? [`# ${already.length} more were skipped because portals.yml already tracks them.`]
      : []),
    ...(opts.trackedWarning ? [`# NOTE: ${oneLine(opts.trackedWarning)}.`] : []),
    '#',
    '# Admission is NOT conditioned on having a matching role today: tracked_companies',
    '# is a standing watch, and title_filter does the per-scan filtering.',
    '#',
    '# Sector and description are BuildList\'s own editorial text, carried through as',
    '# context only — they are not scoring inputs.',
    '',
  ];

  const bySector = new Map();
  for (const c of resolved) {
    const sector = oneLine(c.profile?.sector) || 'Other';
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector).push(c);
  }
  const sectors = [...bySector.keys()].sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return bySector.get(b).length - bySector.get(a).length || a.localeCompare(b);
  });

  for (const sector of sectors) {
    const group = bySector.get(sector).slice().sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`  # -- ${sector} (${group.length}) --`);
    lines.push('');
    for (const c of group) {
      lines.push(`  - name: ${yamlString(c.name)}`);
      lines.push(`    careers_url: ${yamlUrl(c.board)}`);
      const api = apiUrl(c);
      if (api) lines.push(`    api: ${api}`);
      // As discover-ats.mjs writes a Workday entry.
      if (c.vendor === 'workday') lines.push('    provider: workday');
      const note = noteFor(c, sector);
      if (note) lines.push(`    notes: ${JSON.stringify(note)}`);
      lines.push(`    enabled: ${enabled}`);
      lines.push('');
    }
  }

  if (shared.length) lines.push(...sharedBoardLines(shared, '  '), '');

  const hints = result.hintOnly || [];
  if (hints.length) {
    lines.push(`  # -- ${hints.length} companies need a manual coordinate --`);
    lines.push('  # Comeet needs a careers-api URL with its ?token=, which the public page never');
    lines.push('  # exposes; a Workday link without a site names no board. The link is a starting point.');
    for (const c of hints) lines.push(`  #   ${oneLine(c.name)} (${oneLine(c.vendor)}): ${oneLine(c.board)}`);
    lines.push('');
  }

  const un = result.unresolved || [];
  if (un.length) {
    const noRoles = un.filter(c => c.profile?.openRoles === 0).length;
    lines.push(`  # -- ${un.length} companies had no recognized ATS board --`);
    lines.push(`  # ${noRoles} of them list no open roles at all; the rest use a custom careers`);
    lines.push('  # site or an ATS career-ops has no provider for. Re-run later to pick up changes.');
    for (const c of un) lines.push(`  #   ${oneLine(c.name)} (/${oneLine(c.buildlistSlug)}) — ${oneLine(c.reason)}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * One-line `notes:` value: what the company does, plus the facts that help
 * judge it later. Kept to a single line — portals.yml notes are scanned, not read.
 *
 * @param {object} c - Resolved company.
 * @param {string} sector
 * @returns {string}
 */
function noteFor(c, sector) {
  const p = c.profile || {};
  const head = [sector, p.blurb].filter(Boolean).join('. ');
  const facts = [p.hq, p.employees && `${p.employees} staff`, p.raised && `${p.raised} raised`]
    .filter(Boolean).join(', ');
  const tail = `via BuildList ${new Date().toISOString().slice(0, 10)}`;
  return oneLine([head, facts, tail].filter(Boolean).join(' — '));
}

/**
 * Words a YAML 1.1 or 1.2 reader turns into a boolean, null or special float
 * when they stand alone. js-yaml reads `Null` as null and `True` as true, and
 * YAML 1.1 readers (the Go dashboard among them) also read `yes`/`no`/`on`/`off`.
 */
const YAML_RESERVED = /^(?:y|n|yes|no|on|off|true|false|null|nan|inf)$/i;

/**
 * Quote a YAML scalar unless it is plainly a string. Plain form only when it
 * starts with a letter (so it can never read as a number, a date or a hex
 * literal: `2024`, `0x1A`), holds no character with YAML meaning, and is not a
 * reserved word. Everything else goes out JSON-quoted, which YAML reads as a
 * double-quoted string; that also escapes any newline.
 *
 * discover-ats.mjs has its own yamlScalar, but it leaves `Null`, `2024` and a
 * newline unquoted, which a page title controls here.
 */
export function yamlString(s) {
  const text = String(s ?? '');
  return /^[A-Za-z][A-Za-z0-9 ._&'()+-]*$/.test(text) && !YAML_RESERVED.test(text)
    ? text
    : JSON.stringify(text);
}

/**
 * Human-readable summary table.
 *
 * @param {{resolved: object[], unresolved: object[], errors: object[], total: number}} result
 * @returns {string}
 */
export function renderSummary(result) {
  const byVendor = new Map();
  for (const c of result.resolved) byVendor.set(c.vendor, (byVendor.get(c.vendor) || 0) + 1);

  const out = [
    '='.repeat(78),
    '  BuildList harvest — career-ops',
    `  resolved: ${result.resolved.length} | manual coordinate: ${(result.hintOnly || []).length} | no board: ${result.unresolved.length} | errors: ${result.errors.length} | roster: ${result.total}`,
    '='.repeat(78),
    '',
    '  Boards by vendor:',
  ];
  for (const [vendor, n] of [...byVendor.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`    ${oneLine(vendor).padEnd(18)} ${n}`);
  }
  const bySector = new Map();
  for (const c of result.resolved) {
    const k = oneLine(c.profile?.sector) || 'Other';
    bySector.set(k, (bySector.get(k) || 0) + 1);
  }
  if (bySector.size) {
    out.push('');
    out.push('  Companies by sector:');
    for (const [sector, n] of [...bySector.entries()].sort((a, b) => b[1] - a[1])) {
      out.push(`    ${sector.padEnd(28)} ${n}`);
    }
  }
  out.push('');
  out.push('  Company                              Vendor      Board');
  out.push('  ' + '-'.repeat(88));
  for (const c of result.resolved.slice(0, 40)) {
    out.push(`  ${truncate(oneLine(c.name), 36).padEnd(37)}${oneLine(c.vendor).padEnd(12)}${oneLine(c.board)}`);
  }
  if (result.resolved.length > 40) out.push(`  ... and ${result.resolved.length - 40} more`);
  if (result.crawlDelay > 0) {
    out.push('');
    out.push(`  BuildList's robots.txt asks for ${result.crawlDelay}s between requests: fetched one page at a time.`);
  }
  if (result.capped) {
    out.push('');
    out.push(`  ⚠️  The sitemap listed ${result.capped} companies; only the first ${MAX_COMPANIES} were fetched.`);
  }
  if (result.errors.length) {
    out.push('');
    out.push('  Errors:');
    for (const e of result.errors.slice(0, 10)) out.push(`    - ${oneLine(e.buildlistSlug)}: ${oneLine(e.error)}`);
  }
  return out.join('\n');
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Checkpoint path for a given --out file, so --resume can continue a sweep. */
function checkpointPath(outFile) {
  return `${outFile}.progress.json`;
}

/** Collapse every string field of a profile to one line; keep numbers and nulls. */
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'string') out[k] = oneLine(v);
    else if (typeof v === 'number' || v === null) out[k] = v;
  }
  return out;
}

/**
 * Read a --resume checkpoint, keeping only entries that still look like this
 * script wrote them. A resolved entry's board is read back through
 * boardFromUrl and must come back unchanged, because resumed entries skip
 * extraction and go straight into the YAML: an edited or corrupted checkpoint
 * must not be a way to put an arbitrary careers_url in front of the user.
 * Strings are collapsed to one line on the way in.
 *
 * @param {string} path
 * @returns {{carried: {resolved: object[], hintOnly: object[], unresolved: object[], errors: object[]}, dropped: number, warning: string|null}}
 */
export function readCheckpoint(path) {
  const empty = { resolved: [], hintOnly: [], unresolved: [], errors: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { carried: empty, dropped: 0, warning: `progress file unreadable, starting fresh (${oneLine(err.message)})` };
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.resolved) || !Array.isArray(raw.unresolved)) {
    return { carried: empty, dropped: 0, warning: 'progress file is not a harvest checkpoint, starting fresh' };
  }
  const isEntry = (c) => c && typeof c === 'object' && typeof c.name === 'string'
    && typeof c.buildlistSlug === 'string' && BUILDLIST_SLUG.test(c.buildlistSlug);
  const boardHolds = (c) => {
    if (typeof c.board !== 'string' || typeof c.slug !== 'string' || !c.slug) return false;
    const b = boardFromUrl(c.board);
    return Boolean(b) && !b.hintOnly && b.vendor === c.vendor && b.slug === c.slug && b.url === c.board
      && (b.region ?? null) === (c.region ?? null);
  };
  // Only the fields this script writes, each re-typed: an unknown key or a
  // stray control character in a hand-edited file goes no further.
  const str = (v) => (typeof v === 'string' ? oneLine(v) : undefined);
  const clean = (c) => {
    const out = { name: oneLine(c.name), buildlistSlug: c.buildlistSlug, profile: cleanProfile(c.profile) };
    for (const k of ['vendor', 'slug', 'region', 'workday_host', 'board', 'reason']) {
      const v = str(c[k]);
      if (v !== undefined) out[k] = v;
    }
    if (Array.isArray(c.alternates)) out.alternates = c.alternates.map(str).filter(Boolean);
    return out;
  };
  const keep = (list, test) => (Array.isArray(list) ? list.filter(c => isEntry(c) && test(c)).map(clean) : []);
  const carried = {
    resolved: keep(raw.resolved, boardHolds),
    hintOnly: keep(raw.hintOnly, c => typeof c.board === 'string' && typeof c.vendor === 'string'),
    unresolved: keep(raw.unresolved, () => true),
    // Errored companies are fetched again on resume, so none are carried.
    errors: [],
  };
  const before = raw.resolved.length + raw.unresolved.length + (Array.isArray(raw.hintOnly) ? raw.hintOnly.length : 0);
  const after = carried.resolved.length + carried.unresolved.length + carried.hintOnly.length;
  const dropped = before - after;
  return {
    carried,
    dropped,
    warning: dropped ? `progress file: ignored ${dropped} entr${dropped === 1 ? 'y' : 'ies'} that did not check out; they will be fetched again` : null,
  };
}

/**
 * Whether two paths name the same file. When both exist, compare the files
 * themselves (device and inode), which also catches a hard link, a symlink and
 * a different letter case on a case-insensitive file system. When one does not
 * exist yet, compare the resolved paths without regard to case, as macOS and
 * Windows file systems do by default.
 */
function sameFile(a, b) {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch { /* one side does not exist yet */ }
  const real = (p) => {
    try { return realpathSync.native(p); } catch { /* not there yet */ }
    try { return join(realpathSync.native(dirname(p)), basename(p)); } catch { return resolve(p); }
  };
  return real(a).toLowerCase() === real(b).toLowerCase();
}

/** Two harvest results' lists, concatenated (carried-over progress first). */
function mergeHarvest(carried, partial) {
  return {
    resolved: [...carried.resolved, ...partial.resolved],
    hintOnly: [...carried.hintOnly, ...partial.hintOnly],
    unresolved: [...carried.unresolved, ...partial.unresolved],
    errors: [...carried.errors, ...partial.errors],
  };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/** @returns {number} failing assertion count */
export function selfTest() {
  let failed = 0;
  const eq = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) { console.error(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`); failed += 1; }
    else console.log(`  ✓ ${label}`);
  };
  const board = (html) => extractAtsBoards(html).map(b => [b.vendor, b.slug, b.url, b.hintOnly, b.count]);

  eq('sitemap: extracts root-level company slugs', parseCompanySitemap(
    '<urlset><url><loc>https://buildlist.xyz/mercor</loc></url>' +
    '<url><loc>https://buildlist.xyz/aalo-atomics</loc></url></urlset>'),
    ['aalo-atomics', 'mercor']);

  eq('sitemap: drops section pages and deep paths', parseCompanySitemap(
    '<urlset><url><loc>https://buildlist.xyz/jobs</loc></url>' +
    '<url><loc>https://buildlist.xyz/jobs/openings/foo</loc></url>' +
    '<url><loc>https://buildlist.xyz/mercor</loc></url></urlset>'),
    ['mercor']);

  eq('sitemap: ignores foreign hosts', parseCompanySitemap(
    '<urlset><url><loc>https://evil.example/mercor</loc></url></urlset>'), []);

  eq('boards: reads the ashby board from an apply link', board(
    '<a href="https://jobs.ashbyhq.com/mercor/3ecb8ca3?utm_source=buildlist">Apply</a>'),
    [['ashby', 'mercor', 'https://jobs.ashbyhq.com/mercor', false, 1]]);

  eq('boards: an ashby board keeps its case', board('https://jobs.ashbyhq.com/AlephAlpha/123'),
    [['ashby', 'AlephAlpha', 'https://jobs.ashbyhq.com/AlephAlpha', false, 1]]);

  // jobs.ashbyhq.com/hippocratic%20ai is live and answers only in that
  // spelling; decoding the space would break the URL.
  eq('boards: an ashby board id with a space keeps it encoded', board('https://jobs.ashbyhq.com/hippocratic%20ai/abc-123'),
    [['ashby', 'hippocratic%20ai', 'https://jobs.ashbyhq.com/hippocratic%20ai', false, 1]]);

  eq('boards: any other escape in an ashby id is refused', board(
    'https://jobs.ashbyhq.com/acme%0Aenabled/1 https://jobs.ashbyhq.com/acme%3Ax/1 https://jobs.ashbyhq.com/%20acme/1'), []);

  eq('boards: reads the greenhouse embed ?for= board', board(
    '<iframe src="https://job-boards.greenhouse.io/embed/job_board?for=agilityrobotics"></iframe>'),
    [['greenhouse', 'agilityrobotics', 'https://job-boards.greenhouse.io/agilityrobotics', false, 1]]);

  eq('boards: an EU greenhouse board keeps its region', extractAtsBoards(
    'https://job-boards.eu.greenhouse.io/acmeeu/jobs/123').map(b => [b.region, b.url]),
    [['eu', 'https://job-boards.eu.greenhouse.io/acmeeu']]);

  eq('boards: unescapes flight-payload URLs', board(
    '{"href":"https:\\u002F\\u002Fjob-boards.greenhouse.io\\u002Faltoslabs\\u002F1234"}'),
    [['greenhouse', 'altoslabs', 'https://job-boards.greenhouse.io/altoslabs', false, 1]]);

  eq('boards: dedups and ranks by reference count', board(
    'https://jobs.lever.co/acme/1 https://jobs.lever.co/acme/2 https://jobs.ashbyhq.com/other/9'),
    [
      ['lever', 'acme', 'https://jobs.lever.co/acme', false, 2],
      ['ashby', 'other', 'https://jobs.ashbyhq.com/other', false, 1],
    ]);

  eq('boards: subdomain vendors take the board from the host', board('https://acmecorp.recruitee.com/o/engineer'),
    [['recruitee', 'acmecorp', 'https://acmecorp.recruitee.com', false, 1]]);

  eq('boards: bare embed with no ?for= is not a board', board('https://job-boards.greenhouse.io/embed'), []);

  // Regression: the real board appeared twice, the /j/ short link four times,
  // so count-ranking alone once elected `j` as the board for 8 companies.
  eq('boards: workable /j/ short links never beat the real board', board(
    'https://apply.workable.com/j/1318B10262 https://apply.workable.com/j/8D34CAB720 ' +
    'https://apply.workable.com/j/F08AA0CBF9 https://apply.workable.com/anthro/'),
    [['workable', 'anthro', 'https://apply.workable.com/anthro', false, 1]]);

  // Waymo, Databricks and Samsara link ONLY the Greenhouse API host; missing it
  // once scored 26 companies as "no ATS link".
  eq('boards: reads the board out of the greenhouse API url', board(
    'https://boards-api.greenhouse.io/v1/boards/waymo/jobs'),
    [['greenhouse', 'waymo', 'https://job-boards.greenhouse.io/waymo', false, 1]]);

  eq('boards: a vendor page is not a board', board(
    'https://www.greenhouse.io/privacy-policy https://jobs.ashbyhq.com/api/x https://support.greenhouse.io/hc'), []);

  eq('boards: gem board id comes from the path', board(
    'https://jobs.gem.com/astroforge-io/T2F0c0pvYlBvc3Q6MTM3MTg5Mw%3D%3D'),
    [['gem', 'astroforge-io', 'https://jobs.gem.com/astroforge-io', false, 1]]);

  // Host-keyed vendors: the provider resolves the tenant from the careers_url
  // host, so the hostname is what has to survive, not a bare label.
  eq('boards: icims keeps the tenant host', extractAtsBoards(
    'https://careers-jobyaviation.icims.com/jobs/4312/core-software-services-lead/job').map(b => [b.vendor, b.url]),
    [['icims', 'https://careers-jobyaviation.icims.com/jobs/search?ss=1']]);

  eq('boards: personio keeps the tenant host', extractAtsBoards(
    'https://stark.jobs.personio.com/job/2315143').map(b => [b.vendor, b.url]),
    [['personio', 'https://stark.jobs.personio.com']]);

  eq('boards: teamtailor keeps the tenant host, not its own site', extractAtsBoards(
    'https://acme.teamtailor.com/jobs/12-engineer https://www.teamtailor.com/en').map(b => [b.vendor, b.url]),
    [['teamtailor', 'https://acme.teamtailor.com']]);

  eq('boards: workday resolves to its three coordinates', extractAtsBoards(
    'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123').map(b => [b.vendor, b.slug, b.url, b.hintOnly]),
    [['workday', 'acme/wd1/careers', 'https://acme.wd1.myworkdayjobs.com/careers', false]]);

  // Comeet's provider needs a careers-api URL carrying a secret ?token=, which
  // the public page never exposes — so it is a hint, never an entry.
  eq('boards: comeet is hint-only and dedups on the tenant, not the posting', board(
    'https://www.comeet.com/jobs/covenantindustries/3B.00F/comms-engineer/94.F6D ' +
    'https://www.comeet.com/jobs/covenantindustries/3B.00F/contracts/A4.F60'),
    [['comeet', null, 'https://www.comeet.com/jobs/covenantindustries/3B.00F', true, 2]]);

  eq('boards: non-ATS links are ignored', board('<a href="https://x.com/buildlistxyz">Follow</a>'), []);

  eq('api: only a US greenhouse board gets an api: field',
    [apiUrl({ vendor: 'greenhouse', slug: 'waymo', region: 'us' }), apiUrl({ vendor: 'greenhouse', slug: 'acmeeu', region: 'eu' }),
     apiUrl({ vendor: 'ashby', slug: 'mercor' })],
    ['https://boards-api.greenhouse.io/v1/boards/waymo/jobs', null, null]);

  eq('profile: reads sector, blurb and facts off the page',
    (function () {
      const p = extractProfile(
        '<div>Company profile / Energy &amp; Climate Updated Sep 2026 Crusoe Energy ' +
        'Builds AI-scale data centers. Save Website Careers LinkedIn Open positions 373 ' +
        'Roles HQ Denver, CO Founded 2018 Employees 1,001-5,000 Total Raised $14.8B Last Round</div>',
        'Crusoe Energy');
      return [p.sector, p.blurb, p.hq, p.employees, p.raised, p.founded, p.openRoles];
    })(),
    ['Energy & Climate', 'Builds AI-scale data centers.', 'Denver, CO', '1,001-5,000', '$14.8B', '2018', 373]);

  // Regression: "Open positions" and its number are separated by markup whose
  // attributes contain digits, so a raw-HTML regex read the wrong number.
  eq('profile: open-role count survives intervening markup',
    extractProfile('<p class="x2">Open positions</p><span data-n="7">343</span> Roles', 'Waymo').openRoles,
    343);

  const waymo = {
    name: 'Waymo', buildlistSlug: 'waymo', vendor: 'greenhouse', slug: 'waymo', region: 'us',
    board: 'https://job-boards.greenhouse.io/waymo',
    profile: { sector: 'Transportation', blurb: 'Operates autonomous vehicles.', hq: 'Mountain View, CA', employees: '5,001+', raised: '$13.5B', openRoles: 343 },
  };
  const portals = renderPortalsYaml({
    resolved: [waymo],
    hintOnly: [{ name: 'Covenant', vendor: 'comeet', board: 'https://www.comeet.com/jobs/covenantindustries/3B.00F' }],
    unresolved: [{ name: 'Meta', buildlistSlug: 'meta', reason: 'custom careers site', profile: { openRoles: 955 } }],
  });
  eq('portals: emits careers_url + api + notes + enabled',
    portals.includes('  - name: Waymo') &&
    portals.includes('    careers_url: https://job-boards.greenhouse.io/waymo') &&
    portals.includes('    api: https://boards-api.greenhouse.io/v1/boards/waymo/jobs') &&
    portals.includes('    enabled: true') &&
    /notes: ".*Operates autonomous vehicles.*Mountain View, CA.*"/.test(portals), true);

  eq('portals: a workday entry names its provider',
    renderPortalsYaml({ resolved: [{ name: 'Acme', vendor: 'workday', slug: 'acme/wd1/careers', workday_host: 'jobs', board: 'https://acme.wd1.myworkdayjobs.com/careers', profile: {} }] })
      .includes('    provider: workday'), true);

  eq('portals: excludes already-tracked companies, by name or by board, and says so', (function () {
    const out = renderPortalsYaml({
      resolved: [
        waymo,
        { name: 'Brand New', vendor: 'ashby', slug: 'brandnew', board: 'https://jobs.ashbyhq.com/brandnew', profile: {} },
        { name: 'Renamed', vendor: 'lever', slug: 'acme', region: 'us', board: 'https://jobs.lever.co/acme', profile: {} },
      ],
    }, { tracked: [{ name: 'waymo' }, { name: 'Acme Corp', careers_url: 'https://jobs.lever.co/acme' }] });
    return [out.includes('- name: Brand New'), out.includes('- name: Waymo'), out.includes('- name: Renamed'),
            out.includes('# 2 more were skipped because portals.yml already tracks them.')];
  })(), [true, false, false, true]);

  eq('portals: groups under a sector heading', portals.includes('  # -- Transportation (1) --'), true);
  eq('portals: hint-only and unresolved stay comments, never entries',
    portals.includes('  #   Covenant (comeet):') && portals.includes('  #   Meta (/meta)') &&
    !portals.includes('- name: Covenant') && !portals.includes('- name: Meta'), true);

  eq('portals: --disabled stages entries without widening the scan',
    renderPortalsYaml({ resolved: [{ name: 'X', vendor: 'ashby', slug: 'x', board: 'https://jobs.ashbyhq.com/x', profile: {} }] },
      { enabled: false }).includes('    enabled: false'), true);

  eq('name: prefers the page title over the slug',
    extractCompanyName('<title>Altos Labs — Jobs &amp; Company Profile | BuildList</title>', 'altos-labs'),
    'Altos Labs');

  eq('name: strips the "Careers & Jobs — N Open Roles" tail',
    extractCompanyName('<title>Altos Labs Careers &amp; Jobs — 15 Open Roles | BuildList</title>', 'altos-labs'),
    'Altos Labs');

  eq('name: strips the "— Company Profile & Careers" tail',
    extractCompanyName('<title>Aigen — Company Profile &amp; Careers | BuildList</title>', 'aigen'),
    'Aigen');

  eq('name: keeps a hyphenated company name intact',
    extractCompanyName('<title>Hugging-Face Careers &amp; Jobs | BuildList</title>', 'hugging-face'),
    'Hugging-Face');

  eq('name: falls back to title-casing the slug',
    extractCompanyName('<html>no title</html>', 'aalo-atomics'), 'Aalo Atomics');

  eq('name: ignores a bare BuildList title',
    extractCompanyName('<title>BuildList</title>', 'nine-mothers'), 'Nine Mothers');

  eq('yaml: leaves a plain name plain', yamlString('Altos Labs'), 'Altos Labs');
  // A leading digit is quoted so no name can read as a number or date (2024, 0x1A).
  eq('yaml: quotes a name that starts with a digit', yamlString('1x'), '"1x"');
  eq('yaml: quotes names with colons', yamlString('Acme: The Sequel'), '"Acme: The Sequel"');

  console.log(failed === 0 ? '\nAll harvest-buildlist self-tests passed.' : `\n${failed} assertion(s) failed.`);
  return failed;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

// ADDING A FLAG: add it to KNOWN_FLAGS (and VALUE_FLAGS if it takes a value)
// and to USAGE. validateFlags refuses anything else, so a mistyped `--portal`
// fails instead of silently running the default mode.
const KNOWN_FLAGS = [
  '--out', '--limit', '--delay', '--disabled',
  '--include-tracked', '--portals-file', '--resume', '--summary', '--json',
  '--self-test', '--help', '-h',
];
const VALUE_FLAGS = ['--out', '--limit', '--delay', '--portals-file'];

async function main(argv) {
  validateFlags(argv, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  const flag = (name) => hasFlag(argv, name);

  if (flag('--self-test')) return selfTest() === 0 ? 0 : 1;

  // User-given paths resolve against the working directory, like
  // discover-ats.mjs --in; the portals.yml default is the user's own file in
  // the data root, which can live outside this checkout.
  const outArg = flagValue(argv, '--out');
  const outFile = outArg ? resolve(process.cwd(), outArg) : null;

  // A malformed number is an error, not the default: `--limit abc` falling
  // back to "no limit" would turn a quick sample into a full sweep of the site.
  const badNumbers = [];
  const intFlag = (name, fallback, min, max = Infinity) => {
    if (!flag(name)) return fallback;
    const n = safeIntFlag(flagValue(argv, name), null);
    if (n === null || n < min || n > max) {
      badNumbers.push(`${name} needs a whole number ${max === Infinity ? `of at least ${min}` : `from ${min} to ${max}`}`);
      return fallback;
    }
    return n;
  };
  const limit = intFlag('--limit', undefined, 1);
  const delay = intFlag('--delay', MIN_DELAY_MS, MIN_DELAY_MS, MAX_DELAY_MS);
  if (badNumbers.length) {
    console.error(`harvest-buildlist: ${badNumbers.join('; ')}.`);
    return 1;
  }

  const wantResume = flag('--resume');
  const portalsArg = flagValue(argv, '--portals-file');
  const portalsPath = portalsArg
    ? resolve(process.cwd(), portalsArg)
    : resolve(getCareerOpsRoot(), 'portals.yml');

  if (wantResume && !outFile) {
    console.error('harvest-buildlist: --resume needs --out <file>; the progress file lives next to that file.');
    return 1;
  }
  // --summary and --json print instead of writing the YAML, so with --out a
  // finished run would leave neither the file asked for nor a progress file.
  if (outFile && (flag('--summary') || flag('--json'))) {
    console.error('harvest-buildlist: --out writes the YAML; --summary and --json print instead. Use one or the other.');
    return 1;
  }
  // "Never writes portals.yml" has to hold for a mistyped --out too: refuse the
  // user's portals.yml, any file of that name in any letter case, and an --out
  // whose progress file would land on it, before fetching anything.
  if (outFile && (basename(outFile).toLowerCase() === 'portals.yml' || sameFile(outFile, portalsPath)
      || sameFile(checkpointPath(outFile), portalsPath))) {
    console.error(`harvest-buildlist: refusing to write ${outFile}: this script never writes portals.yml. Pick another --out file, review it, then paste.`);
    return 1;
  }
  // Found out now, not after the first pages are fetched.
  if (outFile && !existsSync(dirname(outFile))) {
    console.error(`harvest-buildlist: the folder for --out does not exist: ${dirname(outFile)}`);
    return 1;
  }

  let skip = [];
  let carried = { resolved: [], hintOnly: [], unresolved: [], errors: [] };
  if (wantResume && existsSync(checkpointPath(outFile))) {
    const cp = readCheckpoint(checkpointPath(outFile));
    if (cp.warning) console.error(`⚠️  ${cp.warning}`);
    carried = cp.carried;
    skip = [...carried.resolved, ...carried.hintOnly, ...carried.unresolved].map(c => c.buildlistSlug);
    if (skip.length) console.error(`Resuming: ${skip.length} companies already harvested.`);
  }

  const saveProgress = (partial) => {
    if (outFile) writeFileSync(checkpointPath(outFile), JSON.stringify(mergeHarvest(carried, partial)));
  };

  const isTty = process.stderr.isTTY;
  const result = await harvest({
    limit,
    delay,
    skip,
    onProgress: (done, totalToDo) => {
      if (isTty && (done % 10 === 0 || done === totalToDo)) {
        process.stderr.write(`\r  harvesting… ${done}/${totalToDo}`);
      }
    },
    onCheckpoint: saveProgress,
  });
  if (isTty) process.stderr.write('\n');

  // Fold in anything carried over from an interrupted sweep.
  const merged = mergeHarvest(carried, result);
  const byName = (a, b) => a.name.localeCompare(b.name);
  Object.assign(result, {
    resolved: merged.resolved.sort(byName),
    hintOnly: merged.hintOnly.sort(byName),
    unresolved: merged.unresolved.sort(byName),
    errors: merged.errors,
  });

  if (flag('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (flag('--summary')) {
    console.log(renderSummary(result));
  } else {
    // Default ON: a duplicate tracked_companies entry silently double-scans a
    // board, and this file exists to be pasted straight into portals.yml.
    const { entries, warning } = flag('--include-tracked') ? { entries: null, warning: null } : loadTrackedEntries(portalsPath);
    if (warning) console.error(`⚠️  ${warning}.`);
    const yaml = renderPortalsYaml(result, { enabled: !flag('--disabled'), tracked: entries, trackedWarning: warning });
    if (outFile) {
      writeFileSync(outFile, yaml);
      console.error(renderSummary(result));
      // Counted from the file, not result.resolved: tracked and shared boards are skipped.
      const written = (yaml.match(/^ {2}- name:/gm) || []).length;
      console.error(`\nWrote ${written} portals.yml entries → ${outFile}`);
      console.error('Review, then paste under `tracked_companies:` in portals.yml.');
    } else {
      console.log(yaml);
    }
  }

  if (outFile) {
    // Keep the progress file while there is anything left to do: companies
    // that errored, or roster not reached because of --limit or the cap.
    const cpPath = checkpointPath(outFile);
    if (result.errors.length === 0 && !result.pending) {
      try { unlinkSync(cpPath); } catch { /* none written */ }
    } else {
      writeFileSync(cpPath, JSON.stringify({ resolved: result.resolved, hintOnly: result.hintOnly, unresolved: result.unresolved, errors: result.errors }));
      const left = result.errors.length + result.pending;
      console.error(`\n${left} companies still to harvest. Run the same command with --resume to continue.`);
    }
  }

  return 0;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => { console.error(`harvest-buildlist: ${oneLine(err?.message ?? err)}`); process.exit(1); });
}
