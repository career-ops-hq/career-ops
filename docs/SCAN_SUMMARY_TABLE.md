# Per-source table in the scan summary

At the end of a `node scan.mjs` run, after the totals, the scan prints where each source's offers went:

```
Per source (each row: fetched = source + title + location + age + other + seen + new):
  Source           fetched  source   title location     age   other    seen     new
  Example Board        212      40     120       30       0       2      15       5
  (tracked companies)  300       0     210       60       5       3      20       2
  Total                512      40     330       90       5       5      35       7
```

(Numbers here are made up to show the shape.)

- **Rows.** Every `job_boards:` entry gets its own row. All `tracked_companies:` share one row, `(tracked companies)`. A source whose fetch failed is marked with `✗`. Rows are sorted by `new`, highest first, then by name. The last row is `Total`.
- **Columns.**
  - `fetched`: offers the source returned, plus the ones its provider dropped itself.
  - `source`: dropped inside the provider by its own settings, for example through a `workplace` setting on its entry.
  - `title`, `location`, `age`: removed by the matching filter.
  - `other`: removed by the tier, declared field, salary, content, country, visa, cooldown or blacklist filters.
  - `seen`: already in your scan history.
  - `new`: kept as new offers.
  - `verify`: appears only with `--verify`. It counts offers that passed the filters but that liveness verification then dropped, so `new` is what survives verification.
- **The columns add up.** In every row, `fetched` equals the sum of all the other columns (`source + title + location + age + other + seen`, plus `verify` when shown, plus `new`).
- **Dropped at the source.** When any source dropped offers itself, a second block lists the counts per reason, for example `Example Board: workplace 30, language 10`.
- **`Total jobs found` is counted after source-side drops; the table's `fetched` is counted before.** The line `Total jobs found` above the table counts only offers the providers handed to the scan, so it leaves out the ones a provider dropped itself. The table's `fetched` adds those back in. With a provider dropping 40 offers, `Total jobs found` is 40 lower than the table's `Total` for `fetched`.
- **The `--json` receipt does not include the table.** With `--json` the table is printed to stderr along with the rest of the summary; the receipt on stdout carries `found` (the same number as `Total jobs found`), `filtered` and the other totals, but no per-source breakdown and no `source` counts.

Provider authors who drop offers themselves can report them in this table; see [Reporting offers a provider drops](../providers/ADDING_A_PROVIDER.md#reporting-offers-a-provider-drops-providerstats).
