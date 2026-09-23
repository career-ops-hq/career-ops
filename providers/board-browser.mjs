// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Generic Playwright listing scraper for JS-heavy job boards (Instahyre,
// Cutshort, Wellfound, Work at a Startup, …). Configure via job_boards:
//
//   - name: Instahyre — AI PM India
//     provider: board-browser
//     search_url: https://www.instahyre.com/search-jobs/?skills=AI+Product+Manager&locations=India
//     link_match: instahyre\.com/job-
//     exclude_match: signup|login     # optional
//     wait_ms: 6000                    # optional (default 5000)
//     max_jobs: 80                     # optional (default 100)
//     scroll_steps: 2                  # optional lazy-load scroll passes
//     enabled: true
//
// Uses system Chrome (channel: 'chrome') when available to clear Cloudflare.

import { rejectPrivateOrInvalid } from '../liveness-browser.mjs';
import {
  DEFAULT_MAX_JOBS,
  DEFAULT_WAIT_MS,
  defaultCompanyFromEntry,
  scrapeBoardPage,
} from './_browser-scrape.mjs';

function resolveListingUrl(entry) {
  const raw = entry.search_url || entry.careers_url || '';
  const url = String(raw).trim();
  if (!url) throw new Error('board-browser: search_url or careers_url is required');
  const guard = rejectPrivateOrInvalid(url);
  if (guard) throw new Error(`board-browser: ${guard.reason}`);
  return url;
}

function resolveFetchOptions(entry) {
  const linkMatch = String(entry.link_match || '').trim();
  if (!linkMatch) throw new Error('board-browser: link_match regex is required');

  const maxJobs = Number(entry.max_jobs ?? DEFAULT_MAX_JOBS);
  const waitMs = Number(entry.wait_ms ?? DEFAULT_WAIT_MS);

  return {
    linkMatch,
    excludeMatch: String(entry.exclude_match || '').trim(),
    maxJobs: Number.isFinite(maxJobs) && maxJobs > 0 ? maxJobs : DEFAULT_MAX_JOBS,
    waitMs: Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : DEFAULT_WAIT_MS,
    scrollSteps: Number(entry.scroll_steps ?? 0) || 0,
    defaultCompany: defaultCompanyFromEntry(entry),
  };
}

/** @type {Provider} */
export default {
  id: 'board-browser',

  detect(entry) {
    if (entry?.provider !== 'board-browser') return null;
    try {
      const url = resolveListingUrl(entry);
      return { url };
    } catch {
      return null;
    }
  },

  async fetch(entry) {
    const url = resolveListingUrl(entry);
    const opts = resolveFetchOptions(entry);
    return scrapeBoardPage(url, opts);
  },
};
