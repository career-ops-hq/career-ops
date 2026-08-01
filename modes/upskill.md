# Mode: upskill -- Aggregate Skill-Gap Analysis

## Purpose

After dozens of evaluations, the tracker holds dozens of verdicts — and no aggregate reading. Every low-scoring evaluation names the skills the candidate was missing. This mode turns that discard history into an answer to the question every job seeker asks: **what should I learn, in what order?**

Phase 1 (this mode): aggregate gap map from tracked reports, with an optional LLM synthesis pass and a diff against the previous run. Phase 2b adds a **web-searched learning plan** — free-first resources per gap, grounded in live search results — layered on top of the same gap map (Step 3; trust model in Rules).

**Targeted mode** (`node upskill.mjs --url-text <url-or-file>`, #1739) analyses a *single* JD instead of the tracked history: it extracts the JD's required skills, suppresses the ones already in `cv.md`/`config/profile.yml`, and prints the remaining gaps as JSON (`{ mode: "targeted", gaps, excludedAsKnown, knownSkills }`). Known-skill suppression uses the same canonical extraction as the aggregate path, so a CV skill is never reported as a gap and a real gap is never hidden. `--url-text` accepts either an `http(s)` URL (Playwright, then a redirect-refusing fetch fallback) or a local file path. The web-searched learning plan (Step 3, #1740) is generated for the aggregate report; the targeted single-JD path prints gaps only.

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
| `schema_version` | Extraction-rule version. The diff section (Step 5) only compares reports with the same version. |
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

## Step 3 — Build the Learning Plan (web-searched resources)

Turn the eligible gaps into a resourced, actionable plan. This section is **purely additive**: if it can't be grounded in live web-search results, skip it — the heatmap, Already Covered, and Suggested Order all still ship without it (see the trust model in Rules).

**Which gaps get a plan** (read tiers straight from the Step 1 JSON `tier` field — never re-derive them):
- Every **Critical** and every **High** gap.
- **Medium** gaps too, but *only if* the total distinct gap count is **< 5** (`gaps.length` plus any `LLM synthesis` gaps from Step 2). On larger maps, Medium is out of the plan's scope.

**For each eligible gap, produce:**
1. **2–3 free-first resources.** Each is a name + URL + one-line "why this one". Every resource MUST come from an actual web-search result — include the current year in the query (e.g. `learn Kubernetes free course 2026`) — never invented from memory.
2. **A study direction** tailored to what the CV already covers: anchor the new skill to an adjacent strength the candidate already has (e.g. "you already ship FastAPI services, so start from deploying one on Kubernetes, not container basics").
3. **An effort bucket** — `~hours` / `~days` / `~weeks` — taken ONLY from a resource's own stated length. Never estimate or invent it; omit the bucket if no resource states a length.

**Study order** (within and across gaps): dependencies first, quick wins early (Docker before Kubernetes; a 2-hour primer before a 6-week course).

**Search, budget, and liveness** (the full trust model is frozen in Rules):
- Hard search budget: **max 2 searches per gap**, capped at **~12 searches per aggregate run**; always include the current year in the query.
- **Write-time URL liveness:** liveness-check every cited URL at generation time using the check-liveness pattern (`node check-liveness.mjs <url> ...`, backed by `liveness-core.mjs`). Dead links never enter the report.
- **Free-first with explicit failure:** if no free option surfaces for a gap, the plan SAYS so — it never silently substitutes a paid resource.
- **Scope boundary:** the plan LINKS each resource to `/career-ops training {name}` for a full judging pass; it never runs training's 6-dimension scoring itself. `upskill` finds; `training` judges.

Embed the result as the `## Learning Plan` section of the report (Step 4 template), positioned just below `## Suggested Order` — Suggested Order sequences the gaps, the plan then resources each one.

## Step 4 — Generate Report

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

{See Step 5 — omit section if no previous report}

## Suggested Order

{Top 3–5 gaps, ordered by tier then weighted score, one line each on why it's first/second/third. This is sequencing only — the resources live in the Learning Plan below.}

## Learning Plan

_Resources below are web-searched fresh every run — never version-controlled, diffed, or re-validated across reports; only the gap tiers above are stable between runs. Every URL was liveness-checked at generation ({YYYY-MM-DD}); links still rot over time, so re-run for a current set._

{If web search was unavailable, weak, or you're on a cheap model, replace this whole section with one line and nothing else: "Learning Plan skipped — no live web-search results available this run; the gap heatmap and Suggested Order above stand on their own." Never invent resources from memory.}

### {Tier} — {skill}
**Study direction:** {one line anchored to a strength already on the CV}
**Effort:** {~hours | ~days | ~weeks — from a resource's own stated length; omit this line if none is stated}

- [{Resource name}]({URL}) — {one-line why}. (free)
- [{Resource name}]({URL}) — {one-line why}. (free)
- [{Resource name}]({URL}) — {one-line why}. (paid — only if no free option exists)

→ To judge one of these against your profile, run `/career-ops training {resource name}`.

{If no free resource surfaced for a gap, say so explicitly rather than silently substituting a paid one: "No free resource found for {skill} this run — only paid options surfaced (listed for transparency)."}
```

## Step 5 — Diff vs Previous Report

Find the newest existing `data/upskill/report-*.md` (by filename date) from before today.

- If none exists, omit the diff section.
- If its `**Schema:**` line differs from the current `schema_version`, say so and skip the comparison ("previous report used schema v{X} — not comparable") instead of reporting spurious closures.
- Otherwise compare heatmap skill lists: **closed** (was a gap, now absent or excludedAsKnown — the loop closing), **new** (appeared this run), **still open** (in both). Example: "Since 2026-06-01: Kubernetes gap closed, CI/CD still open, Airflow new."

## Step 6 — Present Summary

Condensed version in chat:
1. One-line stat ("{N} reports, {M} distinct gaps, top tier: {skill}")
2. Top 3 gaps with their evidence sentence
3. Diff highlights if Step 5 ran
4. Link to the full report

Then offer the loop-closing action:

> "If you've since gained any of these skills, tell me — I'll add them to `cv.md`/`config/profile.yml`, and the next run will show the gap closing."

## Rules

- **Output is user layer** (`data/upskill/`) — never write gap analysis into system files.
- **A skill present in `cv.md`/`config/profile.yml` never appears as a gap.** If the user disputes an exclusion, fix the source files, not the report.
- Gap evidence must cite its source (tracker counts or "LLM synthesis") — never present synthesized gaps as measured ones.
- This mode reads reports and the CV; it never fabricates skills the user "should" have from outside the tracked evidence.

### Learning Plan — Trust Model (Step 3)

These eight rules are non-negotiable; each is frozen as a CI assertion so a future edit can't silently drop a guarantee.

1. **Search-result-or-nothing (grounding).** Every resource must come from an actual web-search result — never invented from memory. On a cheap model, or when WebSearch is unavailable or weak, **skip the Learning Plan section and say so explicitly** in the report.
2. **Deterministic degradation.** When search is skipped or weak, the heatmap + Suggested Order still ship WITHOUT resources and the report states why — the plan is purely additive, so its absence never breaks the rest of the report.
3. **Ephemeral / non-versioned resources.** Resources are regenerated fresh every run, never diffed, never revalidated across runs; only gap-tier changes are stable across reports. The report carries a one-line disclaimer stating this.
4. **Write-time URL liveness.** Every cited URL gets a cheap liveness check at generation using the check-liveness pattern (`check-liveness.mjs` / `liveness-core.mjs`); dead links never enter the report, and the artifact carries a one-line staleness disclaimer.
5. **Hard search budget.** Max 2 searches per gap, capped at ~12 searches per aggregate run; always include the current year in queries.
6. **Free-first with explicit failure.** If no free option is found for a gap, the plan SAYS so — it never silently substitutes a paid resource.
7. **Effort from stated length only.** Effort estimates come only from the resource's own stated length — never invented.
8. **Scope boundary.** Plan entries link to `/career-ops training {name}` for judging a specific resource; the plan itself never runs training's 6-dimension scoring. `upskill` finds; `training` judges.
