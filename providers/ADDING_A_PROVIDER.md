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
Nothing to do here — including the `robots.txt` bullet below, which is a
board/aggregator gate — go to section 1.

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
- **`robots.txt`, per path (rule 6).** Check the source's `robots.txt`
  before writing code. A `Disallow` under `User-agent: *` (or a group
  matching the scanner) that covers the listing paths the provider reads is
  a stop (precedent: Lagou); a `Disallow` on routes the parser never touches
  — `/api`, `/data`, a subscribe form — is not (ITviec, CareerViet route
  around theirs). A rule that only names an AI/agent crawler (`ClaudeBot`,
  `anthropic-ai`) doesn't name the scanner — a distinct, bounded
  `career-ops` fetcher — but a scan can still feed a later model-driven
  `pipeline` step, so honouring it is a maintainer call on a source
  proposal, not an automatic no.

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
  For a host the pattern *does* match, claim the URL a real entry point
  hands the user — a link off the company careers page, an aggregator, a
  search hit — which is usually the ATS landing/root URL. Where a source
  serves its listing at more than one path, accept the shallowest;
  requiring a deeper canonical path the user would have to construct by
  hand defeats the point of a URL-pattern `detect()`, and the entry
  silently lands in `verify-portals` `skipped`.
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
  probe runs (currently `vdab`, `smartrecruiters`). That enrichment is
  opt-in *only*: gate the whole detail loop on the entry config asking for
  it **and** on not being in a probe — `smartrecruiters.mjs`
  (`if (fetchDetails && !probing)`), `vdab.mjs`
  (`if (fetchDetails && byId.size && !probing)`). A provider that fetches
  per-posting detail on every scan, with no config switch, defeats the
  opt-in and puts the per-posting request fan-out back on the default path;
  `detailLimit` is the cap on that loop, never the thing that turns it on.
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
file's header comment must name the target list — reference
`providers/ibm.mjs` and `providers/dassault.mjs` for a single-company
`tracked_companies:` adapter, `providers/remotli.mjs` and
`providers/yourator.mjs` for a `job_boards:` aggregator/feed.

### The `enrichDate` hook (optional, rarely needed)

An optional `async enrichDate(job, ctx)` fetches one posting's detail page
to fill `postedAt` (and opportunistically `location`) for a source whose
list page carries no date (`icims`). It is **not** in the core contract,
and `_registry.mjs` never calls it. Its only caller is `scan-ats-full.mjs`,
the reverse-ATS sweep, and only for a job that passed the title/location
filters but came back undated — so the undated-drop policy has a date to
judge.

`scan-ats-full.mjs` imports a **fixed** set of modules (`greenhouse`,
`lever`, `ashby`, `workday`, `icims`) with no registry lookup — a provider
it does not import can define `enrichDate` and nothing will ever call it.
The hook also overlaps the `fetchDetails` opt-in above, which already
fetches the detail page on the normal `scan.mjs` path. Pick one:
`fetchDetails` for a provider reached through `portals.yml`; `enrichDate`
only when the provider is (or is being) wired into `scan-ats-full.mjs`.
Don't ship both. If you add it, test it and say in the header comment that
it is inert until the provider is added there.

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
- A **wildcard-tenant** ATS (`<tenant>.<vendor-domain>`, e.g.
  `*.myworkdayjobs.com`) can't enumerate a `Set` — match the hostname with an
  anchored full-host test instead. Two idioms in the tree: an anchored regex
  over the whole hostname (`/^[a-z0-9-]+\.vendordomain\.com$/` —
  `providers/bamboohr.mjs`, `providers/breezy.mjs`), or
  `hostname.endsWith('.vendordomain.com')` (`providers/workday.mjs`,
  `providers/icims.mjs`). Get the anchoring right or the guard is a no-op:
  keep the trailing `$` (without it `tenant.vendordomain.com.evil.example`
  passes), escape the dots (`\.`, or `.` also matches `vendordomainXcom`), and
  keep the leading dot on a suffix test (`endsWith('vendordomain.com')` also
  accepts `evilvendordomain.com`).
- If the whole URL is assembled by the provider from a fixed literal host, no
  allowlist is needed, but `redirect: 'error'` still is.
