# Governance

## Overview

career-ops is maintained by [@santifer](https://github.com/santifer) under a **BDFL (Benevolent Dictator for Life)** model with a clear path for community members to earn trust and take on responsibilities.

The goal is to build a self-sustaining community where the project thrives even when the maintainer is offline.

## Decision Making

- **Architecture decisions** (CLAUDE.md, scoring system, data contract) — maintainer only
- **New features** — require an approved issue before PR submission
- **Bug fixes** — can be submitted directly with a clear description
- **Documentation and translations** — welcome from anyone, low barrier

## Contributor Ladder

Anyone can grow their role in the project. Roles are earned through sustained, quality contributions — not requested or assigned.

This is the one place the ladder and its criteria are written down: [MAINTAINERS.md](MAINTAINERS.md) lists who holds each role today, and [CONTRIBUTING.md](CONTRIBUTING.md) and announcements link here instead of keeping their own copy.

### Participant

**Everyone starts here.**

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md)
- Open issues, comment on PRs, help others in Discord
- Submit bug reports with reproduction steps

### Contributor

**Earned with your 3rd merged PR.** It brings an invitation to the [career-ops-hq](https://github.com/career-ops-hq) organization (the **contributors** team). That is the whole criterion, and it is retroactive: no vote, no nomination, no application. Invitations go out in batches; if yours has not arrived, say so in an issue.

- Listed in release notes when their contributions ship
- Input is weighted more heavily in issue discussions
- Can be tagged for review on PRs in their area of expertise

### Triager

**By invitation**, after sustained contribution + demonstrated understanding of the project's architecture.

- Can label and categorize issues
- Can close duplicates and redirect support questions
- Can request changes on PRs (non-binding)
- Nominated by the maintainer based on observed behavior

### Reviewer

**By invitation**, after a run of quality merged PRs + a track record of helpful code reviews.

- Triage permissions on the repository; can approve PRs. A maintainer still approves and merges: branch protection only counts approvals from write access
- Identity is verified before this access is granted (see [Trust & access](MAINTAINERS.md#trust--access))
- Reviews carry the decision **inside the reviewer's area** (listed in [MAINTAINERS.md](MAINTAINERS.md)); outside it, an approval is a valued signal on code quality, not the routing decision
- Routing (core vs. plugin vs. separate project, see CONTRIBUTING "Scope") and the critical files in `.github/CODEOWNERS` stay with the maintainers, before code review
- Listed in CONTRIBUTORS.md
- Invited to architectural discussions before major changes

### Maintainer

**By invitation**, after sustained contribution + demonstrated alignment with project values.

- Can merge PRs
- Identity is verified before this access is granted (see [Trust & access](MAINTAINERS.md#trust--access))
- Can release new versions
- Participates in governance decisions
- Voted in by existing maintainers

## How to Level Up

You don't apply for roles. They emerge naturally:

1. **Start contributing** — fix a bug, translate a mode, improve docs
2. **Be consistent** — one quality PR per month beats ten rushed ones
3. **Help others** — answer questions in Discord, review PRs, triage issues
4. **Understand the project** — read CLAUDE.md, DATA_CONTRACT.md, the architecture docs
5. **The maintainer will notice** — and reach out when the time is right

## Values

- **Quality over quantity** — we'd rather have 10 great features than 100 mediocre ones
- **User files are sacred** — the data contract is non-negotiable
- **Human in the loop** — the system recommends, the human decides
- **Respect everyone's time** — maintainers, contributors, and users alike
