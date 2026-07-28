# Mode: cv-hm-audit — Hiring-Manager Audit of a Tailored CV

## Purpose

Put a tailored CV in front of an adversarial, research-grounded reviewer before it becomes a PDF.

The fact gate at `pdf` step 18 (`verify-cv-facts.mjs`) is **mechanical**: it diffs generated output against `cv.md` and `article-digest.md` to catch invented metrics. It cannot judge whether a truthful bullet is the *right* bullet — buried lede, wrong altitude, wrong vocabulary, or answering a requirement the JD never raised. This mode answers a different question: *"Would the person who screens this actually advance it?"*

Two properties are load-bearing, and neither works without the other:

1. **The reviewer is external.** A separate subagent — never the agent that wrote the bullets. An agent reviewing its own tailoring grades its own work and drifts toward summarising what it wrote instead of auditing it.
2. **The reviewer is research-grounded.** A docs lead, a VP Engineering, and a recruiter weigh the same bullet very differently. A generic "hiring manager" persona degrades into generic CV advice.

## Dependency

Requires a tailored CV produced by `modes/pdf.md`. If none exists for the company, stop and point the user at `pdf`.

**Never audit `cv.md` itself.** That is the untailored master; auditing it produces confidently wrong verdicts about a CV the user never intends to send.

## Inputs

1. **Role** — a report number or company slug. If omitted, use the most recent evaluated role (same argument pattern as `cover`).
2. **Report** at `reports/{num}-{company}-{date}.md` — read for the `**URL:**` header, archetype, and identified gaps.
3. **JD** at `jds/{slug}.md`, or fetched from the report's `**URL:**`.
4. **Tailored bullets** — read `/tmp/cv-{candidate}-{company}.json` if it still exists (clean `experience[].bullets[]` iteration). If it is gone, extract the `<li>` items from the newest `output/cv-*-{company}.html`. Never parse the `.pdf`.
5. **Factual floor** — run `node jd-skill-gap.mjs` for the zero-LLM classification of every JD requirement into `existing` / `supportedByResume` / `gap`.
6. **Scope of truth** — `cv.md`, `article-digest.md`, `config/profile.yml`, `modes/_profile.md`. These bound what the reviewer may recommend.

## Step 1 — Gather

Resolve the role to a report. Locate the tailored CV artifact per Input 4. Run `jd-skill-gap.mjs`. Load the scope-of-truth files.

If the tailored CV is missing, stop here with: *"No tailored CV found for {company}. Run `/career-ops pdf` first — auditing the untailored `cv.md` would give you verdicts on a CV you are not sending."*

If no JD text is reachable, continue against the report's requirement summary and state the degradation in the output. Partial-but-honest beats perfect-or-nothing.

## Step 2 — Identify the reviewer, and declare the tier

Research who screens this application using **WebSearch and the company's own pages**. Never use automated access to a platform whose terms prohibit it — public profile pages that surface in search results are fine to read; the platforms themselves are not to be crawled.

Useful angles:

- Targeted searches: `"{company}" "{role}" hiring manager`, `"{company}" head of {function}`, `{company} docs team lead`.
- The company's careers, team, or about pages.
- ATS posting metadata, where the board exposes a recruiter or hiring-manager field.

**Search queries carry company and role terms only — never the candidate's CV content, name, or personal details.**

Classify the result honestly:

| Tier | Trigger | Persona built from | Label in output |
|---|---|---|---|
| **A** | Named person, 2+ independent sources agreeing on role + company | Their actual, cited background | `Identified — {name}, {title}` + source links |
| **B** | Named person, single weak source | Their apparent *function* only, never claimed specifics | `Likely reviewer — {function}` |
| **C** | Nobody identifiable | Company stage/size, team composition, the JD's reports-to line, and the JD's own vocabulary | `Synthesized` |

All three tiers are research-grounded; they differ only in how much of the grounding is a real identifiable person. **Tier C is a constructed reviewer built from actual findings, not a stereotype** — if research established the company is ~40 people, the role reports to a Director of Engineering, and the JD speaks platform-team vocabulary, the synthesized reviewer reflects exactly that.

Cap at Tier B and flag recency doubt when the profile looks stale (the person may have left). Use Tier C when web research is unavailable, and say so.

**Always state the tier.** A reader must never have to guess how much the persona is worth.

## Step 3 — Brief and dispatch one subagent

Dispatch a single subagent per the convention in `.claude/skills/career-ops/SKILL.md`. **Never nest subagents.**

The brief contains:

- The JD (or the report's requirement summary, if degraded).
- The tailored bullets, **numbered**.
- The `jd-skill-gap.mjs` output.
- The persona and its tier.
- The candidate's real scope from `cv.md` and `article-digest.md`, with this instruction verbatim: *"You may recommend cutting or reframing any bullet. You may never recommend a claim the source files do not support. If a requirement is unmet, say it is unmet — do not invent coverage for it."*

If the CLI exposes no Agent primitive, run the persona inline **and say so in the output**. The value of this mode is that it is not self-auditing; degrading silently would misrepresent the result.

## Step 4 — Collect the verdict

The reviewer returns one row per bullet:

| # | Bullet | Verdict | Why | Suggested rewrite |
|---|---|---|---|---|
| 1 | … | `keep` / `cut` / `rewrite` | one line | only when `rewrite` |

Plus:

- An overall **scope/seniority** read — is this pitched at the right level for the role?
- A blunt **"would I advance this to a screen?"** call, with the single biggest reason.

**Coverage rule:** state the bullet count before dispatching, and require the returned table to have exactly that many rows. Agents drift toward summarising instead of auditing every line; the stated count is the defense. If the table comes back short, re-dispatch for the missing rows rather than accepting a partial audit.

## Step 5 — Present, then persist

Present to the user **before any PDF regeneration**: the identity guess, the tier and its sources, the full table, and the overall verdict. The user makes the judgment call on which rewrites to take.

Then append to `reports/{num}-{company}-{date}.md`:

```markdown
## HM Audit

**Reviewer:** {tier label} — {name/function/synthesized descriptor}
**Sources:** {links, or "none — synthesized from JD and company research"}
**Audited:** output/cv-{candidate}-{company}.html ({N} bullets)
**Overall:** {scope/seniority read}
**Would advance to screen:** {yes/no} — {single biggest reason}

| # | Bullet | Verdict | Why | Suggested rewrite |
|---|---|---|---|---|
```

This follows the same convention as the cover letter draft appended by `modes/oferta.md`. If the role has no report, present the audit inline and say plainly that it was not persisted because there is no report to attach it to — never create a stray file.

## Guardrails

- **Fabrication.** Bound by the Source-of-Truth Boundary in `AGENTS.md`. Cut and reframe freely; never invent.
- **Privacy.** Public professional information only. Store name, title, and source links — never contact details, never personal social accounts.
- **Attribution.** Always *"a reviewer with this background would likely read it this way"* — never *"{name} thinks X."* Even at Tier A this is inference from public information about a real private individual.
- **Output language.** Write all human-facing output in `language.output`, per the standing directive in `AGENTS.md`.

## Scope / Non-Goals

- **Not a fact checker.** `verify-cv-facts.mjs` owns that and runs first, at `pdf` step 18.
- **Not a rewriter.** This mode recommends; the user decides; `pdf` regenerates.
- **Not mandatory.** `pdf.md` points at it. Users who want it on every CV can say so in their own `modes/_custom.md`.
- **Not a panel.** One reviewer. A multi-persona panel (recruiter + HM + peer) is a possible follow-up, deliberately out of scope for cost reasons.
