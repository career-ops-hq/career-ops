# Mode: interview-redflag — Company Red-Flag Detector

## Purpose

Analyse the **interviewer's side** of session transcripts to surface structural red flags about a company before the candidate accepts an offer or re-applies. Complements `patterns` (tracker-level win/loss) and `#960` / `realign-targeting` (candidate-side answer clustering).

This mode answers: *"Even if I win this process — is this company safe to join?"*

## Dependency

Requires transcripts produced by `modes/interview/debrief.md` or `modes/interview/practice.md` (#956). Each transcript must be saved under `interview-prep/sessions/` (gitignored). If no session files exist, exit gracefully with an onboarding message.

## Inputs

- `interview-prep/sessions/` — Session transcripts (debrief + practice outputs). One file per round.
- `interview-prep/{company}-{role}.md` — Company intel file (for context + output target).
- `config/profile.yml` — User profile (for role/archetype context, and for the candidate's location → jurisdiction derivation used by Step 2c).
- `templates/protected-grounds.yml` — Jurisdiction-keyed table of protected grounds / do-not-ask topics in hiring (for Step 2c only). A data reference, not instruction logic — adding a jurisdiction row there never requires touching this mode. Reading it is a local file lookup; nothing leaves the machine.
- **Original JD text (user-provided, for Step 2b only)** — the posted job description for the role under analysis. Same "user-provided input, not automated scraping" pattern used elsewhere in this codebase (e.g. `jd-skill-gap.mjs`): paste it, or point at `local:jds/{file}` if it's already saved under `jds/`. Without it, Step 2b is skipped — every other step runs as normal.

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

## Step 2b — Detect Scope/Compensation Mismatch (requires JD text)

This is a **separate, fifth dimension** — distinct from the four interviewer-behaviour signals above. It doesn't measure how the interviewer conducted the session; it measures whether what they *asked about* matches what the company *posted and priced* the role at. It only runs if the user has supplied the original JD text (see Inputs). If not supplied, skip this step entirely — it does not block or degrade Steps 2–6.

Check, per session:

0. **Role match (gate, run first)** — confirm the session's role slug (from the filename pattern in Step 1) matches the role the supplied JD is for. The mode can analyze multiple role slugs for one company, but the supplied JD is for a single role — a session for a different role must never be compared against it. If the match can't be confirmed explicitly (ambiguous slug, JD role unclear, or the user hasn't stated which role the JD is for), **skip this session for Step 2b entirely** — do not run conditions 1–2 below on it, and do not guess.

1. **Off-JD topic** — did the interviewer ask about a specific skill, tool, or scope of responsibility that has **zero textual grounding anywhere in the JD** (not a rephrasing, not an adjacent/implied skill — genuinely absent from the posted text)? Quote the JD and the transcript question side by side to confirm before flagging; do not infer an absence you haven't checked.
2. **Entry-level/junior framing** — does the JD title or body label the role entry-level, junior, associate, coordinator-tier, or similar, **and** is there an **explicit** benchmark establishing the posted pay band as low-end for that title/market — either the JD itself states a specific pay figure alongside the entry-level/junior/associate/coordinator-tier label, or the user's own notes explicitly classify it as below market for that title (e.g. "this is below market for a coordinator role")? **Never estimate or infer market compensation yourself.** If no such explicit benchmark or classification is present in the JD text or the user's notes, treat this condition as unmet — do not flag the mismatch on the basis of an inferred or assumed market rate.

Flag **Scope/Compensation Mismatch** only when all conditions hold for the same session: the session's role is confirmed to match the supplied JD (condition 0), an off-JD topic surfaced (condition 1), during a JD-labeled entry-level/junior/associate/coordinator-tier role with an explicit low-band pay benchmark (condition 2).

**This signal is corroboration-sensitive, not a count-and-threshold signal like the four above.** A single instance is a data point, not a pattern — say so plainly in the output. If the user has a coffee chat note or other independent source for the same company (the Coffee Chat Cross-Reference in modes/interview-prep.md — a sibling to this one), check whether it corroborates that the off-JD topic is something the company consistently screens for. Corroboration changes the framing from "isolated tangent" to "observed pattern" — reflect that distinction explicitly rather than folding it into a score.

**Multiple sessions may qualify.** Evaluate every session independently against conditions 0–2; do not stop at the first match. Carry forward every qualifying session (round, date, off-JD topic, JD context including the seniority label actually captured, evidence strength) into Step 5/6 — see the aggregation rule there.

## Step 2c — Detect Protected-Grounds Questions (#2030)

The most codified red flag an interviewer can produce is a question touching a topic the candidate's jurisdiction explicitly protects or lists as do-not-ask in hiring. This is a **fifth signal inside the existing machinery** — it reuses Step 2's per-session present/absent marking, Step 3's aggregation and scoring, Step 4's verdict tiers, and the Step 5 blacklist-suggestion bridge (#1856). It does not create a new verdict system, a new score, or a parallel output pipeline.

**Jurisdiction derivation (same as the #2026 series siblings):** derive the candidate's jurisdiction from their location in `config/profile.yml`, then look up the matching row in `templates/protected-grounds.yml`. If the table has no row for the jurisdiction, skip this step entirely — no guessing, no applying another jurisdiction's list. The table is a data reference: every row carries a `legal_basis`, per-ground `legitimate_contexts` where they exist, `sources`, and an `as_of` verification date.

**Detection (per session, interviewer turns only):** mark a question as an **observation** when it matches a protected-ground topic for the jurisdiction — by topic, not by exact wording (the table's `example_question_patterns` are regulator-drawn illustrations, not an exhaustive matcher). Match in either language where the row carries bilingual terms (e.g. the JP row's Japanese terms + English glosses — this composes with the market vocabulary modes such as `modes/ja`). Record: the ground/topic, the interviewer's question **quoted verbatim from the transcript**, and the row's `legal_basis` line. Topic match + quote + legal context only — **no sentiment or intent inference about the interviewer, ever.**

**`legitimate_contexts` honesty (run before anything is flagged):** if a context from the ground's `legitimate_contexts` plausibly applies — a bona fide occupational requirement fits the role (e.g. OHRC s.24(1) special employment), the exchange is an employer-initiated accommodation discussion, or the process is at a post-conditional-offer stage where the inquiry becomes permissible — the output **names that context instead of flagging cleanly**, and the observation never counts toward the signal below. Honest uncertainty beats a false flag.

**Evidence tiers (the mode's existing single-vs-pattern weighing, applied here):**

- **Single borderline question in a session** = a low-confidence observation. Report it (ground + quote + legal basis) but do **not** mark the signal present for that session. Regulator enforcement data supports this humility: MHLW's own fair-hiring reports show family questions dominate and are typically asked carelessly to soften the interview atmosphere, not maliciously — and the candidate often doesn't register the question as improper in the moment, which is exactly why this post-interview check exists.
- **Signal present for a session** = repeated probing of the same ground within the session, or questions touching **2+ distinct grounds** in the session. This clears the corroboration bar the same way Step 2's other signals treat pattern-vs-noise.
- Once present, the signal aggregates in Step 3 **exactly like the four existing signals** (+1 for one session, +2 for 2+ sessions) and contributes to the existing verdict tiers — including, at `🚩 Reconsider`, the existing blacklist-suggestion sub-block. A pattern of protected-ground probing is precisely the kind of reason line that sub-block was built for.

**Phrasing discipline (HARD RULE, series-standard):** state the topic match and the legal context — never a legal verdict. The template for each reported observation:

> [Render in {language.output}: "this question touches {ground}, protected under {legal basis line from the table row}" — followed by the verbatim quote and, if one applies, the named legitimate context. E.g., for a fictional Acme Corp interview in Ontario: "This question touches family status, a ground protected under Ontario's Human Rights Code s.5(1) in employment: 'Do you have kids? Who watches them when you travel?'" Or, for a fictional Japanese exchange: "This question touches 尊敬する人物 (respected persons), an item on MHLW's fair-hiring do-not-ask list (Employment Security Act art. 5-5 + 1999 guideline): '尊敬する人物は誰ですか？' — a routine icebreaker in North America, listed guidance in Japan." Close with a note that whether any specific exchange crossed a legal line depends on context the transcript cannot self-certify, and that this is not legal advice.]

Banned formulations, everywhere in the output: "the interviewer broke the law", "this was illegal", "this question was unlawful", "discrimination occurred". Whether a legal line was crossed depends on intent, BFOR facts, accommodation context, and process stage — none of which a transcript can self-certify. Each row's `legal_basis` also fixes the register: the JP row is administrative guidance backed by statute with active Labour Bureau correction ("on MHLW's do-not-ask list"), not a criminal-law claim.

## Step 3 — Aggregate Per Company

For each company, count how many sessions triggered each signal type.

Compute a **red-flag score**:
- Each signal type present in **1 session**: +1
- Each signal type present in **2+ sessions** (pattern, not noise): +2
- Maximum possible: 10 (5 signal types × 2 — the four Step 2 signals plus the Step 2c protected-grounds signal, which counts only for sessions where it cleared its corroboration bar; low-confidence single observations are reported but score 0)

**Scope/Compensation Mismatch (Step 2b) is reported separately and does not feed the red-flag score above.** It's a different category of finding — JD-completeness and pay fairness, not interviewer conduct — and, unlike the four signals above, it's discovered *after* the fact rather than protecting the candidate in the process that produced it. Mixing it into the same 0–10 scale would overstate or understate it depending on session count for reasons unrelated to what it actually measures. Report it in its own output section (Step 5) instead.

## Step 4 — Assign Warning Level

| Score | Level | Label |
|-------|-------|-------|
| 0–1 | None | No structural red flags detected |
| 2–3 | Caution | `⚠️ Enter with eyes open` |
| 4+ | Warning | `🚩 Reconsider` |

## Step 5 — Generate Output

**Output routing:** Red-flag analysis is company-wide (signals aggregate across rounds regardless of role). Write to a single company-level file: `interview-prep/{company-slug}-redflags.md`. Create it if absent. If sessions span multiple role slugs, note all roles in the header. Do not append to per-role intel files — those are role-specific, this is company-specific. This file is cross-referenced by the evaluation report's `## Risk Summary` block (see `modes/oferta.md`), which surfaces its warning level plus a relative link — keep the `**Warning level:**` line intact.

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
| Protected-grounds questions (Step 2c) | {n}/{total} | {single/pattern} |

### What this means

{1–3 sentences interpreting the pattern in plain language. What specifically did the interviewers do? What does this predict about the role? Be direct — if the signal predicts the candidate will absorb undefined responsibility, say so.}

### Recommended action

{One of:
- "No action needed — proceed."
- "Before accepting: clarify [specific scope/responsibility] in writing."
- "Before accepting: ask [specific questions] to verify the concern."
- "Reconsider: the pattern across {N} rounds suggests [specific risk]."}

{If Warning level is 🚩 Reconsider (score 4+), append a blacklist suggestion sub-block. Synthesize the one-line reason from the signal table in Step 3/4 — name the specific pattern(s) at 2+ sessions, not a generic label. This is a suggestion only: present the row in `data/blacklist.md`'s table format so the user can copy it in themselves. Never write to `data/blacklist.md`. Render the heading and instructional sentences in `{language.output}` per the project's language-mode rules (see AGENTS.md § "Output Language vs Market Modes") — only the table's column headers (`Company | Since | Scope | Reason`) and the literal `company` scope value stay fixed, since they must match `data/blacklist.md`'s actual file format regardless of output language.

#### Consider adding to blacklist [heading — render in {language.output}]

[Render in {language.output}: an instruction telling the user that if they agree with this assessment, they should copy the row below into `data/blacklist.md` (see `templates/blacklist.example.md` for the file's column format).]

| Company | Since | Scope | Reason |
|---------|-------|-------|--------|
| {Company} | {today's date, YYYY-MM-DD} | company | {1-line reason drawn from the Step 3/4 signal breakdown, e.g. "2+ rounds: defensive closure + evaluator competency gap"} |

[Render in {language.output}: a note that this is a suggestion only — nothing is written to `data/blacklist.md` automatically.]}

*Analysis based on interviewer behaviour only. Candidate decides.*
```

**If Step 2b flagged one or more Scope/Compensation Mismatches**, append this section (omit entirely if Step 2b was skipped or found nothing across all sessions):

```markdown
### Scope/Compensation Mismatch

{One entry per qualifying session, most recent first. Do not collapse multiple sessions into a single entry — each qualifying session gets its own full entry below.}

#### {round} ({date})

**Off-JD topic asked about:** {specific skill/topic}, absent from the posted JD text for {role}.
**JD context:** posted as {the actual seniority label captured in Step 2b — junior / associate / coordinator-tier / entry-level / etc.}; compensation evidence: {exact JD pay figure/band if the JD stated one, otherwise the exact user-notes below-market benchmark or classification that qualified condition 2 — never invent or estimate a pay band}.

{1–2 sentences, descriptive not accusatory: what was asked, and how it sits outside the JD's stated scope and pay level. E.g. "The interviewer asked directly about workflow automation experience — a skill not mentioned anywhere in the JD, which is posted as a coordinator-tier, non-technical role at the low end of its stated band."}

**Evidence strength:** {"Single instance — one data point, not yet a pattern. Treat as an open question, not a conclusion." OR, if a coffee chat or other independent source corroborates it: "Corroborated by [coffee chat note / other source] — this reads as something the company consistently screens for, not an isolated tangent."}

{repeat the #### block above for each additional qualifying session}

*This does not feed the red-flag score above — it's a separate JD-completeness/pay-fairness observation, not a measure of interviewer conduct.*
```

**If Step 2c produced any observations** (low-confidence singles included), append this section (omit entirely if Step 2c was skipped — no jurisdiction row — or found nothing):

```markdown
### Protected-grounds questions ({jurisdiction_name})

{One entry per observation, grouped by session, most recent first.}

#### {round} ({date})

**Ground/topic:** {ground from templates/protected-grounds.yml}
**Question (verbatim):** "{quoted interviewer question}"
**Legal context:** [Render in {language.output}: "this question touches {ground}, protected under {legal basis line from the table row}" — never "the interviewer broke the law" / "this was illegal" / "discrimination occurred".]
{If a legitimate context plausibly applies: **Possible legitimate context:** [Render in {language.output}: name the specific context from the row's legitimate_contexts — e.g. BFOR, employer-initiated accommodation discussion, post-conditional-offer stage — and state that the observation is not flagged because of it.]}
**Evidence strength:** {"Single borderline question — low-confidence observation; regulator data says these are usually careless icebreakers, not malice. Reported, not scored." OR "Cleared the corroboration bar — {repeated probing of the same ground / N distinct grounds} in this session; counts toward the red-flag score above."}

{repeat per observation}

[Render in {language.output}: a closing note — whether any specific exchange crossed a legal line depends on intent, occupational-requirement facts, and process stage, none of which a transcript can self-certify. This is a private awareness aid, not legal advice; the table row was last verified on its as_of date and the law may have changed since.]
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
{If Step 2b flagged one or more sessions, list all of them here, most recent first — one bullet per qualifying session, do not collapse into a single line:
  • Scope/Compensation Mismatch: {round} ({date}) — {off-JD topic} asked at {the actual seniority label captured in Step 2b, e.g. junior/associate/coordinator-tier/entry-level} pay [{exact JD pay figure/band, or exact user-notes below-market benchmark/classification that qualified condition 2}] — {"single-instance observation" OR "corroborated by [coffee chat note / other source]"}
  ...}
{If Step 2c produced observations, one bullet per session with observations:
  • Protected-grounds questions: {round} ({date}) — {ground(s)} — {"low-confidence single observation" OR "pattern — counted in score" OR "possible legitimate context: {context}"}
  ...}

→ Full analysis written to interview-prep/{company-slug}-redflags.md
```

If the warning level is `🚩 Reconsider`, add one line noting the suggestion is in the file — do not repeat the full blacklist row in the console summary. Render this line in `{language.output}` (see AGENTS.md § "Output Language vs Market Modes"); only the file path is a fixed literal:

```text
→ [render in {language.output}, e.g. "Blacklist entry suggested — see"] interview-prep/{company-slug}-redflags.md
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

- **No auto-action** — never edits `portals.yml`, `modes/_profile.md`, `data/applications.md`, or `data/blacklist.md`. At `🚩 Reconsider`, the output suggests a ready-to-copy blacklist row; the user (or their agent, on explicit instruction) still has to add it themselves. Advisory only.
- **No new dependencies** — prompt-level analysis over local files.
- **Privacy** — reads only local, gitignored session files. Nothing leaves the machine.
- **Not a Glassdoor replacement** — analyses this candidate's live experience in this process, not crowd-sourced opinion.
- **Candidate-side analysis is out of scope** — use `realign-targeting` (#960) for that.
- **Protected-grounds detection (Step 2c) is not legal advice** — a private post-interview awareness aid. It never drafts complaints, never asserts violations, never contacts anyone, and never infers interviewer sentiment or intent — topic match + verbatim quote + legal context from `templates/protected-grounds.yml` only. Transcript analysis only, consistent with this mode's existing design — no live-interview interruption. Jurisdictions without a table row are skipped, never guessed.
- **Scope/Compensation Mismatch (Step 2b) is descriptive, not actionable-in-the-moment** — by the time it's detected, the interview that produced it is already over, so it can't protect the candidate in that specific round. It's written to the company-level file as a record: if a later round with the same company happens, or the candidate considers re-applying, this is the place to check first. It is not fed automatically into `interview-prep/{company}-{role}.md` or any future prep step — the candidate re-reads it manually, the same way every other output of this mode is advisory-only.
