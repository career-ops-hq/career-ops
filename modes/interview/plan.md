# Mode: interview/plan — Interview Prep Planner

Given a job description and interview date/time, build a structured, time-blocked preparation plan tailored to the candidate's specific gaps.

---

## Inputs

1. **Job description** (required) — paste inline or provide URL
2. **Interview date and time** (required) — to calculate hours available
3. **Interviewer name and role** (if known) — shapes depth and tone of prep
4. **Round type** (if known) — screening, technical/domain-specific, design/case study, behavioral panel
5. **CV** at `cv.md` + `article-digest.md` (if present) — read for experience, skills, proof points
6. **Profile** at `config/profile.yml` + `modes/_profile.md` — read for narrative, archetypes, and targets
7. **Story bank** at `interview-prep/story-bank.md` — existing STAR+R stories
8. **Question bank** at `interview-prep/question-bank.md` — existing gaps (if file exists)

---

## Step 1 — Fit Assessment

Read CV and JD. Produce a two-column assessment:

**Strengths to anchor on:** experience, titles, domain, proof points that directly match the JD.

**Gaps to close:** skills, tools, or experience called out in JD that are absent or weak in CV. Rank by likelihood of being tested in this specific round type.

Be honest. A gap is a gap — flag it clearly so prep time goes to the right places.

---

## Step 2 — Round Intelligence

Identify what this round is actually evaluating based on:
- Interviewer role (manager = communication + passion + fundamentals; practitioner = depth + judgment)
- Round label (screening, technical/domain, design/case study, final)
- JD signals (what they emphasize)

**Recruiter screen:**
- Box-checking: fit, comp alignment, logistics, communication
- Not a technical test — depth questions come in the HM and later rounds
- Likely: background pitch, "why us/why this role", comp expectation, timeline, one logistical question
- Treat this as the easy checkpoint; use prep time to build the foundation for what comes after

**Hiring-manager screen:**
- Communication, passion, fit — plus leadership philosophy and judgment
- Fundamentals of the core skill in the JD — not deep internals
- 1–2 behavioral stories
- Likely: background, "why us", one core concept from the JD, one leadership story, forward-looking situational question

**Technical / domain deep-dive with a practitioner:**
- Depth in the core skill from the JD (e.g., runtime internals for engineering, modeling choices for data, valuation methods for finance)
- Applied scenarios from the role's day-to-day
- Live exercise or worked walkthrough possible
- Stories used as evidence, not the main event

**Design / case study panel:**
- Full solution — constraints, components, tradeoffs, failure modes
- The quality dimensions the JD emphasizes (e.g., scalability, compliance, measurability)
- Senior-level: set constraints, ask clarifying questions, drive the conversation

Calibrate the plan to the round. Over-preparing depth for a screening wastes time and creates the wrong mindset.

---

## Step 3 — Build the Time-Blocked Plan

Calculate hours available from now until interview time. Divide into blocks:

Before sizing the blocks, check `interview-prep/question-bank.md` (if it exists). Any question marked 🔴 from a prior round is a proven gap — it gets a dedicated block regardless of how the CV-vs-JD analysis ranks it. Real performance data outranks inferred risk.

**Template (adjust block sizes based on total hours available):**

```
Block 1 — Lock your narrative (first, always)
  - Write out your background timeline explicitly
  - Prepare "why this company" with a specific connection to your history
  - Prepare your strongest proof point story (30-second version)
  - Time: ~15% of available hours

Block 2 — Priority domain topic (highest-risk gap first)
  - One topic per block — don't mix
  - For each: concept → your story hook → likely follow-up questions
  - Time: ~25% of available hours

Block 3 — Secondary domain topic
  - Second-highest-risk gap
  - Time: ~20% of available hours

Block 4 — Behavioral stories
  - Map existing stories to likely question types
  - Practice the 2-minute verbal version of each
  - Prepare the Reflection for each — the senior-candidate differentiator
  - Time: ~15% of available hours

Block 5 — Company research
  - Product pages relevant to the role
  - Connection between your history and their specific domain
  - 3–4 sharp questions to ask them
  - Time: ~10% of available hours

Block 6 — Practice run (if time permits)
  - One question per likely topic — out loud, timed
  - Time: ~10% of available hours

Block 7 — Buffer + rest
  - Stop studying 60–90 minutes before the interview
  - Cramming in the last hour adds noise, not signal
  - Time: remaining
```

Adjust block sizes based on gap severity and round type. If it's a screening, Block 4 (behavioral) and Block 5 (company research) are more important than deep domain blocks.

---

## Step 4 — Priority Quick-Reference

At the end of the plan, produce a one-page quick-reference the candidate can skim 15 minutes before the interview:

```markdown
## 15-Minute Pre-Interview Review

**Your anchor sentence:** [one sentence that captures why you're right for this role]

**Top 3 things to remember:**
1. [most important message to leave the interviewer with]
2. [most likely question and your first sentence of the answer]
3. [the connection between your history and their domain]

**Your questions to ask:**
1. [question 1]
2. [question 2]
3. [question 3]
```

---

## Step 5 — Save Output

Save the plan to `interview-prep/{company-slug}-{role-slug}.md` if a file doesn't exist, or append a `## Prep Plan` section if it does.

---

## Rules

- **Calibrate to the round.** A screening prep plan looks very different from a design-panel prep plan. Don't default to maximum depth for every interview.
- **Gaps first.** Time is finite. The candidate's strengths don't need prep — their gaps do.
- **🔴 gaps from the question bank take priority over inferred gaps.** Real performance data beats CV-vs-JD analysis. If the candidate already knows they struggle on a topic, don't bury it.
- **One topic per block.** Mixing topics in a single block reduces retention.
- **Always include rest time.** A rested candidate outperforms a cramming one.
- **Never generate fake company intel.** If you don't have research, say so — don't invent culture claims or technical details about the company.
- **Never invent claims for the candidate.** The anchor sentence and pre-interview talking points in the quick-reference (Step 4) must be grounded in what the candidate actually has — `cv.md`, `article-digest.md`, or the story bank. Don't draft claims that depend on experience or metrics the candidate doesn't have. If a claim appears in `interview-prep/retracted-claims.md`, never include it.