- Some providers are the inverse of a fixed vendor domain: the scanning
  target is an arbitrary **customer-branded** host taken straight from
  `entry.api` / `entry.careers_url`, with no vendor-domain pattern to
  allowlist against and no `detect()` auto-claim — the provider is wired
  explicitly per `portals.yml` entry instead. Reference: `providers/phenom.mjs`.
  For this shape a per-provider host allowlist isn't constructible (there is
  no stable vendor string to match — every tenant's hostname is different and
  unrelated to the others), and the real SSRF protection is the central
  DNS/IP-layer guard (`_ip-guard.mjs`, #3096), already wrapped around every
  `ctx.fetchJson` / `ctx.fetchText` call regardless of provider. Don't add an
  allowlist just because a reviewer expects the Greenhouse-style pattern —
  a config-derived URL with no vendor host to check against is a valid,
  working state for this provider shape, not a gap. `redirect: 'error'` is
  still mandatory here, same as everywhere else.
- **Redirects are never followed automatically** — `redirect: 'error'` is the
  default and stays it even when the source's own bootstrap issues a
  legitimate same-origin 3xx. A provider that needs to *inspect* a redirect without
  following it (e.g. to tell an empty-board redirect from a dead-tenant one)
  passes `redirect: 'manual'`: `ctx.fetch*` then throws a structured error
  carrying `.status` and `.location` (see `_http.mjs`; `providers/jobvite.mjs`
  and `providers/telegram-channel.mjs` use it — a 302 to a login page then
  reads as a named failure rather than a generic one). Actually following a
  hop is out — if a source only serves content
  past a bootstrap 3xx, target the settled URL directly
  (`providers/deutschebahn.mjs` — a portal that 302s into its own results
  endpoint) or rewrite a known static 3xx up front (`providers/builtin.mjs` —
  bare hosts that 301 to `www`). The one case that needs an actual follow is
  a session-establishing bootstrap 3xx whose target is not knowable ahead of
  time — a portal that bounces through a session or theme-negotiation hop
  carrying a per-session token in the `Location`, so neither "target the
  settled URL" nor "rewrite a static redirect" applies. Follow it manually:
  re-validate **every** hop's `Location` against the tenant origin (the same
  allowlist check that guards the first request) before following it, bail
  the instant a hop points off-origin, and bound the chain with a small hop
  cap. That is stricter than a single up-front check — it also catches a
  later hop in the chain redirecting away — not a relaxation of the guard.

### Defensive parsing

A `fetch()` that throws loses the **entire target for that run**, not just
the bad item — and the throw surfaces as a run error, and as `missing` in
`verify-portals` / `doctor --strict` ("board 404s, will silently drop"): a
false alarm instead of an honest "empty". So a malformed item is a
`continue` / `null` + `.filter`, never an exception out of `fetch()`.

The line between "empty" and "broken" is where a silent API change has to
surface instead of reading as `0` jobs forever. Three outcomes:

- **`[]` — endpoint alive, nothing matched.** The documented array container
  is *present and empty*: `[]`, `{jobs: []}`, `{hits: {hits: []}}`. Nothing
  else — a blank 200 and a genuinely empty board both arrive in that shape.
- **Descriptive `throw` — the envelope is not the documented shape.** The
  container is absent (`{}`, `{jobs: null}`, `{results: […]}` under a
  different key), present but wrong-typed (`{jobs: {}}`, `{jobs: "…"}`), or
  the body is a bare non-object (`""`, a number, `true`) where an object is
  documented. One guard covers all of these — a truthy-array test with a
  single fall-through `throw`, before any row loop — and that is what
  `parseIbmResponse` in `providers/ibm.mjs` is built around:

  ```js
  const rows = json && Array.isArray(json.jobs) ? json.jobs : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`acme: unexpected response — expected jobs[], got: [${got}]`);
  }
  ```

  Name the keys (or the type) you did get. Returning `[]` here instead is a
  defensible "a partial/empty board beats a run error" call — but make it
  deliberately, not through an enumeration gap. `scan.mjs` separately throws
  on a non-array *return value* out of `fetch()`; `verify-portals` catches
  that.
