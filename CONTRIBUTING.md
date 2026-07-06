# Contributing to Career-Ops

Thanks for your interest in contributing! Career-Ops is built with Claude Code, and you can use it for development too.

## Why contribute here

career-ops is a great place to make your **first open-source contribution** — and a great line on your résumé.

- **You already get it.** This is a job-search tool. If you're job-hunting, you understand the problem better than most — which makes you a better contributor.
- **A real merged PR, on something people use.** 55K+ stars, shipping most weeks. Your name in the history of a real project, not a toy repo.
- **We answer fast.** Open an issue or PR and you'll hear back, usually within a day or two. No black holes.
- **Tiny on-ramps.** Browse [`good first issue`](https://github.com/santifer/career-ops/contribute) — each is scoped small, with a time estimate, the pattern to copy, and a clear "done", so your first PR is a win, not a maze.
- **Your human work gets a real review.** We read every PR. We don't drown contributors in bot noise, and we don't merge AI-slop — put thought in, get thought back.
- **A path forward.** Consistent, high-quality contributors get credited publicly and invited into bigger roles (reviewer, then maintainer).

New to all this? That's the point. Claim an issue with a comment, ask anything in [Discord](https://discord.gg/8pRpHETxa4), and we'll help you land it.

## Before Submitting a PR

**For a new feature, a new mode or command, or an architecture change, please open an issue first.** It saves you from investing time in something we'd have to redirect, and lets us align on direction before you write code.

**Going straight to a PR is welcome — no issue needed — for:** bug fixes, new zero-auth scanner providers, docs, and translations. Don't let process slow these down; these are the contributions we most want.

A large *feature* PR that skipped this step may be asked to start with an issue if it doesn't fit the architecture or roadmap — that's a scope conversation, never a judgment on your work.

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
- Report bugs via [Issues](https://github.com/santifer/career-ops/issues)

**Bigger contributions:**
- New evaluation dimensions or scoring logic
- Dashboard TUI features (in `dashboard/`)
- New skill modes (in `modes/`)
- Script improvements (`.mjs` utilities)

## The contribution ladder

There's a clear path here — we promote people who show up:

1. **First-time contributor** — you landed a PR. Welcome aboard.
2. **Trusted contributor** — a few solid merges; we fast-track your PRs and tag you on related work.
3. **Reviewer** — you help triage and review others' PRs. We invite you.
4. **Maintainer** — you help steer the project.

We credit contributors publicly and invite high-signal folks up the ladder. Want to help more? Just say so in an issue.

## Scope: the core vs. the shared layer

career-ops core is **local-first and human-in-the-loop** by design — it runs on your machine and drafts applications for *you* to review and submit. Centralized infrastructure — hosted job aggregation, a shared matching service, proxies or Workers the project would operate — is **not part of the core**: it's heavier than a free local tool should carry, and it's where the project is headed as a *separate, opt-in service*. See the direction here: **[Where career-ops is going](https://github.com/santifer/career-ops/discussions/904)**.

Rule of thumb before you build: **provider modules, languages, CLI support, modes, dashboard, docs and fixes → the core.** Bigger centralized or automation ideas (a hosted layer, auto-apply, scraping infrastructure) → **start in that discussion**, so we can route them together instead of a large PR that can't merge.

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
- **PRs that add centralized or hosted infrastructure to the core** (proxies, aggregation services, shared Workers). That's the separate opt-in service, not the open-core — bring it to the [direction discussion](https://github.com/santifer/career-ops/discussions/904) first.
- **Integrations that send your data to a third-party service** — providers or sync features that require a third-party account or push your CV, pipeline, or notes out to an external service. career-ops is local-first and zero-keys: your job-search data stays on your machine. Reading *public* job-listing APIs locally is welcome (that's how the built-in providers work); routing your personal data through someone else's service is not.
- **PRs that add third-party hosted entry-points or service badges to the README** — links or embeds that route users' resumes or job data through a service the project doesn't operate. The README stays to assets the project controls, and the official online experience is something we keep first-party (see [The Vision](https://github.com/santifer/career-ops/discussions/156)). Projects built on career-ops are welcome — share them in the [Discord](https://discord.gg/8pRpHETxa4) or Discussions, just not on the front page.
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
`tests/providers/{name}.test.mjs` — it's auto-discovered (`tests/**/*.test.mjs`),
no registration needed. Do not add a section to `test-all.mjs` for this.

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
- [Open an issue](https://github.com/santifer/career-ops/issues)
- [Read the architecture docs](docs/ARCHITECTURE.md)
