<!-- Maps retained Node insight behavior to OII-344 canonical Python queries. -->

# OII-344 Node insight baseline

| Valid Node behavior | Python entry and source |
|---|---|
| `stats.mjs` lifecycle counts and cumulative funnel | `insights stats`; canonical `opportunities`, `application_lifecycle`, `application_events` |
| `stats.mjs` scan totals, weekly additions, portal production/health and run trends | `insights stats`; `scan_observations`, `scan_outcomes`, `source_health`, `scan_runs`, `portals.yml` |
| `stats.mjs` sent follow-up counts and cold applications | `insights stats`; `application_activity`, `application_lifecycle`, profile cadence |
| `company-history.mjs` response history, silence/staleness and repost axis | `insights company`; application events/activity and `scan_observations` |
| `company-history.mjs --emit-signal` stable no-response records | `insights company-signals`; derived read-only from company cards and profile region, never sent |
| `detect-reposts.mjs` title identity, distinct URLs/dates, rolling window, aggregator exclusion | `insights reposts`; `scan_observations` and `portals.yml` |
| `salary-gap.mjs` desired/advertised/actual trust fold, same-currency gaps, statement trail and quality | `insights salary`; canonical `salary_observations` and profile; `salary record` uses LangGraph `validate -> commit` |
| `salary-gap.mjs --stated-for` prior numbers, round and interviewer | `insights stated --opportunity ID`; `salary_observations` |
| `upskill.mjs` recurring evaluated gaps and skill aliases | `insights upskill`; retained scored capability table, scan core-capability evidence, CV Skills section |
| `jd-skill-gap.mjs` requirement extraction and named/prose/gap classification; `upskill.mjs --url-text` | `insights jd-skill-gap --jd PATH` or `--jd-url URL`; JD and CV, with the guarded provider capture tool for URLs |
| `preparation-plan.mjs` source-grounded evidence buckets, reviewed report overrides, and pre-application/interview actions | `insights preparation-plan --jd PATH --company NAME --role TITLE [--report PATH] [--output PATH]`; JD, CV and profile |

The Node repost parser accepts only full `YYYY-MM-DD` observation dates.
Python applies that grammar before `date.fromisoformat`, which otherwise also
accepts compact and ISO week dates and could admit false repost clusters.
Node company cards combine application history, repost clusters and explicitly
flagged aggregator boards independently. Python keeps the scan-side cards and
single-company fallback when application tables are absent, while reporting
those missing tables instead of inventing responsiveness facts. Flagged
aggregators retain their original display names in cards while normalized keys
drive repost exclusion.

The 2026-09-25 OII-341 decision removes stored job contacts, so the older
OII-314 contact export requirement no longer applies. Independent interview
CV maintenance remains in its own migration slice. The standalone preparation
plan is retained here because it directly consumes the JD-gap classifier.

The new score policy has no global scalar or shortlist tiers. Upskill therefore
ranks recurring *evaluated gap evidence* by report prevalence and exposes raw
gap topics; it does not reinterpret attractiveness as candidate fit. A missing
capability table is counted as limited or unparsed coverage, not a clean report.
For the current CV layout, only the Production engineering Skills subsection
suppresses a learning gap as known. Prototype evidence remains supported but
does not prove production proficiency; In progress remains a gap.
The old average/top scalar score metrics are omitted under that policy; report
and PDF coverage remain explicit counts and percentages over canonical
opportunities.
The old `activePortals` count is now `producing_sources`: canonical observations
retain the provider source, not the old per-portal TSV column.
Configured scan runs now retain their filter counters in the canonical run
summary. `insights stats` computes the Node filter removal ratio from complete
runs with those counters, excluding duplicate counts; older runs without filter
data report a null ratio and an explicit zero coverage count.

`insights` opens the business SQLite database read-only. Current status comes
from the retained lifecycle row; `ever_*` funnel values come from historical
events. A scan's `active` or `expired` liveness is true at its capture time,
not a current browser check; older exclusions without a reason code are marked
`excluded_unknown_cause`. An exclusion is the latest retained workflow result; waiting
for evidence, waiting for user review, and failure waits are separate.
Repost `none-detected` requires available observations and a non-aggregator
employer. Missing observations and aggregator exclusions have distinct labels.
Missing salary observations, incomparable currencies, and zero application
samples return explicit nulls or source flags rather than inferred zero rates.
