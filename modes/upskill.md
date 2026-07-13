# Mode: upskill -- Aggregate Skill-Gap Analysis

## Purpose

After dozens of evaluations, the tracker holds dozens of verdicts — and no aggregate reading. Every low-scoring evaluation names the skills the candidate was missing. This mode turns that discard history into an answer to the question every job seeker asks: **what should I learn, in what order?**

Phase 1 (this mode): aggregate gap map from tracked reports, with an optional LLM synthesis pass and a diff against the previous run. The web-searched learning plan and targeted `<URL>` mode are phase 2 (see #1520).

Pattern credit: [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)'s `/upskill`, adapted to career-ops' tracker and A–F scoring model.

## Inputs

- `data/applications.md` — Application tracker (rows with report links)
- `reports/` — Evaluation reports (Machine Summary + Gap tables)
- `cv.md` + `config/profile.yml` — Known skills (a skill present here must NEVER appear as a gap)
- `data/upskill/report-*.md` — Previous upskill reports (for the diff section)

## Step 1 — Run the Aggregator

```bash
node upskill.mjs
```

Parse the JSON output:

| Key | Contents |
|-----|----------|
| `schema_version` | Extraction-rule version. The diff section (Step 4) only compares reports with the same version. |
| `metadata` | `reportsLinked` / `reportsRead` / `reportsWithMachineSummary` / `reportsScored` / `lowFitReports` — surface these honestly; older reports may predate the Machine Summary block |
| `gaps` | `[{skill, reports, lowFitReports, lowFitShare, weightedScore, tier, sources}]` sorted by weighted score. Weight per report = `5.0 − score` (a 2.1/5 report says more about gaps than a 4.5/5 one); a skill counts once per report, not per mention |
| `excludedAsKnown` | Skills found in report gaps but already present in `cv.md`/`config/profile.yml` |
| `knownSkills` | The extracted known-skill set (for transparency) |

Tiers are fixed, explainable thresholds over the share of low-fit (score < 4.0) reports naming the gap — always narrate them that way ("named in 4/9 low-fit reports"), never as an opaque ranking.

If the script returns `error` (missing tracker or fewer than 5 scored reports), show the message and exit gracefully.

`--summary` prints a human table; `--min-reports N` lowers the threshold for small trackers.

## Step 2 — LLM Synthesis Pass (optional, skippable)

The aggregator only sees hard skills its tokenizer knows. Read the gap descriptions from the lowest-scoring reports (the `sources` lists point at them) and look for what the keyword pass can't see:

- **[domain]** — domain knowledge gaps (e.g. healthcare data, fintech compliance)
- **[soft]** — soft-skill or experience-shape gaps (e.g. people leadership, stakeholder management)
- **[tooling]** — process/tooling gaps not in the tokenizer (e.g. specific ATS, niche frameworks)
- **[credential]** — certifications or formal qualifications

Rules:
- **No duplicates from Step 1** — if the aggregator already lists it, don't re-add it.
- **Never contradict the exclusion list** — anything in `excludedAsKnown` or `knownSkills` is not a gap.
- Tag every synthesized gap with its source: `LLM synthesis` (vs the aggregator's "N/M low-fit reports").
- **On cheap models or when unsure, skip this step entirely.** The Step 1 output alone is a valid report — say "synthesis pass skipped" in the report and move on.

## Step 3 — Generate Report

Write to `data/upskill/report-{YYYY-MM-DD}.md` (user layer — never touched by the updater). Create the `data/upskill/` directory if missing.

```markdown
# Skill-Gap Analysis -- {YYYY-MM-DD}

**Schema:** v{schema_version}
**Reports analyzed:** {reportsRead} ({reportsScored} scored, {lowFitReports} low-fit)
**Coverage note:** {reportsWithMachineSummary}/{reportsRead} reports carry a Machine Summary block.

## Gap Heatmap

| Tier | Skill | Evidence | Source |
|------|-------|----------|--------|
| Critical | {skill} | named in {lowFitReports}/{totalLowFit} low-fit reports | tracker |
| High | ... | | |
| Medium | [domain] {gap} | — | LLM synthesis |

## Already Covered

Skills named in report gaps but present in your CV/profile: {excludedAsKnown list}.
(If one of these genuinely IS a gap — e.g. the CV overstates it — tell me and I'll re-run without it.)

## Diff vs Previous Report

{See Step 4 — omit section if no previous report}

## Suggested Order

{Top 3–5 gaps, ordered by tier then weighted score, one line each on why it's first/second/third. No fabricated resources or time estimates — the learning plan ships in phase 2.}
```

## Step 4 — Diff vs Previous Report

Find the newest existing `data/upskill/report-*.md` (by filename date) from before today.

- If none exists, omit the diff section.
- If its `**Schema:**` line differs from the current `schema_version`, say so and skip the comparison ("previous report used schema v{X} — not comparable") instead of reporting spurious closures.
- Otherwise compare heatmap skill lists: **closed** (was a gap, now absent or excludedAsKnown — the loop closing), **new** (appeared this run), **still open** (in both). Example: "Since 2026-06-01: Kubernetes gap closed, CI/CD still open, Airflow new."

## Step 5 — Present Summary

Condensed version in chat:
1. One-line stat ("{N} reports, {M} distinct gaps, top tier: {skill}")
2. Top 3 gaps with their evidence sentence
3. Diff highlights if Step 4 ran
4. Link to the full report

Then offer the loop-closing action:

> "If you've since gained any of these skills, tell me — I'll add them to `cv.md`/`config/profile.yml`, and the next run will show the gap closing."

## Rules

- **Output is user layer** (`data/upskill/`) — never write gap analysis into system files.
- **A skill present in `cv.md`/`config/profile.yml` never appears as a gap.** If the user disputes an exclusion, fix the source files, not the report.
- Gap evidence must cite its source (tracker counts or "LLM synthesis") — never present synthesized gaps as measured ones.
- This mode reads reports and the CV; it never fabricates skills the user "should" have from outside the tracked evidence.
