#!/usr/bin/env node

/**
 * company-funded.mjs - discover recently funded companies for manual review.
 *
 * This is intentionally review-first: it writes a report/JSON candidate list,
 * never portals.yml. Add approved entries manually after review.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';

import { deriveSlugCandidates } from './verify-portals.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORTALS_PATH = process.env.CAREER_OPS_PORTALS || 'portals.yml';
const PROVIDERS_DIR = resolve(ROOT, 'providers');
const DEFAULT_LIMIT = 20;
const DEFAULT_MONTHS = 3;
const DEFAULT_SORT = 'date';
const DEFAULT_SOURCES = ['techcrunch', 'prnewswire', 'guardian', 'hn'];
const DEFAULT_ENRICH_CONCURRENCY = 3;
const DEFAULT_ENRICH_TIMEOUT_MS = 20_000;
const QUICK_FETCH_TIMEOUT_MS = 5_000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SOURCE_RANK = {
  techcrunch: 70,
  prnewswire: 65,
  guardian: 50,
  hacker_news: 35,
  duckduckgo: 10,
  web: 5,
};

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

const BLOCKED_HOST_PARTS = [
  'linkedin.',
  'crunchbase.',
  'wikipedia.',
  'facebook.',
  'instagram.',
  'twitter.',
  'x.com',
  'youtube.',
  'glassdoor.',
  'indeed.',
  'wellfound.',
  'tracxn.',
  'pitchbook.',
  'bloomberg.',
];

const MONTH_INDEX = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function usage() {
  console.log(`Usage:
  node company-funded.mjs --dry-run
  node company-funded.mjs --limit 25 --months 6 --sort date
  node company-funded.mjs --sources techcrunch,prnewswire,guardian,hn --dry-run
  node company-funded.mjs --query "agentic AI Series A funding" --dry-run

Options:
  --limit <n>             Max companies in the review list. Default: 20.
  --months <n>            Recent-funding window. Default: 3.
  --sort <date|score>     Candidate ordering. Default: date.
  --sources <csv>         Sources. Default: techcrunch,prnewswire,guardian,hn.
                           Also accepts duckduckgo/search as opt-in fallback.
  --query <text>          Add a DuckDuckGo fallback discovery query. Can be repeated.
  --include-existing      Include companies already present in portals.yml.
  --enrich                Resolve careers URLs/provider paths. This is the default.
  --no-enrich             Fast mode: skip careers/scanner resolution.
  --dry-run               Print only; do not write report/JSON files.
  --json                  Print machine-readable JSON.
  --portals <path>        portals.yml path. Default: portals.yml.
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
    includeExisting: false,
    enrich: true,
    queries: [],
    portalsPath: DEFAULT_PORTALS_PATH,
    selfTest: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--include-existing') opts.includeExisting = true;
    else if (arg === '--enrich') opts.enrich = true;
    else if (arg === '--no-enrich') opts.enrich = false;
    else if (arg === '--self-test') opts.selfTest = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--limit') opts.limit = Number(argv[++i] || '');
    else if (arg === '--months') opts.months = Number(argv[++i] || '');
    else if (arg === '--sort') opts.sort = String(argv[++i] || '').trim().toLowerCase();
    else if (arg === '--sources') opts.sources = parseSources(argv[++i] || '');
    else if (arg === '--query') opts.queries.push(argv[++i] || '');
    else if (arg === '--portals' || arg === '--file') opts.portalsPath = argv[++i] || '';
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
  opts.queries = opts.queries.map((q) => q.trim()).filter(Boolean);
  if (opts.queries.length && !opts.sources.includes('duckduckgo')) opts.sources.push('duckduckgo');
  return opts;
}

function parseSources(value) {
  const out = String(value || '')
    .split(',')
    .map((s) => normalizeSourceName(s.trim()))
    .filter(Boolean);
  const unique = [...new Set(out)];
  const allowed = new Set(['techcrunch', 'prnewswire', 'guardian', 'hn', 'duckduckgo']);
  for (const source of unique) {
    if (!allowed.has(source)) throw new Error(`unknown source in --sources: ${source}`);
  }
  return unique.length ? unique : [...DEFAULT_SOURCES];
}

function normalizeSourceName(value) {
  const s = String(value || '').toLowerCase().replace(/[_\s]+/g, '-');
  if (s === 'hacker-news' || s === 'hackernews' || s === 'hn') return 'hn';
  if (s === 'ddg' || s === 'duck-duck-go' || s === 'search') return 'duckduckgo';
  return s.replace(/-/g, '');
}

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeName(name) {
  return compact(name);
}

function companySlug(name) {
  return compact(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtmlTags(text) {
  return compact(decodeHtml(String(text || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')));
}

function isBlockedHost(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return BLOCKED_HOST_PARTS.some((part) => host === part.replace(/\.$/, '') || host.includes(part));
}

export function parseDuckDuckGoResults(html, { allowBlockedHosts = false } = {}) {
  const out = [];
  const re = /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*>/gi;
  for (const match of String(html || '').matchAll(re)) {
    const hrefMatch = match[0].match(/\bhref="([^"]+)"/i);
    if (!hrefMatch) continue;
    let href = decodeHtml(hrefMatch[1]);
    if (href.startsWith('//')) href = `https:${href}`;
    try {
      const parsed = new URL(href, 'https://duckduckgo.com');
      if (parsed.hostname.includes('duckduckgo.com') && parsed.pathname === '/l/') {
        const target = parsed.searchParams.get('uddg');
        if (target) href = target;
      } else {
        href = parsed.href;
      }
      if (/^https?:\/\//i.test(href) && (allowBlockedHosts || !isBlockedHost(href))) {
        out.push({ url: href, title: stripHtmlTags(match[0]) });
      }
    } catch {
      // Ignore malformed search-result links.
    }
  }
  const seen = new Set();
  return out.filter((item) => {
    const key = item.url.replace(/\/+$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripPublisher(title) {
  return compact(title)
    .replace(/\s+\|\s+.*$/i, '')
    .replace(/\s+-\s+(TechCrunch|Crunchbase|Forbes|Reuters|Bloomberg|BusinessWire|PR Newswire|SiliconANGLE|VentureBeat|The Guardian).*$/i, '')
    .replace(/^Show HN:\s*/i, '')
    .replace(/^Ask HN:\s*/i, '');
}

