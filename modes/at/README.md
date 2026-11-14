# career-ops -- Austria market mode (`modes/at/`)

English-language modes with Austrian market rules for candidates applying to
employers in Austria, whether the posting is written in German or English.

## Why not `modes/de/`?

`modes/de/` translates the modes for German-language postings across DACH, but
its market table ("Deutscher Markt — Spezifika") describes Germany. Several of
its rules are wrong for an employer in Austria:

| Topic | What `modes/de/_shared.md` assumes (Germany) | Austria (this set) |
|-------|----------------------------------------------|--------------------|
| Annual pay | Monthly × 13 (13.5 or 14 in some Tarif sectors) | Monthly × 14 under most KVs (two Sonderzahlungen) |
| Pay in the posting | Not covered | The posting states the minimum under the KV and any willingness to pay more (§ 9 (2) GlBG) |
| Probation | Six months is standard; flag only beyond that | One month at most (§ 19 (2) AngG) |
| Statutory leave | 20 days on a five-day week | 25 working days (§ 2 UrlG) |
| Equal-treatment act | AGG | GlBG |
| Reference letters | Coded Arbeitszeugnis | Dienstzeugnis; statements that make finding a new job harder are not allowed |

Tech postings in Vienna are often written in English, so, like `modes/sg/`, this
set is the canonical English modes plus an Austrian market layer, not a
translation. The language of what you get back is set separately by
`language.output`: German output with Austrian rules is `language.output: de`
plus `modes_dir: modes/at`.

## When to use these modes

Use `modes/at/` when any of these hold:

- The hiring entity is in Austria: an Austrian company, an Austrian
  subsidiary or branch, or a contract under Austrian law
- You need to compare an Austrian offer with offers from other markets on the
  same annual basis
- You want application-form answers for Austrian forms: salary on a 14-salary
  basis, notice period, titles, optional personal fields

Do not use them for employers in Germany or Switzerland, even when the posting
is in German. Per posting, the market is decided from the hiring entity, never
from the language (AGENTS.md → "Output Language vs Market Modes").

## How to activate

### Option 1 -- Single session

At the start of the session, tell the agent:

> "Use the Austrian market modes under `modes/at/`."

### Option 2 -- Permanently

Add to `config/profile.yml`:

```yaml
language:
  output: en        # or de
  modes_dir: modes/at
```

Remind the agent on your first session ("check `profile.yml`, I configured
`language.modes_dir`"). For parallel campaigns (for example Austria and
Germany), declare both: `modes_dir: [modes/at, modes/de]`. The first entry
supplies the evaluation file; the market of each posting is judged from its
hiring entity.

## How this set avoids dropping canonical rules

The router reads the English files first and layers market files on top
(#6728), so this set restates nothing from the canon: `_shared.md` adds only
the Austrian market rules, and `offer.md`, `apply.md` and `pipeline.md` add
Austrian overrides to the English mode files they name. English workflow rules
win on a contradiction; the Austrian files change market facts (pay basis,
contract terms, permits), never the workflow. `_shared.md` still says to read
`modes/_shared.md` first, for any entry point that loads a market file on its
own.

## Which modes are covered?

| File | Based on | Role |
|------|----------|------|
| `_shared.md` | `modes/_shared.md` | Austrian market rules: 14-salary normalisation, the salary statement, contract terms, work authorization, application conventions |
| `offer.md` | `modes/oferta.md` | Full A-H evaluation with Austrian overrides (Block A, D, G and H) and extra report-header fields |
| `apply.md` | `modes/apply.md` | Live application-form assistant with Austrian field guidance |
| `pipeline.md` | `modes/pipeline.md` | URL inbox with Austrian portal notes |

The remaining modes (`scan`, `batch`, `pdf`, `tracker`, `deep`, `contacto`,
`interview`, `offer-prep`, etc.) stay as they are in `modes/`.

## Reference lexicon

| Term | Meaning |
|------|---------|
| KV (Kollektivvertrag) | Sector collective agreement: minimum pay by group and step, Sonderzahlungen, often working-time rules |
| IT-KV | The KV for IT service companies (Angestellte); Tätigkeitsfamilien ZT, AT, ST 1, ST 2, LT and steps Berufseinsteiger, Einstiegsstufe, Regelstufe, Erfahrungsstufe |
| KV-Mindestgehalt | The minimum pay a posting states; a floor, not the offer |
| Überzahlung | Pay above the KV minimum; "Überzahlung möglich" is the usual wording |
| Sonderzahlungen | Urlaubszuschuss and Weihnachtsremuneration: the 13th and 14th salary, from the KV or contract |
| Jahresbrutto | Annual gross; normally already includes the Sonderzahlungen |
| All-in-Vertrag | Flat salary that also covers overtime; the base salary must be stated as an amount |
| Probemonat | Probation, one month at most |
| Kündigungsfrist | Notice period; different for employer and employee |
| Abfertigung Neu | Employer contributions to a Betriebliche Vorsorgekasse; the money stays with the employee |
| Konkurrenzklausel | Non-compete; limited by a pay threshold, one year and the employer's line of business |
| Dienstzeugnis | Reference letter from a former employer |
| GlBG | Gleichbehandlungsgesetz, the equal-treatment act |
| AMS | Arbeitsmarktservice, the public employment service (ALLE JOBS search) |
| Rot-Weiß-Rot – Karte / Blaue Karte EU | Work and residence permits for third-country nationals |

## Contributing

- Never hardcode current thresholds, KV tables or tax figures in these files.
  The modes tell the agent to verify them at runtime from RIS,
  oesterreich.gv.at, migration.gv.at, the Arbeiterkammer or the WKO.
- Cite the source of any legal rule you add (law and paragraph, or an
  official page).
- Test a change with a real Austrian posting (one in German and one in
  English) before opening a PR.
