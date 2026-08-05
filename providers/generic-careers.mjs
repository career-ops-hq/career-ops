// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

/**
 * generic-careers.mjs — Smart career page auto-detector.
 *
 * Given any company's careers_url, this provider:
 * 1. Fetches the page HTML
 * 2. Inspects the content and URL for known ATS footprints (Greenhouse, Ashby,
 *    Lever, Workday, BambooHR, Lever, SmartRecruiters, SuccessFactors, iCIMS, etc.)
 * 3. Detects the ATS type
 * 4. Extracts job listings using the appropriate parser
 *
 * This eliminates the need to manually configure every company — just provide
 * a careers_url and this provider does the rest.
 */

const ATS_DETECTORS = [
  // Greenhouse — check first since it's most common
  {
    id: 'greenhouse',
    detect: (html, url) => {
      // Greenhouse embeds: data-qa="job-card" / gh_jid / boards-api.greenhouse
      if (/boards\.greenhouse\.io|job-boards\.greenhouse\.io|job-boards\.eu\.greenhouse\.io/.test(url)) return true;
      if (/gh_jid/.test(html)) return true;
      if (/Greenhouse|greenhouse\.io/.test(html) && /job|career/.test(html)) return true;
      return false;
    },
    parse: async (html, url, company, ctx) => {
      // Extract Greenhouse slug from URL or HTML
      const match = url.match(/(?:job-boards(?:\.eu)?\.greenhouse\.io)\/([^/?#]+)/);
      if (!match) return [];
      const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs`;
      try {
        const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
        const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
        return jobs.filter(j => j.absolute_url).map(j => ({
          title: j.title || '',
          url: j.absolute_url,
          company: company,
          location: j.location?.name || '',
          postedAt: j.first_published ? Date.parse(j.first_published) : undefined,
        }));
      } catch {
        return [];
      }
    },
  },

  // Ashby
  {
    id: 'ashby',
    detect: (html, url) => {
      if (/jobs\.ashbyhq\.com/.test(url)) return true;
      if (/ashbyhq\.com/.test(html)) return true;
      return false;
    },
    parse: async (html, url, company, ctx) => {
      const match = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
      if (!match) return [];
      const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${match[1]}?includeCompensation=true`;
      try {
        const json = await ctx.fetchJson(apiUrl, { timeoutMs: 30000, redirect: 'error' });
        const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
        return jobs.map(j => ({
          title: j.title || '',
          url: j.jobUrl || '',
          company: company,
          location: (j.location || '') + ((j.secondaryLocations || []).map(s => s.location || '').join(' · ') ? ` · ${(j.secondaryLocations || []).map(s => s.location).join(' · ')}` : ''),
          salary: j.compensation ? { min: j.compensation.minValue, max: j.compensation.maxValue, currency: j.compensation.currency } : undefined,
          postedAt: j.publishedAt ? Date.parse(j.publishedAt) : undefined,
        }));
      } catch {
        return [];
      }
    },
  },

  // Lever
  {
    id: 'lever',
    detect: (html, url) => {
      if (/jobs\.lever\.co/.test(url)) return true;
      if (/jobs\.eu\.lever\.co/.test(url)) return true;
      if (/lever\.co/.test(html) && /job|career/.test(html)) return true;
      return false;
    },
    parse: async (html, url, company, ctx) => {
      const match = url.match(/jobs\.(?:eu\.)?lever\.co\/([^/?#]+)/);
      if (!match) return [];
      const apiUrl = `https://api.lever.co/v0/postings/${match[1]}`;
      try {
        const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
        if (!Array.isArray(json)) return [];
        return json.map(j => ({
          title: j.text || '',
          url: j.hostedUrl || j.applyUrl || '',
          company: company,
          location: j.categories?.location || '',
          description: j.descriptionPlain || '',
          postedAt: j.createdAt ? Date.parse(j.createdAt) : undefined,
        }));
      } catch {
        return [];
      }
    },
  },

  // BambooHR
  {
    id: 'bamboohr',
    detect: (html, url) => {
      if (/bamboohr\.com/.test(url)) return true;
      if (/BambooHR/.test(html)) return true;
      return false;
    },
    parse: async (html, url, company, ctx) => {
      // Already handled by bamboohr.mjs provider
      return [];
    },
  },

  // Workday
  {
    id: 'workday',
    detect: (html, url) => {
      if (/myworkdayjobs\.com/.test(url)) return true;
      if (/(workday|myworkday)/i.test(html)) return true;
      return false;
    },
    parse: async (html, url, company, ctx) => {
      // Already handled by workday.mjs provider
      return [];
    },
  },

  // SmartRecruiters
  {
    id: 'smartrecruiters',
    detect: (html, url) => {
      if (/smartrecruiters\.com/.test(url)) return true;
      if (/SmartRecruiters/.test(html)) return true;
      return false;
    },
    parse: async (html, url, company, ctx) => {
          // Extract company slug from URL
      const match = url.match(/(?:smartrecruiters|careers-\w+)\.com\/([^/?#]+)/i);
      if (!match) return [];
      const apiUrl = `https://api.smartrecruiters.com/v1/companies/${match[1]}/postings`;
      try {
        const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
        const jobs = Array.isArray(json?.content) ? json.content : [];
        return jobs.map(j => ({
          title: j.name || '',
          url: j.additionalProperties?.applyUrl || j.id || '',
          company: company,
          location: j.location || '',
        }));
      } catch { return []; }
    },
  },

  // Workable
  {
    id: 'workable',
    detect: (html, url) => {
      if (/apply\.workable\.com/.test(url)) return true;
      if (/workable\.com/.test(url)) return true;
      return false;
    },
    parse: async (html, url, company, ctx) => {
      const match = url.match(/apply\.workable\.com\/([^/?#]+)/);
      if (!match) return [];
      const apiUrl = `https://apply.workable.com/api/v1/widget/accounts/${match[1]}`;
      try {
        const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
        const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
        return jobs.map(j => ({
          title: j.title || '',
          url: j.url || j.shortlink || '',
          company: company,
          location: j.location?.city || j.location?.country || '',
          postedAt: j.published_date ? Date.parse(j.published_date) : undefined,
        }));
      } catch { return []; }
    },
  },

  // SuccessFactors / SAP
  {
    id: 'successfactors',
    detect: (html, url) => {
      if (/successfactors\.com/.test(url) || /sap\.com\/career/.test(url)) return true;
      return false;
    },
    parse: async (html, url, company, ctx) => {
      // Already handled by successfactors.mjs
      return [];
    },
  },
];

/** @type {Provider} */
export default {
  id: 'generic-careers',

  /**
   * detect() — This provider is the "catch-all". It should only be used when:
   * 1. No other provider matched the entry (check is done in _registry.mjs)
   * 2. The entry has a careers_url or was explicitly asked for
   */
  detect(entry) {
    // Only activate if the user explicitly set provider: generic-careers
    // or if no other provider matched
    if (entry.provider === 'generic-careers') {
      return { url: entry.careers_url || entry.api || '' };
    }
    // Also activate for entries that just have a careers_url and no explicit provider
    // This is our "last resort" fallback
    if (!entry.provider && entry.careers_url && !entry.api) {
      return { url: entry.careers_url };
    }
    return null;
  },

  async fetch(entry, ctx) {
    const url = entry.careers_url || entry.api || '';
    if (!url) throw new Error('generic-careers: no careers_url or api URL');
    
    console.log(`  [generic-careers] Auto-detecting ATS for ${entry.name} at ${url}`);
    
    // Fetch the HTML
    let html = '';
    try {
      html = await ctx.fetchText(url, { timeoutMs: 15000 });
    } catch (err) {
      console.error(`  [generic-careers] Failed to fetch ${url}: ${err.message}`);
      // If fetch failed, try a fallback search
      return [];
    }

    // Try each ATS detector
    for (const ats of ATS_DETECTORS) {
      if (ats.detect(html, url)) {
        console.log(`  [generic-careers] Detected ${ats.id} for ${entry.name}`);
        try {
          const jobs = await ats.parse(html, url, entry.name, ctx);
          if (jobs.length > 0) {
            console.log(`  [generic-careers] Found ${jobs.length} jobs via ${ats.id} for ${entry.name}`);
            return jobs;
          }
        } catch (err) {
          console.error(`  [generic-careers] ${ats.id} parse error for ${entry.name}: ${err.message}`);
        }
      }
    }

    // Fallback: If known ATS-specific providers exist, they handle extraction
    // If we get here, we couldn't auto-detect or extract. Return empty.
    console.log(`  [generic-careers] Could not extract jobs from ${url}`);
    return [];
  },
};