- **`continue` / `.filter` — one row is malformed.** Never an exception out
  of `fetch()` (see the paragraph above this list). A row missing `title` /
  `url`, or one whose `id` won't encode, is dropped and the rest of the
  board stands.
- Same call for an **HTML / SSR-JSON scraper**: the card selector or the
  embedded blob (`__NEXT_DATA__`, a JSON-LD script) matching *nothing at
  all* is a markup change → `throw`. An empty list inside an otherwise
  well-formed payload is the empty-board case → `[]`. Reference:
  `providers/join.mjs` — `!Array.isArray(items)` throws, `items.length
  === 0` returns `[]`. A **regex scraper** has no array container to
  type-check, so it keys the same split off a listing signal that only a
  populated board carries: posting-shaped links (an `href` to a
  detail-page path) present in the HTML but zero cards parsed ⇒ a markup
  change → `throw`; neither the links nor the cards present ⇒ a genuinely
  empty board → `[]`. Reference: `providers/itviec.mjs`
  (`assertParsedSomething` — detail-page hrefs matched by shape but no row
  built ⇒ throw), called on the first page only. `icims.mjs` does not draw
  this line at all (zero cards on a page is read as "past the last page");
  don't carry that into a new scraper.
- Paginating provider whose loop-termination reads the raw page shape
  (`json.hits.hits.length < PAGE_SIZE`): returning `[]` from the parser is
  not enough — guard that bound or `throw` deliberately (the "fail loud vs
  hand back a partial board" call from *Pacing and retry* below).
- The short-page stop compares the row count the **source** returned for that
  page — never a count the provider already narrowed, whether by dropping
  malformed rows or by de-duping against postings an earlier page or an
  earlier query/category pass already yielded. The filtered-count version
  ends the walk one row short the moment a full page carries one bad row. The
  post-dedup version is worse for a provider that fans out over several
  query/category passes against one board behind a single shared `seen` set:
  an earlier pass can cover a later pass's *first* page while that pass's
  deeper pages still hold unique postings, so a "nothing new on this page"
  stop ends the pass one or more pages early. Keep the shared set for output
  de-dup, but key each pass's stop off the source's own page shape (an empty
  page, or a count `< PAGE_SIZE`). Reference: `providers/oraclecloud.mjs`
  (`item.requisitionList.length`), `providers/jobbankca.mjs` (`rawEntryCount`).
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

Scope is exactly this case — a **host-controlled** API field becoming a URL
path segment in a loop. A **config-derived** segment (a company slug from
`portals.yml`, a locale) is handled the other way: not through
`safeEncodeURIComponent` + drop — dropping real postings over a typo in
config is the wrong trade — but still `encodeURIComponent`'d, and computed
**once outside the row loop**. A structural `/`, `?` or `#` then stays
escaped so the URL is well-formed, and a genuinely broken value (a lone
surrogate) throws there, as the loud config error it is, instead of
silently once per posting. `garena.mjs` splits the two explicitly —
`urlSegment()` throws for the config `office`, `idUrlSegment()` drops for
the response `id`; `tkms.mjs`'s `parseQuery` hoists its locale
`encodeURIComponent` out of the loop for the same reason. A value a regex
has already restricted to safe characters (`4dayweek.mjs`'s slug `SLUG_RE`,
which rejects a surrogate before this line) or encoded inside its own
try/catch needs nothing further.

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

`max_pages` and `ctx.maxPages` count **pages of results**. A one-shot
bootstrap that carries no listings — a token/cookie primer, a board-id
lookup — is free and sits outside the count (`providers/csod.mjs`: a
home-page GET for the anonymous token, then a `for page = 1..maxPages`
search loop). But a first request that *does* return the first batch of
postings is page one: when it is issued before the pagination loop, the
loop bound is `maxPages - 1` (floored at 0), and `ctx.maxPages: 1` then
means that first request and nothing else — the "exactly one list request"
probe assertion in section 3 depends on it.

A source-reported `total` can also be plain wrong, not just absent — some
backends silently clamp it, so a `total`-bounded walk is not proof of
completeness. Reference: `providers/workday.mjs`'s facet split (#3310).

The reverse direction happens too, and independently of the clamp case above:
a source-reported **results count** can just as easily *overstate* what its
own pagination will ever actually serve — observed live, on the same query,
across every transport a source exposed. A source's **page count**, by
contrast, is a different number computed a different way, and held up as
reliable in the same live checks — it tracked the walk's own natural end (an
empty or short final page) even on the tenant whose results count was wrong.
So bound the walk by the page count when a source gives you one, same as
before, but never treat either number — pages or results — as *proof* the
walk is complete. Only the walk's own natural end is that proof, independent
of what any source-reported count claims in either direction.

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
Two mechanisms, both expected once a provider paginates — or fans out
per-posting detail fetches:

