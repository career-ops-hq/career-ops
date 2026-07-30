// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Greenhouse provider — hits the public boards-api JSON endpoint.
// Handles both explicit `api:` URLs and auto-detection from `careers_url`.

const ALLOWED_GREENHOUSE_HOSTS = new Set([
  'boards-api.greenhouse.io',
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io',
]);

/** @param {string} url */
function assertGreenhouseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`greenhouse: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`greenhouse: URL must use HTTPS: ${url}`);
  if (!ALLOWED_GREENHOUSE_HOSTS.has(parsed.hostname))
    throw new Error(`greenhouse: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_GREENHOUSE_HOSTS].join(', ')}`);
  return url;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveApiUrl(entry) {
  if (entry.api) {
    assertGreenhouseUrl(entry.api);
    return entry.api;
  }
  const url = entry.careers_url || '';
  const match = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (match) return `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs`;
  return null;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// ── Office enrichment ───────────────────────────────────────────────
// Some Greenhouse boards put the *work model* ("Hybrid", "In-Office",
// "Distributed") in location.name and keep the actual city in the separate
// offices[] array — which the /jobs list endpoint does not return. For those
// boards scan.mjs's location_filter never sees a city, so every role is
// evaluated against the string "Hybrid" and silently dropped. Same bug class
// as #1073 (Ashby dropping secondaryLocations), different provider.
//
// The city is recoverable from /v1/boards/{slug}/offices, which nests
// offices → departments → jobs and costs one extra request. That request is
// only worth making for boards that actually exhibit the pattern: boards
// already reporting real cities pay nothing (Datadog's /offices is 2.8MB).

const WORK_MODEL = /^(?:hybrid|in[-\s]?office|on[-\s]?site|distributed|remote|flexible)$/i;

/**
 * True when a location string carries a work model but no geography at all
 * ("Hybrid", "Distributed; Hybrid"). Anything with a place in it
 * ("Hybrid - London", "Remote (Canada)") is already filterable and is left
 * alone, so enrichment can never rewrite a location that was working.
 * @param {unknown} name
 */
export function isWorkModelOnly(name) {
  if (typeof name !== 'string') return false;
  const parts = name.split(';').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(p => WORK_MODEL.test(p));
}

/**
 * boards/{slug}/jobs → boards/{slug}/offices. Returns null for any other
 * shape (e.g. a single-job URL), which disables enrichment rather than
 * guessing at an endpoint.
 * @param {string} apiUrl
 */
export function officesUrlFor(apiUrl) {
  const m = apiUrl.match(/^(https:\/\/[^/]+\/v1\/boards\/[^/]+)\/jobs(?:$|[?#])/);
  return m ? `${m[1]}/offices` : null;
}

/**
 * Build jobId → Set(office names) by walking offices → departments → jobs.
 * A job listed under several offices collects all of them, which is how a
 * genuinely multi-site role keeps every city it is open to.
 * @param {any} json
 */
export function buildOfficeMap(json) {
  /** @type {Map<any, Set<string>>} */
  const map = new Map();
  /** @param {any} offices */
  const walk = (offices) => {
    if (!Array.isArray(offices)) return;
    for (const office of offices) {
      if (!office || typeof office !== 'object') continue;
      const name = typeof office.name === 'string' ? office.name.trim() : '';
      if (name) {
        for (const dept of Array.isArray(office.departments) ? office.departments : []) {
          for (const job of Array.isArray(dept?.jobs) ? dept.jobs : []) {
            if (!job || job.id == null) continue;
            if (!map.has(job.id)) map.set(job.id, new Set());
            map.get(job.id).add(name);
          }
        }
      }
      walk(office.children);
    }
  };
  walk(json?.offices);
  return map;
}

/** @type {Provider} */
export default {
  id: 'greenhouse',

  detect(entry) {
    try {
      const apiUrl = resolveApiUrl(entry);
      return apiUrl ? { url: apiUrl } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`greenhouse: cannot derive API URL for ${entry.name}`);
    assertGreenhouseUrl(apiUrl);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertGreenhouseUrl above it guarantees the final hostname stays in the allowlist.
    const json = /** @type {any} */ (await ctx.fetchJson(apiUrl, { redirect: 'error' }));
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    const usable = jobs.filter(/** @param {any} j */ j => j.absolute_url);

    // Only pay for /offices when this board actually hides its cities there.
    let officeMap = null;
    if (usable.some(/** @param {any} j */ j => isWorkModelOnly(j.location?.name))) {
      const officesUrl = officesUrlFor(apiUrl);
      if (officesUrl) {
        try {
          assertGreenhouseUrl(officesUrl);
          officeMap = buildOfficeMap(await ctx.fetchJson(officesUrl, { redirect: 'error' }));
        } catch (err) {
          // No /offices on this board, or it failed — fall back to the bare
          // work-model string. Enrichment is best-effort; a scan must never
          // fail because the secondary lookup did. Logged so a persistent
          // regression is distinguishable from a board that simply has no
          // /offices, which is expected and harmless.
          // `err` is not guaranteed to be an Error — a promise may reject with
          // anything, and reading .message off null would throw *inside* the
          // catch, defeating the guarantee above.
          const cause = err instanceof Error ? err.message : String(err);
          console.error(`⚠️  greenhouse: ${entry.name} /offices enrichment failed — ${cause} (keeping work-model-only locations)`);
          officeMap = null;
        }
      }
    }

    return usable.map(/** @param {any} j */ (j) => {
      let location = j.location?.name || '';
      if (officeMap && isWorkModelOnly(location)) {
        const offices = officeMap.get(j.id);
        if (offices && offices.size > 0) location = [location, ...offices].join(' · ');
      }
      return {
        title: j.title || '',
        url: j.absolute_url,
        company: entry.name,
        location,
        postedAt: toEpochMs(j.first_published),
      };
    });
  },
};
