# Adding a provider

A provider is a module `providers/{name}.mjs` that maps one public, no-auth
job source (an ATS API, an RSS/JSON feed, or a server-rendered HTML page) to
the scanner's normalized `Job` shape. `scan.mjs` and `verify-portals.mjs`
load every such module through `providers/_registry.mjs` — no manual
registration, dropping the file in `providers/` is enough.

This file is the checklist and the set of requirements. The authoritative
type catalog is [`_types.js`](_types.js); the architectural role of the layer
is in [`../ARCHITECTURE.md`](../ARCHITECTURE.md) ("Discovery — `scan.mjs` +
`providers/`"). Mirror an existing module of the same shape — see the table
in section 4.

## Before the code: is the source eligible?

A working provider is not enough — the source it reads has to clear the
[Source Indexing Policy](../CONTRIBUTING.md#source-indexing-policy) first, and
that gate is decided on the source's data, not on how the client is written.

**A single-company ATS adapter** (a new Greenhouse/Workday/Ashby-class
vendor, or a company on its own careers API) clears this by construction: the
postings are the employer's own, and the adapter reads exactly one source.
Nothing to do here — go to section 1.

**A job board, aggregator, or talent network** is where the policy bites.
In short:

- **Real, employer-attributed listings, free for the candidate.** A source
  whose postings resolve to identifiable employers and that a candidate can
  read and apply to without paying or registering. A paywall on listings or
  applications disqualifies it.
- **One source per provider (rule 5).** A provider reads its own source.
  A meta-aggregator that republishes other boards' postings is not a source
  career-ops indexes — cross-source aggregation lives in core.
- **Complete inventory, no paid placement (rule 3).** The provider must
  traverse the source's full inventory, not a promoted or default-filtered
  view.

If such a source is operator-run, or its eligibility is not obvious, open a
[source proposal](../.github/ISSUE_TEMPLATE/source-proposal.yml) before
writing code — a routing decision made on a design doc is cheaper than one
made on a finished PR. The [Source Indexing Log](../docs/SOURCE_INDEXING_LOG.md)
records how the rules were applied to sources that went through that process.

## 1. The contract

A `providers/{name}.mjs` file (not starting with `_` — those are shared
helpers and `_registry.mjs` skips them) has a `default` export:

```js
// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

/** @type {Provider} */
export default {
  id: 'unique-id',                 // required, unique across all providers
  detect(entry) { ... },           // optional: claim a portals.yml entry
  async fetch(entry, ctx) { ... }, // required: return Job[]
};
```

- `id` — required, unique. On a duplicate the first-loaded provider wins and
  the later file is skipped with a warning.
- `detect(entry)` — optional; returns `{ url }` or `null`. `_registry.mjs`
  resolves an entry in order: (1) an explicit `provider: {id}` field, which
  bypasses `detect()` entirely; (2) the `local-parser` provider, when the
  entry sets `parser.command` + a script; (3) each provider's `detect()` in
  alphabetical file order, first hit wins. Three valid `detect()` shapes:
  1. **URL-pattern** — match `entry.careers_url` / `entry.api` against a
     known host pattern (`greenhouse.mjs`, `lever.mjs`, `remotli.mjs`).
  2. **Explicit-only** — `return entry?.provider === '{id}' ? { url: FEED_URL } : null`
     for a board-wide feed with no per-entry URL (`larajobs.mjs`).
  3. **Omit `detect()`** — the provider is then reachable only by an explicit
     `provider: {id}` in `portals.yml` (`yourator.mjs`).
  A branded/unrecognizable domain must **not** be matched by a URL-pattern
  `detect()` — use shape 2 or 3 instead, so the provider never claims an
  entry the user did not point at it.
- `fetch(entry, ctx)` — required. Use `ctx.fetchJson` / `ctx.fetchText`
  (never bare `fetch`); `ctx.fetchResponse` returns the raw `Response` when
  you need headers. Optional `ctx.maxPages` and `ctx.sleep(ms)`. Returns a
  normalized `Job[]`.
- `Job` — `title`, `url` (required, absolute — this is the dedup key),
  `company`, `location`; optional `postedAt` (epoch ms) and `description`.
  Populate `description` **only** when the list payload carries it for free
  (no extra per-job request — the scanner is zero-token). The one exception
  is opt-in enrichment: an entry with `fetchDetails: true` (plus an optional
  `detailLimit` cap) makes the provider fetch per-posting detail to fill
  `description`, bounded by `detailLimit` and skipped entirely while a health
  probe runs (currently `vdab`, `smartrecruiters`).
- When the payload exposes **more than one** candidate URL for a posting —
  typically an aggregator carrying the employer's upstream ATS/application
  link alongside its own posting page — `Job.url` is the employer's link, per
  Source Indexing Policy rule 2 ("the shortest verifiable path to the
  employer"); the source's own page is the fallback, used only when the
  upstream link is missing or not `https:`. Reference: `resolveYouratorUrl`
  in `providers/yourator.mjs` and the equivalent in `providers/remotli.mjs`.
  A single-company ATS adapter has one natural posting URL and nothing to
  choose — that URL is the canonical one.

### `tracked_companies:` vs `job_boards:`

`portals.yml` keeps entries in two lists and the provider layer is shared
between them: `tracked_companies:` is one entry per employer, `job_boards:`
is one entry per aggregator/feed (many employers). Both use the **same entry
contract** (`name` / `careers_url` / `api` / `provider` / `parser`), the same
`detect()`, and the same registry. `detect(entry)` gets the same `entry`
shape from either list. A single-company provider is documented and tested
against `tracked_companies:`, an aggregator/feed against `job_boards:`. The
file's header comment must name the target list (reference:
`providers/remotli.mjs`, `providers/yourator.mjs`).

## 2. Mandatory guards

### SSRF hardening

- Always pass `redirect: 'error'` to `fetchJson` / `fetchText`. `_http.mjs`
  defaults to `redirect: 'follow'` by design — that is not a safe default
  for a provider, since a server-side redirect could point the request at an
  internal address.
- If the final URL is built from `portals.yml` data (`entry.api`,
  `entry.careers_url`), check the hostname against an allowlist **before**
  any network call. Reference: `assertGreenhouseUrl` in
  `providers/greenhouse.mjs` — parse the URL (throws if malformed), reject a
  non-`https:` protocol, reject a hostname not in `ALLOWED_GREENHOUSE_HOSTS`.
  A test must prove the guard runs before `ctx.fetchJson` / `ctx.fetchText`
  (see section 3).
- If the whole URL is assembled by the provider from a fixed literal host, no
  allowlist is needed, but `redirect: 'error'` still is.
- `jobvite` and `telegram-channel` pass `redirect: 'manual'` instead: no hop
  is followed either, and the thrown error carries the `Location`, so a 302
  to a login page reads as a named failure rather than a generic one.

### Defensive parsing

A `fetch()` that throws loses the **entire target for that run**, not just
the bad item — and the throw surfaces as a run error, and as `missing` in
`verify-portals` / `doctor --strict` ("board 404s, will silently drop"): a
false alarm instead of an honest "empty". So a malformed item is a
`continue` / `null` + `.filter`, never an exception out of `fetch()`.

- An empty or contentless body (`null`, `{}`, `[]`, `{jobs: null}`) —
  "endpoint alive, nothing matched" → return `[]`.
- A body whose structure is recognisably *not* what the endpoint documents
  (expected nested container absent or wrong-typed, keys entirely different)
  → a descriptive `throw` (name the keys you did get) is allowed and usually
  better: it surfaces a silent API change instead of a board that quietly
  returns `0` forever. Reference: `parseIbmResponse` in `providers/ibm.mjs`.
  `scan.mjs` also throws on a non-array out of `fetch()`; `verify-portals`
  catches it.
- Paginating provider whose loop-termination reads the raw page shape
  (`json.hits.hits.length < PAGE_SIZE`): returning `[]` from the parser is
  not enough — guard that bound or `throw` deliberately (the "fail loud vs
  hand back a partial board" call from *Pacing and retry* below).
- Dates: a date *string* through `Date.parse` can return `NaN`. Don't write
  `Date.parse(s) || undefined` (it also nulls a valid epoch `0` — a
  `1970-01-01` timestamp) — use a NaN-safe helper. Its `!value` guard is for
  the absent/empty field, before parsing:

  ```js
  function toEpochMs(value) {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  ```

- Rows missing a required field (`title`, `url`) — filter them out, don't
  throw.

### URL-encoding a host-controlled `id` / `slug`

When `job.url` is built from a response field (`id`, `slug`, `refnr`) inside
a `.map()` / `for` loop, encode that segment with `safeEncodeURIComponent`
from [`_safe-url.mjs`](_safe-url.mjs), not bare `encodeURIComponent`:

```js
import { safeEncodeURIComponent } from './_safe-url.mjs';
// ...
const seg = safeEncodeURIComponent(job.id);
if (seg === null) continue;          // or .filter(Boolean) on the .map() output
const url = `https://example.com/jobs/${seg}`;
```

`encodeURIComponent` throws `URIError` on a lone UTF-16 surrogate, and a
`"\uD800"` escape survives `JSON.parse` — the throw leaves the loop and
`scan.mjs`'s per-company `catch` then loses every posting already parsed on
that page. The helper returns `null` instead, so you drop exactly the one bad
posting — the same as a posting with no `id`. It returns `null` rather than a
`U+FFFD` substitute on purpose: a degraded value flows on into
`data/scan-history.tsv`, the tracker, and generated documents as ill-formed
UTF-8, and where the encoded value is also the dedup key (`arbeitsagentur`,
`vdab`) it would collide distinct bad postings onto one key. Reference: the
wired providers in `tests/providers/url-encoding-surrogate.test.mjs`
(`alibaba`, `bamboohr`, `phenom`, …).

Scope is exactly this case — a host-controlled API field becoming a URL path
segment in a loop. Config-derived values (a company slug from `portals.yml`,
a keyword, a locale), calls already inside their own try/catch, and values
already checked against a slug charset are left alone; dropping a real
posting over a bad character in config is the wrong trade.

The mirror case on decode: `decodeURIComponent` on a scraped href segment
also throws `URIError` on a malformed percent-escape (`%ZZ`) — wrap it in
try/catch with a fallback to the raw segment (reference: `workday.mjs`,
`successfactors.mjs`, `rheinmetall.mjs`).

### HTML entities — use the shared decoder

If the provider parses HTML/XML (not a JSON API), decode entities
(`&amp;`, `&#252;`) through `providers/_html-entities.mjs`:

```js
import { decodeEntities } from './_html-entities.mjs';
```

Never write a local copy. The project has a history of bugs from exactly
that (#1555, #1639 — a combined `decimal|hex` regex silently misparses one
form as the other), and a source-level test fails on a re-introduced private
decoder (#2902).

### Absolute page ceiling (MUST)

For a paginating provider, the page count must **never** come from what the
source reports (`pagination.pageCount`, `total`) alone — that is untrusted
third-party data, and a growing or tampered response would turn one
`portals.yml` line into an unbounded request loop (there is no per-provider
timeout, only a per-request one). Define your own constant, independent of
`ctx.maxPages` and `entry.max_pages`:

```js
const DEFAULT_MAX_PAGES = 100;  // when the entry sets no max_pages
const MAX_PAGES_CAP = 1500;     // hard ceiling even for a user override
                               // — neither is tied to ctx.maxPages or to
                               //   what the source reports
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}
```

A source-reported value enters the formula only through `Math.min(...)` with
this ceiling, never on its own. Reference: `providers/workday.mjs`
(`DEFAULT_MAX_PAGES`, `MAX_PAGES_CAP`, `resolveMaxPages()`). When the ceiling
truncated the list, warn the user (`raise max_pages on this entry`) so a
partial list is not mistaken for a complete one.

A source-reported `total` can also be plain wrong, not just absent — some
backends silently clamp it, so a `total`-bounded walk is not proof of
completeness. Reference: `providers/workday.mjs`'s facet split (#3310).

### `ctx.maxPages` and the health probe

When `ctx.maxPages` is set, `verify-portals` is running a liveness probe
(`maxPages: 1`), not a scan. Two things follow.

**Cap the walk (SHOULD).** Stop after `ctx.maxPages` pages, and skip any
per-posting `fetchDetails` / detail enrichment (`smartrecruiters`, `vdab`) —
the probe has no use for it. Reference `providers/workday.mjs`:

```js
const ctxMaxPages = Number(ctx?.maxPages);
const ctxCap = ctxMaxPages > 0 ? ctxMaxPages : Infinity;
const pagesToFetch = Math.min(resolveMaxPages(entry), ctxCap);
```

A provider that ignores the hint is not *incorrect* — the probe wraps
`ctx.fetchJson` / `ctx.fetchText` with a hard `PROBE_REQUEST_BUDGET`
(4 requests) and the next call throws `ProbePageBudgetReached`, so every
provider is bounded whether it cooperates or not. But ignoring it makes the
probe slow and costs the source real requests, and the per-provider test
asserts exactly one list request under `maxPages: 1`.

**Don't wrap or swallow a `ctx.fetch*` rejection while probing (MUST, if you
have a per-page `catch`).** `verify-portals` identifies the budget cut-off by
`err instanceof ProbePageBudgetReached` and reads it as "endpoint live, count
unknown", not a broken board. If a per-page / per-keyword `catch` swallows it
into `[]` or rethrows it as a `new Error(...)`, the probe misreads a healthy
board as `missing`. So when `ctx.maxPages` is set, propagate a `ctx.fetch*`
rejection **unwrapped**. In a real scan (no `ctx.maxPages`) the recall-first
"swallow and keep the pages so far" behavior is still fine — `vdab.mjs` shows
both branches.

Keep the "raise `max_pages`" warning tied to the
`entry.max_pages` / `DEFAULT_MAX_PAGES` stop — never to a `ctx.maxPages` cap
or a probe-budget cut-off.

### Pacing and retry (paginating providers)

A full walk of a large board is 100+ sequential requests (`workday`,
`radancy`), and several sources sit behind a WAF that rate-limits in bursts.
Two mechanisms, both expected once a provider paginates:

- **Inter-page delay.** A module constant applied only to pages past the
  first: `if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx)`. Import
  `sleep` from [`_http.mjs`](_http.mjs) (it honours a ctx-supplied test
  clock) — don't hand-roll a local copy. 150–250 ms is the norm; raise it
  only where throttling was actually observed (`careerviet`, `itviec` at
  750 ms) or a published rate limit dictates it (`agentic-jobs` at 2100 ms
  for 30 req/60 s). Don't gold-plate a feed that never complained.
- **Bounded retry.** Wrap every page fetch — and the one-shot
  config-resolving fetch before pagination, if any — in `fetchJsonWithRetry`
  / `fetchTextWithRetry` (`_http.mjs`). They retry 429, any 5xx, and
  transport errors (timeout / abort / DNS) with exponential backoff + jitter;
  they never retry a non-429 4xx or a refused redirect. A `Retry-After`
  header is honoured but clamped, so a hostile `Retry-After: 86400` can't
  stall the sweep. Default policy is
  `{ retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 }`; pass a `policy` 4th
  argument for a different cadence (`workday.mjs`, `oraclecloud.mjs` use
  `{ retries: 3 }` because their API is WAF-fronted).

**Exhaustion is your call, not the helper's.** `withRetry` rethrows; the
error carries `.attempts` (the real request count). Decide per provider: keep
the pages already collected and `warn` (`workday.mjs`), or fail loud rather
than hand back a silent partial board (`a16z-speedrun-talent.mjs`). Either
way, the "raise `max_pages`" warning must **not** fire when pagination
stopped on a fetch error — that message means the ceiling truncated a
healthy board, not that the board broke.

### Health-check coverage (`verify-portals`)

`npm run verify:portals` and `node validate-portals.mjs` (and `doctor.mjs
--strict`, which delegates to the former) sweep **both** `tracked_companies`
and `job_boards` — the two lists share one entry schema and one enabled-name
namespace (a board and a company with the same name is flagged).
`verify-portals` probes reachability in two tiers:

1. **tier 1** — a direct Greenhouse/Ashby/Lever slug probe, when a
   `tracked_companies` `careers_url` / `api` carries a recognizable ATS slug.
   Only these three ATS get a `suggested` fix, so `fix-slugs.mjs` rewrites
   slugs only for them — a `job_boards` aggregator is a provider-layer entry
   and never carries a `suggested` alternate.
2. **tier 2** — every other entry (Workday, SmartRecruiters, branded careers
   pages, any `job_boards` feed) handed to the scanner's provider layer with
   `ctx.maxPages: 1`, so the check really calls `fetch(entry, ctx)`.

An entry that no provider claims (no `provider:`, no `detect()` match) lands
in `skipped` — a coverage hole, not "ok"; `--strict` reddens only `missing`
(a live probe that 404'd), never `skipped`. So the `portals.example.yml`
entry for your provider (see the checklist in section 5) must be claimed by
your `detect()` or carry an explicit `provider:`, whichever list it sits in.

### Timeouts and User-Agent

Use `providers/_http.mjs` (`fetchJson` / `fetchText` / `makeHttpCtx`) — it
already has the `AbortController` timeout (10s default, raise it for a slow
feed by passing `timeoutMs` in the per-call options) and the shared
User-Agent; a non-2xx response throws an `Error` carrying `.status`, `.body`,
and `.retryAfter`. If the source blocks the default UA through a WAF/CDN, use
`BROWSER_LIKE_USER_AGENT` from the same module — do not add your own
constant.

### Public, no-auth sources only

A provider reads only open APIs/feeds with no login. Sending the user's data
(CV, pipeline) to an external service is out of core (see
[`../CONTRIBUTING.md`](../CONTRIBUTING.md), "What we do NOT accept").

### Browser-based scanners (standalone scripts only)

Some sources have no reachable API and render their listings in the browser (`scan-interamt.mjs` is the precedent; Dayforce career sites are the same shape). A scanner that drives a real browser (Playwright) is accepted as its own top-level script, never as a `providers/*.mjs` module, and under three conditions:

1. **Standalone.** It ships as `scan-<source>.mjs` with its own npm script, tests, `SUPPORTED_JOB_BOARDS.md` row, `portals.example.yml` stanza and `SYSTEM_PATHS` entry. `providers/` stays fetch-only.
2. **Public pages only.** It reads what any visitor sees: no login, no session or cookies of a real user, no authenticated area.
3. **No bypass.** It never solves or relays a CAPTCHA, and never spoofs another client's cookies, tokens or headers. If a source puts an interactive challenge in front of its public listings, the scanner reports that as a named error and stops; it does not work around it.

A browser scanner is slower and more fragile than a provider (markup changes break it), so say in the PR what was measured live: which pages, how many listings, and what the source answers to a bare `fetch`, so the reviewer can see why a provider was not enough.

## 3. Tests

One file: `tests/providers/{name}.test.mjs`. Auto-discovered
(`tests/**/*.test.mjs`) — nothing to register in `test-all.mjs`. RSS/HTML
providers should export their pure parser function for direct unit testing.

Don't re-prove the shared helpers (`_safe-url`, `_html-entities`) — their own
tests cover that. A provider test checks only that *this provider's* output
went through them. Must cover:

- The provider `id`.
- `detect()` — for a URL-pattern `detect()`: positive cases; untrusted host,
  non-HTTPS, malformed URL, `null` / non-string / missing `careers_url` all
  → `null` (no throw). For an explicit-only `detect()`: an `entry.provider`
  match returns `{ url }` with no `careers_url` / `api` present; anything
  else → `null`.
- `fetch()`: normalization of the source's real response shape; rows missing
  a required field are filtered; **`redirect: 'error'` is passed on every
  request** — assert `opts.redirect === 'error'`, not just that the call
  happened; the allowlist guard throws **before** `fetchJson` / `fetchText`
  is called.
- Empty or contentless body → `[]`; a body whose shape isn't what the
  endpoint documents → a descriptive throw. Assert both branches.
- Pagination (if any): the provider's own `DEFAULT_MAX_PAGES` stops it even
  when the source reports more pages; `ctx.maxPages` stops it earlier.
- Pagination + transient failure (if any): a 429 / 5xx on page 2 that retry
  can't clear either keeps pages 1..N and warns, or fails loud — whichever
  your provider chose — and the "raise `max_pages`" warning does *not* fire
  on that fetch-error stop.
- Probe cooperation (if paginating): with `ctx.maxPages: 1`, exactly one list
  request and no `fetchDetails` / enrichment calls; and a `ctx.fetch*`
  rejection *while `ctx.maxPages` is set* propagates unwrapped — not swallowed
  to `[]`, not rewrapped (reference: `vdab.test.mjs`).
- HTML parsing (if any): a fixture title with an entity comes out decoded
  *before* the keyword match runs (an encoded `&amp;` must not drop the job —
  #2923), not just that `decodeEntities` was called.

If `job.url` is built from a host-controlled `id` / `slug` in a loop, add one
behavioural case to the shared `tests/providers/url-encoding-surrogate.test.mjs`
(a batch with one lone-surrogate value alongside a clean one → no throw, clean
posting kept, bad one dropped). That file also carries the cross-provider
source guard (no bare `encodeURIComponent` on a `url:` line, helper imported
where used) — nothing to add in your own `{name}.test.mjs` for this.

Fixture values that actually reach the call (`name` / `careers_url` / `api`)
are fictional (`Acme`, `ExampleCo`, `BigCo`) — never real companies. A
comment citing real observed data (e.g. why a page-limit constant was
chosen) is welcome — it documents that the number is not arbitrary.

Dev loop: `node test-all.mjs --only providers/{name}`. Before a PR: the full
`node test-all.mjs` (`--only` is not a merge gate).

## 4. Reference modules

| What you need | Example |
|---|---|
| Simple JSON API, no pagination | `providers/greenhouse.mjs` + `tests/providers/greenhouse.test.mjs` |
| Pagination honoring `ctx.maxPages` | `providers/workday.mjs` |
| HTML scraping with the shared `decodeEntities` | `providers/icims.mjs` |
| SSR JSON inside HTML (`__NEXT_DATA__`) | `providers/join.mjs` |
| RSS parsed in-process | `providers/larajobs.mjs` |
| `job.url` from a host-controlled `id` / `slug` via `safeEncodeURIComponent` | `providers/phenom.mjs`, `providers/bamboohr.mjs` |
| Retry/backoff via the shared helper, default policy | `providers/a16z-speedrun-talent.mjs`, `providers/getro.mjs` |
| Retry/backoff via the shared helper, policy override | `providers/workday.mjs`, `providers/oraclecloud.mjs` |
| Detecting a clamped `total`, recovering it via query fan-out + dedup | `providers/workday.mjs` (facet split) |

`fetchJsonWithRetry` / `fetchTextWithRetry` (`providers/_http.mjs`) take an
optional 4th argument `policy: { retries, baseDelayMs, maxDelayMs }` for a
provider whose tuning needs differ from the shared default
(`{ retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 }`).

## 5. Pre-PR checklist

- [ ] **Board / aggregator / talent network only:** the source clears the
      [Source Indexing Policy](../CONTRIBUTING.md#source-indexing-policy) —
      real employer-attributed listings, free for the candidate, one source
      per provider (not a meta-aggregator of other boards); operator-run or
      borderline → a [source proposal](../.github/ISSUE_TEMPLATE/source-proposal.yml)
      was opened first. A single-company ATS adapter skips this line.
- [ ] If a posting's payload carries both an upstream employer URL and the
      source's own page, `job.url` is the employer's one (rule 2), the
      source page the fallback. (A single-source ATS has only the one URL.)
- [ ] `id` unique; file does not start with `_`.
- [ ] `detect()` never throws on junk input; returns `null` instead of
      failing.
- [ ] Every network call passes `redirect: 'error'`; a config-derived URL is
      checked against an allowlist before the request.
- [ ] `fetch()` returns `[]` on an empty or contentless body (`null` / `{}`
      / `[]` / `{jobs: null}`); it throws on a real API error or an envelope
      that isn't the documented shape. A single bad row is skipped
      (`continue` / `null` + `.filter`), not fatal to the target.
- [ ] Dates are NaN-safe (`toEpochMs` pattern).
- [ ] HTML/XML entities go through `providers/_html-entities.mjs`, not a
      local copy.
- [ ] `job.url` from a per-posting `id` / `slug` goes through
      `safeEncodeURIComponent` (`_safe-url.mjs`), `null` → drop the posting;
      no bare `encodeURIComponent` on a `url:` line. A scraped href segment
      passed to `decodeURIComponent` is wrapped in try/catch with a
      raw-segment fallback.
- [ ] Pagination has its own `DEFAULT_MAX_PAGES` — the page count is never
      decided by the source alone (`pageCount` / `total`).
- [ ] Pagination honors `ctx.maxPages` when present, skips `fetchDetails`
      enrichment while it is set, and a per-page `catch` propagates a
      `ctx.fetch*` rejection **unwrapped** during a probe (so
      `ProbePageBudgetReached` identity survives).
- [ ] Paginating: an inter-page delay via the shared `sleep` (pages past the
      first only); page fetches wrapped in `fetchJsonWithRetry` /
      `fetchTextWithRetry`; a stated exhaustion policy (keep-partial + warn,
      or fail loud) that doesn't misfire the "raise `max_pages`" warning.
- [ ] `tests/providers/{name}.test.mjs` covers everything in section 3.
- [ ] `node test-all.mjs` — the full suite is green (not just `--only`).
- [ ] A row is added to
      [`../docs/SUPPORTED_JOB_BOARDS.md`](../docs/SUPPORTED_JOB_BOARDS.md), in
      alphabetical position by board name (the table is sorted).
- [ ] `templates/portals.example.yml` is updated: (1) if `detect()` matches
      a host, a URL-pattern line under "Provider auto-detection"; otherwise
      an explicit `provider:` in the stanza; (2) in the "Built-in provider
      examples" block, a commented `Example {Name} Co` stanza (every field
      at its default) in the group whose header matches — copy a neighbouring
      group's `(→ tracked_companies: …)` / `(→ job_boards: …)` header format
      verbatim — and, for a provider with **no** `detect()`, add its id to
      the "job boards / aggregators … explicit `provider:`" list at the end
      of the "Provider auto-detection" section (a URL-pattern `detect()` is
      already covered by (1)); (3) one **live, uncommented** real entry, in
      the matching region/topic section, **only when it carries more than the
      stanza in (2)** — a real `careers_url` / `api`, a resolvable slug or
      board id, or provider-specific keys (every company ATS, and any
      slug/URL-bearing board such as Getro). Skip (3) for a bare
      `provider: {id}` feed with no per-entry URL or config (a regional
      board, an RSS feed) — there a live entry is byte-identical to (2).
- [ ] **Editing an existing provider, not adding one?** The
      `SUPPORTED_JOB_BOARDS.md` and `portals.example.yml` items above are
      also "keep in sync on change". If the fix changes observable behavior
      (pagination, defaults, URL format, what counts as an error or an empty
      board), `grep` the repo for every prose description of that behavior —
      by the provider name and by the substance of the change, not just a
      function name — and fix them in the same PR.
