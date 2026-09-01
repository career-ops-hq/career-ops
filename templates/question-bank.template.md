# Question Bank

Copy this file's shape to `interview-prep/question-bank.md` (user layer — never
auto-updated) and grow it as you debrief, practice, and drill. Group entries
under a `##` (or any level) heading per company; `interview-readiness.mjs` and
`weekly-digest.mjs` both attribute a question to the nearest heading above it.

## Backward-compatibility constraint (binding, do not violate)

`weekly-digest.mjs`'s `extractGapsByCompany()` attributes a 🔴 line to the
nearest PRECEDING heading, and CLEARS that attribution at any heading that does
not match a known company name. A `###` sub-heading between the company
heading and a question line (e.g. a `### Technical Round` divider) would clear
attribution and silently drop that question's gap from every digest and
readiness report. Therefore:

**Question entries MUST NOT use `###` (or any level) sub-headings.** Group
everything for one company under that company's single heading. Use the
indented metadata sub-bullets below instead of headings to add structure.

## Entry format

Each question is a single `- **Q:**` bullet, optionally carrying a status inline
as an emoji (🔴 Gap / 🟡 Solid / ✅ Strong), with optional indented metadata
sub-bullets beneath it. ALL sub-bullets are optional — a bare legacy line like
`- **Q:** How would you shard a write-heavy table? Status: 🔴 Gap` with no
sub-bullets at all is still valid and still parses.

**The status emoji is also optional, and its absence is meaningful.** A status
is a *verdict*: it records how the question actually went when it was answered
out loud. `interview/drill` generates questions from a job description without
anyone answering them, so it writes them with **no status marker at all** — the
"drilled but unanswered" state. Do not backfill a marker to make an entry look
complete:

- 🔴 on an unanswered question fabricates a failure that never happened, and
  `interview-readiness.mjs` would rank it above topics genuinely failed.
- ✅/🟡 asserts a competence nothing has demonstrated.

`interview-readiness.mjs` treats a statusless entry as unmeasured: it scores the
topic on a no-evidence placeholder (`NO_STATUS_WEAKNESS`) rather than a verdict
in either direction, excludes the entry from the weakness denominator so it
cannot dilute a real gap on the same topic, and emits `answeredCount` /
`unanswered` so no consumer mistakes the placeholder for a measurement. The
first real status is written by `interview/practice` or `interview/debrief`.

```markdown
## Acme Corp

- **Q:** How would you shard a write-heavy Postgres table? — Status: 🔴 Gap
  - topic: databases/indexing-partitioning
  - round: technical
  - asked: 2026-08-20
  - practiced: 2026-08-25
  - attempts: 3
  - confidence: 2
  - gap: no precise vocabulary for partition pruning
  - source: debrief
```

## Field rules

| Field | Rule |
|-------|------|
| `topic` | `domain-id/topic-id` from `templates/interview-topics.yml` (or your `config/interview-topics.yml` override), or a bare `domain-id` when no specific topic fits. |
| `round` | One of: `screen`, `hiring-manager`, `technical`, `system-design`, `behavioral`, `onsite`, `final`. |
| `asked` | `YYYY-MM-DD` — the date this question was actually asked in a real interview. |
| `practiced` | `YYYY-MM-DD` — the date you last drilled/practiced this question. |
| `attempts` | Integer — number of times you've practiced this question. |
| `confidence` | 0-5 self-rating, 0 = no idea, 5 = could teach it. |
| `gap` | One line describing what specifically went wrong or is missing. |
| `source` | One of: `debrief`, `practice`, `drill`, `research`. |
| status emoji | Optional. `🔴 Gap` / `🟡 Solid` / `✅ Strong`, inline on the `- **Q:**` line. Omit it entirely for a question that has never been answered out loud (see above) — absent is a real state, not a missing field. |

A malformed or missing sub-bullet is tolerated — it just means that field is
unknown for this entry, not that the entry is invalid.

## Producer write rules

- `interview/practice` and `interview/debrief` write the evaluator's verdict inline as `— Status: <emoji> <label>` after a question has actually been answered.
- `confidence` is a separate candidate self-rating. Ask for it directly; never convert 🔴/🟡/✅ into a number. If the candidate provides no valid 0–5 rating, preserve an existing value or omit the field on a new entry.
- Preserve an existing `source` when practice updates an entry. The field records how the question first entered the bank, not the most recent activity.