- **Inter-page delay.** A module constant applied only to pages past the
  first: `if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx)`. Import
  `sleep` from [`_http.mjs`](_http.mjs) (it honours a ctx-supplied test
  clock) — don't hand-roll a local copy, and don't call `ctx.sleep(ms)`
  directly either: `ctx.sleep` is `Optional` in the §1 contract, so a ctx
  that carries no clock turns a bare `ctx.sleep(...)` into a `TypeError` out
  of `fetch()` — the whole target lost. The imported `sleep(ms, ctx)` uses
  the ctx clock when there is one and a real timer otherwise. 150–250 ms is
  the norm; raise it
  only where throttling was actually observed (`careerviet`, `itviec` at
  750 ms) or a published rate limit dictates it (`agentic-jobs` at 2100 ms
  for 30 req/60 s). Don't gold-plate a feed that never complained. A
  `robots.txt` `Crawl-delay` (rule 6), when the source states one, is a
  reasonable floor for `INTER_PAGE_DELAY_MS` directly, no need to observe
  throttling first. It governs spacing *between* requests, not a mandatory
  pause before the first one — `Crawl-delay` isn't even part of RFC 9309,
  the base robots.txt spec (`jobbankca.mjs` delays before page 1 too, but
  that's a per-provider choice, not something rule 6 requires).
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
- **A `fetchDetails` loop counts too.** A provider that does not paginate
  but issues up to `detailLimit` sequential detail fetches under
  `fetchDetails: true` is the same burst against the same WAF — pace it
  with the same inter-request `sleep`, and wrap each detail fetch in
  `fetchTextWithRetry` / `fetchJsonWithRetry`. Detail enrichment is
  best-effort: a detail fetch that exhausts retry is caught, the listing row
  kept as-is, and the sweep moves on — it never fails the run
  (`smartrecruiters.mjs`, `vdab.mjs`).

**Exhaustion is your call, not the helper's.** `withRetry` rethrows; the
error carries `.attempts` (the real request count). Decide per provider: keep
the pages already collected and `warn` (`workday.mjs`), or fail loud rather
than hand back a silent partial board (`a16z-speedrun-talent.mjs`). Either
way, the "raise `max_pages`" warning must **not** fire when pagination
stopped on a fetch error — that message means the ceiling truncated a
healthy board, not that the board broke.

The same distinction carries to any incomplete marker a provider puts on the
returned array: track *why* the walk stopped — ceiling, fetch error,
unrecognised page — as one value, and drive both the warning and the marker's
`reason` from it, so a consumer can tell "truncated a healthy board" from
"the board broke". Reference: `workday.mjs`'s `stopReason`
(`complete` / `cap` / `fetch-error` / …); `providers/phenom.mjs` is the
compact version. Keep that reason independent of whether the source ever
reported a `total`: a walk that hits its own ceiling — or breaks on a fetch
error — with no `total` in hand still has to carry the stop reason and still
warn. Deriving the incomplete marker and the warning only from a
`total`-based "did we reach the count" check drops the signal on exactly the
tenants that omit the count.

A short final page wins over the ceiling. "Hit the ceiling" means the loop
ran out of page budget *and* the last page it fetched was full: count the
rows the **source** returned for that page (the raw count from the
short-page stop above, before malformed rows are dropped), and if it is
below the page size the board ended on its own — stop reason `complete`,
not `cap`, and nothing warns. Only a full page at the cap boundary is a
`cap` stop; a source-reported `total` disambiguates a full boundary page
too. Gating the incomplete marker on the page index alone
(`page === lastAllowedPage`) tags a naturally-short final page as
truncated. Reference: `eightfold.mjs` ("a short page has to win");
`jobbankca.mjs` keys the stop off `rawEntryCount`, the feed's own
`<entry>` count.

A paginating JSON API can also hit a hard, source-side result-window
ceiling that looks nothing like a short page: every page up to some round
number (frequently a multiple of the page size — 100 pages of 100 is a
signature worth recognizing) comes back full, and every page past it
answers with a clean, well-formed, structurally EMPTY response instead of
an error or a partial page. That shape is the default max-result-window on
an Elasticsearch/Solr-style backend, not a bug in the walk, and — unlike
the clamped-`total` case above, which a facet-style query split can
sometimes recover — a hard result-window ceiling generally has no
client-side workaround unless the source exposes a documented alternate
access path. Treat it exactly like any other natural stop (an empty page
ends the walk, stop reason `complete`) and don't let `max_pages` /
`max_jobs` take the blame for a ceiling that was never local.

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
  request the provider issues** — list, pagination, and detail-enrichment
  fetches alike — assert `opts.redirect === 'error'`, not just that the call
  happened; the sole exception is a deliberate redirect-*inspection* request
  (`redirect: 'manual'`, to read `.location` off the thrown 3xx without
  following it — `jobvite.mjs`), and `redirect: 'follow'` is never used. For
  a config-derived URL, the allowlist guard throws **before** `fetchJson` /
  `fetchText` is called — a stub that only throws does not prove this (it
  passes whether the guard fired or a fetch was wrongly attempted), so assert
  the fetch stub was never entered (call count `0`, or a stub that fails the
  test on entry); a fixed-literal-host provider has no allowlist and skips
  this assertion.
- The empty-vs-broken split from §2: a *present-and-empty* documented
  container → `[]`; a bare non-object, a contentless body, or one missing the
  documented envelope → a descriptive throw. Assert both branches — for a
  scraper that means a fixture whose card selector / embedded blob matches
  nothing throws, while a well-formed page carrying an empty list still
  returns `[]` (`join.mjs`). For a regex scraper with no container to
  type-check, the throwing fixture must carry the listing signal (a
  detail-page href in the HTML) with zero rows parsed, and the `[]` fixture
  must carry neither (`itviec.mjs`).
- Pagination (if any): the provider's own `DEFAULT_MAX_PAGES` stops it even
  when the source reports more pages; `ctx.maxPages` stops it earlier. For a
  provider that fans out over several query/category passes behind one shared
  `seen` set: a pass whose first page fully overlaps an earlier pass still
  walks its deeper pages and returns their unique postings — a
  "nothing new, stop" shortcut would drop them.
- Pagination + transient failure (if any): a 429 / 5xx on page 2 that retry
  can't clear either keeps pages 1..N and warns, or fails loud — whichever
  your provider chose — and the "raise `max_pages`" warning does *not* fire
  on that fetch-error stop.
- `fetchDetails` + a failed detail fetch (if any): a detail fetch that
  exhausts retry is caught, the listing row comes back intact, and the sweep
  finishes — enrichment failure is never fatal to the target
  (reference: `smartrecruiters.mjs`).
- `detailLimit` (if `fetchDetails`): a test caps the detail-fetch count at
  `detailLimit` however many postings match — `smartrecruiters.test.mjs`
  runs 40 postings at `detailLimit: 10` and asserts exactly 10 detail calls.
- Probe cooperation (if paginating *or* fetching details): with
  `ctx.maxPages: 1`, exactly one list request and no `fetchDetails` /
  enrichment calls — a non-paginating provider that skips the detail loop
  under the probe still owes this assertion; and a `ctx.fetch*` rejection
  *while `ctx.maxPages` is set* propagates unwrapped — not swallowed to
  `[]`, not rewrapped (reference: `vdab.test.mjs`).
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
| Empty board vs a broken selector, told apart | `providers/join.mjs` (array shape), `providers/itviec.mjs` (regex scraper) |
| Wildcard-tenant host allowlisting (anchored, not a `Set`) | `providers/bamboohr.mjs`, `providers/workday.mjs` |
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
      failing. It claims the landing URL a user actually has (careers-page
      link, aggregator, search hit), not only a hand-built canonical path.
- [ ] Every network call passes `redirect: 'error'` — the sole exception is a
      deliberate `redirect: 'manual'` inspection request, or a
      session-bootstrap follow that re-validates every hop's `Location`
      against the same allowlist, bails on the first off-origin hop, and caps
      the hop count. A config-derived URL is checked against an allowlist
      before the request.
- [ ] `fetch()` returns `[]` only when the documented array container is
      present and empty (`[]` / `{jobs: []}`); it throws — naming the keys
      or type it got — on a real API error, a bare non-object, or an
      envelope that isn't the documented shape (`{}`, `{jobs: null}`, a
      different container key), and for a scraper a selector or embedded
      blob that matches nothing at all. A single bad row is skipped
      (`continue` / `null` + `.filter`), not fatal to the target.
