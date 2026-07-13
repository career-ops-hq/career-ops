# Maintainers

This file lists who maintains career-ops and how contributors grow into review and maintenance roles. It exists so the project doesn't depend on any single person and so the path forward is legible to everyone.

## Current maintainers

| Role | Who | Areas |
|------|-----|-------|
| Lead maintainer | [@santifer](https://github.com/santifer) | All areas; final say on architecture, scoring, and the data contract |

Reviewers and additional maintainers are added as the contributor ladder below produces them. If you're reviewing this and the list is short — that's the honest current state, and the ladder is how it grows.

## The contributor ladder

Career-ops grows its team in the open. There are three rungs:

### 1. Contributor
Anyone who opens a PR or a helpful issue. No permissions needed — just contribute. Good first contributions: a new open-API scanner provider (`providers/`), a translation, a docs fix, or a [good first issue](https://github.com/santifer/career-ops/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22). See [CONTRIBUTING.md](CONTRIBUTING.md).

### 2. Reviewer
Trusted contributors who help triage and review incoming PRs. A reviewer is invited after a track record of **several merged, high-quality PRs** across more than one area, plus consistently helpful review comments on others' PRs. Reviewers help label, reproduce, and give first-pass feedback; merges still go through a maintainer.

**How to get there:** keep shipping quality PRs, review others' work thoughtfully, and engage in discussions/RFCs. Identity is verified before any access is granted (see "Trust & access" below).

### 3. Maintainer
Reviewers who have shown sustained judgment aligned with the project's direction (local-first, AI-agnostic, human-in-the-loop) can be invited to maintain — with merge rights and a voice in architecture decisions.

## What each rung can do

| | Contributor | Reviewer | Maintainer |
|---|:---:|:---:|:---:|
| Open PRs / issues | ✅ | ✅ | ✅ |
| Triage & label | | ✅ | ✅ |
| First-pass review | | ✅ | ✅ |
| Merge to `main` | | | ✅ |
| Architecture / scoring / data-contract decisions | | | ✅ |

## Trust & access

Because career-ops handles people's personal career data, access is granted carefully:

- **Generous with credit, careful with access.** Praise and shout-outs are public and frequent; merge/admin rights are earned and verified.
- **Identity is verified** before granting review/maintainer access (real-identity footprint, account history). This protects the candidate side of the project.
- The codebase stays MIT and the data contract (system vs. user layer) is never weakened to grant convenience.

## Decision-making

- Day-to-day: lowest-friction path — a maintainer reviews and merges.
- Significant or breaking changes: an [RFC](https://github.com/santifer/career-ops/discussions/categories/rfc) first (see [CONTRIBUTING.md](CONTRIBUTING.md) → "Proposing big changes").
- Architecture, scoring rules, and the data contract: lead maintainer has final say, informed by RFC discussion.

## Want to help maintain?

Start by contributing, review others' PRs, and engage in RFCs. If you're consistently shipping quality work and want to take on more, say so in a discussion or reach out — the door is open.
