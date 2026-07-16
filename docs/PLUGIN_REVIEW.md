# Plugin review (maintainer guide)

How to review a registry PR safely + fast. CI does the mechanical checks; you
make the security + fit judgment calls. The registry pinned-SHA is the single
chokepoint — a community plugin can never reach a user without a merged entry
here, so review is the real control.

## Two tiers

- **Listed** — one `plugins-registry/<id>.json` file; the code stays in the
  author's `career-ops-plugin-<name>` repo; users `add` it. The default, low
  burden.
- **Bundled** — promoted into `plugins/` (shipped, auto-updated). Reserve for
  broadly-useful, low/zero-key, well-tested plugins (how `apify`/`gmail`/`notion`
  were absorbed). Adds a maintenance commitment + a `config/plugins.example.yml`
  block + an `.env.example` entry.

## What CI already checked (don't re-do by hand)

`plugin-registry-validate` validates the entry shape + uniqueness, clones each
entry at its pinned SHA, and runs the min-file / manifest / static-audit checks
in a no-secret, read-only sandbox (no plugin code is executed). If it's red,
stop.

## Your judgment calls (the checklist)

- **Naming + identity:** repo is `career-ops-plugin-<name>`, `id` == name minus
  prefix, `sha` pinned to the commit you actually read.
- **Read the diff** (for an update, the old→new diff): does it do only what it
  says? Watch for time-bombs, env-gated branches, obfuscation.
- **Egress:** `allowedHosts` are real public hosts; no IP literals / metadata /
  `*.internal`; localhost only with a stated reason.
- **Capability surface:** hooks ⊆ the five; no apply/submit; no core-owned
  secrets in `requiredEnv`. For an **update**, any growth in hooks / env / hosts
  is a fresh consent surface — review as a new listing.
- **Data direction:** reads PUBLIC data or the user's OWN account only. No
  centralized infrastructure, no auto-submit, no blind-apply.
- **Wording (public-forever):** description / README / skill carry no commercial
  / hosted-service / monetization language. career-ops is free and local-first;
  "approved" means "we reviewed this commit", nothing more.
- **Skill (if any):** domain-scoped — it teaches how to drive the plugin, and
  does NOT instruct the agent to edit core files, change scoring, reveal secrets,
  or act outside the plugin's hooks.
- **License:** MIT-compatible.

## Auto-merge (only when it's truly safe)

Most updates are human-reviewed. An update may auto-merge ONLY when ALL hold: a
known author (2FA + a verified commit signature on the pinned SHA), the diff is
**provably non-logic** (metadata / version / strings / comments / whitespace
only — no change to control flow or executable statements), **zero** new
capability (hooks/env/hosts/deps), every deterministic gate green, and the
agentic reviewer raised no flag. Auto-merge lands the row **staged**; the user's
shipped pin advances only after the canary window. First listings and any
capability or logic change are reviewed by a human regardless of author trust.
The agentic reviewer can only **raise** risk (escalate to a human) — never
approve.

## ToS-grey / authenticated integrations

Anything that scrapes a platform behind a login or whose terms forbid automated
access (authenticated LinkedIn, session-gated boards) is **not** bundled and
**not** registry-listed. It can still be a `career-ops-plugin-<name>` repo users
install explicitly into `plugins.local/` with the full "you're trusting this
author" prompt — the project doesn't host that liability in-tree.

## Bundled plugins are reference seeds (no feature PRs on `plugins/`)

A bundled plugin (`plugins/apify`, `plugins/gmail`, `plugins/notion`) is a
**reference seed**: a reviewed, minimal, stable example. We do **not** accept
feature PRs against it — close-redirect them to "publish `career-ops-plugin-<id>`
and we'll register it as the maintained successor." Bundled plugins only take
PRs for **security or release-compat fixes** (keeping the seed working across
core releases).

**Reviewing a `supersedesBundled: true` registry entry.** Such an entry says
"when installed at this pin, my plugin should take precedence over the bundled
plugin of the same id." Review it with that weight:

- The entry's `id` MUST match an existing bundled plugin in `plugins/` (a
  successor for a non-existent seed is meaningless — reject).
- It is the **same trust bar as any registry entry** (naming, manifest, egress,
  static audit, pinned sha) — plus the awareness that approving it lets users
  *replace* a reviewed bundled integration. Read the diff against the seed.
- Precedence is enforced engine-side **only** for a user who installs it at the
  exact pinned sha; the bundled seed remains the always-present fallback, so an
  abandoned successor degrades gracefully (the seed simply stays in charge).
- Original-author successors (the contributor whose PR seeded the bundled
  plugin) are the natural, encouraged path — hand them the migration warmly.
