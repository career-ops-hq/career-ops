// @ts-check
/**
 * jd-host-readers.mjs — full JD text for career sites that no ATS API in
 * liveness-api.mjs (JD_TEXT_API_ATS) covers.
 *
 * Before this, `jd-years.mjs:fetchJdText` and `fetch-jd.mjs` returned nothing
 * for Oracle Recruiting Cloud, Google, Apple, Amazon, Walmart, Goldman Sachs,
 * Eightfold (Netflix, Microsoft, Qualcomm, Eaton...), ServiceNow, Rippling ATS
 * and Avature portals (Sandisk, Bloomberg, EA), so the
 * scanner's `yrs:` segment read `unread` (no JD) or, worse, `none stated` from
 * a listing excerpt that leaves the qualifications out. Measured 2026-11-19:
 * 200 of 366 new postings unread, 54 JPMorgan rows `none stated` whose JDs
 * state "5+ years".
 *
 * Each reader is one public, logged-out GET (the same endpoint or page the
 * matching providers/*.mjs scanner or a browser reads), through the transport
 * context from providers/_http.mjs: SSRF-guarded connect, no redirects, body
 * cap, retry that honours Retry-After on a 429. Requests are spaced per reader
 * (throttleProviderRequest) so a scan of many postings on one board stays
 * polite. Every normalizer is pure and checks that the payload is the posting
 * that was asked for, so a listing or another job's JD is never returned.
 *
 * Routing is by URL signature, not a host allow-list, where the signature is
 * the platform's own: an Oracle CE path (`/hcmUI/CandidateExperience/.../job/N`)
 * or an Eightfold PCSX path (`/careers?pid=N`, `/careers/job/N`) is that
 * platform on any host, branded or not, and its API lives on the same host.
 *
 * Job-posting content is untrusted data: it is returned as text, never acted on.
 */

import { jdHtmlToText, normalizeSmartRecruitersJob } from '../browser-extract.mjs';
import { elementInnerHtml } from './jd-parse.mjs';
import { throttleProviderRequest } from '../liveness-api.mjs';
import { BROWSER_LIKE_USER_AGENT, fetchJsonWithRetry, fetchTextWithRetry, makeHttpCtx } from '../providers/_http.mjs';

const RETRY_POLICY = { retries: 2 };
// Minimum spacing between two requests from the same reader. One posting per
// request, so this is the only pacing a run of many postings on one board gets.
const READER_SPACING_MS = 400;

