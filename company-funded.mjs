#!/usr/bin/env node

/**
 * company-funded.mjs - discover recently funded companies for manual review.
 *
 * V1 is intentionally narrow: it reads structured public feeds/APIs, writes a
 * report/JSON candidate list, and never probes arbitrary company websites or
 * edits portals.yml.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { isIP } from 'net';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { decodeEntities } from './providers/_html-entities.mjs';
import { BROWSER_LIKE_USER_AGENT } from './user-agent.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LIMIT = 20;
const DEFAULT_MONTHS = 3;
const DEFAULT_SORT = 'date';
const DEFAULT_SOURCES = ['techcrunch', 'prnewswire', 'guardian', 'hn'];

const RSS_SOURCES = {
  techcrunch: [
    'https://techcrunch.com/feed/',
    'https://techcrunch.com/category/startups/feed/',
    'https://techcrunch.com/tag/funding/feed/',
  ],
  prnewswire: [
    'https://www.prnewswire.com/rss/news-releases-list.rss',
    'https://www.prnewswire.com/rss/venture-capital-list.rss',
  ],
  guardian: ['https://www.theguardian.com/technology/rss'],
};

const SOURCE_HOSTS = {
  techcrunch: ['techcrunch.com'],
  prnewswire: ['prnewswire.com'],
  guardian: ['theguardian.com'],
  hacker_news: ['hn.algolia.com', 'news.ycombinator.com'],
};

const SOURCE_RANK = {
  techcrunch: 70,
  prnewswire: 65,
  guardian: 50,
  hacker_news: 35,
  web: 5,
};

const GENERIC_NAMES = new Set([
  'ai',
  'startup',
  'startups',
  'company',
  'companies',
  'founder',
  'founders',
  'developer',
  'developers',
  'edtech platform',
  'fintech platform',
  'healthcare platform',
  'security platform',
  'techcrunch',
  'pr newswire',
  'business wire',
  'globenewswire',
  'crunchbase',
  'hacker news',
  'valuation',
  'valuations',
  'bubble',
  'fears',
  'funding',
  'fund',
  'round',
]);

function usage() {
  console.log(`Usage:
  node company-funded.mjs --dry-run
  node company-funded.mjs --limit 25 --months 6 --sort date
  node company-funded.mjs --sources techcrunch,prnewswire,guardian,hn --dry-run

Options:
  --limit <n>             Max companies in the review list. Default: 20.
  --months <n>            Recent-funding window. Default: 3.
  --sort <date|score>     Candidate ordering. Default: date.
  --sources <csv>         Sources. Default: techcrunch,prnewswire,guardian,hn.
  --dry-run               Print only; do not write report/JSON files.
  --json                  Print machine-readable JSON.
  --self-test             Run offline self-test.
`);
}

function parseArgs(argv) {
  const opts = {
    limit: DEFAULT_LIMIT,
    months: DEFAULT_MONTHS,
    sort: DEFAULT_SORT,
    sources: [...DEFAULT_SOURCES],
    dryRun: false,
    json: false,
    selfTest: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--self-test') opts.selfTest = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--limit') opts.limit = Number(argv[++i] || '');
    else if (arg === '--months') opts.months = Number(argv[++i] || '');
    else if (arg === '--sort') opts.sort = String(argv[++i] || '').trim().toLowerCase();
    else if (arg === '--sources') opts.sources = parseSources(argv[++i] || '');
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!Number.isInteger(opts.limit) || opts.limit <= 0 || opts.limit > 100) {
    throw new Error('--limit must be an integer from 1 to 100');
  }
  if (!Number.isInteger(opts.months) || opts.months <= 0 || opts.months > 120) {
    throw new Error('--months must be an integer from 1 to 120');
  }
  if (!['date', 'score'].includes(opts.sort)) {
    throw new Error('--sort must be date or score');
  }
  return opts;
}

function parseSources(value) {
  const out = String(value || '')
    .split(',')
    .map((s) => normalizeSourceName(s.trim()))
    .filter(Boolean);
  const unique = [...new Set(out)];
  const allowed = new Set(['techcrunch', 'prnewswire', 'guardian', 'hn']);
  for (const source of unique) {
    if (!allowed.has(source)) throw new Error(`unknown source in --sources: ${source}`);
  }
  return unique.length ? unique : [...DEFAULT_SOURCES];
}

function normalizeSourceName(value) {
  const s = String(value || '').toLowerCase().replace(/[_\s]+/g, '-');
  if (s === 'hacker-news' || s === 'hackernews' || s === 'hn') return 'hn';
  return s.replace(/-/g, '');
}

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function companySlug(name) {
  return compact(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function matchesDomain(hostname, domain) {
  const host = String(hostname || '').toLowerCase();
  const d = String(domain || '').toLowerCase();
  return Boolean(host && d && (host === d || host.endsWith(`.${d}`)));
}

function allowedSourceDomains(source) {
  return SOURCE_HOSTS[source === 'hn' ? 'hacker_news' : source] || [];
}

function parseHttpUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function trustedForSource(raw, source) {
  const url = parseHttpUrl(raw);
  if (!url) return false;
  const domains = allowedSourceDomains(source);
  return domains.some((domain) => matchesDomain(url.hostname, domain));
}

function isPrivateIpv4(parts) {
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function parseIpv4Part(part) {
  if (/^0x[0-9a-f]+$/i.test(part)) return Number.parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return Number.parseInt(part, 8);
  if (/^\d+$/.test(part)) return Number.parseInt(part, 10);
  return NaN;
}

function parseIpv4Hostname(host) {
  const parts = String(host || '').split('.');
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => part === '')) return null;
  if (!parts.every((part) => /^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(part))) return null;
  const nums = parts.map(parseIpv4Part);
  if (nums.some((num) => !Number.isSafeInteger(num) || num < 0)) return null;
  const prefix = nums.slice(0, -1);
  if (prefix.some((num) => num > 255)) return null;
  const last = nums.at(-1);
  const remainingBytes = 5 - nums.length;
  if (last > 256 ** remainingBytes - 1) return null;
  if (nums.length === 1) return [(last >>> 24) & 255, (last >>> 16) & 255, (last >>> 8) & 255, last & 255];
  if (nums.length === 2) return [nums[0], (last >>> 16) & 255, (last >>> 8) & 255, last & 255];
  if (nums.length === 3) return [nums[0], nums[1], (last >>> 8) & 255, last & 255];
  return nums;
}

function parseIpv4MappedIpv6(host) {
  const normalized = String(host || '').toLowerCase();
  const dotted = normalized.match(/^(?:0:0:0:0:0:ffff:|::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseIpv4Hostname(dotted[1]);
  const hex = normalized.match(/^(?:0:0:0:0:0:ffff:|::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (high > 0xffff || low > 0xffff) return null;
  return [(high >>> 8) & 255, high & 255, (low >>> 8) & 255, low & 255];
}

function isPrivateOrInternalHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const ipv4 = parseIpv4Hostname(host);
  if (ipv4) return isPrivateIpv4(ipv4);

  const version = isIP(host);
  if (version !== 6) return false;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;

  const mappedIpv4 = parseIpv4MappedIpv6(host);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);

  const firstHextet = host.split(':')[0];
  if (/^f[cd][0-9a-f]{0,2}$/i.test(firstHextet)) return true;
  const first = Number.parseInt(firstHextet, 16);
  return Number.isFinite(first) && first >= 0xfe80 && first <= 0xfebf;
}

function untrustedSourceMeta(url, finalUrl, message, status = 0, contentType = '') {
  return {
    url,
    finalUrl,
    status,
    ok: false,
    contentType,
    text: '',
    blocked: false,
    error: message,
  };
}

async function releaseResponseBody(res) {
  try {
    if (res?.bodyUsed) return;
    await res?.arrayBuffer?.();
  } catch {
    // Best-effort cleanup for rejected responses.
  }
}

export function sourceFromUrl(raw, fallback = 'web') {
  const url = parseHttpUrl(raw);
  if (!url) return fallback;
  for (const [source, domains] of Object.entries(SOURCE_HOSTS)) {
    if (domains.some((domain) => matchesDomain(url.hostname, domain))) return source;
  }
  return fallback;
}

function trustedEvidenceUrl(raw, source) {
  const url = parseHttpUrl(raw);
  if (!url) return '';
  const derived = sourceFromUrl(url.href, '');
  if (!derived) return '';
  if (source && source !== 'web' && derived !== source && !(source === 'hn' && derived === 'hacker_news')) return '';
  return url.href;
}

function cdataValue(text) {
  const match = String(text || '').match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return match ? match[1] : text;
}

function xmlText(text) {
  return compact(decodeEntities(cdataValue(String(text || ''))));
}

function stripPublisher(title) {
  return compact(title)
    .replace(/\s+\|\s+.*$/i, '')
    .replace(/\s+-\s+(TechCrunch|Crunchbase|Forbes|Reuters|Bloomberg|BusinessWire|PR Newswire|SiliconANGLE|VentureBeat|The Guardian).*$/i, '')
    .replace(/^Show HN:\s*/i, '')
    .replace(/^Ask HN:\s*/i, '');
}

