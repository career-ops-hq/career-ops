# Source Indexing Log

Every source that goes through the [Source Indexing Policy](../CONTRIBUTING.md#source-indexing-policy) gets an entry here: what was proposed, who proposed it, which rules were checked, and how they were verified. The point is that a stranger can reconstruct any decision from the outside without asking anyone.

Two things this log deliberately is not: a ranking, and a promise. Rule 4 says it plainly — indexing is not endorsement, and distribution is not owed.

**How to read an entry.** "Verified" means someone ran a command and reported the output, not that a claim was accepted. Where a check could only be done against a live endpoint, the entry says what was sampled and when, because live checks expire: a source that passed in August can drift in November, and re-verification is normal rather than an accusation.

**Adding an entry.** A source is logged when its provider merges. Anyone can open a [source proposal](https://github.com/santifer/career-ops/issues/new?template=source-proposal.yml); the discussion happens in the issue and the PR, and this file is the durable summary with links back to both.

---

## Rules 4 and 6 changed (2026-11-12)

**Rule 6.** Until 2026-11-12 the rule described one reader only: a provider on the job seeker's own machine, which builds no index. The project's shared listings layer (rule 5) does build one: it reads the public job pages of employers and serves a card for each posting, with a link to the employer's own page and without the text of the posting. The rule now says so, and says how that layer reads: only public pages, a user agent that says who it is, one request at a time per host at the pace the host asks for, and removal on request. A source's `robots.txt` is still not a gate. The reason given is no longer "it builds no index", which is true of a provider and is not true of the layer. What the layer honours instead is the operator's own request, which removes the source for good.

**Rule 4.** The 40% cap was written for "a source", which left open whether a company that hosts its board on an applicant tracking system is the source, or the system is. It is the company: the cap is about who benefits from being listed. The share of each hosting system is published as a second figure, with no cap while the registry is being filled.

---

## Rule 6 changed (2026-11-08)

Until 2026-11-08, rule 6 made a source's `robots.txt` a gate: a `Disallow` covering the listing paths a provider reads was a stop. It no longer is. `robots.txt` is written for crawlers that index or copy a site; a provider reads a posting on one person's machine so that person can understand it and, if it fits, apply on the employer's page. What stays a stop: a login or a user account, a CAPTCHA, and an operator who asks career-ops not to read their source ([open an issue](https://github.com/career-ops-hq/career-ops/issues/new) to ask).

The rule 6 notes in the entries below stay as the record of the old rule. The sources it kept out or narrowed (Lagou, TopDev, CareerLink and TurboHire in [Evaluated, not supported](SUPPORTED_JOB_BOARDS.md#evaluated-not-supported); jobspresso's feed path) can come back, or be widened, through a source proposal or a PR. Google's first results page was one of these; it was widened to page through the results on 2026-11-08 ([#6694](https://github.com/career-ops-hq/career-ops/issues/6694)). Thanks to @benbalter for the rule 6 checks in #5774 and #5776: they are why each of those cases is easy to find.

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

**Rule 3 (complete inventory, no paid placement).** The provider pages the public `t.me/s/` preview newest first through the `since_days` window; `max_pages` is a safety cap that warns when it cuts the window short. Accepted posts retain their HTML order within each preview page; pages are fetched from newest to older, without globally sorting the emitted jobs. Whether an operator sells posts to employers is not visible in provider data and remains unverified. A paid post can pass the same employer-and-vacancy-link checks as any other post, so those checks do not establish the absence of paid promotion.

**Rule 4 (operator declared).** Per channel, not per transport: the registry names the channel, and the shipped example is disabled. Indexing a channel is not endorsement of its operator.

**Rule 5 (aggregation stays in core).** The provider reads one channel per entry and does no cross-source work. The one change outside the provider, `aggregator: true` in `scan.mjs`, only switches off cross-employer title dedup for a feed that names itself as the company; dedup, ranking and matching stay where they were.

**The bar for the next channel proposal**, so it is written down: measure the channel (share of posts naming an employer, share linking a vacancy page, what survives both), name its operator, and expect the provider to drop the rest. A channel below roughly a quarter passing is the channel's editorial choice, and the provider will read it correctly and emit little.

**Re-measured 2026-10-31: positional employer shapes and the Habr Career fix.** 51 public RU/CIS channels, 3 preview pages each, 2,973 posts, saved once and replayed before and after the change. Two things kept posts that already met rules 1 and 2 from being emitted:

- Every `career.habr.com` vacancy link was refused. `habr.com` is on the non-apply list as a long-read host, and the subdomain matched it before the board list was checked. All the Proglib channels link there. The board list is now checked first: 98 of the newly emitted posts link to Habr Career.
- Many channel templates name the employer by position, not by label: `Employer ищет …` (Proglib, POSTER), `Title в Employer` on the title line (offerclaw, Remocate and Sparkles mirrors), a second line `Employer is a …` (the EN template of @geekjobs and its siblings), and a finder.work mirror's employer on the line after the salary. These four shapes run only after the five marked shapes find nothing. Because a position is weaker evidence than a label, each capture is also refused when it reads as a role, a sector or unit ("в FinTech", "в команду CDP"), a department, a work format ("Удаленно (Москва)", "Relocation available"), a contract term, a person (a Russian patronymic), a year, a destination ("с переездом в Дубай"), a declined place name ("в Лиссабоне"), a city or region standing alone ("в Алматы", "Москва" after the salary line), a phrase ("в Чехии или Испании"), or a `в` inside a quoted title. `Title / Employer` and `Title — Employer` were measured too and left out: they carried 27 posts and most of the review findings, and wait for a shared candidate filter of their own.

A post is also dropped when it says, anywhere in the text, that the employer's name is withheld ("название компании-заказчика не раскрыто", "неназванной финтех-организации"). On Proglib that sentence follows a first line naming the agency. A post that withholds something else ("Зарплата не раскрыта") is kept.

| | before | after |
|---|---|---|
| posts emitted | 284 | 621 |
| previously emitted posts with the same company, url and title | — | 271 of 284 |
| previously emitted posts now refused | — | 13: 12 that name no employer (`Worldwide 🌏` ×10 and `NDA` read from the hashtag template and a `Компания:` label, `Custom Software Development`, a line of business), and 1 that linked a Remocate page, read until now as the employer's own site |

The 350 new posts name 227 distinct employers. Each employer name was reviewed by hand against its post, and the false attributions found were turned into the refusals above, each with a test. The links were not opened one by one: they pass the current `classifyLink()` rules, including the Habr Career path rule and the mirror-host changes, with ingamejob.com added to the board list (2 of the new posts). Habr Career, on the board list since the provider was merged, was checked on 2026-11-04 on a random 15 of the 107 Habr Career links emitted at the time: 11 were live vacancy pages naming the same employer as the post, with an "Откликнуться" button; 4 had closed since the corpus was saved (2 answer 404, 2 are archived), which is what `check-liveness.mjs` is for. Two of the 13 readable pages name a recruiting agency, Top Selection, as the company and say nothing about a client; the source cannot tell those apart from the agency hiring for itself. Applying needs neither an account nor a payment: on two of the sampled vacancies, checked by hand, "Откликнуться" opens a plain application form behind a captcha.

**Hosts refused instead (`UNDECLARED_HOSTS`).** A host that is on no list is read as the employer's own site whenever its path looks like a vacancy, so a mirror left off the board list still passes, as the employer. Four hosts the measured channels link are refused outright: remocate.app (a relocation job board; its "Apply Now" redirects to the employer's own ATS, but its operator is not named on the site and has been asked), offerclaw.app (unreachable while measured, so neither its operator nor candidate access could be checked), vseti.app (a vacancy aggregator whose page the posts carry in place of the employer's link, which source rules 2 and 5 keep out), and hellowehire.com (a shared ATS for freelance recruiters, run by Plus8Soft; a vacancy page there is a recruiter's intake form, and its employer field is often blank). In the corpus they carry 173 otherwise attributable posts (112, 54, 6 and 1). A mirror moves to the board list in its own PR once its operator is declared here.

**Board mirror added to the board list (rule 4).** A post that links a mirror's vacancy page rather than the employer's own is emitted with the mirror page as `url`, so the mirror host is declared here with its operator.

- **ingamejob.com** (InGame Job, a games-industry job board). Operator: InGameJob OÜ, Tallinn, Estonia, named with its address in the site's [privacy policy](https://ingamejob.com/privacy); Estonian registry code 14769069, active; the same policy gives a contact address at the site's own domain. Rule 1: a vacancy page is free to read without an account, and the apply form on it (name, e-mail, message, PDF CV) needs no sign-in and no payment. What the site sells is on the employer side (job credits, candidate-database access, boosters). Rule 2: the post links the InGame Job vacancy page, whose apply form is the application path; it is the `url`. Rule 3: paid boosters ("Top", "Hot", "Premium") put a job at the top of the site's search and in its newsletters and social channels, and the site lists jobs posted on it ahead of the vacancies it aggregates. None of that reaches career-ops, which reads each Telegram post the same way and ranks on the user's machine. Rule 6: `User-agent: *` disallows only `/away/` and `/email/`, with `Crawl-delay: 5`; the provider never fetches the vacancy page. Checked 2026-11-03; no out-of-band confirmation from the operator yet.

Still out of reach by design: posts whose only application path is a Telegram contact or an e-mail address, digests carrying several vacancy links, and channels that link only through teletype or telegra.ph.

---

## Computrabajo

| | |
|---|---|
| **Proposed by** | @configurowebmax (community contributor; no affiliation with the source declared) |
| **Provider** | `providers/computrabajo.mjs` |
| **PR** | [#2650](https://github.com/career-ops-hq/career-ops/pull/2650) |
| **Merged** | pending (this PR) |
| **Status** | Provider listed; the shipped `job_boards:` entry is `enabled: false`. |

A general job board with one host per Latin American country. Only the Colombian host was measured: one GET of `https://co.computrabajo.com/trabajo-de-sistemas` on 2026-10-23, no key, cookie or session, career-ops' default User-Agent: HTTP 200, 20 posting cards.

**Rule 1 (real listings, identifiable employer, free for candidates).** Employer attribution, measured: 17 of the 20 cards name an employer; 3 show "Importante empresa del sector" (hidden employer), which the provider emits as `?`. Several named employers are staffing agencies rather than the hiring company. Free for candidates: met. Creating an account and applying cost nothing ("Registro gratuito" on `co.computrabajo.com`, read 2026-10-23); applying goes through a free candidate sign-in. Computrabajo also sells candidates an optional "Cuenta Premium" (`co.computrabajo.com/cuenta-premium/`, about COP 12,000 a month on 2026-10-23) that, among other things, puts the profile in the first positions employers see and allows applying more than once to the same vacancy. Applying does not require it. career-ops does not use, link to or recommend that plan: the provider only reads public listings and links each posting page.

**Rule 2 (canonical URL is the employer's).** The listing card carries no employer or ATS URL, only the board's own posting page, so `url` is that page (fragment dropped). Whether the posting page links on to the employer: unverified.

**Rule 3 (complete inventory, no paid placement).** Partly met, flagged for the maintainer. Employers can pay Computrabajo (not career-ops) to feature a posting as "Empleo destacado", and the board interleaves those cards in every sort order: 9 of 20 in the default "Relevancia" order and 11 of 20 in the "Fecha" order (`?by=publicationtime`), measured on 2026-10-23. There is no order without them, and they are real postings by real employers, so the provider keeps them. It requests the "Fecha" order so the newest postings come first, keeps every card it reads, does no ranking of its own, and stops at 3 pages / 15 postings by design. career-ops receives nothing from Computrabajo or from any employer. Pagination (`?p=N`) is unverified.

**Rule 4 (operator declared).** Operator not declared in the PR; unverified.

**Rule 5 (aggregation stays in core).** Verified in code: the provider reads one search URL per entry, on a `<country>.computrabajo.com` host only.

**Rule 6 (`robots.txt`).** Checked on 2026-10-23: one GET of `https://co.computrabajo.com/robots.txt` with career-ops' default User-Agent, HTTP 200, a single `User-agent: *` group. Its `Disallow` lines cover `/ofertas-de-trabajo/` with filter parameters (`*by=`, `*pubdate=`, ...), `/hojas-de-vida/`, `/curriculums/`, `/empresas/` filters, `/Ajax/`, `/_services/` and `/go/`; none covers the search page the provider fetches (`/trabajo-de-sistemas?by=publicationtime&p=N`). A configured search URL under `/ofertas-de-trabajo/` fell under the `*by=` rule once the provider added `by=publicationtime`, so the provider used to drop the sort on that path; after the [rule 6 change](#rule-6-changed-2026-11-08) (2026-11-08, #6691) the sort is sent on every path (#6694). Other country hosts: unverified.

---

## ElEmpleo (not listed)

Proposed in [#2650](https://github.com/career-ops-hq/career-ops/pull/2650) together with Computrabajo and Magneto365, and taken out of it on 2026-10-23. The comments in `https://www.elempleo.com/robots.txt` (read 2026-10-23) say that extracting or scraping its content by automated means is prohibited without ELEMPLEO's prior written permission. A provider reads the board by automated means, so it is not listed. The provider code stays in the history of #2650 (`providers/elempleo.mjs` at e40e148) in case ELEMPLEO gives that permission.

## Magneto365

| | |
|---|---|
| **Proposed by** | @configurowebmax (community contributor; no affiliation with the source declared) |
| **Provider** | `providers/magneto.mjs` |
| **PR** | [#2650](https://github.com/career-ops-hq/career-ops/pull/2650) |
| **Merged** | pending (this PR) |
| **Status** | Provider listed; the shipped `job_boards:` entry is `enabled: false`. |

A general job board for Colombia. Measured: one GET of `https://www.magneto365.com/co/trabajos/buscar/tecnologia` on 2026-10-23, no key, cookie or session, career-ops' default User-Agent: HTTP 200, 20 job cards, pager links up to page 20.

**Rule 1 (real listings, identifiable employer, free for candidates).** Employer attribution, measured: 11 of the 20 cards name an employer; 5 read "Confidencial" and 4 carry the board's own name ("Magneto empleos"), and the provider emits all 9 as `?`. Free for candidates: met according to the press, not to a Magneto page: candidates register, upload a CV and apply at no cost, and employers pay for credits to see candidate contacts ([El Colombiano](https://www.elcolombiano.com/empleos/contenidos/como-acceder-ofertas-empleo-magneto-mas-de-100-mil-vacantes-NJ27958140), read 2026-10-23). Applying requires a free account.

**Rule 2 (canonical URL is the employer's).** The card carries no employer or ATS URL, only the board's own posting page, so `url` is that page. Whether the posting page links on to the employer: unverified.

**Rule 3 (complete inventory, no paid placement).** The default sort order and whether any card is promoted: unverified. The provider reads up to `max_pages` (default 5), not the whole board. The pagination shape (`?paginator[page]=N`) is the one in the page's own pager links; a page past the first was not fetched.

**Rule 4 (operator declared).** Operator not declared in the PR; unverified.

**Rule 5 (aggregation stays in core).** Verified in code: the provider reads one search URL per entry, on `www.magneto365.com` / `magneto365.com` only.

**Rule 6 (`robots.txt`).** Checked on 2026-10-23: one GET of `https://www.magneto365.com/robots.txt` with career-ops' default User-Agent, HTTP 200. Under `User-agent: *` it allows `/`, disallows `/*?` and `/manager/*`, and allows `/*paginator[page]`. Every URL the provider fetches carries `paginator[page]=N`, which the longer `Allow` covers; a configured search URL with other query parameters still carries it. No group names career-ops.

---

## jobs.cz and prace.cz

| | |
|---|---|
| **Proposed by** | @kosinal (not the operator) |
| **Provider** | `providers/jobscz.mjs`, `providers/pracecz.mjs` |
| **PR** | [#5631](https://github.com/career-ops-hq/career-ops/pull/5631) · issue [#5627](https://github.com/career-ops-hq/career-ops/issues/5627) |
| **Merged** | — |
| **Status** | Proposed |

**Rule 1 (real listings, identifiable employer, free for candidates).** Listings are individual offers, and each names its employer: a company line on every jobs.cz card, `company.publicName` on every prace.cz item. Listings are readable without an account, and the prace.cz footer links an advertising price list for employers ("Ceník inzerce"). Each offer page has an "Odpovědět" (reply) button leading to the portal's application form. It was opened by hand in a browser, as a candidate, on one offer of each portal (the providers never request it; prace.cz's `robots.txt` disallows `/odpovedni-formular/`): on both portals, sending an application requires no account and is free.

**Rule 2 (canonical URL is the employer's).** jobs.cz cards link `https://www.jobs.cz/rpd/{id}/`, which redirects to the offer page, often on the employer's branded career site (`{employer}.jobs.cz/pd/{id}`). The listing exposes no direct ATS link, so `/rpd/{id}/` (without tracking params) is the canonical URL. On prace.cz, an item's `extended.careerPage.url`, the employer's branded page, is used when present; otherwise `https://www.prace.cz/nabidka/{advertId}/`.

**Rule 3 (complete inventory, no paid placement).** Both portals mark promoted placement: "Příležitost dne" cards (`data-test-ad-status="jobsTip"`) on jobs.cz, `searchInfo.isPromoted` on prace.cz. Neither portal has a sort control. Walking every page of a search returns exactly the total the site shows: for "python", jobs.cz returned 281 unique offers over 10 pages, and prace.cz 63 over 2 pages. The providers walk all pages up to a cap, warn when the cap is hit, dedup by offer id, and leave ranking local. The id is the one in the offer URL on jobs.cz (`/rpd/{id}/`) and `advertId` on prace.cz, so an offer seen under both its branded career-page URL and `/nabidka/{advertId}/` is kept once.

**Rule 4 (operator declared).** Alma Career Czechia s.r.o. runs both portals, according to their page footers. The proposer is not the operator, but a candidate using them.

**Rule 5 (aggregation stays in core).** Each portal has its own provider. jobs.cz and prace.cz are separate portals, but many employers publish the same offer on both: for "python", 56 of the 63 prace.cz offers also appeared on jobs.cz with identical company and title. The scanner's existing company+role dedup merges these.

**Rule 6 (the source's own `robots.txt`).** Under `User-agent: *`, jobs.cz does not disallow the listing path `/prace/`, and its disallowed `/api/` and `/iapi/` are never requested. prace.cz does not disallow `/nabidky/`, the only path the providers read; its disallowed `/hledat/` (the old search path, which now redirects to `/nabidky/`) and application-form paths are never requested. Neither file names an AI or agent crawler.

---

## jobspresso.co

| | |
|---|---|
| **Proposed by** | issue [#1310](https://github.com/career-ops-hq/career-ops/issues/1310); provider by @aakash811 |
| **Provider** | `providers/jobspresso.mjs` |
| **PR** | [#1320](https://github.com/career-ops-hq/career-ops/pull/1320) · rule 6 re-check in issue [#5774](https://github.com/career-ops-hq/career-ops/issues/5774) |
| **Merged** | 2026-06-29, before this policy existed (2026-08-04) |
| **Status** | Listed; query string `?posts_per_page=100` enabled on 2026-11-09 (#6694) |

Re-read against rule 6 after a contributor checked the live `robots.txt` in [#5774](https://github.com/career-ops-hq/career-ops/issues/5774).

**Rule 6 (the source's own `robots.txt`).** Checked on 2026-10-23 and again on 2026-11-05: one GET of `https://jobspresso.co/robots.txt`, HTTP 200. Under `User-agent: *` it disallows `/*?` and sets `Crawl-delay: 3`; its only `Allow` lines are `/*.css` and `/*.js`. No group names career-ops. `/*?` covered the URL the provider originally fetched, `/?feed=job_feed`. Following the Rule 6 update in #6691 and #6694 where robots.txt is no longer a gate for providers, the feed requests `?posts_per_page=100` (within Crawl-delay: 3, 1 request per scan) to return 100 items instead of 10.

**Rules 1 to 5.** Not re-verified here.

---

## jobicy.com

| | |
|---|---|
| **Proposed by** | provider by [#1260](https://github.com/career-ops-hq/career-ops/pull/1260); rule 3 re-check in this PR |
| **Provider** | `providers/jobicy.mjs` |
| **PR** | [#1260](https://github.com/career-ops-hq/career-ops/pull/1260) · rule 3 re-check: this PR |
| **Merged** | 2026-06-29, before this policy existed (2026-08-04) |
| **Status** | Listed; walks the whole 7-day feed since this PR |

Re-read against rule 3 after the feed's documentation ([jobi.cy/apidocs](https://jobi.cy/apidocs), updated 2026-10-19) turned out to describe cursor pagination the provider never used.

**Rule 3 (complete inventory, no paid placement).** The provider read one page, `?count=50`. Measured on 2026-11-05 with career-ops' default User-Agent, no key, cookie or session: the feed is a 7-day window served newest first, 100 postings a page, and one full walk of its `nextCursor` returned 1,358 postings over 14 pages (largest page 0.9 MB), zero duplicates, published 2026-10-30 to 2026-11-05. The 50 the provider read were 3.7% of the board and had all been published the same day. The provider now follows `nextCursor` until the feed reports `hasMore: false`, up to `max_pages` (default 25, max 100), and warns when that cap cuts the walk short. The public payload has no promoted or sponsored field, and the documentation states the order: publication time, newest first, listing id as tie-breaker. The optional `geo` / `industry` / `tag` keys are the feed's own documented filters, chosen by the user per entry; with `geo=argentina` the same walk returned 124 postings over 2 pages.

**Rule 2 (canonical URL).** For a public request the payload carries one URL per posting, the Jobicy listing page; the employer's ATS link is a field of the paid Commercial API only. Jobicy's fair-use terms also ask that apply links from the free API keep pointing at the Jobicy page, so `url` stays that page.

**Rule 6 (the source's own `robots.txt`).** Checked on 2026-11-05: one GET of `https://jobicy.com/robots.txt`, HTTP 200. Its `User-agent: *` group disallows query shapes such as `/*?s=`, `/*?p=`, `/*?q=`, `/*?offset=0` and `/*api_access_key=`, and paths such as `/search/` and `/job-listings/`; none covers `/api/v2/remote-jobs` with `count`, `cursor`, `geo`, `industry` or `tag`. It also carries `Content-Signal: ai-train=yes, search=yes, ai-input=yes`. No group names career-ops.

**Fair use.** The documentation asks integrations to start an automated pass no more than once an hour and to follow its cursor pages in order. One scan is one pass per `provider: jobicy` entry, with 250 ms between pages.

**Rules 1, 4 and 5.** Not re-verified here.

## tes.com

| | |
|---|---|
| **Proposed by** | [#6685](https://github.com/career-ops-hq/career-ops/issues/6685) |
| **Provider** | `providers/tes.mjs` |
| **PR** | this PR |
| **Status** | Listed |

UK and international teaching jobs from schools and other education employers. Tes publishes no API; the search page at `https://www.tes.com/jobs/search` fills itself from a public tRPC query, `GET /jobs/api/trpc/jobs.search?batch=1&input=<json>`, which the provider reads with the input shape the page sends (captured 2026-11-09).

**Rule 1 (real, attributed, free).** Every posting names its school or employer and is free to read and apply to; no account is needed to read a posting.

**Rule 2 (canonical URL).** The search payload carries one URL per posting, the Tes vacancy page (`canonicalUrl`), and `url` is that page. The per-posting detail query (`jobs.getById`) also exposes the school's own application link (`item.application.url`, for example an international-school ATS), but reading it costs one request per posting, about 5,700 for the whole board, so the provider does not read it. The Tes vacancy page links to it. A bounded, opt-in detail pass that carries that link is a possible follow-up.

**Rule 3 (complete inventory, no paid placement).** Measured on 2026-11-09 with career-ops' default User-Agent, no key, cookie or session: sorted by `date`, the board returned 5,679 postings over 114 pages of 50, zero duplicate URLs, the last page short and the next one empty. A `limit` above 50 passes the endpoint's validation (`<= 100`) but returns zero rows, so the page size is 50. Rows carry a `promoted` flag and the payload a `sponsoredJobIds` list; the provider keeps every row in the order the date sort returns and never moves or filters by either. The optional `keywords` key is Tes's own search, chosen by the user per entry; the endpoint ignores `locations`, which the provider therefore does not send.

**Rule 6 (read like a visitor).** The requests are the ones the public search page makes, one per page, 250 ms apart, bounded by `max_pages` (default 150, cap 400). `robots.txt` (checked 2026-11-09) disallows `/auth/`, `/registration/`, attachment paths and `/api/career-profile`, `/api/job-application` and `/api/schools` at the root; none covers `/jobs/api/trpc/jobs.search` or `/jobs/vacancy/`.

**Rules 4 and 5.** The provider reads only Tes; nothing is ranked or merged at the source.
