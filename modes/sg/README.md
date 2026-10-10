# career-ops -- Singapore market mode (`modes/sg/`)

English-language modes with Singapore market rules for candidates targeting
software/AI engineering roles in Singapore.

## When to use these modes?

Use `modes/sg/` when any of these hold:

- You are applying to **roles based in Singapore** (on-site or hybrid), whether or
  not the employer sponsors an Employment Pass
- You need **Singapore-specific evaluation rules**: EP/COMPASS sponsorship
  feasibility, Fair Consideration Framework signals, CPF vs. pass-holder
  treatment, AWS/13th-month conventions, SGD salary-band calibration
- You want application-form answers phrased for **Singapore portals**
  (MyCareersFuture, JobStreet, Workday SG instances) and **business-English**
  cover letters

Singapore JDs are written in English, so unlike `modes/it/` this is not a
translation: it is the canonical English modes plus a Singapore market layer.
If most of your target roles are outside Singapore, stay on the default
`modes/` — the SG files add nothing for other markets.

## How to activate

### Option 1 -- Single session

At the start of the session, tell the agent:

> "Use the Singapore market modes under `modes/sg/`."

The agent will read this folder's files for Singapore roles and fall back to
`modes/` for everything else.

### Option 2 -- Permanently

Add to `config/profile.yml`:

```yaml
language:
  output: en
  modes_dir: modes/sg
```

Remind the agent on your first session ("check `profile.yml`, I configured
`language.modes_dir`"). For parallel campaigns (e.g. Singapore + Italy), declare
both: `modes_dir: [modes/sg, modes/it]` — the first entry supplies the
evaluation-mode file; per-JD market fit is judged from the JD's own signals
(see AGENTS.md "Output Language vs Market Modes").

## Which modes are covered?

| File | Based on | Role |
|------|----------|------|
| `_shared.md` | `modes/_shared.md` | Shared context, archetypes, global rules, Singapore market specifics |
| `offer.md` | `modes/oferta.md` | Full A-H evaluation with Singapore overrides (Block D comp, Block G legitimacy, Block H answers) |
| `apply.md` | `modes/apply.md` | Live application-form assistant with Singapore-specific fields |
| `pipeline.md` | `modes/pipeline.md` | URL inbox with Singapore portal notes |

The remaining modes (`scan`, `batch`, `pdf`, `tracker`, `deep`, `contacto`,
`interview`, etc.) stay as-is in `modes/`. Their content is tooling and
workflow, independent of market.

## Reference lexicon

| Term | Meaning |
|------|---------|
| EP (Employment Pass) | Work pass for foreign professionals/managers/executives; employer-sponsored, MOM-issued |
| S Pass | Work pass for mid-level skilled staff; quota + levy apply |
| ONE Pass | 5-year personalised pass for top talent (S$30k/month); not employer-tied |
| Tech.Pass | Legacy tech-talent pass, being replaced by the ONE Pass (AI & Tech) track from Jan 2027 |
| COMPASS | Points-based EP assessment (40+ points); salary, qualifications, diversity, local hiring |
| MOM | Ministry of Manpower — work-pass authority |
| MyCareersFuture | National jobs portal; EP roles must be advertised here first (Fair Consideration Framework) |
| FCF | Fair Consideration Framework — employers must fairly consider locals before EP hire |
| CPF | Central Provident Fund — mandatory savings for citizens/PRs only; pass holders excluded |
| AWS | Annual Wage Supplement — "13th month" bonus convention (not mandatory) |
| DP / LOC | Dependant's Pass / Letter of Consent (spouse work rights) |
| RAL equivalent | Singapore quotes **monthly base** (S$/month); annualise as monthly x 12 + AWS + variable |