function cleanCompanyName(raw) {
  let s = stripPublisher(decodeHtml(raw))
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
  s = s.replace(/^[A-Z][A-Za-z0-9&.-]+-backed\s+/i, '');
  s = s.replace(/\b(?:maker|creator)\s+of\s+.+$/i, '');
  s = s.replace(/^(?:the\s+)?(?:(?:ai|genai|agentic|coding|developer tools|developer|data|security|fintech|startup|software|robotics|defense|healthcare|biotech|open-source|enterprise|infrastructure|crypto|climate)\s+)+(?:startup|company|platform)?\s+/i, '');
  s = s.replace(/^.+\bmaker\s+/i, '');
  s = s.replace(/^(?:startup|company|platform)\s+/i, '');
  s = compact(s);

  if (s.length < 2 || s.length > 70) return '';
  if (GENERIC_NAMES.has(s.toLowerCase())) return '';
  if (/\b(valuation|valuations|bubble|fears|earnings|fund)\b/i.test(s)) return '';
  if (!/[a-z0-9]/i.test(s)) return '';
  return s;
}

export function extractCompanyFromFundingTitle(title) {
  const t = stripPublisher(title);
  if (/^(ask hn|tell hn|who is hiring|launch hn)\b/i.test(t)) return '';

  const patterns = [
    /\b(?:raises?|raised|lands|landed|secures?|secured|closes?|closed|nabs?|nabbed|bags?|bagged)\s+(?:an?\s+|over\s+|more\s+than\s+|up\s+to\s+)?\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\s+for\s+(?:an?\s+)?(?:ai\s+)?startup\s+(.+?)$/i,
    /(?:startup|company|agency|platform)\s+(.+?)\s+hits\s+unicorn\s+status\b.*\braises?\b/i,
    /^(.+?)\s+(?:raises?|raised|lands|landed|secures?|secured|closes?|closed|nabs?|nabbed|bags?|bagged)\s+(?:an?\s+|over\s+|more\s+than\s+|up\s+to\s+)?\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\b/i,
    /^(.+?)\s+(?:raises?|raised|lands|landed|secures?|secured|closes?|closed|nabs?|nabbed|bags?|bagged)\s+(?:an?\s+)?(?:\w+\s+){0,4}(?:funding|round|series\s+[a-h]|seed|pre-seed|investment|financing|valuation)\b/i,
    /^(.+?)\s+(?:announces?|announced)\s+(?:\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\s+)?(?:\w+\s+){0,4}(?:funding|round|series\s+[a-h]|seed|pre-seed|financing)\b/i,
    /^(.+?)\s+(?:gets|got|receives?|received)\s+(?:\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\s+)?(?:in\s+)?(?:funding|investment|financing)\b/i,
    /^(.+?)\s+(?:hits?|hit|reaches?|reached)\s+(?:a\s+)?\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\s+valuation\b/i,
    /^(.+?)\s+valued\s+at\s+\$[\d.,]+\s*(?:billion|million|bn|[bkmt])?\b/i,
    /^(.+?)\s+emerges?\s+from\s+stealth\b/i,
    /^(.+?)\s+in\s+talks\s+to\s+raise\b/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) return cleanCompanyName(m[1]);
  }
  return '';
}

export function extractFundingDetails(text) {
  const raw = String(text || '');
  const amount = raw.match(/\$[\d,.]+\s*(?:billion|million|bn|m|b|k)?/i)?.[0] || '';
  const round = raw.match(/\b(?:pre-seed|seed|series\s+[a-h]|strategic|venture|growth)\b/i)?.[0] || '';
  return {
    amount: compact(amount),
    round: round ? round.replace(/\s+/g, ' ').replace(/\bseries\b/i, 'Series') : '',
  };
}

function sourceFromUrl(url, fallback = 'web') {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return fallback;
  }
  if (host.includes('hn.algolia.com') || host.includes('news.ycombinator.com')) return 'hacker_news';
  if (host.includes('techcrunch.com')) return 'techcrunch';
  if (host.includes('prnewswire.com')) return 'prnewswire';
  if (host.includes('theguardian.com')) return 'guardian';
  if (host.includes('businesswire.com')) return 'businesswire';
  if (host.includes('crunchbase.com')) return 'crunchbase';
  if (host === 'x.com' || host.endsWith('.x.com') || host.includes('twitter.com')) return 'x_twitter';
  if (host.includes('reddit.com')) return 'reddit';
  return fallback;
}

