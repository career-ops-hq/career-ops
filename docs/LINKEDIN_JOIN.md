# LinkedIn Join — the connections cross-reference

`linkedin-join.mjs` answers one question: **do I already know someone at a
company in my funnel?**

It takes the `Connections.csv` file LinkedIn gives you when you export your
data, matches the employers in it against the companies career-ops already
tracks, and prints only the overlap. No network calls, no model calls, nothing
written to disk. A run costs zero tokens and takes about as long as reading a
CSV, because that is all it does.

Two things it is deliberately *not*: knowing someone at a company is not an
evaluation input (Blocks A–F own the score), and nothing it prints may become a
claim in a CV, cover letter, or form answer. It changes **who you contact and
through which channel**, and nothing else.

## 1. Get the export

1. LinkedIn → **Settings** → **Data Privacy** → **Get a copy of your data**.
2. Pick **Connections** specifically rather than requesting the full archive.
   `Connections.csv` is the only file this script reads, and the narrower
   request is the one LinkedIn turns around faster.
3. LinkedIn emails you a download link when the file is ready.
4. Unzip it and put `Connections.csv` in `data/`:

```bash
mv ~/Downloads/Connections.csv data/
```

The export opens with a free-text `Notes:` preamble before the real header row,
and LinkedIn has changed its length before. Leave it in place; the parser finds
the header by content rather than by counting lines.

If you would rather keep the file somewhere else, every command below accepts
`--csv <path>`.

## 2. Run it

```bash
node linkedin-join.mjs --summary
```

```
LinkedIn warm-intro join
  5 connections · 4 target companies · 4 companies with a connection · 4 people

── In your tracker ────────────────────────────────────────

  Siemens Digital Industries Software  [#1 Applied · Staff Engineer]
    · Jane Doe — Director, Platform Engineering — since 2021-08 — strong match: "Siemens"
        https://www.linkedin.com/in/janedoe
    2nd-degree: https://www.linkedin.com/search/people/?keywords=Siemens%20Digital%20Industries%20Software&network=%5B%22S%22%5D

  Datavant  [#2 Screening · Platform Engineer]
    · Ravi Patel — Staff Data Engineer — since 2019-02
        https://www.linkedin.com/in/ravipatel
    2nd-degree: https://www.linkedin.com/search/people/?keywords=Datavant&network=%5B%22S%22%5D

── Scanner targets (no application yet) ─────────────────────

  Akamai Technologies
    · Alex Kim — Solutions Architect — since 2020-06 — strong match: "Akamai"
        https://www.linkedin.com/in/alexkim
    2nd-degree: https://www.linkedin.com/search/people/?keywords=Akamai%20Technologies&network=%5B%22S%22%5D

  Ørsted
    · Mette Sørensen — Wind Analytics Lead — since 2023-11
        https://www.linkedin.com/in/mettes
    2nd-degree: https://www.linkedin.com/search/people/?keywords=%C3%98rsted&network=%5B%22S%22%5D

Notes:
  ! 1 connections have no employer listed (cannot join)
  ! 1 target rows skipped (placeholder names)

Review before acting: a 1st-degree connection is not automatically a warm intro.
```

The two sections are the two company lists it joins against:

- **In your tracker** — companies in `data/applications.md`, so the row carries
  its tracker number, status and role.
- **Scanner targets** — enabled `tracked_companies` from `portals.yml`, which
  you have not applied to yet.

### One company at a time

The bulk report only lists companies where something matched, which is right for
a digest and wrong for a direct question — a blank reads as "not checked" rather
than "checked, nobody". `--company` answers in words either way, and the company
does not have to be tracked yet:

```bash
node linkedin-join.mjs --company Datavant --summary
```

```
Do you know anyone at "Datavant"?

  Yes — 1 connection:

    · Ravi Patel — Staff Data Engineer — since 2019-02
        https://www.linkedin.com/in/ravipatel

  Second-degree (not in any export — open it yourself, nothing is fetched):
    https://www.linkedin.com/search/people/?keywords=Datavant&network=%5B%22S%22%5D
```

```
Do you know anyone at "Stripe"?

  No. No first-degree connection in your export lists this company.
  (Strict name matching. Try --include-weak for looser variants.)
```

### Promoting someone into your phonebook

`--tsv` prints rows shaped for `data/contacts.tsv`, skipping anyone already in
it. It **prints and never appends** — read the rows, then paste the keepers in
yourself, and `contacts.mjs` and the `contacto` mode pick them up from there.

```bash
node linkedin-join.mjs --tsv
```

```
# name	company	type	title	phone	email	linkedin	tracker#	notes
Jane Doe	Siemens Digital Industries Software	peer	Director, Platform Engineering			https://www.linkedin.com/in/janedoe	1	LinkedIn 1st-degree, connected 2021-08-03. Name match strong: "Siemens". Verify current employer before outreach.
```

### All the flags

| Flag | What it does |
|------|--------------|
| *(none)* | JSON on stdout: targets, totals, quality counters, active filters |
| `--summary` | The human-readable report above, grouped by company |
| `--company <name>` | Answer for one company, even when nothing matches (JSON; add `--summary` for the prose answer) |
| `--tsv` | `contacts.tsv`-shaped rows on stdout (never appends) |
| `--tracker-only` | Only companies in `data/applications.md` |
| `--portals-only` | Only `portals.yml` scanner targets |
| `--include-weak` | Include weak name matches (see below — noisier) |
| `--since <YYYY>` | Only connections made in or after a 4-digit year |
| `--csv <path>` | Read the export from somewhere other than `data/Connections.csv` |
| `--self-test` | Run the inline matcher checks |
| `--help`, `-h` | Print usage |

