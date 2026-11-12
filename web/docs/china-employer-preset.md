# China employer discovery preset (#5423)

Explore → Scan → **China employer preset** selects Tencent, ByteDance and Meituan.
It is opt-in. The existing ATS-network default and AI search are unchanged.
Role/title and location terms stay visible and are preserved when switching
presets. The selected sources can be deselected individually; zero sources disables
Discover with an associated explanation.

## Scope adjustment

Issue #5423 proposed Tencent, Alibaba and Meituan. On 2026-10-18 the requester
explicitly approved replacing Alibaba with another existing provider to make the
China-company discovery flow usable. ByteDance was chosen after checking its
existing `feishu-jobs` provider and cold-opening a returned original JD.
The fixed implementation scope is **Tencent, ByteDance, Meituan**. Alibaba is not
called by this preset. Its existing provider and every other provider are unchanged.
The original issue has no maintainer scope-confirmation comment as of this check;
this implementation does not claim maintainer approval of the adjusted scope.

## Data flow and limits

`/api/explore` validates the fixed source selection before the legacy filter codec.
The employer adapter starts one bounded worker per selected employer. Each worker
imports the existing provider and `scan.mjs` functions without invoking the scanner
CLI. Only `title_filter.positive` and `location_filter.allow` are applied, through
`buildTitleFilter` and `buildLocationFilter`. No profile/YAML restrictions, recency,
negative terms, ATS directory depth, liveness stage or model call is added.
Unknown locations and the core's URL hints / remote-title behavior are preserved.
This is a term filter, not a promise of geography, experience or hiring eligibility.

Each HTTP request has a 10-second timeout and each source worker a 60-second
ceiling. A worker is killed on cancellation or timeout. The adapter adds no retries;
existing provider behavior is retained. Each board is capped at 10 pages of 100
postings. A known count beyond that cap, malformed data, or a swallowed later-page
fetch failure is reported as incomplete coverage, even with zero matching jobs.
Other sources' results are retained. Total failure is distinct from a clean empty
scan. The dedicated polite status names affected employers; the results grid is
not a live region and completing a scan does not move focus.

Results use the core URL normalization for deduplication, retain distinct posting
identities, and label missing location/date as unknown. Opening a JD uses the
provider's original posting link. Employer cards do not request the disk-backed
logo proxy. Discovery invokes no pipeline, history, health, profile or portal
writer and creates no temporary configuration. Pipeline addition and evaluation
continue to require their existing separate explicit actions. Scheduling this
preset is not offered by this change. Employer preset results and coverage
messages stay in memory and are not saved in the browser snapshot; refreshing
the page requires a new scan. The legacy ATS/AI snapshot behavior is unchanged.

## Live check — 2026-10-18 (Asia/Shanghai)

No login, cookie capture, CAPTCHA handling or new fetching behavior was used.
Only the existing providers' public HTTP requests and normal browser navigation
were exercised. These observations are not ongoing availability guarantees.

| Source | Public endpoint / policy check | Provider smoke | Cold original JD |
| --- | --- | --- | --- |
| Tencent | Existing `/tencentcareer/api/post/Query`; `robots.txt` redirects to an HTML 404 page, with no applicable rule returned | First page returned structured jobs | HTTP 200, detail URL retained, corresponding title visible |
| ByteDance (`feishu-jobs`) | Existing `/api/v1/search/job/posts`; `robots.txt` allows experienced/society/campus/en/jp paths and disallows referral; no disallow covers the provider's endpoint or experienced JD route | First page returned structured jobs | HTTP 200, experienced detail URL retained, corresponding title visible |
| Meituan | Existing `/api/official/job/getJobList`; `robots.txt` redirects to the social site rather than returning robots directives | First page returned structured jobs | HTTP 200, detail URL retained, corresponding title visible |
| Alibaba (excluded) | Existing provider still returned structured jobs | Investigated as the originally proposed source only | Detail link redirected to `/`; corresponding title absent. Replaced at requester direction; no provider fix included |

The actual local `/api/explore` flow was also exercised with all three final
sources, title term `工程师`, and location term `北京`: HTTP 200, results retained,
and all three explicitly reported partial coverage because their inventories
exceeded the page cap. A before/after SHA-256 snapshot of disposable user-data
files was identical. Empty, unknown, arbitrary and excluded Alibaba selections
were rejected with HTTP 400. Live result counts are not CI assertions.

## Validation

- `npm test --prefix web`: 1,692 passed, 0 failed, 13 optional browser tests skipped.
  Deterministic Web regressions include filter parity,
  posting identities, malformed fields, finite worker timeout/cancellation,
  exact selected-source execution and user-file byte identity.
- `npm run typecheck --prefix web` and root `npm run lint`.
- Production `npm run build --prefix web`: passed (one existing CV Studio filesystem-tracing warning).
- Core `node test-all.mjs`: 15,701 passed, 0 failed, 19 warnings (environment/optional checks and existing scan findings).
- Real-browser keyboard/AX-tree regression:
  `EXPLORE_EMPLOYER_TEST_URL=http://127.0.0.1:35423 node --test web/tests/lib/employer-preset.browser.test.mjs`
  against a local server using disposable `CAREER_OPS_ROOT`. Its scan and action
  requests are intercepted, so no employer or AI task is started by the fixture.
  Covers a successful result, zero selection, clean empty, partial zero/results,
  total failure, preserved focus, and opening the original URL by keyboard. A second
  browser case covers both legacy ATS and employer cards, proving pipeline-add
  and evaluation still go through separate explicit actions. Both browser cases passed.
- **Manual screen-reader speech checks: not performed.** Chromium AX-tree and DOM
  checks do not establish what VoiceOver/NVDA speaks. A manual speech pass remains
  a review follow-up, separately from automated browser coverage.
