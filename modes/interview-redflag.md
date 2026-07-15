# Mode: interview-redflag — Company Red-Flag Detector

## Purpose

Analyse the **interviewer's side** of session transcripts to surface structural red flags about a company before the candidate accepts an offer or re-applies. Complements `patterns` (tracker-level win/loss) and `#960` / `realign-targeting` (candidate-side answer clustering).

This mode answers: *"Even if I win this process — is this company safe to join?"*

## Dependency

Requires transcripts produced by `modes/interview/debrief.md` or `modes/interview/practice.md` (#956). Each transcript must be saved under `interview-prep/sessions/` (gitignored). If no session files exist, exit gracefully with an onboarding message.

## Inputs

- `interview-prep/sessions/` — Session transcripts (debrief + practice outputs). One file per round.
- `interview-prep/{company}-{role}.md` — Company intel file (for context + output target).
- `config/profile.yml` — User profile (for role/archetype context).

Expected transcript filename convention (from #956):
```
{company-slug}-{role-slug}-{round}-{YYYY-MM-DD}.md
```

## Minimum Threshold

Check: does `interview-prep/sessions/` contain at least **1** file?

If not:
> "No session transcripts found yet. Run `/career-ops interview` on a role after your next interview to generate a debrief, then come back to check for red flags."

Exit gracefully.

## Step 1 — Discover Sessions

List all `.md` files in `interview-prep/sessions/`. Parse each filename using the `YYYY-MM-DD` date segment as the anchor:

```
{company-slug}-{role-slug}-{round}-{YYYY-MM-DD}.md
         ↑            ↑        ↑          ↑
 everything     segment    round      date anchor
 before round   immediately label      (trailing)
                before round
```

- `YYYY-MM-DD` is the anchor — find the date, work left from it.
- `round` = segment immediately before the date anchor.
- `company+role` = everything before `round`.

Example: `acme-corp-swe-hr-2024-01-15.md` → company=`acme-corp`, role=`swe`, round=`hr`, date=`2024-01-15`.

Group files by `{company-slug}`. For each company group, note:
- Number of rounds on file
- Date range of sessions
- Role slugs covered (a company may have sessions across multiple roles)

## Step 2 — Classify Interviewer Signals Per Session

For each transcript, read **only the interviewer's turns** (lines attributed to the interviewer, moderator, or prefixed with role labels). Ignore candidate turns for this pass.

Mark each of the four signal types as **present** or **absent** for the session. A signal is present if it is directly observable in the transcript — do not infer. Single occurrence within a session is sufficient to mark it present; noise filtering happens at the company-level aggregation step (Step 3).

### Signal taxonomy

| Signal | What to look for |
|--------|-----------------|
| **Scope ambiguity** | Questions with no measurable criteria ("tell me about yourself, anything really"; "just talk us through whatever you think is relevant"); no definition of what a good answer looks like; role responsibilities described in circular or contradictory terms across interviewers |
| **Defensive closure** | Interviewer shortens or redirects after a technically complete / superior candidate answer; follow-up probes absent when answer exceeds expectations; session ends abruptly after candidate gives a comprehensive response without probing further |
| **Evaluator competency gap** | Interviewer cannot engage with a domain-correct answer (silence, non-sequitur follow-up, pivot to unrelated topic); senior interviewer asks questions whose framing reveals unfamiliarity with the candidate's stated domain |
| **Process signals** | Contradictory criteria across interviewers in the same company; structured follow-up absent across all rounds; interviewers visibly unaware of previous round's content; evaluation criteria shift mid-session |

Record which signals are present per session. Do not infer — only flag what is explicitly observable in the transcript text.

## Step 3 — Aggregate Per Company

For each company, count how many sessions triggered each signal type.

Compute a **red-flag score**:
- Each signal type present in **1 session**: +1
- Each signal type present in **2+ sessions** (pattern, not noise): +2
- Maximum possible: 8 (4 signal types × 2)

## Step 4 — Assign Warning Level

| Score | Level | Label |
|-------|-------|-------|
| 0–1 | None | No structural red flags detected |
| 2–3 | Caution | `⚠️ Enter with eyes open` |
| 4+ | Warning | `🚩 Reconsider` |

## Step 5 — Generate Output

**Output routing:** Red-flag analysis is company-wide (signals aggregate across rounds regardless of role). Write to a single company-level file: `interview-prep/{company-slug}-redflags.md`. Create it if absent. If sessions span multiple role slugs, note all roles in the header. Do not append to per-role intel files — those are role-specific, this is company-specific.

Write the following structure:

```markdown
# Red-Flag Analysis — {Company}

**Roles covered:** {role-slug(s)}
**Sessions analysed:** {N} round(s) — {date range}
**Warning level:** {emoji} {label}

### Signals detected

| Signal | Sessions | Severity |
|--------|----------|----------|
| Scope ambiguity | {n}/{total} | {single/pattern} |
| Defensive closure | {n}/{total} | {single/pattern} |
| Evaluator competency gap | {n}/{total} | {single/pattern} |
| Process signals | {n}/{total} | {single/pattern} |

### What this means

{1–3 sentences interpreting the pattern in plain language. What specifically did the interviewers do? What does this predict about the role? Be direct — if the signal predicts the candidate will absorb undefined responsibility, say so.}

### Recommended action

{One of:
- "No action needed — proceed."
- "Before accepting: clarify [specific scope/responsibility] in writing."
- "Before accepting: ask [specific questions] to verify the concern."
- "Reconsider: the pattern across {N} rounds suggests [specific risk]."}

*Analysis based on interviewer behaviour only. Candidate decides.*
```

## Step 6 — Present Summary

After writing the file, show the user:

```
Red-Flag Analysis — {Company}
──────────────────────────────
Rounds analysed: {N}
Warning level:   {emoji} {label}

Signals:
  • {signal}: {n}/{total} sessions {(pattern) if 2+}
  ...

→ Full analysis written to interview-prep/{company-slug}-redflags.md
```

If multiple companies were analysed in one run, show a summary table:

```
Company          Rounds   Level
──────────────── ──────   ─────────────────────────
{Company A}      3        🚩 Reconsider
{Company B}      1        ⚠️ Enter with eyes open
{Company C}      2        No red flags
```

## Scope / Non-Goals

- **No auto-action** — never edits `portals.yml`, `modes/_profile.md`, or `data/applications.md`. Advisory only.
- **No new dependencies** — prompt-level analysis over local files.
- **Privacy** — reads only local, gitignored session files. Nothing leaves the machine.
- **Not a Glassdoor replacement** — analyses this candidate's live experience in this process, not crowd-sourced opinion.
- **Candidate-side analysis is out of scope** — use `realign-targeting` (#960) for that.