Value-taking flags accept both `--flag value` and `--flag=value`, and a value
flag with no operand is a usage error rather than a silent default. An
unrecognized flag exits 1 rather than falling through to default behaviour, so a
typo cannot silently hand you a report about something you did not ask for.

`--since` excludes connections whose date will not parse, rather than waving
them through, and reports the count as `quality.undatedExcludedBySince` in the
JSON output. A warm intro you never hear about is the expensive failure here, so
the counters are worth reading.

## 3. How companies are matched

LinkedIn employer names are free text, so exact string equality misses most real
hits. Names are folded (case, accents, punctuation, spacing) and split into all
tokens and *distinctive* tokens, with generic industry and legal words removed.
Three tiers come out of that:

| Tier | Rule | Example |
|------|------|---------|
| `exact` | The folded keys are equal | `GE HealthCare` ~ `GE Healthcare` |
| `strong` | Distinctive token sets are **equal**; only generic filler differs | `Siemens` ~ `Siemens Digital Industries Software` |
| `weak` | Distinctive tokens overlap but the sets differ | `Epic Systems` ~ `Epic Games` |

`exact` and `strong` show by default; `weak` needs `--include-weak`.

Strong requires the distinctive sets to be **equal**, not merely nested, and
that is the line that keeps the feature trustworthy. `Epic` is contained in
`Epic Games`, and `Blue` in `Blue Cloud Ventures`, but those name different
companies from Epic Systems and Optimal Blue. An extra distinctive token on
either side changes the entity; only filler like `Inc`, `Group` or
`Technologies` may differ.

Two more rules follow from the same principle:

- **Substring matching is never used**, so `Loop` never matches `Loopio`.
- **Generic words alone never match**, so `Monogram Health` and
  `Advocate Health` stay apart. That is also why an anonymized tracker row
  (`Stealth Startup`, `?`, `Undisclosed`) is dropped as a target rather than
  matched against whichever connection happens to be typed the same way — the
  summary reports those as skipped rows.

Spacing is deliberately ignored, because `GoDaddy`/`Go Daddy` and
`ServiceNow`/`Service Now` are the same employer typed two ways. Accents fold
both directions, including the non-decomposing letters a naive fold silently
drops: `Ørsted` matches `Orsted`, `Straße` matches `Strasse`, `Işık` matches
`Isik`. Non-Latin names are preserved rather than emptied, so a CJK or Cyrillic
employer still matches itself.

Whenever the two names are not identical, the report prints **both** — the
LinkedIn one beside the tracked one, captioned with the tier (`strong match:
"Siemens"`). The JSON output carries the LinkedIn spelling as `linkedinCompany`
on every match, exact ones included. You are the last filter, which is the point
of showing you the pair.

## 4. Second-degree connections

The export carries first-degree contacts only. Second-degree edges exist solely
inside LinkedIn's own UI and are not exportable, so the honest answer is a link
rather than a result: every target carries a prefilled people-search URL,
filtered to 2nd degree.

career-ops builds that string and **never fetches it**. You open it in your own
browser, logged in as yourself.

## 5. Privacy

The export is third-party PII — other people's names, employers and profile
URLs — so it is worth being precise about where it goes.

**What the script does not do.** No network access. No LLM calls. No writes of
any kind: no cache, no index, no sidecar state, no edit to your tracker or your
phonebook. The CSV is read fresh on every run, which makes it disposable —
delete it when you are done and re-export when you need it again. `data/` is
gitignored, so the file is never committed and the updater never touches it.
Only the rows you paste in by hand ever reach `data/contacts.tsv`.

**What does move.** The file itself never enters a prompt. Its *output* is a
different matter: if you ask your CLI agent to run the join rather than running
it yourself, the agent reads stdout, and that output is a list of real people's
names, job titles and profile URLs. It is now in that session's context and
subject to whatever your CLI does with context.

That may be exactly what you want — asking "do I know anyone at Datavant?" and
getting a useful answer is the whole feature. But if you would rather the
third-party data stayed on the machine, run the command yourself in a terminal
and read the result there. The script behaves identically either way; the
difference is only who reads the output.

`--company <name>` is the narrow option when you have a specific question, since
it returns one company's connections instead of your whole overlap.

## 6. When it finds nothing

A run that exits 1 tells you why:

```
Connections export not readable: /path/to/career-ops/data/Connections.csv
Export it from LinkedIn (Settings → Data Privacy → Get a copy of your data → Connections),
drop Connections.csv in data/, or pass --csv <path> pointing at the file.
```

```
--tracker-only and --portals-only are mutually exclusive: together they exclude every target source. Pass neither to search both.
```

```
--since expects a 4-digit year, got "20".
```

```
"Stealth Startup" has no identifying words to match on (all generic or placeholder terms). Give a more specific company name.
```

A run that exits 0 with no matches is a real answer, not a failure. The `Notes:`
block at the end of `--summary` explains what was excluded and why:

- `CSV header row not found` — the file is not a LinkedIn Connections export.
- `N connections have no employer listed` — LinkedIn leaves the Company column
  empty for some connections, and there is nothing to join on.
- `N unparseable "Connected On" dates` — only matters when you use `--since`.
- `N target rows skipped (placeholder names)` — anonymized companies, as above.

If you expected a hit that did not appear, try `--include-weak` and read the raw
names it prints. If matching itself looks wrong, `node linkedin-join.mjs
--self-test` runs the matcher's own checks without needing an export at all.

## See also

- [`docs/SCRIPTS.md`](SCRIPTS.md) — the full script reference
- [`DATA_CONTRACT.md`](../DATA_CONTRACT.md) — which files are yours and which
  the updater owns, including the `data/Connections.csv` row
- `contacts.mjs` — the phonebook that `--tsv` rows are destined for
