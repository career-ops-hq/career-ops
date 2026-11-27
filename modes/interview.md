# Mode: interview — Interactive Profile & CV Onboarding

When the user runs `/career-ops interview`, execute this interactive profile/CV interview flow.

The purpose of this mode is to conduct a conversational interview to extract rich context, specific project tasks, technologies used, and measurable business impact to build or enhance `cv.md`, `config/profile.yml`, and `modes/_profile.md`.

> **Non-negotiables (from the project's source-of-truth rules in `AGENTS.md`):**
> - **Confirm before write.** Never touch `cv.md` / `config/profile.yml` /
>   `modes/_profile.md` until the user approves the Step 5 preview.
> - **Never fabricate.** Every bullet, metric, and date must come from the user's
>   own words or a file they wrote. If the user doesn't know a number, it does
>   not go in. Keywords get reformulated, never invented.

---

**Unattended runs** (`modes/_shared.md` → **Unattended runs**): do not start. This mode asks one question at a time and has no default answers. End with `needs_confirmation: interactive_only interview - run /career-ops interview in a chat session`.

## Guidelines for the AI Agent

### 1. Load Baseline Context

- Read `cv.md` (if it exists) to understand the candidate's current professional profile.
- Read `config/profile.yml` (if it exists) to check current target roles, location settings, and compensation bounds.
- Read `modes/_profile.md` (if it exists) to examine existing target archetypes and narrative alignments.

### 2. Interview Structure & Tone

- Keep it professional, conversational, and direct. Avoid generic corporate fluff.
- **Rule: Ask exactly ONE question at a time.** Never present a wall of questions; wait for the user's response before asking the next question.
- Always prompt for **specifics**: tools/frameworks used, architecture decisions, and most importantly, **measurable outcomes** (percentages, revenue, performance gains, team size, cost savings).

---

## Step-by-Step Interview Flow

### Step 1: Target Roles & Ambitions

Ask the user about their immediate goals:
- What specific roles are they targeting?
- What are their target salary and total compensation expectations?
- What are their location preferences (remote, hybrid, on-site, geographic limits)?
- Note the target role titles, locations, and salary bounds for the Step 5 preview. Do not write `config/profile.yml` yet.

### Step 2: Experience & Core Achievements

Ask about their most significant professional achievements:
- Focus on the last 2-3 roles.
- For each role, ask: "What was your single most impactful achievement in this position, and what specific projects did you build to make it happen?"
- Extract: What tools/architecture were used?

### Step 3: Digging for Metrics (Business Impact)

Recruiters and ATS scanners look for quantifiable metrics. For the achievements and projects mentioned in Step 2:
- Ask: "What was the measurable outcome of this project? (e.g., % improvement, $ saved, latency reduction, user adoption numbers)"
- If the user doesn't know the figure, do not estimate one and do not offer a number for them to confirm. Keep the achievement unquantified, describe the outcome in their words, and note it as a missing metric for the Step 5 summary so they can add the figure later. Never put a placeholder in `cv.md`; it would reach generated CVs.

### Step 4: Uncovering Hidden Skills

Ask about adjacent experience or forgotten skills:
- "What tools, languages, or methodologies do you have experience with that aren't on your main resume?"
- "Any courses, certifications, side projects, or articles you have written recently?"

---

## Step 5 — Apply Updates

Once the interview is complete, or once enough new details have been collected:
1. **Preview.** Show, as a diff-style preview, the exact changes proposed for `cv.md`, `config/profile.yml`, and `modes/_profile.md`. List the achievements left unquantified.
2. **Confirm gate.** Ask the user to approve, edit, or cancel. Do **not** proceed
   without an explicit yes. Apply only what they approve.
3. **Update `cv.md`**: Update the professional summary, rewrite project bullet points to incorporate the new keywords and metrics, and append new skills.
4. **Update `config/profile.yml`**: Update the targets, compensation, and narrative sections.
5. **Update `modes/_profile.md`**: Map the new projects/proof points to the target archetypes and update the adaptive framing rules.
6. Run `node doctor.mjs` silently to verify project integrity.
7. Provide a summary of the files updated:
   > "✅ Interactive interview completed! Updated your profile:
   > - **CV**: Refined summaries and project bullets with new metrics.
   > - **Profile config**: Updated target roles and comp expectations.
   > - **Custom framing**: Integrated project mappings into _profile.md."

   End with the list of missing metrics, if any, so the user can add the figures to `cv.md` themselves.