function companyKey(name) {
  return compact(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function loadExistingCompanies(filePath) {
  if (!existsSync(filePath)) return new Set();
  const parsed = yaml.load(readFileSync(filePath, 'utf-8'));
  const companies = Array.isArray(parsed?.tracked_companies) ? parsed.tracked_companies : [];
  return new Set(companies.map((c) => companyKey(c?.name || '')).filter(Boolean));
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

async function fetchTextMeta(url, { timeoutMs = 12_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': BROWSER_UA, accept: 'application/rss+xml,application/xml,text/xml,text/html,text/plain,*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    const contentType = res.headers.get('content-type') || '';
    return {
      url,
      finalUrl: res.url || url,
      status: res.status,
      ok: res.ok,
      contentType,
      text,
      blocked: detectBlockedContent(text, { status: res.status, contentType }),
      error: res.ok ? '' : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      url,
      finalUrl: url,
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

async function fetchJsonMeta(url, { timeoutMs = 12_000 } = {}) {
  const meta = await fetchTextMeta(url, { timeoutMs });
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
    const m = String(xml || '').match(re);
    if (m?.[1]) return decodeHtml(m[1]);
  }
  return '';
}

function attrValue(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, 'i');
  return decodeHtml(String(xml || '').match(re)?.[1] || '');
}

function categoriesFromXml(xml) {
  return [...String(xml || '').matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
    .map((m) => stripHtmlTags(m[1]))
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
    const title = stripHtmlTags(tagValue(block, ['title']));
    const description = stripHtmlTags(tagValue(block, ['description', 'summary', 'content:encoded', 'content']));
    const link = compact(tagValue(block, ['link'])) || attrValue(block, 'link', 'href');
    const publishedRaw = tagValue(block, ['pubDate', 'published', 'updated', 'dc:date']);
    const observedDate = parsePublishedDate(publishedRaw);
    const sourceCompany = stripHtmlTags(tagValue(block, ['dc:contributor', 'dc:creator', 'author', 'source']));
    const itemSource = sourceFromUrl(link, source);
    if (!title && !link) continue;
    out.push({
      source: itemSource === 'web' ? source : itemSource,
      title,
      url: link,
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
  return /\b(funding|funded|raises?|raised|raise|series\s+[a-h]|seed\s+round|pre-seed|venture\s+round|investment|financing|valuation|valued\s+at|lands?|landed|secures?|secured|closes?|closed|nabs?|nabbed|bags?|bagged|emerges?\s+from\s+stealth|in\s+talks\s+to\s+raise)\b/i.test(String(text || ''));
}

function isExcludedFundingItem(item) {
  const text = compact(`${item.title || ''} ${item.text || ''} ${(item.categories || []).join(' ')}`);
  if (!hasFundingLanguage(text)) return true;
  const negativePatterns = [
    /\b(acquires?|acquired|acquisition|merger|merged|takeover|buyout|buys?|bought)\b/i,
    /\b(earnings|quarterly results|financial results|fiscal year|revenue guidance|dividend|share repurchase|stock split|nasdaq|nyse|tsx:|lse:)\b/i,
    /\b(scholarship|scholarships|grant|grants|donation|donates?|nonprofit grant)\b/i,
    /\b(how to raise|tips for fundraising|fundraising advice|guide to fundraising|startup fundraising guide)\b/i,
    /\b(public offering|registered direct offering|private placement|atm offering|offering of common stock)\b/i,
    /\b(venture fund|vc fund|investment fund|private equity fund|capital fund|fund ii|fund iii|fund iv|new fund)\b/i,
    /\b(?:raises?|raised|closes?|closed|launches?|launched)\s+(?:an?\s+|its\s+|new\s+)?\$[\d.,]+\s*(?:billion|million|bn|[bm])?\s+fund\b/i,
    /\b(?:raises?|raised|closes?|closed|launches?|launched)\s+(?:an?\s+|its\s+|new\s+)?(?:first|second|third|fourth|latest)\s+fund\b/i,
  ];
  return negativePatterns.some((re) => re.test(text));
}

function fundingWindowStart(now = new Date(), months = DEFAULT_MONTHS) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export function extractFundingDate(text, now = new Date()) {
  const raw = String(text || '');
  const iso = raw.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (iso) return { value: iso[0], precision: 'day', date: new Date(`${iso[0]}T00:00:00Z`) };

  const monthYear = raw.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?:\d{1,2},?\s+)?(20\d{2})\b/i);
  if (monthYear) {
    const month = MONTH_INDEX[monthYear[1].toLowerCase().replace(/\.$/, '')];
    const year = Number(monthYear[2]);
    if (month != null) {
      const date = new Date(Date.UTC(year, month, 1));
      return { value: `${year}-${String(month + 1).padStart(2, '0')}`, precision: 'month', date };
    }
  }

  const year = raw.match(/\b(20\d{2})\b/);
  if (year) {
    const y = Number(year[1]);
    const date = new Date(Date.UTC(y, 0, 1));
    return { value: String(y), precision: 'year', date };
  }

  const monthsAgo = raw.match(/\b(\d{1,2})\s+months?\s+ago\b/i);
  if (monthsAgo) {
    const date = fundingWindowStart(now, Number(monthsAgo[1]));
    return { value: `${monthsAgo[1]} months ago`, precision: 'relative_month', date };
  }
  return null;
}

function dateValue(observedDate) {
  return observedDate?.date instanceof Date && !Number.isNaN(observedDate.date.getTime())
    ? observedDate.date.getTime()
    : 0;
}

function candidateSourceName(hit) {
  if (hit.source === 'prnewswire' && hit.source_company && hasFundingLanguage(`${hit.title || ''} ${hit.text || ''}`)) {
    const clean = cleanCompanyName(hit.source_company);
    if (clean) return clean;
  }
  return extractCompanyFromFundingTitle(hit.title);
}

function fundingEvidenceScore(hit, { now = new Date(), months = DEFAULT_MONTHS } = {}) {
  const haystack = `${hit.title || ''} ${hit.text || ''} ${(hit.categories || []).join(' ')}`;
  if (!hasFundingLanguage(haystack) || isExcludedFundingItem(hit)) return -100;
  const observed = hit.observedDate || extractFundingDate(haystack, now);
  const windowStart = fundingWindowStart(now, months);
  let score = 25 + (SOURCE_RANK[hit.source] || SOURCE_RANK.web);
  if (observed?.date && observed.date >= windowStart) score += 50;
  else if (observed?.date) score -= 40;
  if (/\$[\d,.]+\s*(?:billion|million|bn|m|b|k)?/i.test(haystack)) score += 15;
  if (/\b(series\s+[a-h]|seed\s+round|pre-seed)\b/i.test(haystack)) score += 15;
  if (/\braises?|raised|secures?|secured|lands?|landed|closes?|closed\b/i.test(haystack)) score += 10;
  if (/\bemerges?\s+from\s+stealth|in\s+talks\s+to\s+raise|valuation|valued\s+at\b/i.test(haystack)) score += 5;
  return score;
}

function buildFundingSignal(evidence, { now = new Date(), months = DEFAULT_MONTHS } = {}) {
  const windowStart = fundingWindowStart(now, months);
  const scored = evidence
    .map((hit) => {
      const haystack = `${hit.title || ''} ${hit.text || ''}`;
      const observed = hit.observedDate || extractFundingDate(haystack, now);
      return {
        source: hit.source || sourceFromUrl(hit.url),
        title: compact(hit.title || hit.url).slice(0, 180),
        url: hit.url,
        observed_date: observed?.value || '',
        date_precision: observed?.precision || '',
        recent: Boolean(observed?.date && observed.date >= windowStart),
        categories: hit.categories || [],
        score: fundingEvidenceScore({ ...hit, observedDate: observed }, { now, months }),
        dateMs: dateValue(observed),
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.recent - a.recent || b.dateMs - a.dateMs || b.score - a.score || (SOURCE_RANK[b.source] || 0) - (SOURCE_RANK[a.source] || 0));

  const recent = scored.filter((hit) => hit.recent);
  const sources = scored.slice(0, 5).map(({ score, dateMs, ...rest }) => rest);
  let status = 'no_signal';
  let confidence = 'low';
  if (recent.length > 0) {
    status = 'recent_funding_signal';
    const best = recent[0];
    confidence = ['techcrunch', 'prnewswire', 'guardian'].includes(best.source) || /\$[\d,.]+|\bseries\s+[a-h]\b|\bseed\b/i.test(best.title)
      ? 'medium'
      : 'low';
  } else if (scored.length > 0) {
    status = 'funding_signal_unconfirmed_recency';
  }

  return {
    status,
    confidence,
    checked_at: now.toISOString().slice(0, 10),
    window_months: months,
    sources,
    note: 'Funding is a hiring-likelihood signal only; verify manually before prioritizing.',
  };
}

export function buildCandidates(hits, {
  months = DEFAULT_MONTHS,
  includeExisting = false,
  existingCompanies = new Set(),
  now = new Date(),
  sort = DEFAULT_SORT,
  limit = DEFAULT_LIMIT,
  diagnostics = [],
} = {}) {
  const grouped = new Map();
  for (const hit of hits) {
    if (isExcludedFundingItem(hit)) continue;
    const name = candidateSourceName(hit);
    if (!name) continue;
    const key = companyKey(name);
    if (!key) continue;
    if (!includeExisting && existingCompanies.has(key)) continue;
    if (!grouped.has(key)) grouped.set(key, { name, evidence: [], evidenceKeys: new Set() });
    const evidenceKey = compact(`${hit.source || ''} ${hit.url || ''} ${hit.title || ''}`).toLowerCase();
    if (grouped.get(key).evidenceKeys.has(evidenceKey)) continue;
    grouped.get(key).evidenceKeys.add(evidenceKey);
    grouped.get(key).evidence.push(hit);
  }

  let candidates = [];
  for (const item of grouped.values()) {
    const funding = buildFundingSignal(item.evidence, { months, now });
    if (funding.status !== 'recent_funding_signal') continue;
    const best = funding.sources[0] || {};
    const details = extractFundingDetails(`${best.title || ''} ${item.evidence[0]?.title || ''} ${item.evidence[0]?.text || ''}`);
    candidates.push({
      company: item.name,
      funding,
      funding_date: best.observed_date || '',
      amount: details.amount,
      round: details.round,
      existing: existingCompanies.has(companyKey(item.name)),
      discovery_score: discoveryScore(funding),
      best_source: best.source || '',
      best_title: best.title || '',
      best_url: best.url || '',
      suggested_action: 'review',
    });
  }

  annotateCandidateDiagnostics(candidates, diagnostics);
  candidates = sortCandidates(candidates, sort);
  return candidates.slice(0, limit);
}

function annotateCandidateDiagnostics(candidates, diagnostics) {
  const bySource = new Map(diagnostics.map((d) => [d.source, d]));
  for (const diag of diagnostics) diag.candidate_count = 0;
  for (const candidate of candidates) {
    const seen = new Set();
    for (const src of candidate.funding.sources || []) {
      if (!src.source || seen.has(src.source)) continue;
      seen.add(src.source);
      const key = src.source === 'hacker_news' ? 'hn' : src.source;
      const diag = bySource.get(key) || bySource.get(src.source);
      if (diag) diag.candidate_count += 1;
    }
  }
}

function sortCandidates(candidates, sort = DEFAULT_SORT) {
  const sorted = [...candidates];
  if (sort === 'score') {
    return sorted.sort((a, b) => b.discovery_score - a.discovery_score || dateMs(b) - dateMs(a) || a.company.localeCompare(b.company));
  }
  return sorted.sort((a, b) =>
    dateMs(b) - dateMs(a) ||
    (SOURCE_RANK[b.best_source] || 0) - (SOURCE_RANK[a.best_source] || 0) ||
    b.discovery_score - a.discovery_score ||
    a.company.localeCompare(b.company)
  );
}

function dateMs(candidate) {
  const date = candidate.funding.sources?.[0]?.observed_date || candidate.funding_date || '';
  const parsed = date ? new Date(`${date.length === 7 ? `${date}-01` : date}T00:00:00Z`) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : 0;
}

function discoveryScore(funding) {
  let score = 0;
  if (funding.status === 'recent_funding_signal') score += 70;
  if (funding.confidence === 'medium') score += 20;
  const source = funding.sources?.[0]?.source || '';
  score += Math.floor((SOURCE_RANK[source] || 0) / 4);
  score += Math.min((funding.sources || []).length, 5);
  return score;
}

function websearchQuery(name, careersUrl) {
  let site = '';
  try {
    site = `site:${new URL(careersUrl).hostname}`;
  } catch {
    site = `"${name}"`;
  }
  return `${site} "AI Engineer" OR "Applied AI" OR "LLMOps" OR "Agentic" OR "Principal Engineer" OR "Staff Engineer" OR "Software Architect" OR "Backend Engineer" India OR Singapore OR London OR remote`;
}

export async function buildCompanyEntry(name, careersUrl, { providers = null, providerHint = null } = {}) {
  const entry = {
    name: normalizeName(name),
    careers_url: careersUrl,
    enabled: true,
  };
  if (providerHint) entry.provider = providerHint;

  const loadedProviders = providers || await loadProviders(PROVIDERS_DIR);
  const resolved = resolveProvider(entry, loadedProviders, { skipIds: ['local-parser'] });
  if (!resolved?.provider) {
    entry.scan_method = 'websearch';
    entry.scan_query = websearchQuery(entry.name, careersUrl);
  }
  return { entry, provider: resolved?.provider?.id || null };
}

function formatPortalsEntry(entry) {
  if (!entry) return '';
  return yaml.dump([entry], { lineWidth: 140, noRefs: true, sortKeys: false }).trimEnd();
}

async function enrichCandidate(candidate) {
  try {
    const resolved = await withTimeout(
      quickResolveCareerUrl(candidate.company),
      DEFAULT_ENRICH_TIMEOUT_MS,
      `career resolution timed out after ${DEFAULT_ENRICH_TIMEOUT_MS}ms`,
    );
    if (!resolved?.url) return markEnrichmentNotFound(candidate, resolved?.website || '');
    const { entry, provider } = await buildCompanyEntry(candidate.company, resolved.url, { providerHint: resolved.providerHint });
    return {
      ...candidate,
      website: resolved.website || '',
      careers_url: entry.careers_url,
      scanner_path: provider ? `provider:${provider}` : 'websearch',
      provider: provider || '',
      enrichment_status: 'found',
      enrichment_error: '',
      portals_entry: entry,
      portals_entry_yaml: formatPortalsEntry(entry),
      suggested_action: 'review_portals_entry',
    };
  } catch (err) {
    const timedOut = err?.code === 'ETIMEDOUT';
    return {
      ...candidate,
      website: '',
      careers_url: '',
      scanner_path: timedOut ? 'resolution_timeout' : 'resolution_failed',
      enrichment_status: timedOut ? 'timeout' : 'error',
      enrichment_error: err?.message || 'career resolution failed',
      suggested_action: 'research_manually',
    };
  }
}

function markEnrichmentNotFound(candidate, website = '') {
  return {
    ...candidate,
    website,
    careers_url: '',
    scanner_path: 'resolution_failed',
    enrichment_status: 'not_found',
    enrichment_error: '',
    suggested_action: 'research_manually',
  };
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(message);
          err.code = 'ETIMEDOUT';
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function ensureHttpsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function baseHostFromWebsite(website) {
  try {
    return new URL(ensureHttpsUrl(website)).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function providerHintFromPage(meta) {
  const text = `${meta.finalUrl || meta.url}\n${meta.text || ''}`.toLowerCase();
  if (text.includes('teamtailor') && text.includes('jobs.rss')) return 'teamtailor';
  return null;
}

function quickWebsiteUrls(name) {
  const slug = companySlug(name);
  if (!slug) return [];
  return [`https://${slug}.com`, `https://${slug}.ai`, `https://${slug}.io`, `https://${slug}.co`];
}

function quickCareerUrlsFromWebsite(website) {
  const baseHost = baseHostFromWebsite(website);
  if (!baseHost) return [];
  const roots = [`https://${baseHost}`, `https://www.${baseHost}`];
  return [
    `https://jobs.${baseHost}`,
    `https://careers.${baseHost}`,
    ...roots.map((root) => `${root}/careers`),
    ...roots.map((root) => `${root}/jobs`),
    ...roots.map((root) => `${root}/company/careers`),
    ...roots.map((root) => `${root}/careers/jobs`),
  ];
}

function quickAtsUrls(name) {
  const slugs = deriveSlugCandidates(name).slice(0, 4);
  const urls = [];
  for (const slug of slugs) {
    urls.push(`https://jobs.ashbyhq.com/${slug}`);
    urls.push(`https://job-boards.greenhouse.io/${slug}`);
    urls.push(`https://jobs.lever.co/${slug}`);
  }
  return urls;
}

function visibleText(meta) {
  return stripHtmlTags(meta.text || '').toLowerCase();
}

function quickCareerProbeScore(meta, name, websiteUrl = '') {
  let parsed;
  try {
    parsed = new URL(meta.finalUrl || meta.url);
  } catch {
    return -100;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const visible = visibleText(meta);
  const baseHost = baseHostFromWebsite(websiteUrl);
  const isKnownAts = /(^|\.)ashbyhq\.com$|(^|\.)greenhouse\.io$|(^|\.)lever\.co$/i.test(host);
  let score = meta.ok ? 40 : 0;
  if ([401, 403].includes(Number(meta.status))) score += 10;
  if (baseHost && (host === baseHost || host.endsWith(`.${baseHost}`))) score += 25;
  if (/^(jobs|careers)\./i.test(host)) score += 25;
  if (isKnownAts) score += 45;
  if (/\/(careers|jobs|work-with-us|open-roles)\b/i.test(path)) score += 20;
  if (/(open roles|open positions|current openings|job openings|view jobs|apply now|greenhouse|ashby|lever|workday|smartrecruiters|teamtailor)/i.test(visible)) score += 25;
  if (/(page not found|not found|no longer available|access denied|forbidden|no jobs found)/i.test(visible)) score -= 35;
  if (companySlug(name) && `${host}${path}${visible.slice(0, 2000)}`.replace(/[^a-z0-9]+/g, '').includes(companySlug(name))) score += 5;
  return score;
}

async function probeQuickUrl(url, name, website = '') {
  const meta = await fetchTextMeta(url, { timeoutMs: QUICK_FETCH_TIMEOUT_MS });
  const score = quickCareerProbeScore(meta, name, website);
  if (score < 55) return null;
  return {
    url: meta.finalUrl || url,
    score,
    providerHint: providerHintFromPage(meta),
  };
}

async function firstReachableWebsite(name) {
  const probes = await Promise.allSettled(
    quickWebsiteUrls(name).map(async (url) => {
      const meta = await fetchTextMeta(url, { timeoutMs: QUICK_FETCH_TIMEOUT_MS });
      if (!meta.ok) return null;
      return { url: meta.finalUrl || url, status: meta.status };
    }),
  );
  return probes.map((p) => p.status === 'fulfilled' ? p.value : null).find(Boolean)?.url || '';
}

export async function quickResolveCareerUrl(name) {
  const website = await firstReachableWebsite(name);
  const urls = [...quickCareerUrlsFromWebsite(website), ...quickAtsUrls(name)];
  const seen = new Set();
  const unique = urls.filter((url) => {
    const key = url.replace(/\/+$/, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const probes = await Promise.allSettled(unique.map((url) => probeQuickUrl(url, name, website)));
  const candidates = probes
    .map((p) => p.status === 'fulfilled' ? p.value : null)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return { website, ...(candidates[0] || {}) };
}

function enrichmentFailure(candidate, err) {
  const timedOut = err?.code === 'ETIMEDOUT';
  return {
    ...candidate,
    website: '',
    careers_url: '',
    scanner_path: timedOut ? 'resolution_timeout' : 'resolution_failed',
    enrichment_status: timedOut ? 'timeout' : 'error',
    enrichment_error: err?.message || 'career resolution failed',
    suggested_action: 'research_manually',
  };
}

export async function enrichCandidates(candidates, {
  enrichCandidateFn = enrichCandidate,
  concurrency = DEFAULT_ENRICH_CONCURRENCY,
  timeoutMs = DEFAULT_ENRICH_TIMEOUT_MS,
} = {}) {
  const out = new Array(candidates.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(concurrency, candidates.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < candidates.length) {
      const idx = next++;
      try {
        out[idx] = await withTimeout(Promise.resolve().then(() => enrichCandidateFn(candidates[idx])), timeoutMs, `career resolution timed out after ${timeoutMs}ms`);
      } catch (err) {
        out[idx] = enrichmentFailure(candidates[idx], err);
      }
    }
  }));
  return out;
}

function isoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function fetchRssDiscovery(source, diagnostics) {
  const diag = diagnostics.find((d) => d.source === source) || diagnostic(source);
  const out = [];
  for (const url of RSS_SOURCES[source] || []) {
    const meta = await fetchTextMeta(url);
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
  if (diag.fetched_items === 0 && diag.errors.length === 0) {
    markDiagnosticError(diag, 'no RSS items fetched');
  }
  return out;
}

function hnQueries(extra = []) {
  return [
    'AI startup raises funding',
    'Series A AI startup',
    'developer tools startup funding',
    'infrastructure startup raises funding',
    'agentic AI raises seed',
    ...extra,
  ];
}

async function fetchHnDiscovery({ months = DEFAULT_MONTHS, extraQueries = [], diagnostics = [] } = {}) {
  const diag = diagnostics.find((d) => d.source === 'hn') || diagnostic('hn');
  const cutoff = Math.floor(Date.now() / 1000) - months * 31 * 24 * 60 * 60;
  const out = [];
  for (const query of hnQueries(extraQueries)) {
    const url =
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
      `&tags=story&hitsPerPage=50&numericFilters=created_at_i>${cutoff}`;
    const meta = await fetchJsonMeta(url);
    if (!meta.ok || meta.blocked || !meta.json) {
      markDiagnosticError(diag, `${url}: ${meta.error || (meta.blocked ? 'blocked/challenge page' : 'fetch failed')}`, { blocked: meta.blocked });
      continue;
    }
    const hits = Array.isArray(meta.json?.hits) ? meta.json.hits : [];
    diag.fetched_items += hits.length;
    for (const hit of hits) {
      const title = compact(hit.title || hit.story_title || '');
      if (!title) continue;
      const item = {
        source: 'hacker_news',
        title,
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        published_at: hit.created_at ? new Date(hit.created_at).toISOString() : '',
        observedDate: hit.created_at ? { value: hit.created_at.slice(0, 10), precision: 'day', date: new Date(hit.created_at) } : null,
        text: compact(hit.story_text || ''),
        categories: [],
        source_company: '',
      };
      if (isExcludedFundingItem(item)) continue;
      diag.funding_like_items += 1;
      out.push(item);
    }
  }
  if (diag.fetched_items === 0 && diag.errors.length === 0) {
    markDiagnosticError(diag, 'no HN items fetched');
  }
  return out;
}

function discoveryQueries(extra = []) {
  const year = new Date().getUTCFullYear();
  return [
    ...extra,
    `site:techcrunch.com raises funding AI startup Series A seed ${year}`,
    `site:prnewswire.com raises funding AI startup ${year}`,
  ];
}

async function fetchSearchDiscovery(extraQueries = [], diagnostics = []) {
  const diag = diagnostics.find((d) => d.source === 'duckduckgo') || diagnostic('duckduckgo');
  const out = [];
  for (const query of discoveryQueries(extraQueries)) {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const meta = await fetchTextMeta(url);
    if (!meta.ok || meta.blocked) {
      markDiagnosticError(diag, `${url}: ${meta.error || (meta.blocked ? 'blocked/challenge page' : 'fetch failed')}`, { blocked: meta.blocked });
      continue;
    }
    const results = parseDuckDuckGoResults(meta.text, { allowBlockedHosts: true }).slice(0, 12);
    diag.fetched_items += results.length;
    for (const result of results) {
      const item = {
        source: sourceFromUrl(result.url, 'duckduckgo'),
        title: result.title,
        url: result.url,
        published_at: '',
        observedDate: null,
        text: '',
        categories: [],
        source_company: '',
      };
      if (isExcludedFundingItem(item)) continue;
      diag.funding_like_items += 1;
      out.push(item);
    }
  }
  if (diag.fetched_items === 0 && diag.errors.length === 0) {
    markDiagnosticError(diag, 'no DuckDuckGo results parsed');
  }
  return out;
}

async function collectDiscoveryItems(opts, diagnostics) {
  const requested = new Set(opts.sources || DEFAULT_SOURCES);
  const hits = [];
  for (const source of ['techcrunch', 'prnewswire', 'guardian']) {
    if (requested.has(source)) hits.push(...await fetchRssDiscovery(source, diagnostics));
  }
  if (requested.has('hn')) {
    hits.push(...await fetchHnDiscovery({ months: opts.months, extraQueries: opts.queries || [], diagnostics }));
  }
  if (requested.has('duckduckgo')) {
    hits.push(...await fetchSearchDiscovery(opts.queries || [], diagnostics));
  }
  return hits;
}

function renderReport(result) {
  const lines = [];
  lines.push(`# Funded Company Discovery - ${result.generated_at}`);
  lines.push('');
  lines.push('Review-first output. No companies were added to portals.yml.');
  lines.push('');
  lines.push(`Window: ${result.window_months} months`);
  lines.push(`Sort: ${result.sort}`);
  lines.push(`Sources: ${result.sources.join(', ')}`);
  lines.push(`Candidates: ${result.companies.length}`);
  lines.push('');
  lines.push('## Source Health');
  lines.push('');
  lines.push('| Source | Status | Fetched | Funding-like | Candidates | Notes |');
  lines.push('|--------|--------|---------|--------------|------------|-------|');
  for (const diag of result.diagnostics) {
    lines.push(`| ${md(diag.source)} | ${md(diag.status)} | ${diag.fetched_items} | ${diag.funding_like_items} | ${diag.candidate_count} | ${md(diag.errors.join('; '))} |`);
  }
  lines.push('');
  lines.push('| # | Company | Funding | Date | Source | Careers URL | Scanner | Action |');
  lines.push('|---|---------|---------|------|--------|-------------|---------|--------|');
  result.companies.forEach((c, idx) => {
    const src = c.funding.sources?.[0] || {};
    const funding = [c.round, c.amount, c.funding.status].filter(Boolean).join(' / ');
    lines.push(`| ${idx + 1} | ${md(c.company)} | ${md(funding)} | ${md(src.observed_date || '')} | ${md(src.source || '')} | ${md(careerDisplay(c))} | ${md(scannerDisplay(c))} | ${md(c.suggested_action)} |`);
  });
  lines.push('');
  for (const c of result.companies) {
    lines.push(`## ${c.company}`);
    lines.push('');
    lines.push(`- Funding signal: ${c.funding.status} (${c.funding.confidence})`);
    if (c.round || c.amount) lines.push(`- Round/amount: ${[c.round, c.amount].filter(Boolean).join(', ')}`);
    lines.push(`- Careers URL: ${careerDisplay(c)}`);
    lines.push(`- Scanner path: ${scannerDisplay(c)}`);
    lines.push(`- Enrichment: ${c.enrichment_status || 'unknown'}${c.enrichment_error ? ` (${c.enrichment_error})` : ''}`);
    lines.push(`- Existing in portals.yml: ${c.existing ? 'yes' : 'no'}`);
    if (c.portals_entry_yaml) {
      lines.push('- Suggested portals.yml entry:');
      lines.push('```yaml');
      lines.push(c.portals_entry_yaml);
      lines.push('```');
    } else {
      lines.push('- Suggested action: research careers URL manually before adding to portals.yml');
    }
    lines.push('- Evidence:');
    for (const src of c.funding.sources.slice(0, 3)) {
      lines.push(`  - ${src.source}${src.observed_date ? `, ${src.observed_date}` : ''}: [${md(src.title)}](${src.url})`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function md(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
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
  for (const [idx, c] of result.companies.entries()) {
    const src = c.funding.sources?.[0] || {};
    console.log(`${idx + 1}. ${c.company}`);
    console.log(`   Funding: ${[c.round, c.amount, c.funding.status].filter(Boolean).join(' / ')} (${c.funding.confidence})${src.observed_date ? `, ${src.observed_date}` : ''}`);
    console.log(`   Source: ${src.source || 'n/a'} - ${src.title || 'n/a'}`);
    console.log(`   Careers: ${careerDisplay(c)}`);
    console.log(`   Scanner: ${scannerDisplay(c)}`);
    if (c.enrichment_status && c.enrichment_status !== 'found') {
      console.log(`   Enrichment: ${c.enrichment_status}${c.enrichment_error ? ` - ${c.enrichment_error}` : ''}`);
    }
    if (c.portals_entry_yaml) {
      console.log('   Suggested portals.yml entry:');
      for (const line of c.portals_entry_yaml.split('\n')) console.log(`     ${line}`);
    } else {
      console.log('   Suggested action: research careers URL manually before adding to portals.yml');
    }
  }
}

function careerDisplay(candidate) {
  if (candidate.careers_url) return candidate.careers_url;
  if (candidate.enrichment_status === 'skipped') return 'not checked (--no-enrich)';
  return 'not found';
}

function scannerDisplay(candidate) {
  if (candidate.scanner_path) return candidate.scanner_path;
  if (candidate.enrichment_status === 'skipped') return 'not checked';
  return 'resolution_failed';
}

export async function discoverFundedCompanies(opts = {}) {
  const months = opts.months || DEFAULT_MONTHS;
  const sources = (opts.sources || DEFAULT_SOURCES).map(normalizeSourceName);
  const portalsPath = resolve(opts.portalsPath || DEFAULT_PORTALS_PATH);
  const existingCompanies = loadExistingCompanies(portalsPath);
  const diagnostics = [...new Set(sources)].map(diagnostic);
  const hits = Array.isArray(opts.discoveryItems)
    ? opts.discoveryItems
    : await collectDiscoveryItems({ ...opts, months, sources }, diagnostics);
  let companies = buildCandidates(hits, {
    months,
    includeExisting: opts.includeExisting,
    existingCompanies,
    sort: opts.sort || DEFAULT_SORT,
    limit: opts.limit || DEFAULT_LIMIT,
    diagnostics,
  });

  if (opts.enrich !== false) {
    companies = await enrichCandidates(companies, {
      enrichCandidateFn: opts.enrichCandidateFn || enrichCandidate,
      concurrency: opts.enrichConcurrency || DEFAULT_ENRICH_CONCURRENCY,
      timeoutMs: opts.enrichTimeoutMs || DEFAULT_ENRICH_TIMEOUT_MS,
    });
  } else {
    companies = companies.map((c) => ({
      ...c,
      careers_url: '',
      scanner_path: '',
      enrichment_status: 'skipped',
      enrichment_error: '',
    }));
  }

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

async function selfTest() {
  const examples = [
    ['Prime Intellect raises $130M Series A', 'Prime Intellect'],
    ['Norm raises $120M', 'Norm'],
    ['Resolve AI raises $125M Series A', 'Resolve AI'],
    ['Cascade raises $3.5M', 'Cascade'],
    ['SambaNova raises $1B', 'SambaNova'],
    ['Anysphere raises $900M in funding', 'Anysphere'],
    ['AI coding startup Cursor maker Anysphere raises Series C funding', 'Anysphere'],
    ['AI logistics startup Augment, from Deliverr founder, raises $85M Series A', 'Augment'],
    ['Mira Murati’s AI startup Thinking Machines valued at $12B in early-stage funding', 'Thinking Machines'],
    ['OpenAI in talks to raise funding that would value AI startup at up to $340B', 'OpenAI'],
    ['AI-powered travel agency Fora hits unicorn status, raises $60M', 'Fora'],
    ['Airbnb-backed WeRoad raises $58M to take its group travel platform to the US', 'WeRoad'],
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
    console.error(`company-funded failed: ${err.message}`);
    process.exit(1);
  });
}