/** Join non-empty text sections, each converted from HTML. */
function joinSections(parts) {
  return parts
    .map(([label, html]) => {
      const text = typeof html === 'string' ? jdHtmlToText(html) : '';
      return text ? (label ? `${label}\n${text}` : text) : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

const cap = (text, n) => (text.length > n ? text.slice(0, n) : text);

// ── Normalizers (pure) ─────────────────────────────────────────────

/**
 * Oracle Recruiting Cloud recruitingCEJobRequisitionDetails payload.
 * @param {any} json
 * @param {string} id requisition number from the posting URL
 * @returns {{title: string, text: string}|null}
 */
export function normalizeOracleDetail(json, id) {
  const items = Array.isArray(json?.items) ? json.items : [];
  const item = items.find((it) => String(it?.Id ?? '') === String(id));
  if (!item) return null;
  const text = joinSections([
    ['', item.ExternalDescriptionStr],
    ['Responsibilities', item.ExternalResponsibilitiesStr],
    ['Qualifications', item.ExternalQualificationsStr],
  ]);
  return text ? { title: String(item.Title || ''), text } : null;
}

/**
 * Google Careers posting page: the posting itself is the `ds:0` data blob
 * (the page also carries other jobs in `ds:1`, which are ignored).
 * Fields by position: 0 id, 1 title, 3 responsibilities, 4 qualifications,
 * 10 about the job, 19 qualifications without the headings.
 * @param {string} html
 * @param {string} id numeric id from the posting URL
 * @returns {{title: string, text: string}|null}
 */
export function normalizeGooglePage(html, id) {
  const src = String(html || '');
  const start = src.indexOf("AF_initDataCallback({key: 'ds:0'");
  if (start === -1) return null;
  const dataAt = src.indexOf('data:', start);
  const end = src.indexOf(', sideChannel:', dataAt);
  if (dataAt === -1 || end === -1) return null;
  let data;
  try { data = JSON.parse(src.slice(dataAt + 5, end)); } catch { return null; }
  const job = Array.isArray(data) ? data[0] : null;
  if (!Array.isArray(job) || String(job[0]) !== String(id)) return null;
  const html2 = (v) => (Array.isArray(v) && typeof v[1] === 'string' ? v[1] : '');
  const quals = html2(job[4]) || html2(job[19]);
  const text = joinSections([
    ['', html2(job[10])],
    ['Responsibilities', html2(job[3])],
    ['', quals],
  ]);
  return text ? { title: String(job[1] || ''), text } : null;
}

/**
 * Apple jobs API `/api/v1/jobDetails/{jobNumber}` payload.
 * @param {any} json
 * @param {string} jobNumber e.g. "200693769-0836"
 * @returns {{title: string, text: string}|null}
 */
export function normalizeAppleDetail(json, jobNumber) {
  const r = json?.res;
  if (!r || typeof r !== 'object') return null;
  const want = String(jobNumber);
  if (String(r.jobNumber ?? '') !== want && String(r.positionId ?? '') !== want.split('-')[0]) return null;
  // Apple's fields are plain text with newlines; jdHtmlToText leaves that intact.
  const text = joinSections([
    ['', r.jobSummary],
    ['Description', r.description],
    ['Responsibilities', r.responsibilities],
    ['Minimum Qualifications', r.minimumQualifications],
    ['Preferred Qualifications', r.preferredQualifications],
    ['Education & Experience', r.educationExperience],
  ]);
  return text ? { title: String(r.postingTitle || ''), text } : null;
}

/**
 * amazon.jobs posting page: `<div class="section"><h2>Heading</h2>…</div>` blocks
 * (Description, Basic Qualifications, Preferred Qualifications).
 * @param {string} html
 * @param {string} id numeric job id from the posting URL
 * @returns {{title: string, text: string}|null}
 */
export function normalizeAmazonPage(html, id) {
  const src = String(html || '');
  const pageId = /'job_id'\s*:\s*'(\d+)'/.exec(src)?.[1];
  if (pageId && pageId !== String(id)) return null;
  const parts = [];
  const re = /<div class="section[^"]*">\s*<h2>([^<]{1,80})<\/h2>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(src)) !== null) parts.push([m[1].trim(), m[2]]);
  const text = joinSections(parts);
  if (!text) return null;
  const title = /<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/.exec(src)?.[1]?.trim() || '';
  return { title, text };
}

/**
 * Eightfold PCSX `/api/pcsx/position_details` payload.
 * @param {any} json
 * @param {string} pid position id from the posting URL
 * @returns {{title: string, text: string}|null}
 */
export function normalizeEightfoldDetail(json, pid) {
  const d = json?.data;
  if (!d || String(d.id ?? '') !== String(pid)) return null;
  const text = joinSections([['', d.jobDescription]]);
  return text ? { title: String(d.name || ''), text } : null;
}

/** The `__NEXT_DATA__` JSON of a Next.js page, or null. */
export function nextData(html) {
  const m = /<script id="?__NEXT_DATA__"? type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Text of a field that may be a string, a list, or a list of {text|description}. */
function looseText(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(looseText).filter(Boolean).join('\n');
  if (v && typeof v === 'object') return looseText(v.text ?? v.description ?? v.value ?? '');
  return '';
}

/**
 * careers.walmart.com posting page (`pageProps.jobDetails`).
 * @param {string} html
 * @param {string} id e.g. "R-2647437"
 * @returns {{title: string, text: string}|null}
 */
export function normalizeWalmartPage(html, id) {
  const j = nextData(html)?.props?.pageProps?.jobDetails;
  if (!j || typeof j !== 'object') return null;
  const want = String(id).toUpperCase();
  if (![j.jobId, j.jobPostingId].some((v) => String(v ?? '').toUpperCase() === want)) return null;
  const text = j.jobPostingDescription
    ? joinSections([['', j.jobPostingDescription]])
    : joinSections([
      ['', j.description],
      ['Minimum Qualifications', looseText(j.minimumQualification)],
      ['Preferred Qualifications', looseText(j.preferredQualification)],
    ]);
  return text ? { title: String(j.jobPostingTitle || j.title || ''), text } : null;
}

/**
 * higher.gs.com (Goldman Sachs) role page (`pageProps.role`).
 * @param {string} html
 * @param {string} id numeric role id from the URL
 * @returns {{title: string, text: string}|null}
 */
export function normalizeGoldmanPage(html, id) {
  const role = nextData(html)?.props?.pageProps?.role;
  if (!role || typeof role !== 'object') return null;
  const roleId = String(role.roleId ?? '');
  const sourceId = String(role.externalSource?.sourceId ?? '');
  if (roleId !== String(id) && !roleId.startsWith(`${id}_`) && sourceId !== String(id)) return null;
  const text = joinSections([['', role.descriptionHtml]]);
  return text ? { title: String(role.jobTitle || ''), text } : null;
}

/**
 * Rippling ATS posting page (ats.rippling.com): `pageProps.apiData.jobPost`,
 * whose description is split into `company` and `role` HTML.
 * @param {string} html
 * @param {string} uuid job id from the posting URL
 * @returns {{title: string, text: string}|null}
 */
export function normalizeRipplingPage(html, uuid) {
  const post = nextData(html)?.props?.pageProps?.apiData?.jobPost;
  if (!post || typeof post !== 'object') return null;
  if (String(post.uuid ?? '').toLowerCase() !== String(uuid).toLowerCase()) return null;
  const d = post.description && typeof post.description === 'object' ? post.description : {};
  const text = joinSections([['', d.role], ['', d.company]]);
  return text ? { title: String(post.name || ''), text } : null;
}

/**
 * Avature career portal job page (`/JobDetail/...`): the JD is the
 * `article--details` blocks (<article> or collapsible <details>) (description, qualifications, details fields). The
 * page must carry the requested id in its own job links (`jobId={id}`).
 * @param {string} html
 * @param {string} id numeric job id from the posting URL
 * @returns {{title: string, text: string}|null}
 */
const AVATURE_MAX_SECTIONS = 12;
export function normalizeAvaturePage(html, id) {
  const src = String(html || '');
  const want = String(id);
  if (!new RegExp(`jobId(?:=|%3D)${want}(?!\\d)`, 'i').test(src)) return null;
  // Sections are <article> or, when collapsible, <details> (the Description
  // block on avature.sandisk.com). One nested inside another is read once.
  const parts = [];
  let coveredTo = -1;
  for (const m of src.matchAll(/<(?:article|details|section)\b[^>]*class="[^"]*\barticle--details\b[^"]*"/gi)) {
    if (m.index < coveredTo) continue;
    if (parts.length >= AVATURE_MAX_SECTIONS) break; // each read scans the page; a real job has a handful
    const inner = elementInnerHtml(src, m.index);
    if (!inner) continue;
    parts.push(['', inner]);
    coveredTo = src.indexOf(inner, m.index) + inner.length;
  }
  const text = joinSections(parts);
  if (!text) return null;
  // The section headers are generic ("General Information"); the job title is og:title, when present.
  const og = /<meta\s+property="og:title"\s+content="([^"]*)"/i.exec(src)?.[1] ?? '';
  const title = jdHtmlToText(og.replace(/&amp;/gi, '&')).replace(/\s+/g, ' ').trim();
  return { title, text };
}

// ── Routing ────────────────────────────────────────────────────────

const ORACLE_PATH_RE = /^\/hcmUI\/CandidateExperience\/[^/]+\/sites\/([^/]+)\/(?:job|requisitions\/preview)\/(\d+)/i;

/**
 * Which reader serves this posting URL, with the parts it needs, or null.
 * @param {string} url
 * @returns {{reader: string, apiUrl: string, kind: 'json'|'text', id: string, normalize: (body: any, url: string, cap: number) => ({title: string, text: string}|null)}|null}
 */
export function resolveHostReader(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const path = u.pathname;

  // Oracle Recruiting Cloud, any tenant host (pod or branded, e.g. Dell).
  const orc = ORACLE_PATH_RE.exec(path);
  if (orc) {
    const [, site, id] = orc;
    const finder = `ById;Id=%22${id}%22,siteNumber=${encodeURIComponent(site)}`;
    return {
      reader: 'oraclecloud', kind: 'json', id,
      apiUrl: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${finder}`,
      normalize: (json) => normalizeOracleDetail(json, id),
    };
  }

  // Eightfold PCSX, any host (*.eightfold.ai, explore.jobs.netflix.net,
  // apply.careers.microsoft.com, careers.qualcomm.com, ...).
  const pid = (/^\/careers\/?$/i.test(path) || /^\/careers\/job\/?$/i.test(path)) ? u.searchParams.get('pid')
    : /^\/careers\/job\/(\d+)/i.exec(path)?.[1];
  if (pid && /^\d+$/.test(pid)) {
    const params = new URLSearchParams({ position_id: pid });
    const domain = u.searchParams.get('domain');
    if (domain && /^[a-z0-9.-]+$/i.test(domain)) params.set('domain', domain);
    return {
      reader: 'eightfold', kind: 'json', id: pid,
      apiUrl: `https://${host}/api/pcsx/position_details?${params}`,
      normalize: (json) => normalizeEightfoldDetail(json, pid),
    };
  }

  if (host === 'www.google.com' || host === 'careers.google.com') {
    const id = /\/jobs\/results\/(\d+)/.exec(path)?.[1];
    if (!id) return null;
    return {
      reader: 'google', kind: 'text', id,
      apiUrl: `https://www.google.com/about/careers/applications/jobs/results/${id}`,
      normalize: (html) => normalizeGooglePage(html, id),
    };
  }

  if (host === 'jobs.apple.com') {
    const jobNumber = /\/details\/([0-9]+(?:-[0-9]+)?)/.exec(path)?.[1];
    if (!jobNumber) return null;
    return {
      reader: 'apple', kind: 'json', id: jobNumber,
      apiUrl: `https://jobs.apple.com/api/v1/jobDetails/${jobNumber}`,
      normalize: (json) => normalizeAppleDetail(json, jobNumber),
    };
  }

  if (host === 'www.amazon.jobs' || host === 'amazon.jobs') {
    const m = /^\/([a-z]{2}(?:-[a-z]{2})?)\/jobs\/(\d+)(\/[^/?#]*)?/i.exec(path);
    if (!m) return null;
    const [, locale, id, slug = ''] = m;
    // The slug-less path answers a redirect, which the transport does not follow.
    if (!slug || slug === '/') return null;
    return {
      reader: 'amazon', kind: 'text', id,
      apiUrl: `https://www.amazon.jobs/${locale}/jobs/${id}${slug}`,
      normalize: (html) => normalizeAmazonPage(html, id),
    };
  }

  if (host === 'careers.walmart.com') {
    const id = /\/jobs\/(R-\d+)/i.exec(path)?.[1];
    if (!id) return null;
    return {
      reader: 'walmart', kind: 'text', id,
      apiUrl: `https://careers.walmart.com/us/en/jobs/${id}`,
      normalize: (html) => normalizeWalmartPage(html, id),
    };
  }

  if (host === 'higher.gs.com') {
    const id = /^\/roles\/(\d+)/.exec(path)?.[1];
    if (!id) return null;
    return {
      reader: 'goldman', kind: 'text', id,
      apiUrl: `https://higher.gs.com/roles/${id}`,
      normalize: (html) => normalizeGoldmanPage(html, id),
    };
  }

  if (host === 'ats.rippling.com') {
    const m = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?([a-z0-9_-]+)\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(path);
    if (!m) return null;
    const [, slug, uuid] = m;
    return {
      reader: 'rippling', kind: 'text', id: uuid,
      apiUrl: `https://ats.rippling.com/${slug}/jobs/${uuid}`,
      normalize: (html) => normalizeRipplingPage(html, uuid),
    };
  }

  // Avature portals, any host (avature.sandisk.com, bloomberg.avature.net,
  // jobs.ea.com): `/{portal}/JobDetail/{slug}/{id}` or `.../JobDetail?jobId={id}`.
  const avature = /^\/((?:[a-z]{2}_[A-Z]{2}\/)?[A-Za-z0-9_-]+)\/JobDetail(?:\/[^/?#]*)?\/(\d+)\/?$/.exec(path)
    ?? (/^\/((?:[a-z]{2}_[A-Z]{2}\/)?[A-Za-z0-9_-]+)\/JobDetail\/?$/.test(path) && /^\d+$/.test(u.searchParams.get('jobId') || '')
      ? [null, /^\/(.+?)\/JobDetail/.exec(path)[1], u.searchParams.get('jobId')] : null);
  if (avature) {
    const id = avature[2];
    // The posting's own page (no fragment, and only the jobId query when that is where the id is).
    const query = /\/\d+\/?$/.test(path) ? '' : `?jobId=${id}`;
    return {
      reader: 'avature', kind: 'text', id,
      apiUrl: `https://${host}${path}${query}`,
      normalize: (html) => normalizeAvaturePage(html, id),
    };
  }

  // ServiceNow's careers site fronts SmartRecruiters: the id in its URL is the
  // SmartRecruiters posting id.
  if (host === 'careers.servicenow.com') {
    const id = /^\/jobs\/(\d+)/.exec(path)?.[1];
    if (!id) return null;
    return {
      reader: 'servicenow', kind: 'json', id,
      apiUrl: `https://api.smartrecruiters.com/v1/companies/ServiceNow/postings/${id}`,
      normalize: (json, postingUrl, textCap) => (String(json?.id ?? '') === id
        ? normalizeSmartRecruitersJob(json, postingUrl, textCap)
        : null),
    };
  }

  return null;
}

/**
 * Hosts whose posting URL redirects to a different path the page reader then
 * refuses (a redirect is not proof it is the same document). The canonical
 * path is requested directly instead. iCIMS Jibe: /jobs/N -> /careers-home/jobs/N.
 * @param {string} url
 * @returns {string} the URL to read the posting page from
 */
export function canonicalPageUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const jibe = /^\/jobs\/(\d+)\/?$/.exec(u.pathname);
    if (jibe && JIBE_CAREERS_HOME_HOSTS.has(host)) return `https://${host}/careers-home/jobs/${jibe[1]}`;
    // iCIMS: the bare job page is a frame shell; the JD (and its JSON-LD) is the
    // framed document, the same path with in_iframe=1.
    if ((host === 'icims.com' || host.endsWith('.icims.com')) && /^\/jobs\/\d+\/[^/]+\/job\/?$/.test(u.pathname)
      && !u.searchParams.has('in_iframe')) {
      u.searchParams.set('in_iframe', '1');
      u.hash = '';
      return u.href;
    }
    // Phenom sites whose `global` locale answers a redirect to the US home page
    // (not the job): the job lives under the `us` locale at the same path.
    const phenomGlobal = /^\/global\/([a-z]{2})\/job\//.exec(u.pathname);
    if (phenomGlobal && PHENOM_US_LOCALE_HOSTS.has(host)) {
      u.pathname = u.pathname.replace(/^\/global\//, '/us/');
      return u.href;
    }
  } catch { /* fall through */ }
  return url;
}
// Measured 2026-11-20: careers.franklintempleton.com/global/en/job/{id}/... -> 303 /us/en.
const PHENOM_US_LOCALE_HOSTS = new Set(['careers.franklintempleton.com']);
const JIBE_CAREERS_HOME_HOSTS = new Set(['careers.amd.com']);

// ── Fetch ──────────────────────────────────────────────────────────

/**
 * Full JD text from the host reader for this URL.
 *
 * @param {string} url
 * @param {{ textCap?: number, timeoutMs?: number, ctx?: any }} [opts]
 * @returns {Promise<{url: string, title: string, text: string, reader: string}|null>}
 *   null when no reader covers the URL. Throws when the reader's request fails
 *   or its answer holds no JD for this posting (closed, or a shape change).
 */
export async function fetchJdViaHostReader(url, { textCap = 60_000, timeoutMs = 15_000, ctx = makeHttpCtx() } = {}) {
  const r = resolveHostReader(url);
  if (!r) return null;
  await throttleProviderRequest(`jd-host:${r.reader}`, READER_SPACING_MS);
  const opts = {
    timeoutMs,
    headers: {
      accept: r.kind === 'json' ? 'application/json' : 'text/html,application/xhtml+xml',
      'user-agent': BROWSER_LIKE_USER_AGENT,
    },
  };
  const body = r.kind === 'json'
    ? await fetchJsonWithRetry(ctx, r.apiUrl, opts, RETRY_POLICY)
    : await fetchTextWithRetry(ctx, r.apiUrl, opts, RETRY_POLICY);
  const result = r.normalize(body, url, textCap);
  if (!result?.text) throw new Error(`${r.reader} answered without a JD for this posting`);
  return { url, title: result.title || '', text: cap(result.text, textCap), reader: r.reader };
}
