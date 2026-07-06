# Supported Job Boards

Career-Ops scans job sources through provider modules in `providers/`. Each
non-helper `*.mjs` file maps to one supported source. Files prefixed with `_`
are shared helpers and are not loaded as providers.

| Board | Type (API / RSS / parser) | Notes |
| --- | --- | --- |
| 4 Day Week | API | Reads the public `https://4dayweek.io/api/jobs` JSON feed (4-day-week / reduced-hours roles). Configure with `provider: 4dayweek`; paginates `?page=N` up to `max_pages` (default 3), drops expired postings, then scanner filters apply. |
| Amazon / AWS | API | Auto-detects `amazon.jobs` careers URLs and queries the public amazon.jobs search API. The board is one global endpoint, so narrow it with an `amazon:` config block (`loc_query`, `base_query`, `category`, …) whose keys pass through as query params. Configure with `provider: amazon`. |
| Arbeitnow | API | Reads the public `https://www.arbeitnow.com/api/job-board-api` JSON feed (EU/DACH-heavy, newest-first). Configure with `provider: arbeitnow`; paginates `?page=N` up to `max_pages` (default 3), then scanner filters apply. |
| Arbeitsagentur | API | Uses the public Bundesagentur fuer Arbeit Jobsuche REST API. Configure with `provider: arbeitsagentur`; title, location, and dedup filters run after fetch. |
| Ashby | API | Auto-detects `https://jobs.ashbyhq.com/<slug>` boards and uses Ashby's public posting API. |
| Avature | Parser | Auto-detects `<tenant>.avature.net` career sites and parses the public server-rendered job list (`/careers/SearchJobs?jobOffset=N`, 6 results/page). A branded custom domain that proxies Avature needs `provider: avature` + `api:` pointing at the Avature origin. Paginates up to `max_pages` (default 50). |
| BambooHR | API | Auto-detects `<tenant>.bamboohr.com` careers pages, reads `/careers/list`, and follows public detail endpoints for job URLs. |
| Breezy HR | API | Auto-detects `<tenant>.breezy.hr` boards and reads the public JSON position feed. |
| Comeet / Spark Hire Recruit | API | Uses Comeet's public careers API. Provide the full API URL with `api:` or `careers_url`; it cannot derive the endpoint from a branded careers page. |
| Get on Board | API | Reads the public `https://www.getonbrd.com/api/v0/categories/programming/jobs` JSON:API feed (remote/LatAm-heavy tech roles). Configure with `provider: getonbrd`; paginates `?page=N` up to `max_pages` (default 3) over the programming category (`expand[]=company`), then scanner filters apply. |
| Glints | API | Uses Glints' public GraphQL job search endpoint. Configure with `provider: glints`; query and filters can be set on the portal entry. |
| Greenhouse | API | Handles explicit `api:` URLs and auto-detects public Greenhouse board URLs for the boards API. |
| HigherEdJobs | RSS | Reads the public `https://www.higheredjobs.com/rss/categoryFeed.cfm?catID={catID}` feed and parses it in-process. Configure with `provider: higheredjobs` and optional `cat_id` (default 68 = Higher Education). Not auto-detected — requires explicit `provider:` config. |
| IBM Careers | API | Posts to IBM's public careers search API and supports optional IBM facet filters in the portal entry. |
| JibeApply | API | Auto-detects `https://<slug>.jibeapply.com/jobs` careers URLs (rewriting `/jobs` to the public `/api/jobs` endpoint); paginates `?page=N` up to `max_pages` (default 50), warning if a tenant's postings exceed the cap. Also supports branded/iCIMS-hosted sites at their own `/jobs` path via an explicit `provider: jibeapply` + `api:` URL. |
| Jobstreet / SEEK | API | Uses the public SEEK chalice-search JSON API for Jobstreet and SEEK sites. Configure explicitly with `provider: jobstreet`. |
| Landing.jobs | API | Reads the board-wide `https://landing.jobs/api/v1/jobs` JSON feed (tech, Europe). Configure with `provider: landingjobs`; company is derived from the posting URL slug. |
| Lever | API | Auto-detects `https://jobs.(eu.)?lever.co/<slug>` boards and uses Lever's public postings endpoint. |
| Local parser | Parser | Runs an in-repo parser command from `portals.yml`. Use this for stable SSR or HTML pages that need a custom extractor. |
| NoDesk | RSS | Reads the public `https://nodesk.co/remote-jobs/index.xml` feed and parses it in-process. Configure with `provider: nodesk`. |
| Personio | RSS | Auto-detects `<slug>.jobs.personio.de` or `.com` hosts and parses the public XML jobs feed. |
| Pinpoint | API | Auto-detects `<slug>.pinpointhq.com` boards and reads the public zero-auth `/postings.json` per-tenant feed. |
| Recruitee | API | Auto-detects `<slug>.recruitee.com` boards and uses the public per-tenant offers API. |
| RemoteOK | API | Reads the board-wide `https://remoteok.com/api` JSON feed; scanner filters decide which rows are relevant. |
| Remotive | API | Reads the board-wide `https://remotive.com/api/remote-jobs` JSON feed, then applies local scanner filters. |
| Rippling | API | Auto-detects `https://ats.rippling.com/<slug>/jobs` careers pages and reads the public zero-auth board API (`api.rippling.com/platform/api/ats/v1/board/<slug>/jobs`). |
| SAP SuccessFactors | Parser | Reads SF Recruiting Marketing (RMK) career sites — branded boards like `jobs.sap.com`, `jobs.zf.com`, `jobs.schaeffler.com` — via the public no-auth `/tile-search-results/?startrow=N` HTML fragment. Branded hosts carry no "successfactors" string, so select with `provider: successfactors` + `api:` the board origin. |
| SmartRecruiters | API | Auto-detects SmartRecruiters careers URLs or uses `provider: smartrecruiters` for branded custom domains. |
| SolidJobs | API | Auto-detects `https://solid.jobs/public-api/offers/<division>` and reads the public offers API. |
| Teamtailor | RSS | Auto-detects `<slug>.teamtailor.com` career sites and reads the public zero-auth `/jobs.rss` per-tenant feed. For a branded careers domain, set `provider: teamtailor` and it reads `/jobs.rss` off that host. Job links may point at a branded custom domain; location comes from the `tt:` city/country tags, falling back to `Remote` when a posting carries no `tt:city`/`tt:country` but its `remoteStatus` is remote (`fully` or `temporary`). |
| The Hub | API | Reads the board-wide `https://thehub.io/api/jobs` JSON feed (Nordic/EU startups). Configure with `provider: thehub`; paginates `?page=N` up to `max_pages` (default 3), then scanner filters apply. |
| We Work Remotely | RSS | Reads the public `https://weworkremotely.com/remote-jobs.rss` feed and parses it in-process. |
| Workable | Parser | Auto-detects `https://apply.workable.com/<slug>` and parses Workable's public markdown jobs feed. |
| Workday | API | Auto-detects `<tenant>.<instance>.myworkdayjobs.com[/<locale>]/<site>` careers URLs and posts to the public CXS jobs endpoint; paginates via offset up to `max_pages` (default 100), warning if a tenant's postings exceed the cap. |
| Working Nomads | API | Reads the board-wide `https://www.workingnomads.com/api/exposed_jobs/` JSON feed, then applies scanner filters. |

When adding a new provider, add a new non-helper module under `providers/` and
update this table in the same PR.
