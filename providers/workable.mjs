// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Workable provider — hits the public markdown feed at /<slug>/jobs.md.
// Workable's documented JSON API requires an auth token; the markdown feed
// is the only no-auth public surface. Auto-detects from careers_url pattern
// `https://apply.workable.com/<slug>`. A tracked_companies entry can also
// set `provider: workable` explicitly to bypass detection.
//
// Large boards return search instructions instead of a complete table. Configure
// a bounded query fan-out for those boards:
//   workable:
//     queries: ["backend engineer", "platform engineer"]
//     fetch_details: true

const ALLOWED_WORKABLE_HOSTS = new Set(['apply.workable.com']);

function assertWorkableUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`workable: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`workable: URL must use HTTPS: ${url}`);
  if (!ALLOWED_WORKABLE_HOSTS.has(parsed.hostname)) {
    throw new Error(`workable: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_WORKABLE_HOSTS].join(', ')}`);
  }
  return url;
}

function resolveFeedUrl(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'apply.workable.com') return null;
  const slug = parsed.pathname.split('/').filter(Boolean)[0];
  if (!slug) return null;
  return `https://apply.workable.com/${slug}/jobs.md`;
}

function resolveQueries(entry) {
  const raw = entry?.workable && typeof entry.workable === 'object'
    ? entry.workable.queries
    : null;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .filter(query => typeof query === 'string')
    .map(query => query.trim())
    .filter(Boolean))]
    .slice(0, 20);
}

async function enrichWithDetails(jobs, entry, ctx) {
  if (entry?.workable?.fetch_details !== true) return jobs;
  const enriched = [];
  for (const job of jobs) {
    try {
      const detailUrl = `${job.url}.md`;
      assertWorkableUrl(detailUrl);
      const detailText = await ctx.fetchText(detailUrl, { redirect: 'error' });
      enriched.push(parseWorkableDetailMarkdown(detailText, job));
    } catch {
      enriched.push(job);
    }
  }
  return enriched;
}

/** @type {Provider} */
export default {
  id: 'workable',

  detect(entry) {
    const feedUrl = resolveFeedUrl(entry);
    return feedUrl ? { url: feedUrl } : null;
  },

  async fetch(entry, ctx) {
    const feedUrl = resolveFeedUrl(entry);
    if (!feedUrl) throw new Error(`workable: cannot derive feed URL for ${entry.name}`);
    assertWorkableUrl(feedUrl);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertWorkableUrl above it guarantees the final hostname stays in the allowlist.
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    const directJobs = parseWorkableMarkdown(text, entry.name);
    if (directJobs.length > 0) return enrichWithDetails(directJobs, entry, ctx);

    const queries = resolveQueries(entry);
    if (queries.length === 0) return [];

    const jobsByUrl = new Map();
    for (const query of queries) {
      const queryUrl = new URL(feedUrl);
      queryUrl.searchParams.set('query', query);
      assertWorkableUrl(queryUrl.toString());
      const queryText = await ctx.fetchText(queryUrl.toString(), { redirect: 'error' });
      for (const job of parseWorkableMarkdown(queryText, entry.name)) {
        jobsByUrl.set(job.url, job);
      }
    }
    return enrichWithDetails([...jobsByUrl.values()], entry, ctx);
  },
};

/**
 * Parse Workable's public markdown feed. Exported as a named export for unit
 * tests. The feed exposes a table:
 *   | Title | Department | Location | Type | Salary | Posted | Details |
 * where `Details` holds a markdown link
 *   [View](https://apply.workable.com/<slug>/jobs/view/<id>.md)
 * URLs are validated against `https://apply.workable.com/` — off-domain or
 * non-HTTPS [View] links are skipped (not emitted).
 *
 * @param {string} text — markdown body
 * @param {string} companyName — value to write into job.company
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseWorkableMarkdown(text, companyName) {
  if (typeof text !== 'string') return [];
  const jobs = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || !line.includes('[View]')) continue;
    const cols = line.split('|').map(c => c.trim());
    // Cols: ['', title, dept, location, type, salary, posted, '[View](url.md)', '']
    if (cols.length < 8) continue;
    const title = cols[1];
    if (!title || title === 'Title') continue;
    const location = cols[3] || '';
    const urlMatch = line.match(/\[View\]\(([^)]+)\)/);
    let url = urlMatch ? urlMatch[1] : '';
    if (url.endsWith('.md')) url = url.slice(0, -3);
    if (!url) continue;  // skip rows with no resolvable URL (e.g., malformed [View] link)

    // Validate the extracted URL — must parse as https://apply.workable.com/...
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'apply.workable.com') continue;
      url = parsedUrl.href;
    } catch {
      continue;
    }

    const postedAt = Date.parse(cols[6] || '');
    jobs.push({
      title,
      url,
      location,
      company: companyName,
      ...(Number.isNaN(postedAt) ? {} : { postedAt }),
    });
  }
  return jobs;
}

/**
 * Enrich a Workable list row with the public detail Markdown. The explicit
 * `**Location:**` field is more accurate than the list row's office/country
 * label for region-wide remote roles.
 *
 * @param {string} text
 * @param {{title: string, url: string, company: string, location: string, postedAt?: number}} job
 */
export function parseWorkableDetailMarkdown(text, job) {
  if (typeof text !== 'string' || !text.trim()) return job;
  const locationMatch = text.match(/^\*\*Location:\s*([^*\r\n]+)\*\*\s*$/mi);
  return {
    ...job,
    location: locationMatch?.[1]?.replace(/\u00a0/g, ' ').trim() || job.location,
    description: text,
  };
}