function cleanCompanyName(raw) {
  let s = stripPublisher(xmlText(raw))
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/'s$/i, '')
    .replace(/’s$/i, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s*,.*$/g, '')
    .trim();

  const afterStartup = s.match(/\bstartup\s+(.+)$/i);
  if (afterStartup?.[1]) s = afterStartup[1].trim();
  if (/\bstartup$/i.test(s) && /['’]s\b/i.test(s)) return '';
  if (/['’]s\b.*\b(company|startup)\b/i.test(s)) return '';
  s = s.replace(/\s+in talks to$/i, '');
  s = s.replace(/\s+reportedly$/i, '');
  s = s.replace(/\s+defies\s+.+$/i, '');
  s = s.replace(/^[A-Z][A-Za-z0-9&.-]+-backed\s+/i, '');
  s = s.replace(/\b(?:maker|creator)\s+of\s+.+$/i, '');
  s = s.replace(/^(?:the\s+)?(?:(?:ai|genai|agentic|coding|developer tools|developer|data|security|fintech|startup|software|robotics|defense|healthcare|biotech|open-source|enterprise|infrastructure|crypto|climate)\s+)+(?:startup|company|platform)?\s+/i, '');
  s = s.replace(/^.+\bmaker\s+/i, '');
  s = s.replace(/^(?:startup|company|platform)\s+/i, '');
  s = compact(s);

  if (s.length < 2 || s.length > 70) return '';
  if (/[<>]/.test(s)) return '';
  if (GENERIC_NAMES.has(s.toLowerCase())) return '';
  if (/^(ai|genai|agentic|edtech|fintech|security|healthcare|biotech|robotics|climate|crypto|developer tools?)\s+(startup|company|platform)$/i.test(s)) return '';
  if (/\b(valuation|valuations|bubble|fears|earnings|fund)\b/i.test(s)) return '';
  if (!/[a-z0-9]/i.test(s)) return '';
  return s;
}

export function extractCompanyFromFundingTitle(title) {
  const t = stripPublisher(xmlText(title));
  if (/^(ask hn|tell hn|who is hiring|launch hn)\b/i.test(t)) return '';

  const patterns = [
    /\b(?:raises?|raised|lands|landed|secures?|secured|closes?|closed|nabs?|nabbed|bags?|bagged)\s+(?:an?\s+|over\s+|more\s+than\s+|up\s+to\s+)?\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\s+for\s+(?:an?\s+)?(?:ai\s+)?startup\s+(.+?)$/i,
    /\bstartup\s+(.+?)\s+(?:reportedly\s+)?(?:raises?|raised|lands|landed|secures?|secured|closes?|closed|nabs?|nabbed|bags?|bagged)\b/i,
    /(?:startup|company|agency|platform)\s+(.+?)\s+hits\s+unicorn\s+status\b.*\braises?\b/i,
    /^(.+?)\s+(?:raises?|raised|lands|landed|secures?|secured|closes?|closed|nabs?|nabbed|bags?|bagged)\s+(?:an?\s+|over\s+|more\s+than\s+|up\s+to\s+)?\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\b/i,
    /^(.+?)\s+(?:raises?|raised|lands|landed|secures?|secured|closes?|closed|nabs?|nabbed|bags?|bagged)\s+(?:an?\s+)?(?:\w+\s+){0,4}(?:funding|round|series\s+[a-h]|seed|pre-seed|investment|financing|valuation)\b/i,
    /^(.+?)\s+(?:announces?|announced)\s+(?:\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\s+)?(?:\w+\s+){0,4}(?:funding|round|series\s+[a-h]|seed|pre-seed|financing)\b/i,
    /^(.+?)\s+(?:gets|got|receives?|received)\s+(?:\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\s+)?(?:in\s+)?(?:funding|investment|financing)\b/i,
    /^(.+?)\s+(?:hits?|hit|reaches?|reached)\s+(?:a\s+)?\$[\d.,]+(?:\.\d+)?\s*(?:billion|million|bn|[bkmt])?\s+valuation\b/i,
    /^(.+?)\s+valued\s+at\s+\$[\d.,]+(?:\.\d+)?\s*(?:billion|million|bn|[bkmt])?\b/i,
    /^(.+?)\s+emerges? from stealth\b/i,
    /^(.+?)\s+in\s+talks\s+to\s+raise\b/i,
  ];

  for (const re of patterns) {
    const match = t.match(re);
    if (match?.[1]) return cleanCompanyName(match[1]);
  }
  return '';
}

export function extractFundingDetails(text) {
  const raw = xmlText(text);
  const amount = raw.match(/\$[\d,.]+(?:\.\d+)?\s*(?:billion|million|bn|m|b|k)?/i)?.[0] || '';
  const round = raw.match(/\b(?:pre-seed|seed|series\s+[a-h]|strategic|venture|growth)\b/i)?.[0] || '';
  return {
    amount: compact(amount),
    round: round ? round.replace(/\s+/g, ' ').replace(/\bseries\b/i, 'Series') : '',
  };
}

function companyKey(name) {
  return compact(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function diagnostic(source) {
  return {
    source,
    status: 'ok',
    fetched_items: 0,
    funding_like_items: 0,
    candidate_count: 0,
    blocked: false,
    errors: [],
  };
}

function markDiagnosticError(diag, message, { blocked = false } = {}) {
  if (!message) return;
  diag.errors.push(message);
  if (blocked) diag.blocked = true;
  if (diag.status !== 'blocked') diag.status = blocked ? 'blocked' : 'error';
}

function detectBlockedContent(text, { status = 200, contentType = '' } = {}) {
  const raw = String(text || '').slice(0, 20_000);
  if ([401, 403, 429, 503].includes(Number(status))) return true;
  if (/text\/html/i.test(contentType) || /<html/i.test(raw)) {
    return /\b(access denied|captcha|cloudflare|attention required|verify you are human|enable javascript|unusual traffic|temporarily blocked|bot detection|ddos-guard|akamai|perimeterx)\b/i.test(raw);
  }
  return false;
}

async function fetchTextMeta(url, { timeoutMs = 12_000, source = '' } = {}) {
  const startUrl = String(url || '');
  if (!trustedForSource(startUrl, source)) return untrustedSourceMeta(startUrl, startUrl, `untrusted source URL: ${startUrl}`);
  if (isPrivateOrInternalHostname(new URL(startUrl).hostname)) {
    return untrustedSourceMeta(startUrl, startUrl, `internal source URL rejected: ${startUrl}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = startUrl;
    for (let hops = 0; hops <= 5; hops++) {
      const res = await fetch(currentUrl, {
        headers: { 'user-agent': BROWSER_LIKE_USER_AGENT, accept: 'application/rss+xml,application/xml,text/xml,text/plain,*/*' },
        redirect: 'manual',
        signal: controller.signal,
      });
      const contentType = res.headers.get('content-type') || '';
      if ([301, 302, 303, 307, 308].includes(Number(res.status))) {
        const location = res.headers.get('location') || '';
        if (!location) {
          await releaseResponseBody(res);
          return untrustedSourceMeta(startUrl, currentUrl, `redirect without Location: ${currentUrl}`, res.status, contentType);
        }
        let nextUrl;
        try {
          nextUrl = new URL(location, currentUrl).href;
        } catch {
          await releaseResponseBody(res);
          return untrustedSourceMeta(startUrl, currentUrl, `invalid redirect Location: ${location}`, res.status, contentType);
        }
        const nextHost = new URL(nextUrl).hostname;
        if (isPrivateOrInternalHostname(nextHost)) {
          await releaseResponseBody(res);
          return untrustedSourceMeta(startUrl, nextUrl, `internal redirect target rejected: ${nextUrl}`, res.status, contentType);
        }
        if (!trustedForSource(nextUrl, source)) {
          await releaseResponseBody(res);
          return untrustedSourceMeta(startUrl, nextUrl, `untrusted final source URL: ${nextUrl}`, res.status, contentType);
        }
        await releaseResponseBody(res);
        currentUrl = nextUrl;
        continue;
      }

      const finalUrl = res.url || currentUrl;
      if (!trustedForSource(finalUrl, source)) {
        await releaseResponseBody(res);
        return untrustedSourceMeta(startUrl, finalUrl, `untrusted final source URL: ${finalUrl}`, res.status, contentType);
      }
      const text = await res.text().catch(() => '');
      return {
        url: startUrl,
        finalUrl,
        status: res.status,
        ok: res.ok,
        contentType,
        text,
        blocked: detectBlockedContent(text, { status: res.status, contentType }),
        error: res.ok ? '' : `HTTP ${res.status}`,
      };
    }
    return untrustedSourceMeta(startUrl, startUrl, 'too many redirects');
  } catch (err) {
    return {
      url: startUrl,
      finalUrl: startUrl,
      status: 0,
      ok: false,
      contentType: '',
      text: '',
      blocked: false,
      error: err?.name === 'AbortError' ? 'timeout' : (err?.message || 'fetch failed'),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonMeta(url, { timeoutMs = 12_000, source = '' } = {}) {
  const meta = await fetchTextMeta(url, { timeoutMs, source });
  if (!meta.ok) return { ...meta, json: null };
  try {
    return { ...meta, json: JSON.parse(meta.text) };
  } catch (err) {
    return { ...meta, ok: false, json: null, error: `invalid JSON: ${err.message}` };
  }
}

function tagValue(xml, names) {
  for (const name of names) {
    const escaped = name.replace(':', '\\:');
    const re = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i');
    const match = String(xml || '').match(re);
    if (match?.[1]) return xmlText(match[1]);
  }
  return '';
}

function attrValue(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, 'i');
  return xmlText(String(xml || '').match(re)?.[1] || '');
}

function categoriesFromXml(xml) {
  return [...String(xml || '').matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
    .map((match) => xmlText(match[1]))
    .filter(Boolean);
}

function parsePublishedDate(value) {
  const raw = compact(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return {
    value: date.toISOString().slice(0, 10),
    precision: 'day',
    date,
  };
}

export function parseRssItems(xml, { source = 'web' } = {}) {
  const out = [];
  const raw = String(xml || '');
  const blocks = [
    ...raw.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...raw.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ];
  for (const blockMatch of blocks) {
    const block = blockMatch[1];
    const title = tagValue(block, ['title']);
    const description = tagValue(block, ['description', 'summary', 'content:encoded', 'content']);
    const link = compact(tagValue(block, ['link'])) || attrValue(block, 'link', 'href');
    const observedDate = parsePublishedDate(tagValue(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const sourceCompany = tagValue(block, ['dc:contributor', 'dc:creator', 'author', 'source']);
    const itemSource = sourceFromUrl(link, source);
    if (!title && !link) continue;
    out.push({
      source: itemSource === 'web' ? source : itemSource,
      title,
      url: trustedEvidenceUrl(link, itemSource === 'web' ? source : itemSource),
      published_at: observedDate?.date?.toISOString() || '',
      observedDate,
      text: compact(`${title} ${description}`),
      categories: categoriesFromXml(block),
      source_company: sourceCompany,
    });
  }
  return out;
}

function hasFundingLanguage(text) {
  return /\b(funding|funded|raises?|raised|raise|series\s+[a-h]|seed\s+round|pre-seed|venture\s+round|investment|financing|valuation|valued\s+at|lands?|landed|secures?|secured|closes?|closed|nabs?|nabbed|bags?|bagged|emerges?\s+from\s+stealth|in\s+talks\s+to\s+raise)\b/i.test(text);
}

function isExcludedFundingItem(item) {
  const text = `${item.title || ''} ${item.text || ''} ${item.categories?.join(' ') || ''}`;
  const exclusions = [
    // (?<!\w)/(?!\w), not \b: the `cuts N%` alternative ends in "%", and a
    // trailing \b can never match after a non-word character — so that
    // alternative was dead and layoff headlines that also mention a raise
    // ("Acme raises $40M Series A, then cuts 30% of staff") were surfaced as
    // funding leads. Same symbol-edge class as the fix in #2227. For every
    // other alternative (all of which end in a word character) \b and the
    // lookarounds are equivalent, so their behaviour is unchanged.
    /(?<!\w)(acquires?|acquired|acquisition|merger|spac|ipo|bankruptcy|layoffs?|earnings|quarterly results)(?!\w)/i,
    // A layoff announced in the same headline as a raise is the case #2404
    // fixed, but it only covered one spelling — "cuts N%". These reach the
    // same reader with the same harm, the tool recommending a company that
    // just announced job losses:
    //   "raises $40M …, then cuts 30 % of staff"    (a space before the percent)
    //   "raises $40M …, then cuts 1,200 jobs"       (a count, no percent)
    //   "raises $40M … and lays off 300 employees"  (a different verb)
    //
    // EVERY form requires a workforce noun, percent included. The percent
    // alternative used to sit in the group above with no such requirement, so
    // "cuts 30% of cloud costs" — a cost story at a company that may well
    // still be hiring — was excluded as if it were a layoff. Scoping it here
    // fixes that and makes the two numeric forms consistent, which splitting
    // them did not (CodeRabbit review). The optional "of its/the/their"
    // carries the spellings the corpus uses ("cuts 15% of its workforce").
    /(?<!\w)(cuts?|axes|slashes|eliminates|sheds)\s+\d[\d,.]*\s*(?:%\s*)?(?:of\s+)?(?:its\s+|the\s+|their\s+)?(jobs|roles|positions|staff|employees|workers|workforce|headcount)(?!\w)/i,
    // Plural too: "amid workforce reductions" bypassed the singular-only form.
    /\b(lays?\s+off|laying\s+off|laid\s+off|job\s+cuts|workforce\s+reductions?|headcount\s+reductions?|staff\s+reductions?)\b/i,
    /\b(public offering|registered direct offering|private placement|atm offering|offering of common stock)\b/i,
    /\braises?\s+\$[\d,.]+(?:\.\d+)?\s*(?:billion|million|bn|m|b|k)?\s+fund\b/i,
    /\b(venture fund|vc fund|investment fund|private equity fund|capital fund|fund ii|fund iii|fund iv|new fund)\b/i,
    /\b(grant|grants|scholarship|scholarships|award|awards|donation|donates?)\b/i,
    /\b(how to raise|ways to raise|guide to fundraising|startup valuations|bubble fears)\b/i,
  ];
  if (exclusions.some((re) => re.test(text))) return true;
  return !hasFundingLanguage(text);
}

function inferredDateFromText(text, now = new Date()) {
  const raw = String(text || '');
  const year = raw.match(/\b(20\d{2})\b/)?.[1];
  if (year) {
    const currentYear = now.getUTCFullYear();
    const date = Number(year) === currentYear ? new Date(now.getTime()) : new Date(`${year}-01-01T00:00:00Z`);
    return { value: String(year), precision: 'year', date };
  }
  return { value: now.toISOString().slice(0, 10), precision: 'observed', date: now };
}

function bestObservedDate(item, now) {
  if (item.observedDate?.date instanceof Date && !Number.isNaN(item.observedDate.date.getTime())) return item.observedDate;
  if (item.published_at) {
    const parsed = parsePublishedDate(item.published_at);
    if (parsed) return parsed;
  }
  return inferredDateFromText(`${item.title || ''} ${item.text || ''}`, now);
}

function withinMonths(date, months, now) {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return date >= cutoff && date <= now;
}

function confidenceFor(item, details) {
  const sourceStrong = ['techcrunch', 'prnewswire', 'guardian'].includes(item.source);
  const detailStrong = Boolean(details.amount || details.round);
  if (sourceStrong && detailStrong) return 'high';
  if (sourceStrong || detailStrong) return 'medium';
  return 'low';
}

function candidateFromItem(item, { now }) {
  if (isExcludedFundingItem(item)) return null;
  const observed = bestObservedDate(item, now);
  const details = extractFundingDetails(`${item.title || ''} ${item.text || ''}`);
  const sourceCompany = item.source === 'prnewswire' ? cleanCompanyName(item.source_company || '') : '';
  const company = extractCompanyFromFundingTitle(item.title) || sourceCompany;
  if (!company) return null;
  return {
    company,
    amount: details.amount,
    round: details.round,
    source: item.source || sourceFromUrl(item.url),
    title: compact(item.title || ''),
    url: trustedEvidenceUrl(item.url || '', ''),
    observedDate: observed,
    confidence: confidenceFor(item, details),
  };
}

export function buildCandidates(items, {
  months = DEFAULT_MONTHS,
  sort = DEFAULT_SORT,
  limit = DEFAULT_LIMIT,
  now = new Date(),
  diagnostics = [],
} = {}) {
  const grouped = new Map();
  for (const item of items || []) {
    const candidate = candidateFromItem(item, { now });
    if (!candidate) continue;
    if (!withinMonths(candidate.observedDate.date, months, now)) continue;
    const key = companyKey(candidate.company);
    if (!key) continue;
    const current = grouped.get(key) || {
      company: candidate.company,
      amount: '',
      round: '',
      funding: { status: 'recent_funding', confidence: 'low', sources: [] },
      discovery_score: 0,
      suggested_action: 'review_company_manually',
    };
    if (!current.amount && candidate.amount) current.amount = candidate.amount;
    if (!current.round && candidate.round) current.round = candidate.round;
    const evidence = {
      source: candidate.source,
      title: candidate.title,
      url: candidate.url,
      observed_date: candidate.observedDate.value,
      date_precision: candidate.observedDate.precision,
    };
    const evidenceKey = `${evidence.source}\n${evidence.title}\n${evidence.url}\n${evidence.observed_date}`;
    const duplicateEvidence = current.funding.sources.some((src) => `${src.source}\n${src.title}\n${src.url}\n${src.observed_date}` === evidenceKey);
    if (!duplicateEvidence) {
      current.funding.sources.push(evidence);
      const sourceRank = SOURCE_RANK[candidate.source] || SOURCE_RANK.web;
      const detailBonus = (candidate.amount ? 10 : 0) + (candidate.round ? 8 : 0);
      const confidenceBonus = candidate.confidence === 'high' ? 15 : candidate.confidence === 'medium' ? 8 : 0;
      current.discovery_score += sourceRank + detailBonus + confidenceBonus;
      current.funding.confidence = bestConfidence(current.funding.confidence, candidate.confidence);
    }
    grouped.set(key, current);
  }

  const candidates = [...grouped.values()].map((candidate) => {
    candidate.funding.sources.sort((a, b) => String(b.observed_date || '').localeCompare(String(a.observed_date || '')));
    return candidate;
  });

  candidates.sort((a, b) => {
    if (sort === 'score') return b.discovery_score - a.discovery_score || a.company.localeCompare(b.company);
    const ad = a.funding.sources[0]?.observed_date || '';
    const bd = b.funding.sources[0]?.observed_date || '';
    return bd.localeCompare(ad) || b.discovery_score - a.discovery_score || a.company.localeCompare(b.company);
  });
  const finalCandidates = candidates.slice(0, limit);

  for (const diag of diagnostics) {
    diag.candidate_count = finalCandidates.filter((c) => c.funding.sources.some((s) => s.source === sourceNameForDiagnostic(diag.source))).length;
  }

  return finalCandidates;
}

function sourceNameForDiagnostic(source) {
  return source === 'hn' ? 'hacker_news' : source;
}

function bestConfidence(a, b) {
  const rank = { low: 1, medium: 2, high: 3 };
  return rank[b] > rank[a] ? b : a;
}

async function fetchRssDiscovery(source, diagnostics) {
  const diag = diagnostics.find((d) => d.source === source) || diagnostic(source);
  const out = [];
  for (const url of RSS_SOURCES[source] || []) {
    const meta = await fetchTextMeta(url, { source });
    if (!meta.ok || meta.blocked) {
      markDiagnosticError(diag, `${url}: ${meta.error || (meta.blocked ? 'blocked/challenge page' : 'fetch failed')}`, { blocked: meta.blocked });
      continue;
    }
    const items = parseRssItems(meta.text, { source });
    diag.fetched_items += items.length;
    for (const item of items) {
      if (isExcludedFundingItem(item)) continue;
      diag.funding_like_items += 1;
      out.push(item);
    }
  }
  if (diag.fetched_items === 0 && diag.errors.length === 0) markDiagnosticError(diag, 'no RSS items fetched');
  return out;
}

function hnQueries() {
  return [
    'AI startup raises funding',
    'Series A AI startup',
    'developer tools startup funding',
    'infrastructure startup raises funding',
    'agentic AI raises seed',
  ];
}

async function fetchHnDiscovery({ months = DEFAULT_MONTHS, diagnostics = [] } = {}) {
  const diag = diagnostics.find((d) => d.source === 'hn') || diagnostic('hn');
  const cutoff = Math.floor(Date.now() / 1000) - months * 31 * 24 * 60 * 60;
  const out = [];
  for (const query of hnQueries()) {
    const url =
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
      `&tags=story&hitsPerPage=50&numericFilters=created_at_i>${cutoff}`;
    const meta = await fetchJsonMeta(url, { source: 'hacker_news' });
    if (!meta.ok || meta.blocked || !meta.json) {
      markDiagnosticError(diag, `${url}: ${meta.error || (meta.blocked ? 'blocked/challenge page' : 'fetch failed')}`, { blocked: meta.blocked });
      continue;
    }
    const hits = Array.isArray(meta.json?.hits) ? meta.json.hits : [];
    diag.fetched_items += hits.length;
    for (const hit of hits) {
      const title = compact(hit.title || hit.story_title || '');
      if (!title) continue;
      const fallbackUrl = `https://news.ycombinator.com/item?id=${encodeURIComponent(String(hit.objectID || ''))}`;
      const itemUrl = trustedEvidenceUrl(hit.url || '', '') || trustedEvidenceUrl(fallbackUrl, 'hacker_news');
      const item = {
        source: 'hacker_news',
        title: xmlText(title),
        url: itemUrl,
        published_at: hit.created_at ? new Date(hit.created_at).toISOString() : '',
        observedDate: hit.created_at ? { value: hit.created_at.slice(0, 10), precision: 'day', date: new Date(hit.created_at) } : null,
        text: xmlText(hit.story_text || ''),
        categories: [],
        source_company: '',
      };
      if (isExcludedFundingItem(item)) continue;
      diag.funding_like_items += 1;
      out.push(item);
    }
  }
  if (diag.fetched_items === 0 && diag.errors.length === 0) markDiagnosticError(diag, 'no HN items fetched');
  return out;
}

async function collectDiscoveryItems(opts, diagnostics) {
  const requested = new Set(opts.sources || DEFAULT_SOURCES);
  const hits = [];
  for (const source of ['techcrunch', 'prnewswire', 'guardian']) {
    if (requested.has(source)) hits.push(...await fetchRssDiscovery(source, diagnostics));
  }
  if (requested.has('hn')) {
    hits.push(...await fetchHnDiscovery({ months: opts.months, diagnostics }));
  }
  return hits;
}

function markdownText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\r?\n/g, ' ');
}

function safeReportUrl(value) {
  const url = parseHttpUrl(value);
  if (!url) return '';
  return url.href.replace(/[<>\s]/g, encodeURIComponent);
}

export function renderReport(result) {
  const lines = [];
  lines.push(`# Funded Company Discovery - ${markdownText(result.generated_at)}`);
  lines.push('');
  lines.push('Review-first output. No companies were added to portals.yml and no company websites were probed.');
  lines.push('');
  lines.push(`Window: ${result.window_months} months`);
  lines.push(`Sort: ${markdownText(result.sort)}`);
  lines.push(`Sources: ${result.sources.map(markdownText).join(', ')}`);
  lines.push(`Candidates: ${result.companies.length}`);
  lines.push('');
  lines.push('## Source Health');
  lines.push('');
  lines.push('| Source | Status | Fetched | Funding-like | Candidates | Notes |');
  lines.push('|--------|--------|---------|--------------|------------|-------|');
  for (const diag of result.diagnostics) {
    lines.push(`| ${markdownText(diag.source)} | ${markdownText(diag.status)} | ${diag.fetched_items} | ${diag.funding_like_items} | ${diag.candidate_count} | ${markdownText(diag.errors.join('; '))} |`);
  }
  lines.push('');
  lines.push('| # | Company | Funding | Date | Source | Action |');
  lines.push('|---|---------|---------|------|--------|--------|');
  result.companies.forEach((candidate, idx) => {
    const src = candidate.funding.sources?.[0] || {};
    const funding = [candidate.round, candidate.amount, candidate.funding.status].filter(Boolean).join(' / ');
    lines.push(`| ${idx + 1} | ${markdownText(candidate.company)} | ${markdownText(funding)} | ${markdownText(src.observed_date || '')} | ${markdownText(src.source || '')} | ${markdownText(candidate.suggested_action)} |`);
  });
  lines.push('');
  for (const candidate of result.companies) {
    lines.push(`## ${markdownText(candidate.company)}`);
    lines.push('');
    lines.push(`- Funding signal: ${markdownText(candidate.funding.status)} (${markdownText(candidate.funding.confidence)})`);
    if (candidate.round || candidate.amount) lines.push(`- Round/amount: ${markdownText([candidate.round, candidate.amount].filter(Boolean).join(', '))}`);
    lines.push(`- Suggested action: ${markdownText(candidate.suggested_action)}`);
    lines.push('- Evidence:');
    for (const src of candidate.funding.sources.slice(0, 3)) {
      const url = safeReportUrl(src.url);
      const suffix = url ? ` - ${url}` : '';
      lines.push(`  - ${markdownText(src.source)}${src.observed_date ? `, ${markdownText(src.observed_date)}` : ''}: ${markdownText(src.title)}${suffix}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function writeArtifacts(result) {
  const outDir = join(ROOT, 'output');
  const reportDir = join(ROOT, 'reports');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });
  const jsonPath = join(outDir, `funded-companies-${result.generated_at}.json`);
  const reportPath = join(reportDir, `funded-companies-${result.generated_at}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
  writeFileSync(reportPath, renderReport(result), 'utf-8');
  return { jsonPath, reportPath };
}

function printHuman(result) {
  console.log(`Funded company discovery - ${result.generated_at}`);
  console.log(`Window: ${result.window_months} months`);
  console.log(`Sort: ${result.sort}`);
  console.log(`Sources: ${result.sources.join(', ')}`);
  console.log(`Candidates: ${result.companies.length}`);
  if (result.artifacts) {
    console.log(`JSON: ${result.artifacts.jsonPath}`);
    console.log(`Report: ${result.artifacts.reportPath}`);
  }
  const unhealthy = result.diagnostics.filter((d) => d.status !== 'ok' || d.blocked || d.fetched_items === 0);
  if (unhealthy.length || result.companies.length === 0) {
    console.log('');
    console.log('Source health:');
    for (const diag of result.diagnostics) {
      const note = diag.errors.length ? ` - ${diag.errors.join('; ')}` : '';
      console.log(`  ${diag.source}: ${diag.status}, fetched ${diag.fetched_items}, funding-like ${diag.funding_like_items}, candidates ${diag.candidate_count}${note}`);
    }
  }
  console.log('');
  for (const [idx, candidate] of result.companies.entries()) {
    const src = candidate.funding.sources?.[0] || {};
    console.log(`${idx + 1}. ${candidate.company}`);
    console.log(`   Funding: ${[candidate.round, candidate.amount, candidate.funding.status].filter(Boolean).join(' / ')} (${candidate.funding.confidence})${src.observed_date ? `, ${src.observed_date}` : ''}`);
    console.log(`   Source: ${src.source || 'n/a'} - ${src.title || 'n/a'}`);
    console.log(`   Evidence: ${src.url || 'n/a'}`);
    console.log(`   Action: ${candidate.suggested_action}`);
  }
}

export async function discoverFundedCompanies(opts = {}) {
  const months = opts.months || DEFAULT_MONTHS;
  const sources = (opts.sources || DEFAULT_SOURCES).map(normalizeSourceName);
  const diagnostics = [...new Set(sources)].map(diagnostic);
  const hits = Array.isArray(opts.discoveryItems)
    ? opts.discoveryItems
    : await collectDiscoveryItems({ ...opts, months, sources }, diagnostics);
  const companies = buildCandidates(hits, {
    months,
    sort: opts.sort || DEFAULT_SORT,
    limit: opts.limit || DEFAULT_LIMIT,
    diagnostics,
  });

  return {
    generated_at: isoDate(),
    window_months: months,
    sort: opts.sort || DEFAULT_SORT,
    dry_run: Boolean(opts.dryRun),
    sources,
    diagnostics,
    companies,
  };
}

function isoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function selfTest() {
  const examples = [
    ['Prime Intellect raises $130M Series A', 'Prime Intellect'],
    ['AI coding startup Cursor maker Anysphere raises Series C funding', 'Anysphere'],
    ['Ex-DeepMind David Silver Raises $1.1B for AI Startup Ineffable', 'Ineffable'],
    ['Travis Kalanick&#8217;s robotics company raises $1.7B, led by a16z', ''],
    ['AI startup valuations raise bubble fears as funding surges', ''],
    ["Yann LeCun's AI startup raises $1B seed round", ''],
    ['Acme closes $25M Series A round', 'Acme'],
    ['Ask HN: Who is hiring?', ''],
  ];
  for (const [title, expected] of examples) {
    const got = extractCompanyFromFundingTitle(title);
    if (got !== expected) throw new Error(`extractCompanyFromFundingTitle(${JSON.stringify(title)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  }

  const details = extractFundingDetails('Acme closes $25M Series A round');
  if (details.amount !== '$25M' || details.round !== 'Series A') {
    throw new Error(`extractFundingDetails failed: ${JSON.stringify(details)}`);
  }

  const candidates = buildCandidates([
    {
      source: 'techcrunch',
      title: 'Acme raises $25M Series B',
      url: 'https://techcrunch.com/acme',
      observedDate: { value: '2026-06-10', precision: 'day', date: new Date('2026-06-10T00:00:00Z') },
      text: 'Acme raises $25M Series B funding.',
      categories: ['Startups'],
    },
    {
      source: 'hacker_news',
      title: 'Startup raises seed funding in March 2026',
      url: 'https://news.ycombinator.com/item?id=2',
      observedDate: { value: '2026-03-10', precision: 'day', date: new Date('2026-03-10T00:00:00Z') },
      text: '',
      categories: [],
    },
  ], { months: 3, now: new Date('2026-07-20T00:00:00Z') });
  if (candidates.length !== 1 || candidates[0].company !== 'Acme') {
    throw new Error(`buildCandidates failed: ${JSON.stringify(candidates)}`);
  }

  console.log('company-funded self-test OK');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  if (opts.selfTest) {
    await selfTest();
    return;
  }
  const result = await discoverFundedCompanies(opts);
  if (!opts.dryRun) result.artifacts = writeArtifacts(result);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(`company-funded: ${err.message}`);
    process.exit(1);
  });
}
