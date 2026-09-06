# Source Indexing Log

Every source that goes through the [Source Indexing Policy](../CONTRIBUTING.md#source-indexing-policy) gets an entry here: what was proposed, who proposed it, which rules were checked, and how they were verified. The point is that a stranger can reconstruct any decision from the outside without asking anyone.

Two things this log deliberately is not: a ranking, and a promise. Rule 4 says it plainly — indexing is not endorsement, and distribution is not owed.

**How to read an entry.** "Verified" means someone ran a command and reported the output, not that a claim was accepted. Where a check could only be done against a live endpoint, the entry says what was sampled and when, because live checks expire: a source that passed in August can drift in November, and re-verification is normal rather than an accusation.

**Adding an entry.** A source is logged when its provider merges. Anyone can open a [source proposal](https://github.com/santifer/career-ops/issues/new?template=source-proposal.yml); the discussion happens in the issue and the PR, and this file is the durable summary with links back to both.

---

## remotli.ch

| | |
|---|---|
| **Proposed by** | @eliador90, **who operates the source** (declared in the proposal) |
| **Provider** | `providers/remotli.mjs` |
| **PR** | [#2465](https://github.com/santifer/career-ops/pull/2465) · issue [#2464](https://github.com/santifer/career-ops/issues/2464) |
| **Merged** | 2026-08-07 |
| **Status** | Listed |

First source reviewed under the written policy. The operator proposing their own board is exactly the case the rules exist for: the disclosure came first, and the rules decided rather than a conversation.

**Rule 1 (real listings, identifiable employer, free for candidates).** Verified: listings resolve to named employers, no candidate-side paywall or registration on the source.

**Rule 2 (canonical URL is the employer's).** The provider prefers each listing's upstream `applyUrl` and falls back to the board page only when that is missing or not `https:`. Verified by sampling 121 rows across pages 1, 9 and 19 of the live feed: zero rows without an employer URL, zero non-https, zero pointing back at remotli.ch. The host distribution was ordinary employer infrastructure (Greenhouse, Workday, Ashby, Lever, Recruitee, company career pages), with no tracking hop in between.

**Rule 3 (complete inventory, no paid placement).** The operator disclosed a coverage gap in his own proposal: without the `remote=all` parameter the feed serves 392 of 921 roles, 42.6% of the board. The merged provider walks all 19 pages. No promoted or sponsored field exists in the payload.

**Rule 4 (operator declared).** The [supported boards table](SUPPORTED_JOB_BOARDS.md) row carries `operator: eliador90` with a link to this policy.

**Rule 5 (aggregation stays in core).** The provider reads its own source only. Ranking and cross-source work stay where they always were.

**Also checked, outside the policy:** zero-auth (a plain `curl` with no key, cookie or session returns the feed), and two HIGH CodeQL alerts raised in review were resolved before merge.

---

## a16z speedrun talent network

| | |
|---|---|
| **Proposed by** | @justma16ze (community contributor, not affiliated with the source) |
| **Provider** | `providers/a16z-speedrun.mjs` |
| **PR** | [#2231](https://github.com/santifer/career-ops/pull/2231) |
| **Merged** | 2026-07-29 |
| **Status** | Listed |

Merged before the policy was written, and logged here because it is the case that prompted writing it: a large, well-connected talent network is exactly where "does indexing imply endorsement?" stops being theoretical.

**Rule 3, retroactively.** Two coverage defects were found and fixed after listing, both by contributors reading the live feed rather than the code: the page size was set to 100 while the feed serves 50, so the fetch stopped silently after one page ([#2419](https://github.com/santifer/career-ops/pull/2419)), and a single transient upstream failure aborted the whole board fetch ([#2506](https://github.com/santifer/career-ops/issues/2506)). Both are the failure mode rule 3 targets: partial coverage that reads as complete.

**Rule 4.** Listed with its operator declared. Rule 4's 40% ceiling exists so no single source, however large, dominates the registry.

## theirstack.com (retired from the plugin registry)

| | |
|---|---|
| **Proposed by** | @d-ulker (registration issue [#1697](https://github.com/career-ops-hq/career-ops/issues/1697)); plugin published by @uelkerd |
| **Plugin** | `career-ops-plugin-theirstack` (community plugin, `provider` hook, `THEIRSTACK_API_KEY`) |
| **Listed** | 2026-07-07, before this policy existed (2026-08-04) |
| **Retired** | 2026-09-05 |
| **Status** | Not listed. The plugin remains published in its own repository; the registry is only what the project lists. |

Re-read against the written policy after a second source of the same shape asked to be listed (JobsPipe, [#3841](https://github.com/career-ops-hq/career-ops/pull/3841)), so that the two answers match.

**Rule 1 (real listings, identifiable employer, free for candidates).** Not met as a listed source: access to the listings goes through a metered, paid API on the job seeker's side, and a free tier does not change that. Manifesto right 4 (*"You never pay"*) applied to sources is the whole of this rule; it has no free-tier exception.

**Rule 5 (aggregation belongs to the project).** The value of the source is a cross-source feed ("50k+ sources"), which is the layer the policy keeps in core.

**Rules 2, 3 and 4.** Not re-verified: rule 1 decides on its own. Rule 4 is worth restating for the record: indexing is not endorsement, and retiring a listing is not a judgement on the product.

---

## Public Telegram channels (t.me/s/ preview)

| | |
|---|---|
| **Proposed by** | @nikitacometa, who operates none of the channels measured |
| **Provider** | `providers/telegram-channel.mjs` |
| **PR** | [#3668](https://github.com/career-ops-hq/career-ops/pull/3668) · issue [#3701](https://github.com/career-ops-hq/career-ops/issues/3701) |
| **Merged** | 2026-09-05 |
| **Status** | Provider listed; no channel is listed. The shipped `job_boards:` entry is a disabled template, and a channel added to the registry gets its operator declared per channel. |

First source of a new kind: not a board with a feed, but a transport (Telegram) carrying channels whose posts are written by hand. A board guarantees rules 1 and 2 by construction; a channel only satisfies them post by post, so the provider was asked to measure before it was read, and the measurement became its contract.

**What was measured.** 17 channels with a public preview (10 RU/CIS, 7 EN), 809 posts, up to 3 pages each, on 2026-09-03, with every surviving link opened by hand (137 links).

| | RU/CIS (461 job posts, 77 CV posts) | EN (271 posts) |
|---|---|---|
| post names an employer (`Компания:` / `Company:` line, `Title @ Employer`, `Title \| Employer`, a second line `в Employer —`) | 45% | 4% |
| post links outside Telegram and the vk/max footers | 70% | 74% |
| both, after dropping homepages, forms, shorteners, LinkedIn posts, pages with no vacancy evidence, hidden employers and multi-vacancy digests | **25% (137 posts)** | **0** |

The pass rate is each channel's editorial shape, not noise: @data_science_job 77% (every post is `Title [Remote] @ Employer` plus a getmatch page), @ai_rabota 42%, @jobforjunior 42%, @job_python 35%, @backend_job_geeklink 32%; @devjobs 2%, @datasciencejobs, @theyseeku and @itjobs_ru 0% (a recruiter named instead of an employer, or an employer named with nothing linked). The EN channels in the sample mirror boards the project already scans (remoteok, weworkremotely, arbeitnow) or link only through shorteners, so they pass 0 and lose nothing.

**Rule 1 (real listings, identifiable employer, free for candidates).** The provider enforces employer-name and qualifying vacancy-link checks. `company` is that employer, never the channel and never the link's hostname; the 77 CV posts and every post naming a recruiter, an agency client or "название скрыто" are dropped. Manual review found no candidate-side paywall on the 137 sampled links. Free candidate access is an observation from that sample, not a runtime check or a guarantee for later posts.

**Rule 2 (canonical URL is the employer's).** `url` is the vacancy link the post carries: a vacancy page on the employer's own https host first, then a known board's per-vacancy page (getmatch.ru, finder.work, geekjob.ru, geeklink.io, hh.ru, linkedin.com/jobs/view). Rejected: t.me, social and footer hosts, shorteners, forms, homepages and listing roots, employer pages with no vacancy evidence, plain http. Of the 137 emitted links, 53 are employer vacancy pages and 84 board per-vacancy pages. The t.me permalink is secondary attribution only, carried as a trailing `Source:` line; a post with no external vacancy link is not emitted at all.

**Rule 3 (complete inventory, no paid placement).** The provider pages the public `t.me/s/` preview newest first through the `since_days` window; `max_pages` is a safety cap that warns when it cuts the window short. Whether an operator sells posts to employers is not visible in provider data and remains unverified. A paid post can pass the same employer-and-vacancy-link checks as any other post, so those checks do not establish the absence of paid promotion.

**Rule 4 (operator declared).** Per channel, not per transport: the registry names the channel, and the shipped example is disabled. Indexing a channel is not endorsement of its operator.

**Rule 5 (aggregation stays in core).** The provider reads one channel per entry and does no cross-source work. The one change outside the provider, `aggregator: true` in `scan.mjs`, only switches off cross-employer title dedup for a feed that names itself as the company; dedup, ranking and matching stay where they were.

**The bar for the next channel proposal**, so it is written down: measure the channel (share of posts naming an employer, share linking a vacancy page, what survives both), name its operator, and expect the provider to drop the rest. A channel below roughly a quarter passing is the channel's editorial choice, and the provider will read it correctly and emit little.

