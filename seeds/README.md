# seeds/: scanner seed sources

| Path | What it is |
|------|------------|
| `vc-portfolios.mjs` | Fetchers that pull a public VC portfolio company list and probe each company's ATS, below. |
| `employers-validate.mjs` | The static validator of the employer registry, which lives at the repository root in [`employers/`](../employers/README.md): a community-maintained list of employer job boards, one pointer per board (employer → ATS → board), with no postings and no personal data, licensed CC BY 4.0. CI runs the validator on every pull request that touches the registry (`.github/workflows/employers-validate.yml`). |
| `employers-inbox.mjs` | The registry's contribution inbox (`employers/inbox/`): file names, the short line format, and the check that a pull request only adds inbox files. |
| `employers-import.mjs` | Turns a CSV or a list of board URLs into inbox files, reading each URL back to its ATS and board. No network. |
| `employers-fold.mjs` | For maintainers: folds the inbox into `boards/` and `contributions/`, skips boards already listed, regenerates `CHANGELOG.md` and empties the inbox. Dry run unless `--apply`; it does not commit. |

The scanner does not read the employer registry yet.

## VC portfolio seed fetchers

A complementary discovery path for startup job-seekers: pull a **public VC portfolio company list** and probe each company's ATS for openings, feeding results into the same pipeline as tracked companies in `portals.yml`.

### What this does

`scan-ats-full.mjs` normally discovers companies by walking public ATS directories (Greenhouse, Lever, Ashby, Workday, iCIMS, BambooHR, Paylocity, join.com, Workable). The `seeds/` layer adds a **high-signal starting point for startup roles**: rather than waiting for companies to appear in ATS directories, we seed the universe from well-known VC portfolios — giving you instant coverage of hundreds of YC/a16z-backed companies.

Flow:
```
VC portfolio API/page
    ↓ seeds/vc-portfolios.mjs
SeedCompany[]
    ↓ toPortalEntry()
toPortalEntries()
    ↓
PortalEntry candidates: Ashby, Greenhouse, Lever board URLs from the slug
    ↓ probed in that order; a 404 moves to the next, the first board found wins
ATS provider fetches jobs
    ↓ title_filter / location_filter / dedup
data/pipeline.md
```

### Usage

#### Via scan-ats-full.mjs (recommended)

```bash
# Seed from Y Combinator portfolio, last 7 days
node scan-ats-full.mjs --seeds yc --since 7

# Seed from both YC and a16z, dry-run preview
node scan-ats-full.mjs --seeds yc,a16z --dry-run

# Combine seeds + regular ATS sources
node scan-ats-full.mjs --seeds yc --ats greenhouse,lever --since 5

# npm shortcuts
npm run scan:seeds   # yc + a16z
npm run scan:yc      # YC only
```

#### Programmatic

```js
import { fetchYCCompanies, fetchA16zCompanies, toPortalEntries, SEED_SOURCES } from './seeds/vc-portfolios.mjs';

// Fetch YC companies
const companies = await fetchYCCompanies();
console.log(companies[0]);
// → { name: 'Stripe', slug: 'stripe', url: 'https://stripe.com', source: 'yc', batch: 'W11' }

// Candidate PortalEntries for ATS provider.detect(), in probe order
const candidates = toPortalEntries(companies[0]);
// → [{ name: 'Stripe', careers_url: 'https://jobs.ashbyhq.com/stripe', source: 'yc' },
//    { ..., careers_url: 'https://job-boards.greenhouse.io/stripe' },
//    { ..., careers_url: 'https://jobs.lever.co/stripe' }]

// Using the registry
for (const [id, source] of Object.entries(SEED_SOURCES)) {
  const companies = await source.fetch();
  console.log(`${source.label}: ${companies.length} companies`);
}
```

### Data sources

| Source | URL | Format | Auth |
|--------|-----|--------|------|
| Y Combinator | `https://api.ycombinator.com/v0.1/companies` | JSON API | None |
| a16z | `https://a16z.com/portfolio/` | Public HTML page | None |

- **YC**: Walks every page the API reports (`totalPages`). The page size is set by the API. Covers all public YC batches.
- **a16z**: Reads the company list embedded in the public portfolio page (the `data-companies` attribute, with the inline `window.a16z_portfolio_companies` script as fallback). Acquired companies are skipped. A page that parses to zero companies fails with a warning instead of returning an empty list.
- Neither source names a company's ATS, so each company is probed by slug on Ashby, Greenhouse and Lever. A company with no board on any of them is counted as "no board found", not as an error.

### Security

- All slugs are validated against `SLUG_RE = /^[A-Za-z0-9._-]+$/` before any URL interpolation — consistent with the guard in `scan-ats-full.mjs`.
- Constructed ATS URLs go through the existing `entryOnHost()` SSRF guard before reaching any provider.
- No authentication tokens, no headless browser, no LLM API calls.

### Adding more VC portfolios

1. Add a `parseXyzPayload(payload)` pure function (no network — testable with inline fixtures).
2. Add a `fetchXyzCompanies(opts?)` async function that calls the public endpoint and returns `SeedCompany[]`.
3. Register it in `SEED_SOURCES`:

```js
export const SEED_SOURCES = {
  yc: { fetch: fetchYCCompanies, label: 'Y Combinator Portfolio' },
  a16z: { fetch: fetchA16zCompanies, label: 'Andreessen Horowitz (a16z) Portfolio' },
  // Add yours:
  sequoia: { fetch: fetchSequoiaCompanies, label: 'Sequoia Portfolio' },
};
```

4. Add test cases in `test-all.mjs` covering your `parseXyzPayload()` function.

### Prior art

The VC-portfolio seeding approach is inspired by [adityachaudhary99/job-hunt](https://github.com/adityachaudhary99/job-hunt) (`02-seeds/fetch_yc.py`, `fetch_a16z.py`), which was the original companion reference cited in issue #1370.