- [ ] Dates are NaN-safe (`toEpochMs` pattern).
- [ ] HTML/XML entities go through `providers/_html-entities.mjs`, not a
      local copy.
- [ ] `job.url` from a per-posting `id` / `slug` goes through
      `safeEncodeURIComponent` (`_safe-url.mjs`), `null` → drop the posting;
      no bare `encodeURIComponent` on a `url:` line. A scraped href segment
      passed to `decodeURIComponent` is wrapped in try/catch with a
      raw-segment fallback.
- [ ] A config-derived URL segment (`locale`, `office`) is
      `encodeURIComponent`'d once outside the row loop — escaped, and loud
      (throws) on a broken value — not `safeEncodeURIComponent` + drop.
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
- [ ] A `fetchDetails` detail-fetch loop is paced and retry-wrapped the
      same way, even when the provider does not paginate.
- [ ] No `enrichDate` unless the provider is (being) wired into
      `scan-ats-full.mjs`; not shipped alongside the `fetchDetails` opt-in.
- [ ] `tests/providers/{name}.test.mjs` covers everything in section 3.
- [ ] `node test-all.mjs` — the full suite is green (not just `--only`).
- [ ] A row is added to
      [`../docs/SUPPORTED_JOB_BOARDS.md`](../docs/SUPPORTED_JOB_BOARDS.md), in
      case-insensitive alphabetical position by board name (the table is
      sorted — a lowercase name like `softgarden` sorts among the `S…` rows,
      not after `Z`).
