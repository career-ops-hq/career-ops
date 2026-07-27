# Mode: eu-swe — European SWE Application Calibration

Use this mode when the candidate is targeting software engineering roles in Europe and wants market-specific application calibration before CV generation, form answers, or interview prep.

This mode is advisory. It must not replace official immigration, tax, labor, or salary-threshold research.

## Inputs

1. **JD text or URL** — role title, country, city, work model, stack, seniority, language, and application portal.
2. **CV** at `cv.md` + `article-digest.md` — proof points and real achievements.
3. **Profile** at `config/profile.yml` + `modes/_profile.md` — location, targets, constraints, compensation, and user-specific rules.
4. **Evaluation report** in `reports/` if one already exists.

## Step 1 — Market and Role Classification

Classify the opportunity:

- country and city
- role family: backend, frontend, full-stack, platform, data, ML, DevOps, mobile, security, engineering management
- seniority and level signals
- work model: remote, hybrid, office-first, relocation
- core stack and domain
- language expectations
- application portal and required fields

If the country or city is unclear, say so and proceed with generic European SWE guidance.

## Step 2 — Hard Filters

Build a table:

| Filter | JD signal | Candidate signal | Risk | Action |
|--------|-----------|------------------|------|--------|
| Location/work model | | | pass/risk/blocker/unknown | |
| Work authorization/sponsorship | | | pass/risk/blocker/unknown | |
| Language | | | pass/risk/blocker/unknown | |
| Seniority | | | pass/risk/blocker/unknown | |
| Core stack | | | pass/risk/blocker/unknown | |
| Domain | | | pass/risk/blocker/unknown | |
| Compensation feasibility | | | pass/risk/blocker/unknown | |
| Background checks | | | pass/risk/blocker/unknown | |

Do not guess missing candidate facts. Mark unknowns and ask only when the answer changes apply/no-apply or generated text.

## Step 3 — Country Notes

Use these as prompts for what to verify, not as final legal advice.

| Country/market | Common checks for SWE applications |
|----------------|------------------------------------|
| Netherlands | Sponsor readiness, recognized employer requirements, office/hybrid expectations, English vs Dutch, finance/security screening such as VOG/PES when relevant. Verify immigration and salary threshold facts from official Dutch sources at runtime. |
| Germany / DACH | Blue Card or residence/work permit fit, German vs English expectations, city-specific compensation, notice/probation norms, and highly formal application expectations in some companies. Verify legal and permit facts from official sources at runtime. |
| Ireland | Employment permit or local work authorization fit, Dublin vs regional compensation, English-language expectations, and multinational hiring-process norms. Verify permit facts from official Irish sources at runtime. |
| France | French vs English expectations, CDI/CDD or contract framing, Paris vs regional compensation, and sector-specific benefits or collective-agreement context when visible in the JD. Verify work authorization and labor facts from official sources at runtime. |
| UK | Skilled Worker sponsorship, salary/visa feasibility, London vs regional compensation, and right-to-work wording. Verify legal and immigration facts from official UK sources at runtime. |
| Other Europe | Use generic SWE screening plus country-specific official verification for work authorization, salary thresholds, tax/legal constraints, and language expectations. |

Never hardcode current thresholds. If a threshold matters, search official government sources before advising.

## Step 4 — Application Calibration

Produce a concise addendum:

```markdown
## EU SWE Calibration: {Company} — {Role}

**Market:** {country/city or unknown}
**Role family:** {family}
**Primary hard filters:** {top 3}
**Main reviewer doubts:** {top 3}

### CV Adjustments
- {top-third summary adjustment}
- {stack/domain keyword adjustment}
- {business-value bullet adjustment}

### Application Answers
- {work authorization / sponsorship answer if asked}
- {location / hybrid answer if asked}
- {language answer if asked}
- {compensation strategy if asked}

### Interview Prep Handoff
- {recruiter screen risks}
- {hiring-manager proof points}
- {technical topics to prep}

### Facts To Verify
- {official-source checks}
- {candidate facts to confirm}
```

## Step 5 — Handoff

- Use `pdf` mode for the submit-ready CV after calibration.
- Use `apply` mode for portal answers after calibration.
- Use `interview-prep` mode when the candidate reaches recruiter, hiring-manager, or technical rounds.
- Store user-specific rules in `modes/_profile.md` or `config/profile.yml`, not in this mode.

## Rules

- Do not invent work authorization, language level, compensation targets, degree equivalence, or relocation availability.
- Do not put sensitive logistics in the CV unless the user explicitly wants that or the local market clearly expects it.
- Do not provide legal advice. Provide verification prompts and cite official sources when legal facts are used.
- Keep output in the JD language unless the user asks otherwise.
