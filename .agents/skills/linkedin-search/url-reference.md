# LinkedIn Jobs URL Reference

Public, unauthenticated `jobs-guest` endpoints used by this skill. Global — the same
endpoints serve every market; only the `location` value changes.

> Personal use only — automated access is against LinkedIn's Terms of Service; keep volume low.

## Search

```
GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
```

Query params:

| Param | Meaning | Example |
|-------|---------|---------|
| `keywords` | Free-text query | `data engineer` |
| `location` | Place string | `Mumbai, Maharashtra, India` · `Berlin, Germany` · `Remote` |
| `f_TPR` | Posted-within window (seconds) | `r604800` (7d), `r2592000` (30d) |
| `f_WT` | Workplace type | `1` on-site · `2` remote · `3` hybrid |
| `start` | Pagination offset (10/page) | `0`, `10`, `20`, … |

Returns an HTML list of job cards (one `<li>` per posting). The CLI parses each card by
its `data-entity-urn="urn:li:jobPosting:<id>"` and extracts title, company, location, date, URL.

## Detail

```
GET https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<jobId>
```

Returns a single job's HTML: title (`top-card-layout__title`), company
(`topcard__org-name-link`), location (`topcard__flavor--bullet`), the rich description
(`show-more-less-html__markup` / `description__text`), and job-criteria items
(seniority, employment type, job function, industries).

## Notes

- No authentication required.
- Respect rate limits — the CLI backs off on 429/5xx.
- Country-agnostic: pass any `--location` (city, region, country, or "Remote").
