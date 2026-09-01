# Contributing to Career-Ops

Thanks for your interest in contributing! Career-Ops is built with Claude Code, and you can use it for development too.

## Why contribute here

career-ops is a great place to make your **first open-source contribution** — and a great line on your résumé.

- **You already get it.** This is a job-search tool. If you're job-hunting, you understand the problem better than most — which makes you a better contributor.
- **A real merged PR, on something people use.** 55K+ stars, shipping most weeks. Your name in the history of a real project, not a toy repo.
- **We answer fast.** Open an issue or PR and you'll hear back, usually within a day or two. No black holes.
- **Tiny on-ramps.** Browse [`good first issue`](https://github.com/career-ops-hq/career-ops/contribute) — each is scoped small, with a time estimate, the pattern to copy, and a clear "done", so your first PR is a win, not a maze.
- **Your human work gets a real review.** We read every PR. We don't drown contributors in bot noise, and we don't merge AI-slop — put thought in, get thought back.
- **A path forward.** Consistent, high-quality contributors get credited publicly and invited into bigger roles (reviewer, then maintainer).

New to all this? That's the point. Claim a good-first-issue by commenting `/assign` on it, ask anything in [Discord](https://discord.gg/8pRpHETxa4), and we'll help you land it.

## Before Submitting a PR

**For a new feature, a new mode or command, or an architecture change, please open an issue first.** It saves you from investing time in something we'd have to redirect, and lets us align on direction before you write code.

**Going straight to a PR is welcome — no issue needed — for:** bug fixes, new zero-auth scanner providers, docs, and translations. Don't let process slow these down; these are the contributions we most want.

A large *feature* PR that skipped this step may be asked to start with an issue if it doesn't fit the architecture or roadmap — that's a scope conversation, never a judgment on your work.

The review process you'll experience here is documented end-to-end in [Agentic maintenance: how this repo is run](https://santifer.io/ai-agent-fleet): why a first-timer's CI waits for human approval, why review comments arrive with test evidence, and what happens between your push and the merge.

### What makes a good PR
- Fixes a bug listed in Issues
- Addresses a feature request that was discussed and approved
- Includes a clear description of what changed and why
- Follows the existing code style and project philosophy (simple, minimal, quality over quantity)

## Quick Start

1. Open an issue to discuss your idea
2. Fork the repo
3. Create a branch (`git checkout -b feature/my-feature`)
4. Make your changes
5. Test with a fresh clone (see [docs/SETUP.md](docs/SETUP.md))
6. Commit and push
7. Open a Pull Request referencing the issue

## What to Contribute

**Good first contributions:**
- Add companies to `templates/portals.example.yml`
- Translate modes to other languages
- Improve documentation
- Add example CVs for different roles (in `examples/`)
- Report bugs via [Issues](https://github.com/career-ops-hq/career-ops/issues)

**Bigger contributions:**
- New evaluation dimensions or scoring logic
- Dashboard TUI features (in `dashboard/`)
- New skill modes (in `modes/`)
- Script improvements (`.mjs` utilities)

### Claiming a good first issue

Comment `/assign` on any [`good first issue`](https://github.com/career-ops-hq/career-ops/contribute) and it's yours: no waiting for a maintainer. How it stays fair:

- **Claims free up on their own.** After 7 quiet days (with a friendly ping at day 3) the issue goes back to the window, so nothing stays stuck. `/extend` restarts the clock, no questions asked; `/unassign` lets go cleanly. An open PR always pauses the clock.
- **Reserved for newcomers.** Good-first-issues are for contributors with fewer than 3 merged PRs here (`first-timers-only` means exactly that: your very first), one at a time, so a first-time contributor always has a way in. Past that stage? [`help wanted`](https://github.com/career-ops-hq/career-ops/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) is your board.
- **No claim needed to contribute.** A PR straight onto any unassigned issue is always welcome.

## The contribution ladder

There's a clear path here — we promote people who show up:

1. **First-time contributor** — you landed a PR. Welcome aboard.
2. **Trusted contributor** — a few solid merges; we fast-track your PRs and tag you on related work.
3. **Reviewer** — you help triage and review others' PRs. We invite you.
4. **Maintainer** — you help steer the project.

We credit contributors publicly and invite high-signal folks up the ladder. Want to help more? Just say so in an issue.

## Adopting an abandoned PR

Life happens: a PR gets a review, the author moves on, and useful work strands at 80% done. We don't let a bot bury it, and we don't let it rot. Instead it goes through a public, predictable ladder:

1. **Two weeks of silence** after a review round, and a maintainer opts the PR into the ladder (`adoption/track`). You get a friendly ping: still yours, no rush.
2. **Two more weeks**, a second check-in with the plan spelled out: two further weeks of silence and the work opens up for adoption.
3. **Only then** a maintainer (never a bot) closes the PR with thanks and opens a companion issue labeled **`adoptable`**, pointing at the branch and listing exactly what's left to do.

**Adopting one** is one of the highest-value first contributions you can make: the diff is mostly done, the review is already written, and the remaining work is scoped. Open a *new* PR that carries the original commits (git preserves the author's credit), or add a `Co-authored-by:` trailer for them. Both of you end up credited: the original author for the work, you for landing it.

**If you're the original author coming back**: the work stays yours to reclaim at any point before someone else finishes it. Just say so on the issue. Any comment or push from you at any ladder step resets the clock completely.

## Someone else's open PR stays theirs

The ladder above is for work that has been **abandoned**. An open PR with an author still around is a different thing, and the line matters.

**Please don't open a PR that re-resolves someone else's conflict.** Pointing out on the thread that a PR has gone into conflict is genuinely useful. Rebasing it onto a branch of your own and opening a replacement is not, however cleanly the merge is done: landing that replacement closes the original, and the author is left with a `closed` PR where their `merged` should have been. That badge is most of what a contributor takes away from a project, and it isn't ours to reassign.

If the conflict came from something **we** merged, the fix is ours. We resolve it on the author's own branch (that is what "Allow edits by maintainers" is for), run the suite, and leave their PR and their authorship untouched. If it came from anywhere else, the author rebases whenever they're ready: nobody is on a clock for that.

This applies to automation as well. A bot opening replacement PRs on other people's branches is doing the same thing at higher volume, and automated triage posted into someone else's thread ("don't merge both", "treat #X as the primary") reads as a project decision to the person who has been waiting on one. Merge calls are the maintainers' to make.

Improvements that go *beyond* resolving the conflict are welcome, just not stapled onto another person's PR: raise them in the thread and let the author decide, or open your own PR once theirs has landed.

## Scope: the core vs. the shared layer

career-ops core is **local-first and human-in-the-loop** by design — it runs on your machine and drafts applications for *you* to review and submit. Centralized infrastructure — hosted job aggregation, a shared matching service, proxies or Workers the project would operate — is **not part of the core**: it's heavier than a free local tool should carry, and it's where the project is headed as a *separate, opt-in service*. See the direction here: **[Where career-ops is going](https://github.com/career-ops-hq/career-ops/discussions/904)**.

Rule of thumb before you build: **provider modules, languages, CLI support, modes on the core path, dashboard, docs and fixes → the core.** Bigger centralized or automation ideas (a hosted layer, auto-apply, scraping infrastructure) → **start in that discussion**, so we can route them together instead of a large PR that can't merge.

### What belongs in core (the parallel-feature test)

career-ops says yes to a lot: providers, languages, CLI support, fixes. Where we are deliberately picky is **parallel features**: things adjacent to the job-search path that would each be useful on their own. Every merged feature is a promise to maintain it forever (docs, tests, agent context, upgrade paths), so "is it well built?" is not the bar. Before proposing one, run it through the four questions we use ourselves:

1. **Is it on the core path?** The core path is: discover postings, evaluate, tailor, apply, track, close the loop. Infrastructure that strengthens that path is core even when invisible (dedup, atomic writes, the transition ledger). A feature that lives *next to* the path (contact management, calendaring, note-taking) starts as a plugin.
2. **Who pays the maintenance?** A feature that solves one workflow brilliantly but adds surface for everyone (a new data file, a new script, a new mode) needs either demonstrated demand (issues from several people, not one) or a plugin home.
3. **Plugin-first, with graduation.** Adjacent features start as plugins (see [docs/PLUGINS.md](docs/PLUGINS.md)): you own the release cycle, we list it in the registry. If a plugin earns real adoption, we will consider graduating it into core. Evidence-based promotion, not gatekeeping: it is how WordPress runs feature-projects.
4. **Does it match the project's shape?** A mode or API that breaks established patterns creates cognitive load for every future user and contributor, even when it works. Expect us to ask for the spelling that matches the codebase before the merge.

Failing one of these is a routing, not a rejection. Open the issue first and we will tell you which door fits: core, plugin, or separate project. The plugin registry gives real distribution, and an idea that is wrong for core today can still be the most useful thing you ship.

## Source Indexing Policy

career-ops reads job listings from public sources: ATSes, job boards, company career pages, talent networks. This policy is the single bar every source meets, whoever proposes it — including operators submitting their own board. We don't judge a source's business model; we judge its data. These rules are the [CareerOps Manifesto](MANIFESTO.md) applied to sources.

1. **What gets indexed.** Any source whose listings are real, attributed to an identifiable employer, and free for candidates to read and apply to. Manifesto right 4 — *"You never pay"* — applies to sources too: a source that paywalls listings or applications for candidates doesn't get indexed, whatever else it does.

2. **Canonical URL.** Each listing carries the shortest verifiable path to the employer the source exposes (the ATS or direct application URL when available). The source's own page may travel as secondary attribution.

3. **Paid placement doesn't reach the candidate.** Promoted content cannot buy position in career-ops: ranking happens on each user's machine, providers traverse their source's complete inventory, and the maintainer audits sources for response bias (API totals vs site totals, page distribution). career-ops itself carries no sponsored placements of any kind. This is manifesto right 8 — *"Your agent works for you. Not for a platform, not for an employer."* — enforced at the data layer.

4. **Indexing is not endorsement, and distribution is not owed.** Presence in the registry places listings in front of the installed base (as of August 2026, a single network's launch post drove 15,626 unique machines to clone the repo in a day). Real, measurable, channel-dependent — and no source is owed placement, traffic, or permanence. Sources are listed with their operator declared, and no single source may exceed 40% of the registry.

5. **The aggregation layer belongs to the project.** A provider reads its own source. Cross-source aggregation, ranking, matching and the registry live in core and are never delegated to a source.

To see how the rules have actually been applied, read the [Source Indexing Log](docs/SOURCE_INDEXING_LOG.md): one entry per listed source, with what was checked and how.

To propose a source (yours or anyone's): [open a source proposal](https://github.com/career-ops-hq/career-ops/issues/new?template=source-proposal.yml) walking through these five rules. A direct PR with the provider is welcome too: the same five rules apply before merge. Operator declarations are verified out-of-band before listing — a contact reachable at the source's own domain, or equivalent proof of domain control. Operators proposing their own board are welcome — that's what rule-based gates are for.

## Guidelines

- Keep modes language-agnostic when possible (Claude handles both EN and ES)
- Scripts should handle missing files gracefully (check `existsSync` before `readFileSync`)
- Dashboard changes require a build (`npm run build:dashboard`) — test with real data before submitting
- Don't commit personal data (cv.md, profile.yml, applications.md, reports/)

## What we do NOT accept

- **PRs that scrape platforms prohibiting automated access** (LinkedIn, etc.). We actively reject these to respect third-party ToS.
- **PRs that enable auto-submitting applications** without human review. career-ops is a decision-support tool, not a spam bot.
- **PRs that add external API dependencies** without prior discussion in an issue.
- **Feature PRs against bundled plugins** (`plugins/apify`, `plugins/gmail`, `plugins/notion`). Bundled plugins are stable *reference seeds* — to extend one, publish your own `career-ops-plugin-<id>` and we'll register it as the maintained successor that takes precedence once installed (see [docs/PLUGINS.md](docs/PLUGINS.md)). Bundled plugins only take security/compat fixes.
- **PRs that add centralized or hosted infrastructure to the core** (proxies, aggregation services, shared Workers). That's the separate opt-in service, not the open-core — bring it to the [direction discussion](https://github.com/career-ops-hq/career-ops/discussions/904) first.
- **Universal aggregation indexes as a dependency** — integrating a single third-party service that unifies listings across many sources into one pipe career-ops reads from. Reading individual boards where employers post is exactly what `providers/` is for and stays welcome; the *unified offers-aggregation layer itself* is first-party, the same boundary that keeps the web experience first-party ([#904](https://github.com/career-ops-hq/career-ops/discussions/904) / [#156](https://github.com/career-ops-hq/career-ops/discussions/156)). This boundary applies to the plugin registry as well as core.
- **Integrations that send your data to a third-party service** — providers or sync features that require a third-party account or push your CV, pipeline, or notes out to an external service. career-ops is local-first and zero-keys: your job-search data stays on your machine. Reading *public* job-listing APIs locally is welcome (that's how the built-in providers work); routing your personal data through someone else's service is not.
- **PRs that add third-party hosted entry-points or service badges to the README** — links or embeds that route users' resumes or job data through a service the project doesn't operate. The README stays to assets the project controls, and the official online experience is something we keep first-party (see [The Vision](https://github.com/career-ops-hq/career-ops/discussions/156)). Projects built on career-ops are welcome — share them in the [Discord](https://discord.gg/8pRpHETxa4) or Discussions, just not on the front page.
- **PRs containing personal data** (real CVs, emails, phone numbers). Use `examples/` with fictional data instead.

## Development

```bash
# Scripts
npm run doctor                # Setup validation
node verify-pipeline.mjs     # Health check
node cv-sync-check.mjs        # Config check

# Dashboard
npm run build:dashboard       # go build with platform-correct binary name
npm run serve:dashboard       # launch the TUI against the repo root

# Tests
node test-all.mjs             # Full suite — run before pushing/opening a PR
node test-all.mjs --quick     # Full suite, skipping the dashboard build
node test-all.mjs --only providers/themuse   # Run just one provider's test(s)
```

**Adding a test for a new scanner provider:** add one file at
**Any new test belongs in its own file** under `tests/`, not as a numbered
section inside `test-all.mjs`. Anything matching `tests/**/*.test.mjs` is
auto-discovered, so there is nothing to register and no section number to pick.
A new file also collides with nobody: several contributors adding sections to
`test-all.mjs` at the same time all edit its final lines, and each merge forces
a rebase on the rest.

`tests/providers/{name}.test.mjs` — it's auto-discovered (`tests/**/*.test.mjs`),
no registration needed. Do not add a section to `test-all.mjs` for this.

**Adding a test for the web app:** web suites live under `web/tests/`, mirroring
the tested module's path below `web/src/` (`src/lib/clean-chips.mjs` →
`tests/lib/clean-chips.test.mjs`), named `{module}.test.mjs`. `web/`'s own
`npm test` glob-discovers them, so no registration is needed there either — but
keep them out of `web/src/` (Next.js scans that tree) and write them as `.mjs`,
since there is no TypeScript loader for `node --test`. `web/README.md` has the
detail; `tests/web-test-layout.test.mjs` enforces it on every PR.

**`--only` is a dev convenience, not a PR gate:** it runs *only* the discovered
`tests/` files matching the given substring and skips every inline core
section (syntax, scripts, dashboard, data contract, personal data, paths,
etc.). A green `--only` run is **not** a green suite — always run the full
`node test-all.mjs` before pushing.

## Brand and Trademark

Contributions to the codebase are governed by the MIT [LICENSE](LICENSE).
The "career-ops" name itself is governed by [TRADEMARK.md](TRADEMARK.md).
If you fork the project for commercial use, you're welcome to do so
under MIT — please give it your own product name and follow the
trademark policy regarding commercial naming and endorsement claims.

## Need Help?

- [Join the Discord](https://discord.gg/8pRpHETxa4) — fastest way to get answers and connect with other contributors
- [Open an issue](https://github.com/career-ops-hq/career-ops/issues)
- [Read the architecture docs](docs/ARCHITECTURE.md)
