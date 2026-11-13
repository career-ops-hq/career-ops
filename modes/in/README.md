# career-ops -- India market mode (`modes/in/`)

English-language modes with Indian market rules for candidates applying to
employers in India, freshers and experienced professionals alike.

## Why not `modes/hi/`?

`modes/hi/` is the Hindi-language mode set for the same market, and its table
of Indian terms (CTC, PF, notice period, bonds) is the starting point for this
set. Two things make a separate English layer worth having:

| Topic | `modes/hi/` | This set |
|-------|-------------|----------|
| Language | Hindi prose, Hindi output conventions | English, like most Indian tech postings |
| Structure | Hindi modes layered on the English canon | English modes with only an Indian market layer on top, like `modes/sg/` and `modes/at/` |
| Freshers | Not covered | Batch eligibility, joining date vs final exams, hidden experience lines, CGPA and backlog cut-offs |
| Experienced candidates | Notice period and buyout, probation, moonlighting, relieving letters | Adds the experience band, titles and grades, current-CTC privacy and the clauses to quote |
| Figures | Some rates and ranges are written into the file | None: the agent verifies rates and rules at runtime from official sources |

The language of what you get back is set separately by `language.output`.

## When to use these modes

Use `modes/in/` when any of these hold:

- The hiring entity is in India: an Indian company, the Indian subsidiary or
  branch of a foreign company (including a global capability center), or a
  contract under Indian law
- You are a fresher and want batch, joining-date and cut-off checks on every
  posting
- You want application-form answers for Indian forms: CTC, notice period,
  CGPA, batch, backlogs

Do not use them for a remote role with a foreign entity that pays you as a
contractor from India. Per posting, the market is decided from the hiring
entity, never from the language (AGENTS.md → "Output Language vs Market
Modes").

## How to activate

### Option 1 -- Single session

At the start of the session, tell the agent:

> "Use the Indian market modes under `modes/in/`."

### Option 2 -- Permanently

Add to `config/profile.yml`:

```yaml
language:
  output: en
  modes_dir: modes/in
```

Remind the agent on your first session ("check `profile.yml`, I configured
`language.modes_dir`"). For parallel campaigns (for example India and
Singapore), declare both: `modes_dir: [modes/in, modes/sg]`. The first entry
supplies the evaluation file; the market of each posting is judged from its
hiring entity.

To fix your stage instead of letting the agent count it from `cv.md`, write
"Career stage: fresher" or "Career stage: experienced" in
`modes/_profile.md`.

## How this set avoids dropping canonical rules

The router reads the English files first and layers market files on top
(#6728), so this set restates nothing from the canon: `_shared.md` adds only
the Indian market rules, and `offer.md`, `apply.md` and `pipeline.md` add
Indian overrides to the English mode files they name. English workflow rules
win on a contradiction; the Indian files change market facts (CTC, contract
terms, eligibility checks), never the workflow. An eligibility check becomes a
Block B row with an HR question, banded by the posting's own wording; whether
it is a hard stop, and the decision, follow the canonical rules.
`_shared.md` still says to read `modes/_shared.md` first, for any entry point
that loads a market file on its own.

## Which modes are covered?

| File | Based on | Role |
|------|----------|------|
| `_shared.md` | `modes/_shared.md` | Indian market rules: CTC, the stage rules for freshers and experienced candidates, scam signals, contract terms, work authorization, application conventions |
| `offer.md` | `modes/oferta.md` | Full A-H evaluation with Indian overrides (Block A, B, D, G and H) and extra report-header fields |
| `apply.md` | `modes/apply.md` | Live application-form assistant with Indian field guidance |
| `pipeline.md` | `modes/pipeline.md` | URL inbox with Indian portal notes |

The remaining modes (`scan`, `batch`, `pdf`, `tracker`, `deep`, `contacto`,
`interview`, `offer-prep`, etc.) stay as they are in `modes/`.

## Reference lexicon

| Term | Meaning |
|------|---------|
| CTC | Cost to company: the employer's annual cost, including contributions and benefits; not take-home pay |
| LPA | Lakh per annum; how Indian postings quote CTC |
| In-hand | Monthly take-home pay after tax and deductions |
| Fixed / variable pay | The guaranteed part of CTC and the performance-linked part |
| EPF / PF | Employees' Provident Fund: employer and employee contributions on basic wages |
| Gratuity | Lump sum on leaving after a qualifying period of continuous service |
| Notice period / buyout | Days of notice owed when resigning; a buyout pays it off, at the employer's choice |
| Bond / service agreement | A promise to stay for a period, or repay training or joining costs |
| Relieving letter | The previous employer's letter confirming the exit; asked for in background checks |
| Batch | Graduation year; fresher postings often name the eligible batches |
| CGPA / backlogs | Grade average on a 10-point scale; papers not yet cleared |
| Circuital branches | The engineering branches close to computing, usually CS, IT, ECE and EE; many tech postings for freshers accept only these |
| Campus / off-campus drive | Hiring through the college, or open hiring for recent graduates |
| GCC | Global capability center: a foreign company's own Indian unit |
| OCI | Overseas Citizen of India card |

## Contributing

- Never hardcode current PF or ESI rates, tax slabs, gratuity rules or salary
  bands in these files. The modes tell the agent to verify them at runtime from
  epfindia.gov.in, esic.gov.in, incometax.gov.in, labour.gov.in or
  indiacode.nic.in.
- Cite the source of any legal rule you add (act and section, or an official
  page).
- Test a change with real Indian postings (one for freshers, one for
  experienced candidates) before opening a PR.
