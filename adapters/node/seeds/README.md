# seeds/ — VC Portfolio Seed Fetchers

A complementary discovery path for startup job-seekers: pull a **public VC portfolio company list** and probe each company's ATS for openings, feeding results into the same SQLite opportunity store as tracked companies in `portals.yml`.

## What this does

`python -m workflow.career_ops global` discovers companies by walking public ATS directories (Greenhouse, Lever, Ashby, Workday, iCIMS). The `seeds/` layer adds a **high-signal starting point for startup roles** by reading public YC and a16z portfolio lists.

Flow:
```
VC portfolio API/page
    ↓ seeds/vc-portfolios.mjs
SeedCompany[]
    ↓ Python seed validation and board selection
ATS provider fetches jobs
    ↓ Python title, location, content and dedup decisions
data/opportunities.db
```

## Usage

### Via the Python workflow

```bash
# Seed from Y Combinator portfolio, last 7 days
workflow/.venv/bin/python -m workflow.career_ops global --seeds yc --since 7

# Seed from both YC and a16z, dry-run preview
workflow/.venv/bin/python -m workflow.career_ops global --seeds yc,a16z --dry-run

# Combine seeds + regular ATS sources
workflow/.venv/bin/python -m workflow.career_ops global --seeds yc --ats greenhouse,lever --since 5
```

### Programmatic

```js
import { fetchYCCompanies, fetchA16zCompanies, SEED_SOURCES } from './seeds/vc-portfolios.mjs';

// Fetch YC companies
const companies = await fetchYCCompanies();
console.log(companies[0]);
// → { name: 'Stripe', slug: 'stripe', url: 'https://stripe.com', source: 'yc', batch: 'W11' }

// Using the registry
for (const [id, source] of Object.entries(SEED_SOURCES)) {
  const companies = await source.fetch();
  console.log(`${source.label}: ${companies.length} companies`);
}
```

## Data sources

| Source | URL | Format | Auth |
|--------|-----|--------|------|
| Y Combinator | `https://api.ycombinator.com/v0.1/companies` | JSON API | None |
| a16z | `https://a16z.com/portfolio/` | Public HTML page | None |

- **YC**: Fetches up to 500 pages × 1000 companies. Covers all public YC batches.
- **a16z**: Parses the public portfolio page. Falls back gracefully if the page structure changes.

## Security

- All slugs are validated against `SLUG_RE = /^[A-Za-z0-9._-]+$/` before any URL interpolation — consistent with the Python reverse-discovery guard.
- Constructed ATS URLs go through the existing `entryOnHost()` SSRF guard before reaching any provider.
- No authentication tokens, no headless browser, no LLM API calls.

## Adding more VC portfolios

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

4. Add test cases in `the offline adapter tests` covering your `parseXyzPayload()` function.

## Prior art

The VC-portfolio seeding approach is inspired by [adityachaudhary99/job-hunt](https://github.com/adityachaudhary99/job-hunt) (`02-seeds/fetch_yc.py`, `fetch_a16z.py`), which was the original companion reference cited in issue #1370.
