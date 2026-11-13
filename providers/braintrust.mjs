// @ts-check
// Braintrust freelance talent network: the public job list behind
// app.usebraintrust.com/jobs. job_boards: provider: braintrust.
// Each listing names its employer (including AI labs and Outlier projects);
// applying needs a free Braintrust account.
// robots.txt (checked 2026-11-07) disallows `?page=` URLs, so the list is never
// paged. The API caps a response at 100 rows, so the provider reads the newest
// 100 and the oldest 100 and merges them. That is the whole inventory up to
// 200 listings (148 on 2026-11-07); above that the middle is missed and a
// warning says so. The list carries no description; scout fetches it from
// /api/jobs/{id}/ when it needs one (lib/scout-jd.mjs).
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { str, epoch } from './_scout-board.mjs';

const ORIGIN = 'https://app.usebraintrust.com';
const PAGE_SIZE = 100;
const LISTS = [`${ORIGIN}/api/jobs/?page_size=${PAGE_SIZE}`, `${ORIGIN}/api/jobs/?page_size=${PAGE_SIZE}&ordering=created`];

const money = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? `$${n % 1 ? n.toFixed(2) : n}` : ''; };
function payLine(row) {
  const lo = money(row.budget_minimum_usd), hi = money(row.budget_maximum_usd);
  const range = lo && hi && lo !== hi ? `${lo}–${hi}` : lo || hi;
  if (!range) return '';
  return { hourly: `Hourly rate: ${range}`, annual: `Annual salary: ${range}`, per_task: `Pay per task: ${range}`,
    fixed_price: `Fixed budget: ${range}`, fixed_project: `Fixed budget: ${range}` }[row.payment_type] ?? `Budget: ${range}`;
}

export function normalizeBraintrustJob(row) {
  const title = str(row?.title);
  const id = Number.isInteger(row?.id) ? safeEncodeURIComponent(String(row.id)) : null;
  if (!title || !id) return null;
  const places = Array.isArray(row.locations) ? row.locations.map(l => str(l?.location)).filter(Boolean) : [];
  const skills = Array.isArray(row.main_skills) ? row.main_skills.map(s => str(s?.name)).filter(Boolean) : [];
  const hours = Number(row.expected_hours_per_week);
  const kind = { freelance: 'Freelance', direct_hire: 'Direct hire (employment)' }[row.job_type] ?? str(row.job_type);
  const postedAt = epoch(row.created);
  return {
    title, url: `${ORIGIN}/jobs/${id}/`, externalId: String(row.id),
    company: str(row.employer?.name), location: places.join(', '),
    description: [
      kind && `${kind} via Braintrust${row.contract_type === 'long' ? ', long-term' : row.contract_type === 'short' ? ', short-term' : ''}.`,
      payLine(row) && `${payLine(row)}.`,
      Number.isFinite(hours) && hours > 0 && `Expected ${hours} hours per week.`,
      places.length && `Locations: ${places.join(', ')}.`,
      skills.length && `Skills: ${skills.join(', ')}.`,
    ].filter(Boolean).join('\n'),
    ...(postedAt ? { postedAt } : {}),
  };
}

/** @type {import('./_types.js').Provider} */
export default {
  id: 'braintrust',
  detect(entry) { return entry?.provider === 'braintrust' ? { url: `${ORIGIN}/jobs/` } : null; },
  async fetch(_entry, ctx) {
    const lists = ctx.maxPages != null ? LISTS.slice(0, 1) : LISTS;
    const jobs = new Map();
    let count = 0;
    for (const [i, url] of lists.entries()) {
      if (i) await sleep(400, ctx);
      const data = await fetchJsonWithRetry(ctx, url, { redirect: 'error', headers: { accept: 'application/json' } });
      if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
        throw new Error(`braintrust: expected {results: [...]}, got ${data && typeof data === 'object' ? Object.keys(data).join(',') || 'empty object' : typeof data}`);
      }
      count = Number(data.count) || count;
      for (const row of data.results) { const job = normalizeBraintrustJob(row); if (job) jobs.set(job.url, job); }
      if (data.results.length < PAGE_SIZE) break; // one response held everything
    }
    if (ctx.maxPages == null && count > jobs.size) console.warn(`braintrust: ${count} listings, ${jobs.size} read; the oldest-first and newest-first lists no longer overlap`);
    return [...jobs.values()];
  },
};
