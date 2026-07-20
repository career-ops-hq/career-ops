# Reviewing career-ops PRs — the one-pager

For reviewers on the [contributor ladder](../MAINTAINERS.md). Merges still go through a maintainer; your review is what makes them fast and safe.

## The three rules

1. **Assigned means owned.** If a PR or issue is assigned to you, you're the one driving it to a decision — review it, label it, or hand it back explicitly. Silence is the only wrong move.
2. **Written doctrine beats personal taste.** Review against what the repo says (CONTRIBUTING.md, DATA_CONTRACT.md, AGENTS.md, the mode files), not against how you'd have written it. If the doctrine is missing or wrong, that's an issue to open, not a review comment to enforce.
3. **Every piece gets two people.** Nothing merges reviewed only by its author. Your approval is the second pair of eyes that makes `--admin` merges unnecessary.

## What to check, in order

1. **Data contract** — does the diff touch user files (`cv.md`, `config/profile.yml`, `data/`, `reports/`)? User files are never written without explicit opt-in. This is the one non-negotiable.
2. **Tests** — does `node test-all.mjs` pass? Does new behavior come with a check? Files added at top level must be registered in `SYSTEM_PATHS` (update-system.mjs).
3. **Scope** — does the diff match what the linked issue asked for? Features nobody asked for, or >200 lines with no issue, get a conversation before a review.
4. **Behavior changes** — anything under `modes/` changes what the agent does. Descriptive signals with guards written into the text are the house style; anything that changes scoring or tiers goes to the maintainer.
5. **Security** — new fetches get hostname validation (parse the URL, never substring-match), no new dependencies without discussion, nothing auto-submits on a candidate's behalf.

## Tone

Every contributor gets warmth, especially first-timers. Merge-then-refine beats bikeshedding on a first PR. When something can't land, say why and leave a path forward — a close without a path is a door slam.