- [ ] `templates/portals.example.yml` is updated: (1) if `detect()` matches
      a host, a URL-pattern line under "Provider auto-detection"; otherwise
      an explicit `provider:` in the stanza; (2) in the "Built-in provider
      examples" block, a commented `Example {Name} Co` stanza (every field
      at its default) in the group whose header matches — copy a neighbouring
      group's `(→ tracked_companies: …)` / `(→ job_boards: …)` header format
      verbatim — a provider with **no** `detect()` is covered by the
      `provider:` line in that stanza, which is what the "Provider
      auto-detection" section points at (there is no separate name list to
      append to); (3) one **live, uncommented** real entry, in
      the matching region/topic section, **only when it carries more than the
      stanza in (2)** — a real `careers_url` / `api`, a resolvable slug or
      board id, or provider-specific keys (every company ATS, and any
      slug/URL-bearing board such as Getro). "Live" here means uncommented
      and carrying real config (a resolvable `careers_url` / slug), not
      necessarily `enabled: true` — a company-ATS entry can ship
      `enabled: false` and still satisfy this. Skip (3) for a bare
      `provider: {id}` feed with no per-entry URL or config (a regional
      board, an RSS feed) — there a live entry is byte-identical to (2).
- [ ] **Editing an existing provider, not adding one?** The
      `SUPPORTED_JOB_BOARDS.md` and `portals.example.yml` items above are
      also "keep in sync on change". If the fix changes observable behavior
      (pagination, defaults, URL format, what counts as an error or an empty
      board), `grep` the repo for every prose description of that behavior —
      by the provider name and by the substance of the change, not just a
      function name — and fix them in the same PR.
