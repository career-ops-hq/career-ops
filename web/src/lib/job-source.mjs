import { normalizeUrl } from './core/url-key.mjs';

const LABELS = {
  linkedin: 'LinkedIn', 'linkedin-alerts': 'LinkedIn', greenhouse: 'Greenhouse', lever: 'Lever',
  ashby: 'Ashby', workday: 'Workday', personio: 'Personio',
  indeed: 'Indeed', arbeitnow: 'Arbeitnow', arbeitsagentur: 'Arbeitsagentur',
  smartrecruiters: 'SmartRecruiters', workable: 'Workable', recruitee: 'Recruitee',
  teamtailor: 'Teamtailor', wttj: 'Welcome to the Jungle', jobicy: 'Jobicy',
};

/** Human-readable source names for scanner IDs; user-defined names are preserved. */
export function sourceName(value) {
  if (typeof value !== 'string') return '';
  const raw = value.replace(/[\r\n\t|]/g, ' ').trim();
  if (!raw || /^(unknown|manual|explorer|website|n\/a|—|-)$/i.test(raw)) return '';
  const id = raw.replace(/^plugin:/i, '').replace(/-(?:full|api|parser)$/i, '').toLowerCase();
  if (LABELS[id]) return LABELS[id];
  // A person's custom source name is not a machine identifier to title-case.
  if (/\s/.test(raw)) return raw;
  const text = raw.replace(/^plugin:/i, '').replace(/-(?:full|api|parser)$/i, '');
  return text.replace(/(^|[-_])([a-z])/g, (_, prefix, letter) => `${prefix ? ' ' : ''}${letter.toUpperCase()}`);
}

function hostnameSource(url) {
  if (typeof url === 'string' && url.startsWith('local:')) return 'Pasted job';
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    const domain = name => host === name || host.endsWith(`.${name}`);
    if (domain('linkedin.com')) return 'LinkedIn';
    if (domain('greenhouse.io')) return 'Greenhouse';
    if (domain('lever.co')) return 'Lever';
    if (domain('ashbyhq.com')) return 'Ashby';
    if (domain('myworkdayjobs.com') || domain('workday.com')) return 'Workday';
    if (domain('indeed.com') || domain('indeed.de')) return 'Indeed';
    if (domain('personio.de') || domain('personio.com')) return 'Personio';
    return host.replace(/^www\./, '') || '';
  } catch { return ''; }
}

/**
 * Read provenance from existing data without rewriting it. Pipeline labels and
 * monitor notices prove where a job was added; older scanner history supplies
 * the first added source when no more-specific saved source is available.
 * @param {{pipeline?: Array<{url?: string, source?: string}>, history?: string, monitors?: any}} input
 */
export function sourceIndex({ pipeline = [], history = '', monitors = null } = {}) {
  const found = new Map();
  function remember(url, raw) {
    const key = normalizeUrl(url);
    const name = sourceName(raw);
    if (key && name && !found.has(key)) found.set(key, name);
  }
  for (const job of pipeline) remember(job.url, job.source);
  if (Array.isArray(monitors?.notices)) {
    // Notices are newest-first; either direction is safe for distinct URLs.
    // When one URL has several records, retain its earliest observed source.
    for (const notice of [...monitors.notices].reverse()) {
      if (!Array.isArray(notice?.jobs)) continue;
      for (const job of notice.jobs) remember(job?.url, notice.name);
    }
  }
  const lines = String(history || '').split(/\r?\n/);
  const header = (lines.shift() || '').split('\t').map(value => value.trim().toLowerCase());
  const urlAt = header.indexOf('url'), sourceAt = header.indexOf('portal'), statusAt = header.indexOf('status');
  if (urlAt >= 0 && sourceAt >= 0 && statusAt >= 0) {
    for (const line of lines) {
      const cells = line.split('\t');
      if (!/^added(?:\b|$)/i.test((cells[statusAt] || '').trim())) continue;
      remember(cells[urlAt], cells[sourceAt]);
    }
  }
  return found;
}

/** Resolve the recorded discovery source, or honestly fall back to the link host. */
export function jobSource(job, index = new Map()) {
  const recorded = sourceName(job?.source) || index.get(normalizeUrl(job?.url));
  if (recorded) return { label: recorded, inferred: false };
  const host = hostnameSource(job?.url);
  return host ? { label: host, inferred: true } : { label: 'Unknown source', inferred: true };
}
