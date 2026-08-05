# Scripts Reference

All scripts live in the project root as `.mjs` modules. Most are exposed via
`npm run <name>`; agent-invoked utilities (bottom section) run via
`node <script>` directly.

## Quick Reference

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run doctor` | `doctor.mjs` | Validate setup prerequisites |
| `npm run verify` | `verify-pipeline.mjs` | Check pipeline data integrity |
| `npm run normalize` | `normalize-statuses.mjs` | Fix non-canonical statuses |
| `npm run dedup` | `dedup-tracker.mjs` | Remove duplicate tracker entries |
| `npm run merge` | `merge-tracker.mjs` | Merge batch TSVs into applications.md |
| `npm run pdf` | `generate-pdf.mjs` | Convert HTML to ATS-optimized PDF |
| `npm run jd:similarity` | `jd-similarity.mjs` | Compare a new JD with a previous JD/CV and recommend reuse, edits, or regeneration |
| `npm run img-to-pdf` | `img-to-pdf.mjs` | Convert a single screenshot/image into a single-page PDF |
| `node build-cv-latex.mjs` | `build-cv-latex.mjs` | Build .tex from structured JSON payload |
| `npm run sync-check` | `cv-sync-check.mjs` | Validate CV/profile consistency |
| `npm run patterns` | `analyze-patterns.mjs` | Analyze tracker outcomes and report patterns |
| `npm run upskill` | `upskill.mjs` | Aggregate skill-gap map from tracked reports (or `--url-text <url\|file>` for a single-JD targeted gap analysis) |
| `npm run add` | `add-entry.mjs` | Dedup + insert a `/career-ops add` entry into cv.md / article-digest.md |
| `npm run update:check` | `update-system.mjs check` | Check for upstream updates |
| `npm run update` | `update-system.mjs apply` | Apply upstream update |
| `npm run rollback` | `update-system.mjs rollback` | Rollback last update |
| `npm run liveness` | `check-liveness.mjs` | Test if job URLs are still active |
| `npm run extract` | `browser-extract.mjs` | Headless read-only page extractor (opt-in `scan.extractor: cli`) — compact JSON for scan/JD |
| `npm run scan` | `scan.mjs` | Zero-token portal scanner |
| `npm run scan:full` | `scan-ats-full.mjs` | Reverse ATS discovery scanner |
| `npm run company:funded` | `company-funded.mjs` | Review-first discovery of recently funded companies |
| `npm run validate:portals` | `validate-portals.mjs` | Validate portals.yml shape before scanning |
| `npm run tracker` | `tracker.mjs` | SQLite derived index over applications.md — sync/query/history/export |
| `npm run find` | `find.mjs` | Resolve a report#/tracker#/company query to its full pipeline identity |
| `npm run invite-match` | `invite-match.mjs` | Fuzzy-match a pasted interview-invite email against `data/applications.md` |
| `npm run application:init` | `application-artifacts.mjs` | Initialize one versioned application-scoped JD/CV/PDF artifact bundle |
| `npm run paste-reply` | `paste-reply.mjs` | Manual/no-Gmail input into the `reply-watch.mjs` classification pipeline |
| `npm run freshness` | `check-table-freshness.mjs` | Staleness validator for jurisdiction data tables (`as_of` / `next_effective` watchdog) |
| `npm run openai:tailor` | `openai-tailor.mjs` | Tailor a CV via any OpenAI-compatible endpoint (headless companion to `openai-eval.mjs`) |
| `npm run or` | `openrouter-runner.mjs` | Run scan/evaluate/pipeline/apply on OpenRouter free models — no Claude CLI required |
| `npm run reconcile` | `reconcile-pipeline.mjs` | Remove batch-evaluated offers from pipeline.md "Pendientes" |
| `npm run cover-letter` | `generate-cover-letter.mjs` | Render a cover-letter JSON payload to PDF |
| `npm run verify:portals` | `verify-portals.mjs` | Probe ATS endpoints to confirm portals.yml slugs resolve (network) |
| `node fix-slugs.mjs` | `fix-slugs.mjs` | Write `verify-portals.mjs`'s suggested ATS slug fixes back to portals.yml (dry run by default, `--fix` to write) |
| `npm run reposts` | `detect-reposts.mjs` | Flag re-listed (ghost) postings from scan history |
| `npm run gemini:eval` | `gemini-eval.mjs` | Evaluate a JD with Google Gemini (free-tier alternative) |
| `npm run ollama:eval` | `ollama-eval.mjs` | Evaluate a JD with a local Ollama model |
| `npm run openai:eval` | `openai-eval.mjs` | Evaluate a JD via any OpenAI-compatible endpoint |
| `npm run star` | `match-star.mjs` | Match a behavioural question to your best STAR story (zero-LLM) |
| `npm run archive` | `archive-posting.mjs` | Save a live job posting as PDF before it disappears |
| `npm run prepare:application` | `prepare-application.mjs` | Print an ATS prefill summary (read-only, never POSTs) |
| `npm run build:dashboard` | `build-dashboard.mjs` | Build the Go TUI dashboard binary cross-platform |
| `node upgrade-tests.mjs --pr-gate` | `upgrade-tests.mjs` | Upgrade an install seeded from the newest old release to this commit and prove user data survived (CI gate; `--canary` proves the gate can fail) |

---

## doctor

Validates that all prerequisites are in place: Node.js >= 18, dependencies installed, Playwright chromium, required files (`cv.md`, `config/profile.yml`, `portals.yml`), fonts directory, and auto-creates `data/`, `output/`, `reports/` if missing.

```bash
npm run doctor
```

**Exit codes:** `0` all checks passed, `1` one or more checks failed (fix messages printed).

---

## verify

Health check for pipeline data integrity. Validates `data/applications.md` against nine rules: canonical statuses (per `templates/states.yml`), no duplicate company+role pairs, all report links point to existing files, scores match `X.XX/5` / `N/A` / `DUP`, rows have proper pipe-delimited format, no pending TSVs in `batch/tracker-additions/`, no markdown bold in scores, no two `reports/*.md` files covering the same company+role, and no orphan reports without a tracker row (#1425). The report checks are warning-level: duplicate reports can be legitimate (re-evaluation after a JD change), so they never fail the run.

```bash
npm run verify
```

**Exit codes:** `0` pipeline clean (zero errors), `1` errors found. Warnings (e.g. possible duplicates) do not cause a non-zero exit.

---

## normalize

Maps non-canonical statuses to their canonical equivalents and strips markdown bold and dates from the status column. Aliases like `Enviada` become `Aplicado`, `CERRADA` becomes `Descartado`, etc. DUPLICADO info is moved to the notes column.

```bash
npm run normalize             # apply changes
npm run normalize -- --dry-run  # preview without writing
```

Creates a `.bak` backup of `applications.md` before writing.

**Exit codes:** `0` always (changes or no changes).

---

## dedup

Removes duplicate entries from `applications.md` by grouping on normalized company name + fuzzy role match. Keeps the entry with the highest score. If a removed entry had a more advanced pipeline status, that status is promoted to the keeper.

```bash
npm run dedup             # apply changes
npm run dedup -- --dry-run  # preview without writing
```

Creates a `.bak` backup before writing.

**Exit codes:** `0` always.

---

## merge

Merges batch tracker additions (`batch/tracker-additions/*.tsv`) into `applications.md`. Handles 9-column TSV, 8-column TSV, and pipe-delimited markdown formats. Detects duplicates by report number, entry number, and company+role fuzzy match. Higher-scored re-evaluations update existing entries in place.

```bash
npm run merge                 # apply merge
npm run merge -- --dry-run    # preview without writing
npm run merge -- --verify     # merge then run verify-pipeline
```

Processed TSVs are moved to `batch/tracker-additions/merged/`.

**Exit codes:** `0` success, `1` verification errors (with `--verify`).

---

## validate:portals

Validates `portals.yml` before running the scanner. The validator is offline: it reads YAML, loads local provider IDs from `providers/*.mjs`, and checks common configuration mistakes without fetching any job boards.

It reports errors for invalid YAML shape, unknown explicit providers, malformed URLs, empty filter keywords, and invalid local parser blocks. Duplicate enabled company names are warnings because they may be intentional during migrations, but they are worth reviewing.

```bash
npm run validate:portals
npm run validate:portals -- --file templates/portals.example.yml
node validate-portals.mjs --self-test
```

**Exit codes:** `0` no errors (warnings allowed), `1` one or more errors found.

---

## upgrade-tests

The dynamic upgrade regression harness (#2358). `update-system.mjs` has the
largest blast radius in the repo — it rewrites system files in place on someone
else's install — and this is the only test that exercises a *real* upgrade
against a seeded user install instead of asserting on the updater's source.

It is hermetic: a temporary `GIT_CONFIG_GLOBAL` rewrites the canonical GitHub
URL to a local bare mirror whose `main` ref is forced to the commit under test,
so no leg ever reaches the network. The old install runs its own `apply`, which
self-reexecs into the target updater — so the migration code being tested is the
one the PR ships, not the one already installed.

Two modes:

```bash
node upgrade-tests.mjs --pr-gate    # newest release tag that is an ancestor of HEAD -> this commit
node upgrade-tests.mjs --canary     # plant a user-file clobber; the harness MUST report it
```

`--pr-gate` picks the newest release tag that is an ancestor of `HEAD`, seeds an
install from that era's fixture state, and upgrades it to the commit under
review. The leg is red unless all of it holds: `apply` exits 0; a system file
that genuinely changed between the two revisions now carries the target's blob
(the non-vacuity oracle — VERSION is never used, since `apply` has no version
gate); every user file is byte-identical; every path the new manifest adds is
present; `data/applications.md` still parses with the expected row and status
counts; `data/salary-observations.tsv` still parses; and `doctor.mjs --json`
reports `onboardingNeeded: false`. It needs the release tags, which is why CI
checks out with `fetch-depth: 0`.

`--canary` exists because a gate never seen red proves nothing. It commits a
poisoned mirror — `cv.md` tracked and added to `SYSTEM_PATHS`, so the old
updater checks it out over the user's CV — and then requires the harness to
report that clobber. A canary that comes back green means the harness detected
the planted damage; a red canary means the gate is incapable of failing and its
green runs are worthless.

Both modes run on every PR, as the `upgrade-gate` job in
`.github/workflows/test.yml`.

---

## fix-slugs

Write-side twin of `verify-portals.mjs` (#1703). `verify-portals` already probes every tracked company's ATS slug and, for a failing Greenhouse/Ashby/Lever entry, cross-probes slug variants across all three ATSes and attaches `suggested: { ats, slug }` when one resolves. That tool is read-only; this one patches the matching `tracked_companies` entry in `portals.yml`. It imports the same probe and suggestion logic rather than re-implementing it, so the two can never disagree about what a broken slug is (network, like `verify-portals`).

**It is a dry run by default: writing requires an explicit `--fix` (or its alias `--apply`).** A bare `node fix-slugs.mjs` prints the diff it *would* apply and changes nothing, so the safe invocation is also the shortest one. `--dry-run` exists only to say that out loud.

Only entries `verify-portals` classifies as `missing` **and** for which it found a `suggested` alternate are touched. Live entries, empty entries, and entries whose slug genuinely could not be resolved are left completely alone.

The file is edited as text — line-level surgery inside the matching company's block — rather than through a YAML parse-and-dump round trip, because `portals.yml` carries hand-written comments and documentation blocks that `yaml.dump()` would silently discard.

```bash
node fix-slugs.mjs                            # dry run (default, safe): print the diff, write nothing
node fix-slugs.mjs --dry-run                  # same as above, explicit
node fix-slugs.mjs --fix                      # write the resolved slugs back to portals.yml
node fix-slugs.mjs --apply                    # alias for --fix
node fix-slugs.mjs --file templates/portals.example.yml
```

The default path is `portals.yml`, overridable with `--file` or the `CAREER_OPS_PORTALS` environment variable. A missing portals file is reported and treated as nothing to do, not as an error.

**Exit codes:** `0` on every normal run, `1` only if the run itself fails. Unlike `check-table-freshness`, pending fixes in a dry run do **not** fail the run, so this is a maintenance tool rather than a CI gate.

---

## pdf

Renders an HTML file to a print-quality, ATS-parseable PDF via headless Chromium. Resolves font paths from `fonts/`, normalizes Unicode for ATS compatibility (em-dashes, smart quotes, zero-width characters), and reports page count and file size.

```bash
npm run pdf -- input.html output.pdf
npm run pdf -- input.html output.pdf --format=letter   # US letter
npm run pdf -- input.html output.pdf --format=a4        # A4 (default)
```

**Exit codes:** `0` PDF generated, `1` missing arguments or generation failure.

---

## img-to-pdf

Converts a single screenshot or image (PNG, JPEG, GIF, WEBP, BMP, SVG) into a single-page PDF via headless Chromium — for ATS upload fields that require a PDF specifically and reject images. Embeds the image as a base64 `data:` URI in a minimal HTML page and renders it with `page.pdf()`, sized to the image's own pixel dimensions so the page is neither cropped nor padded. Zero new dependencies — reuses the `playwright` dependency `generate-pdf.mjs` already uses, and is a deliberately standalone script: it does not go through `generate-pdf.mjs`, so it is never subject to that script's cv.md section-order validation.

```bash
npm run img-to-pdf -- screenshot.png output.pdf
npm run img-to-pdf -- screenshot.png output.pdf --force   # overwrite an existing output file
node img-to-pdf.mjs --self-test
```

MVP scope: one image in, one PDF page out. Multi-image/multi-page conversion is not implemented.

**Exit codes:** `0` PDF generated, `1` missing arguments, unsupported image type, missing input file, existing output without `--force`, or generation failure.

---

## build-cv-latex.mjs

Builds a `.tex` file from a structured JSON payload, handling template merge and LaTeX escaping automatically. The JSON is produced by the agent during evaluation — this script replaces the manual LaTeX generation step in `modes/latex.md`.

```bash
node build-cv-latex.mjs input.json output.tex
node build-cv-latex.mjs --test
```

**Exit codes:** `0` file generated, `1` missing inputs, invalid JSON, unresolved placeholders, or template not found.

---

## sync-check

Validates that the career-ops setup is internally consistent: `cv.md` exists and is not too short, `config/profile.yml` exists with required fields, no hardcoded metrics in `modes/_shared.md` or `batch/batch-prompt.md`, and `article-digest.md` freshness (warns if older than 30 days).

```bash
npm run sync-check
```

**Exit codes:** `0` no errors (warnings allowed), `1` errors found.

---

## patterns

Analyzes application outcomes, scores, archetypes, blockers, remote policy, and company size from `data/applications.md` and linked reports. New reports should include `## Machine Summary` YAML; `analyze-patterns.mjs` uses it first and falls back to legacy markdown parsing for older reports.

```bash
npm run patterns
npm run patterns -- --summary
npm run patterns -- --min-threshold 3
node analyze-patterns.mjs --self-test
```

**Exit codes:** `0` analysis succeeded, `1` insufficient data or parser self-test failure.

---

## upskill

Aggregates skill gaps across every tracked report (#1520, phase 1). Extracts skill tokens from each report's Machine Summary `hard_stops`/`soft_gaps` and Gap table, removes skills already present in `cv.md`/`config/profile.yml` (exact-alias matching only — an umbrella term never suppresses a specific skill), and weights each gap by inverse report score (`5.0 − score`, counted once per report). Tiers (Critical/High/Medium/Low) use fixed thresholds over the share of low-fit (score < 4.0) reports naming the gap. Output carries `schema_version` so the `upskill` mode's diff-vs-previous section never compares across extraction-rule changes, plus coverage stats (`reportsWithMachineSummary` vs `reportsRead`). The script emits data only; the `upskill` mode reads the tiered `gaps` JSON and, in phase 2b (#1740), layers a **web-searched learning plan** (free-first resources per Critical/High gap — plus Medium when the map is small) onto the aggregate report. The plan is generated by the agent, not this script — no web-search logic lives in `upskill.mjs`.

```bash
npm run upskill
npm run upskill -- --summary
npm run upskill -- --min-reports 3
node upskill.mjs --url-text https://boards.greenhouse.io/acme/jobs/123   # targeted: gaps for one JD
node upskill.mjs --url-text ./jds/my-job.txt                            # targeted: --url-text also takes a local file
node upskill.mjs --self-test
```

**Exit codes:** `0` analysis succeeded (including graceful `{error}` JSON for insufficient data), `1` self-test failure.

---

## salary-gap

Folds compensation observations into per-application desired/advertised/actual values and gap aggregates. Sources: `reports/*.md` Machine Summary `advertised_comp` (advertised, source `jd` — historical reports backfill automatically), `data/salary-observations.tsv` (desired/actual/stated, append-only), and `config/profile.yml` `compensation.target_range` (desired default). Fold precedence: highest trust tier wins, then latest date (`actual`: contract > offer-letter > recruiter-verbal > user). Aggregates group by (company, role) and per currency — no FX conversion. Unparseable amounts, orphaned tracker numbers, sample sizes, and staleness are always reported.

```bash
node salary-gap.mjs             # JSON
node salary-gap.mjs --summary   # table + data-quality section
node salary-gap.mjs --stated-for <tracker#>   # prior `stated` observations for one tracker#, JSON
node salary-gap.mjs --self-test
```

Observation line format (TSV, one per line, `#`-prefixed lines are comments):

```text
{tracker#}\t{YYYY-MM-DD}\t{desired|advertised|actual|stated}\t{amount}\t{currency}\t{source}\t{note}\t{round}\t{interviewer}
```

Amounts: number + optional k/K suffix, ranges allowed ("80-90k"), annual gross unless noted. Sources: jd | profile | user | recruiter-verbal | offer-letter | contract.

**`stated` observations** are a narrower-purpose addition (#1852): a specific compensation number the candidate verbally committed to, in a specific interview round, to a specific interviewer — so a later round doesn't accidentally contradict it. `round` and `interviewer` are two optional trailing columns, meaningful only for `stated` rows (existing rows without them still parse — they default to `''`). `stated` observations carry no trust tier and never participate in the desired/advertised/actual fold or gap math; look them up with `getStatedObservations(observations, num)` or `--stated-for`. Interview-prep modes (`modes/interview/plan.md`, `modes/interview-prep.md`) check this before generating comp-related prep content — see their Inputs sections.

**Exit codes:** `0` always (missing sources produce an explanatory empty result), `1` self-test failure.

---

## funnel-velocity

Funnel calibration vs market benchmarks + stage velocity. Three payloads, decreasing availability: **calibration** — your funnel rates (canonical `ever*` definition imported from `stats.mjs`) vs candidate-side benchmark ranges from `templates/benchmarks.yml` (override: `config/benchmarks.yml` or `--benchmarks <path>`); **waiting** — in-flight Applied rows and elapsed days vs the typical first-response window (per-row factual reporting; applied-date priority: status-log observation > `Applied YYYY-MM-DD` in tracker notes > unknown, never guessed); **velocity** — median/p75 days per stage hop (Applied→Responded→Interview→Offer, Applied→Rejected separate) folded from `data/status-log.tsv`.

Statistical honesty is enforced in code: right-censored counts printed next to every median ("n still waiting, excluded"), same-day catch-up hops excluded and counted, no comparative multiplier claims below n=20 applied, above-range output carries a selection-bias note, every benchmark mention carries its year + "directional". Coverage, orphaned tracker numbers, unparseable lines, and unknown sources are always reported.

```bash
node funnel-velocity.mjs             # JSON
node funnel-velocity.mjs --summary   # human-readable
node funnel-velocity.mjs --self-test
node funnel-velocity.mjs --benchmarks path/to/benchmarks.yml
```

Ledger line format (TSV, appended by `set-status.mjs`, `#`-prefixed lines are comments):

```text
{tracker#}\t{YYYY-MM-DD}\t{from}\t{to}\t{source}\t{note}
```

`from` may be `-` (unknown prior state); `to` = `-` retracts the row's latest observation; a later `correction`-source line with the same (tracker#, to) replaces the earlier observation's date. Sources: set-status | correction | backfill | manual (only set-status/correction feed day-math).

**Exit codes:** `0` always (missing tracker/ledger produce an explanatory empty result), `1` self-test or benchmarks-load failure.

---

## assessment-log

Logs "received a skills assessment" as a structured per-application event (eSkill, HackerRank, Criteria, Predictive Index, ...) instead of burying it in free-text notes. Each event records platform, subject tested, pass threshold vs score achieved (both optional — vendors often hide them), and a candidate-observed staleness note (e.g. "test content references Adobe Acrobat 9, a 2008-era version"; empty = no staleness observed). Events append to `data/assessments.tsv` (user layer, created on first `add`, never rewritten). Aggregates count events, pass/fail (only when both threshold and score are known), and stale-flagged events per platform; malformed lines are always reported, never dropped silently.

```bash
node assessment-log.mjs add --company Acme --report 042 --platform eSkill --subject "MS Office" --threshold 70 --score 92 --stale "references Adobe Acrobat 9 (2008-era)"
node assessment-log.mjs             # JSON
node assessment-log.mjs --summary   # per-event + per-platform table
node assessment-log.mjs --self-test
```

Log line format (TSV, one per line, `#`-prefixed lines are comments; for `report#`, `threshold%`, and `score%`, `-` or an absent trailing cell = unknown; an empty `stale_note` means no staleness was observed, not unknown):

```text
{YYYY-MM-DD}\t{company}\t{report#|-}\t{platform}\t{subject}\t{threshold%|-}\t{score%|-}\t{stale_note}
```

**Exit codes:** `0` success (a missing log produces an explanatory empty result), `1` invalid `add` arguments or self-test failure.

---

## company-history

Read-only per-company evidence-card aggregator. Joins `data/applications.md` (tracker), `data/follow-ups.md`, and `data/scan-history.tsv` per company (and a `funnel-velocity.mjs` status-log source, loaded defensively via dynamic `import()` — probed for optional applied-date/median helpers and degrading to `false` when they are absent). Companies are joined on a normalized key (`normalizeCompany`); rows whose company normalizes to an empty key (e.g. non-Latin names that strip to nothing) are never merged into another company's card — they are excluded and counted in `dataQuality.unjoinable` instead.

Each card covers two independent fact axes, never combined into a single verdict:

- **`responsiveness`** — has this company ever responded to you, or gone silent on an Applied row past the silence window? A rejection counts as a response (it's an answer, not silence). Labels: `responded-before`, `silent-on-you`, `mixed`, `no-history`. Rows younger than the silence window are **pending** — right-censored, never labeled silent. Facts older than 365 days are **stale** and excluded from label computation unless `--include-stale` is passed. Follow-ups sent never change the label — they only annotate a silent fact's `confidence` (`confirmed-by-followups` vs `unconfirmed`).
- **`postingChurn`** — does this company repost the same role repeatedly (evergreen requisition / re-opened search), sourced from `detect-reposts.mjs` clusters over `data/scan-history.tsv`. Labels: `reposts-detected`, `none-detected`, `no-scan-data`.

The script deliberately reports **facts, not verdicts** — output is always descriptive and past-tense ("silent 34d since 2026-05-01"), never "ghosted" or "risk". Every silent fact carries a dated `clearInstruction` (the exact `set-status.mjs` command to run if the company actually did respond and it just wasn't logged), and every card with a silent fact is accompanied by an innocent-explanations line: high-volume inboxes, evergreen requisitions, re-opened searches, and the candidate's own unlogged responses all produce the same raw signals as genuine silence. Before trusting the output against real data, run a dry read (`node company-history.mjs --summary`) and sanity-check a few cards where you already know the real story.

```bash
node company-history.mjs                        # full JSON evidence cards to stdout
node company-history.mjs --summary               # human-readable cards (hygiene nudge, then silent-first, window caveat printed once)
node company-history.mjs --company "Acme"         # single-card lookup (unknown company returns the minimal no-history/no-scan-data shape)
node company-history.mjs --silence-window 21      # override the default silence window in days
node company-history.mjs --include-stale          # include facts older than 365d in label computation
node company-history.mjs --self-test
```

Default silence window: `templates/benchmarks.yml` `days_first_response.range_days[1] * 2` when that file exists, else `28` days.

**Exit codes:** `0` success, including empty/no-data runs (a missing tracker, follow-ups, or scan-history source degrades gracefully rather than failing), `1` unrecognized CLI flag or an unexpected runtime error.

---

## contacts

Your job-search phonebook, exportable to your phone. Reads `data/contacts.tsv` (one contact per line — the schema is the vCard fields, nothing more) and emits vCard 3.0 (`VERSION:3.0` for iOS/Android import compatibility) with CRLF line endings, byte-safe 75-octet line folding, and a stable deterministic UID `careerops-{uidPart(name)}--{uidPart(company)}` (double-dash boundary between the two parts). Each `uidPart` is the lowercase slug of the raw value (non-alphanumeric runs collapsed to single dashes, ends trimmed) suffixed with an 8-hex sha1 of the *raw* value — e.g. `jane-doe-cac7bbb6`; when the slug is empty — a fully non-ASCII value such as a CJK name — the part is the bare 8-hex hash. Hashing the raw value (not the lossy slug) keeps distinct inputs that slug identically — e.g. `José` and `Josè` both slug to `jos` (the accented char drops out), and `Acme Inc` and `Acme, Inc.` both to `acme-inc` — from colliding into one UID. Re-importing updates existing entries instead of duplicating them on platforms that honor vCard UID (iOS fallback: assign imports to a group, delete the group to bulk-remove). `--caller-id` renders the display name as `Jane Doe (Acme recruiter)` so the lock screen tells you which recruiter is calling — useful when a phone number is known (often it isn't). Malformed rows are reported in a `quality` block, never dropped silently.

```bash
node contacts.mjs                    # JSON (contacts + quality + total)
node contacts.mjs --summary          # human-readable table
node contacts.mjs --vcf [path]       # write vCard file (default output/contacts.vcf)
node contacts.mjs --vcf --caller-id  # FN as "Jane Doe (Acme recruiter)"
node contacts.mjs --self-test
```

Contact line format (TSV, one per line, `#`-prefixed lines are comments):

```text
{name}\t{company}\t{type}\t{title}\t{phone}\t{email}\t{linkedin}\t{tracker#|-}\t{notes}
```

`type`: recruiter | hiring-manager | peer | interviewer | other — optional; when present it must be one of the enum, else it is flagged in `quality`. Only name + company are required (>= 4 cells); all channels are optional; `-` for the tracker number when the contact precedes an application. Lines are updated in place when a contact's details change — unlike the append-only salary log. If two lines resolve to the same generated UID (`careerops-{uidPart(name)}--{uidPart(company)}` — normally rows with the same name + company), the LAST one wins the `--vcf` export (JSON keeps all rows and reports the clash in `quality.duplicates`). Import: send the `.vcf` to your phone (AirDrop/email/messaging) and open it — iOS Contacts offers "Add All Contacts", Android imports via Contacts → Fix & manage → Import.

**Exit codes:** `0` always (an empty/missing store prints an explanatory message and writes no file), `1` self-test failure or a `--vcf` path escaping the project directory.

---

## weekly-digest

Rolls up `interview-prep/sessions/*.md` — the structured, machine-readable transcripts `interview/debrief` and `interview/practice` already write (schema in `interview-prep/sessions/README.md`) — into a single digest for a date range (default: the current ISO week, Monday–Sunday). Groups sessions by company/role into a per-company round rollup (round type + date per round), counts `<!-- competency: tag[, tag...] -->` annotations across all sessions in range and flags any tag appearing 2+ times as recurring, and — best-effort, since `interview-prep/question-bank.md` has no fixed schema — attributes 🔴-tagged lines to whichever in-range company's heading they fall under. Purely mechanical: front-matter parsing, date filtering, and tag counting, no LLM judgment calls.

```bash
node weekly-digest.mjs                                   # JSON, current ISO week
node weekly-digest.mjs --summary                          # human-readable digest
node weekly-digest.mjs --from 2026-07-13 --to 2026-07-19  # explicit date range
node weekly-digest.mjs --dir path/to/sessions             # override sessions dir (test isolation)
node weekly-digest.mjs --self-test
```

`interview-prep/sessions/` is gitignored, and session content contains real interviewer names and companies — see the "Privacy — important" section of `interview-prep/sessions/README.md` for the source of that statement. A fresh clone or a week with no interviews reports "no interviews recorded in this range" and exits `0`, never an error.

**Exit codes:** `0` always (missing sessions dir/question bank, or an empty range, produce an explanatory empty result), `1` invalid `--from`/`--to` or self-test failure.
## check-table-freshness

Staleness validator for the jurisdiction data tables (umbrella #2026). The tables' correctness decays on a schedule — minimum wages adjust annually, pre-announced legal changes land on known dates — and every row already carries the metadata to watch: a mandatory `as_of` verification date and, for rate-style rows, `next_effective`. This script is the watchdog: zero LLM, zero network, zero writes.

Discovery is schema-agnostic: any `templates/*.yml` (non-recursive) whose parsed YAML contains at least one object row with an `as_of` field is treated as a jurisdiction table — rows may sit in a top-level array or in an array under any top-level key (e.g. `covenants:`). Files without `as_of` rows (`states.yml`, `portals.example.yml`, `benchmarks.yml`) are silently skipped, so new tables are picked up automatically with no per-table registration. On a checkout with no jurisdiction tables yet, the script reports zero tables and exits `0` — that is the designed empty state, not an error.

Two finding types:

- **`expired`** (hard) — the row has a `next_effective` date, today ≥ `next_effective`, and the row was not re-verified on or after that date (`as_of` < `next_effective`): the pre-announced change has arrived and the table hasn't been updated.
- **`review-due`** (soft) — `as_of` is older than the review threshold (default 12 months): nobody has re-verified the row in a legal cycle. Threshold precedence: `--max-age-months` flag > `config/profile.yml` `table_freshness.max_age_months` > default. Thresholds are strict positive integers — an invalid flag value is a usage error (exit 1, fail-fast, never a silent fallback); an invalid config value is reported as a warning and the default applies.

Each finding copies the row's `sources`, so whoever picks it up knows exactly where to re-verify. Malformed or missing dates produce a warning entry and the row is skipped — never a crash: once an array qualifies as a row-set (≥1 row with `as_of`), a sibling row that *forgot* its mandatory `as_of` warns too, instead of silently vanishing from validation. All date math is UTC-midnight calendar math (no time-of-day drift); dates in tables are quoted `YYYY-MM-DD` strings.

```bash
npm run freshness
node check-table-freshness.mjs                    # JSON
node check-table-freshness.mjs --summary          # human-readable table
node check-table-freshness.mjs --max-age-months 6 # override review threshold
node check-table-freshness.mjs --today 2026-10-02 # deterministic date for tests
node check-table-freshness.mjs --self-test
```

**Exit codes (CI-friendly):** `1` if any `expired` finding or on invalid usage (bad `--max-age-months` / `--today` values), `0` otherwise — `review-due` alone never fails the run, so a scheduled job only goes red when a known legal change has actually landed unaddressed.

---

## update:check

Checks whether a newer version of career-ops is available upstream. Outputs JSON to stdout:

```bash
npm run update:check
```

Possible JSON responses:

| `status` | Meaning |
|----------|---------|
| `up-to-date` | Local version matches remote |
| `update-available` | Newer version exists (includes `local`, `remote`, `changelog`) |
| `dismissed` | User dismissed the update prompt |
| `offline` | Could not reach GitHub |

**Exit codes:** `0` always.

---

## update

Applies the upstream update. Creates a timestamped backup branch (`backup-pre-update-<version>-<YYYYMMDDTHHMMSSZ>`), fetches from the canonical repo, checks out only system-layer files, runs `npm install`, and commits. The timestamp is derived from UTC ISO time with separators and milliseconds removed (for example, `backup-pre-update-1.8.1-20260608T071302Z`). User-layer files (`cv.md`, `config/profile.yml`, `data/`, etc.) are never touched.

```bash
npm run update
```

**Exit codes:** `0` success, `1` lock conflict or safety violation.

---

## rollback

Restores system-layer files from the most recent backup branch created during an update. Rollback prefers the newest timestamped branch matching `backup-pre-update-<version>-<YYYYMMDDTHHMMSSZ>` and still accepts legacy `backup-pre-update-<version>` branches for older installs.

```bash
npm run rollback
```

**Exit codes:** `0` success, `1` no backup branch found or git error.

---

## liveness

Tests whether job posting URLs are still live. Two rungs: a zero-token ATS API check first (`liveness-api.mjs` — Greenhouse, Lever, Ashby, Workday), falling back to headless Chromium (`liveness-browser.mjs`) for non-ATS pages or when the API is inconclusive. The browser rung detects expired patterns (e.g. "job no longer available"), HTTP 404/410, ATS redirect patterns, and apply-button presence, and supports multi-language expired patterns (English, German, French).

Per-job ATS endpoints (Greenhouse, Lever, Workday) treat a 200 as proof the posting is live; Ashby's public API is org-level (the whole job board), so that rung parses the board and confirms the specific job id is still listed. A definitive 404/410 from any ATS API is authoritative and short-circuits the browser check entirely — zero tokens, no browser launch.

```bash
npm run liveness -- https://example.com/job/123
npm run liveness -- https://a.com/job/1 https://b.com/job/2
npm run liveness -- --file urls.txt
npm run liveness -- --no-fallback https://a.com/job/1   # stay fully headless (no headed retry on anti-bot walls)
npm run liveness -- --throttle=5000 --file urls.txt      # jittered wait between checks (rate-based WAFs)
```

Each URL gets a verdict: `active`, `expired`, or `uncertain` with a reason.

**Exit codes:** `0` all URLs active, `1` any expired or uncertain.

---

## scan

Zero-token portal scanner. Runs configured local parsers for SSR/static career pages and hits ATS APIs (Greenhouse, Ashby, Lever) directly — no LLM tokens consumed. Reads `portals.yml` for target companies, outputs matching listings to stdout, and optionally appends to `data/pipeline.md`.

`scan_history.recheck_after_days` in `portals.yml` lets old `added` URLs become eligible for recheck after the configured number of days. If absent, scan-history dedup keeps the historical behavior and dedups forever. Permanent invalid statuses such as blocked host and malformed URL remain permanent.

For custom SSR pages, configure a tracked company with `scan_method: local_parser` and a `parser` block. The parser can be written in JavaScript, Python, or any language available as a local executable. Company-specific parsers usually already know their source URL and only need to print JSON jobs to stdout:

```yaml
parser:
  command: node
  script: scripts/parsers/example-company-jobs.js
  format: jobs-json-v1
```

Use `args` only for reusable parsers that intentionally accept runtime parameters such as `{careers_url}` or `{company}`.

If a parser writes full extraction artifacts for debugging or audit, store them under `data/parser-output/{company}/`. `scan.mjs` reads stdout and does not require those JSON files after parsing. Keep generated JSON artifacts out of git; `.gitkeep` placeholders are the only exception for preserving directory structure.

When the ATS provider's list API returns a description, each new offer is fingerprinted for cross-listing detection. See [Cross-listing detection](#cross-listing-detection) under `scan:full` for details.

**Company blacklist (#1742):** if `data/blacklist.md` exists (user layer, opt-in — see `templates/blacklist.example.md`), postings from listed companies are skipped, matched case- and punctuation-insensitively with the same company normalization the tracker scripts share. Skips are never silent: the run summary reports `N skipped (blacklist)` and the count is persisted to `data/scan-runs.tsv` as `filtered_blacklist`. Pass `--include-blacklisted` to bypass the filter for auditing — matching postings flow through annotated (`note: blacklisted: {reason}` in `data/pipeline.md`). No blacklist file = no filtering; nothing ever adds a company to the list automatically.

```bash
npm run scan
node scan.mjs --include-blacklisted   # audit: let blacklisted companies through, annotated
```

**Exit codes:** `0` scan completed, `1` configuration error or no portals.yml found.

---

## scan:full

Reverse ATS discovery scanner. Where `scan.mjs` scans the companies you track in `portals.yml`, this inverts the direction: it walks public directories of companies per ATS (Greenhouse, Lever, Ashby, Workday) and surfaces fresh postings matching your `portals.yml` `title_filter` / `location_filter` — no manual company curation. Company directories come from the public [job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator) dataset, cached in `data/cache/` for 24 hours.

Postings without a usable publish date are skipped — a reverse scan is only useful for fresh postings. New matches are appended to `data/pipeline.md` and `data/scan-history.tsv` in the same format as `scan.mjs`.

`data/blacklist.md` is respected here too: blacklisted companies are skipped by default and reported in the summary. Pass `--include-blacklisted` to audit them instead; matching postings flow through annotated (`note: blacklisted: {reason}` in `data/pipeline.md`).

### Cross-listing detection

`data/scan-history.tsv` carries a **SimHash fingerprint** of the JD text in its 8th column (`jd_fingerprint`), and the original posting date in its 9th column (`postedAt`). The fingerprint column exists to catch a specific double-submission hazard: the same role posted by the direct employer **and** by a recruitment agency, often with the employer name stripped from the agency listing. URL dedup and company+role dedup both miss this pair because the URLs and company names are different — but agencies rarely rewrite the requirements text, so a near-identical JD body is a reliable signal.

The 12th column (`normalized_company`) stores the **canonical company key** — the raw company (col 5) run through the shared `normalizeCompanyName` (lowercased, punctuation/whitespace folded, trailing legal-entity suffixes stripped), so `Acme Inc.`, `Acme, Inc.` and `ACME  Inc` all resolve to `acme`. It is written at scan time so repost/name matching (`detect-reposts.mjs`) keys on a stable value instead of re-deriving it or routing a legitimacy signal through script execution. The column is **additive and trailing**: rows written before it existed simply omit it, and consumers normalize the raw company on the fly for those rows (backward-compatible). All columns beyond col 7 are append-only — index-based readers (including the web parser, which reads only cols 0-6) are unaffected.

How it works:

- When the ATS provider's list API returns a description field (e.g. Lever's `descriptionPlain`), the scanner computes a **64-bit SimHash** of the normalized text and stores it as the 8th column.
- SimHash is locality-sensitive: near-duplicate texts land within a few bits of each other. The scanner flags any two rows from **different companies** whose fingerprints are ≥ 92 % similar (at most 5 of 64 bits differ) and that appeared within a 90-day window.
- The check is **warn-only**: nothing is dropped automatically. If one side is an agency, apply through ONE channel only — a double submission burns the candidate with both parties.
- Postings without a usable description get an **empty fingerprint** and are never flagged. No body → no signal, no false positives.
- The fingerprint is computed **locally** from the text already returned by the API. No extra network request is made and the JD body itself is not stored in the TSV.

Same detection logic applies to `scan.mjs` (the standard portal scanner) — the sub-section above is shared between both commands.

```bash
npm run scan:full                              # all ATS directories, last 3 days
node scan-ats-full.mjs --since 7               # postings from the last 7 days
node scan-ats-full.mjs --ats greenhouse,workday # subset of sources
node scan-ats-full.mjs --limit 200             # max companies per ATS
node scan-ats-full.mjs --dry-run               # preview without writing
node scan-ats-full.mjs --liveness              # Playwright-verify matches first
node scan-ats-full.mjs --include-blacklisted   # audit blacklist matches instead of skipping
node scan-ats-full.mjs --md-out notes/scans    # also write a dated markdown digest
npm run scan:seeds                             # probe VC portfolio seed companies (--seeds yc,a16z)
npm run scan:yc                                # Y Combinator portfolio only (--seeds yc)
```

`--seeds <list>` fetches comma-separated VC portfolio sources (e.g. `yc,a16z`)
and probes those companies via the ATS providers instead of (or in addition
to) the directory walk. Other flags: `--verbose`, `--json`, `--include-undated`,
`--shuffle`.

### DNS pacing

A full sweep resolves one hostname per Workday and iCIMS tenant — 13,889 distinct hostnames across the current datasets (3,781 Workday + 10,108 iCIMS), against 3 for Greenhouse, Lever and Ashby combined. Those lookups are irreducible (nothing to cache: every hostname is distinct), and issued unpaced they trip the per-client rate limit on a resolver like Pi-hole, which then refuses queries for the whole machine — the scan reports thousands of misleading `fetch failed` lines while the boards themselves are fine (#2229).

Uncached, non-coalesced lookups are therefore paced at **400 per minute** by default. The token is spent *before* `dns.lookup()` runs, so a name answered locally — from `/etc/hosts`, say — still costs one; the ceiling meters what the process asks to resolve, not what leaves the machine.

How many upstream queries that becomes depends on the OS resolver: `dns.lookup()` delegates to `getaddrinfo`, which may answer without any query at all, but on a typical glibc host with `autoSelectFamily` it emits an A **and** an AAAA query — roughly 800 queries/minute, measured against a Pi-hole. That is under a stock Pi-hole's 1,000/minute with headroom for the rest of the machine; size it against your own resolver's limit.

Cache hits and lookups that coalesce onto an in-flight one are free, so only uncached, non-coalesced lookup keys count against the ceiling — a hostname not in the cache, or a cached one requested with different resolver options (the cache key is hostname plus `family`/`all`/`hints`/`verbatim`).

```bash
CAREER_OPS_DNS_LOOKUPS_PER_MIN=800 npm run scan:full   # raise the ceiling
CAREER_OPS_DNS_LOOKUPS_PER_MIN=0 npm run scan:full     # no pacing (pre-#2229 behaviour)
CAREER_OPS_NO_DNS_CACHE=1 npm run scan:full            # no DNS cache AND no pacing
```

The cost is real: a full Workday + iCIMS sweep becomes DNS-bound at roughly 35 minutes. Raise the ceiling if your resolver has the budget — but if you see `fetch failed` in bulk from one ATS section, suspect the resolver before the boards.

**Exit codes:** `0` scan completed, `1` configuration error (no portals.yml, unknown `--ats` source) or fatal scan error.

---

## company:funded

Review-first discovery for companies that recently raised funding. It reads structured public RSS/API sources and prints a candidate report for manual review. It never edits `portals.yml` and does not probe company websites.

```bash
npm run company:funded -- --dry-run --limit 20
npm run company:funded -- --dry-run --limit 20 --months 3 --json
npm run company:funded -- --dry-run --sort score --limit 20
npm run company:funded -- --sources techcrunch,prnewswire,guardian,hn
npm run company:funded -- --self-test
```

Defaults: last 3 months, `--sort date`, sources `techcrunch,prnewswire,guardian,hn`. `--sort score` ranks by source and funding-detail confidence instead.

Runs without `--dry-run` write JSON under `output/` and a Markdown report under `reports/`.

Source diagnostics are included in JSON output and surfaced in human output when a source has errors, is blocked, returns no items, or when no candidates are found.

**Exit codes:** `0` discovery completed, `1` invalid arguments or fatal runtime error.

---

## tracker

SQLite **derived index** for the applications tracker (RFC #918, phase 1). `data/applications.md` stays the source of truth; `data/applications.db` is built from it by `sync` and is safe to delete at any time — it regenerates on the next sync. All writes keep going to the markdown exactly as today (`merge-tracker.mjs`, hand edits); the index is read-only infrastructure.

Why: at hundreds of rows a markdown table degrades structurally (encoding corruption, column drift, `|` inside cells shifting columns), and agents grepping it get model-dependent results. The index normalizes on sync, so a query returns the same rows for every model on every CLI — and corruption is detected at sync time instead of propagating silently.

Zero new dependencies — uses `node:sqlite`, built into Node ≥ 22.5.

```bash
node tracker.mjs sync                     # (re)build applications.db from applications.md
node tracker.mjs sync --check             # diagnose corruption only, no write (exit 1 if issues found)
node tracker.mjs query --status Applied --since 2026-05-01
node tracker.mjs query --company acme --json
node tracker.mjs history --id 42          # status transitions observed across syncs (Applied → Interview → ...)
node tracker.mjs export                   # inverse: index → canonical markdown table on stdout
node tracker.mjs export --out repaired.md # write to a file (existing file backed up to .bak first)
```

`query` and `history` auto-resync when the markdown changed since the last sync, so the index can never serve stale reads.

`sync` detects and reports the corruption classes markdown accumulates — mojibake placeholder cells, scores stranded in the status column, non-canonical statuses (resolved via `templates/states.yml` aliases), missing/duplicate ids, stray pipes — and normalizes them **in the index only**; the markdown is never modified. Fix at the source with `normalize-statuses.mjs` / `dedup-tracker.mjs`, then re-sync. Status changes between syncs accumulate in a `status_events` table, which gives `analyze-patterns.mjs` a real funnel instead of only the current snapshot.

`export` is the inverse of `sync` (round-trip `md → db → md` is lossless for clean input — enforced by `test-all.mjs`). It writes to stdout by default and never touches `applications.md` unless you explicitly pass it as `--out`. Phase 2 of #918 (DB becomes source of truth, markdown becomes a rendered view) is a separate, explicit per-user opt-in — not part of this script yet.

**Exit codes:** `0` success, `1` validation error, missing prerequisites (Node < 22.5, no `applications.md` to index), or corruption found by `sync --check`.

---

## find

Resolves a report number, tracker number, or company/role fragment to its full pipeline identity: company, role, tracker#, report#, canonical status, PDF path (from `data/pdf-index.tsv`), and report path. "Apply to #13" is ambiguous — report numbers and tracker row numbers diverge — and answering it used to require opening three files; this does it in one read-only lookup.

Zero dependencies, strictly read-only. Numeric queries match **both** the tracker # column and the report number from the Report link (`012` and `12` are the same number), so collisions between the two numbering schemes surface as multiple rows instead of a silent wrong pick. Text queries match company/role by case-insensitive substring, with the shared fuzzy matcher (`role-matcher.mjs`) as fallback for multi-word phrases.

```bash
node find.mjs 13                # report# OR tracker# 13 — shows both if they differ
node find.mjs acme              # company fragment
node find.mjs "data engineer"   # role phrase (fuzzy via role-matcher)
node find.mjs acme --json       # machine-readable output
```

Multiple matches print as a table; zero matches print a clean message.

**Exit codes:** `0` at least one match, `1` no match, missing query, or no `applications.md`.

---

## paste-reply

Manual, no-Gmail input path into `reply-watch.mjs`'s classification pipeline (#1802). `reply-watch.mjs` already classifies employer replies and matches them to tracker rows, but its only input is `data/reply-candidates.json`, and the only planned way to populate that file is a Gmail scanner (#1583, unbuilt, requires OAuth inbox-read access). `paste-reply.mjs` normalizes a pasted (or file-provided) email's subject/from/body into the exact candidate shape `reply-watch.mjs` expects and appends it — existing candidates are never overwritten. It does not classify the reply itself (that stays `reply-watch.mjs`'s job) and never runs `reply-watch.mjs` or touches `data/applications.md`.

```bash
npm run paste-reply                    # interactive: prompts for subject, from, body
node paste-reply.mjs --file email.txt  # read subject/from/body from a file
```

`--file` format (header lines optional, blank line separates headers from body):

```text
Subject: <subject line>
From: <sender>

<body text...>
```

If no `Subject:`/`From:` header lines are found, the whole file is treated as the body. After appending, run `node reply-watch.mjs` to classify the new candidate and review suggested tracker updates.

**Exit codes:** `0` candidate appended, `1` missing `--file` argument, input file not found, or no subject/body text found.

---

## or (OpenRouter runner)

Runs the pipeline on OpenRouter free models with automatic fallback — no
Claude Code CLI required.

```bash
npm run or:scan                 # scan configured companies for new listings
npm run or:eval -- <url>        # evaluate a job by URL (no URL: paste interactively)
npm run or:pipeline             # process pending URLs
npm run or:apply                # application assistance
```

---

## reconcile

Syncs the `data/pipeline.md` "Pendientes" section with `batch/batch-state.tsv`.
`batch-runner.sh` records evaluated offers in the state file but never writes
back to `pipeline.md`, so batch-processed offers would otherwise be
re-surfaced by every later scan or pipeline run.

```bash
npm run reconcile
```

---

## cover-letter

Renders a cover-letter JSON payload to PDF: fills
`templates/cover-letter-template.html` with the payload, then renders via the
same Playwright pipeline as CVs.

```bash
npm run cover-letter -- payload.json
node generate-cover-letter.mjs --payload payload.json --out output/slug-cover.pdf
```

---

## verify:portals

Online ATS-slug validator — complements the offline `validate:portals`. A
wrong slug in `careers_url` 404s silently on every future scan, so this
probes the public Greenhouse / Ashby / Lever endpoints to confirm each slug
actually resolves.

```bash
npm run verify:portals
```

---

## reposts

Repost detector. Reads `data/scan-history.tsv`, fuzzy-matches role titles per
company, and flags any company+role listed 2+ times with different URLs
within a 90-day window — a strong ghost-job / re-listing signal.

```bash
npm run reposts                 # JSON
node detect-reposts.mjs --summary
```

---

## gemini:eval / ollama:eval / openai:eval

Standalone evaluators — run the same evaluation logic
(`modes/oferta.md` + `modes/_shared.md` + `cv.md`) without an interactive AI
CLI:

- `gemini:eval` — Google Gemini free tier (`GEMINI_API_KEY` in `.env`)
- `ollama:eval` — fully local and private via Ollama
- `openai:eval` — any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq,
  DeepSeek, LM Studio, llama.cpp, vLLM, ...)

```bash
npm run gemini:eval -- "We are looking for a Senior AI Engineer..."
node gemini-eval.mjs --file ./jds/my-job.txt
npm run ollama:eval -- "JD text"
npm run openai:eval -- "JD text"
```

---

## star

Zero-LLM, zero-browser behavioural question matcher. Parses
`interview-prep/story-bank.md`, scores each STAR story against the question
text (optionally plus a JD file), and returns the top matches formatted to
ATS paste length (250-500 words).

```bash
npm run star -- "Tell me about a time you disagreed with a decision"
```

---

## archive

Saves a live job posting as PDF via Playwright before it disappears —
postings vanish once filled, and the original requirements matter for
interview prep and salary negotiation evidence.

```bash
npm run archive -- https://example.com/job/123
```

---

## prepare:application

ATS auto-fill helper for Greenhouse, Ashby, and Lever. Detects the ATS from
the apply URL, reads candidate data from `config/profile.yml`, and prints a
prefill summary to stdout. **Never POSTs anything** — you review the output,
open the apply URL, and submit yourself. See
[APPLY_AUTOFILL.md](APPLY_AUTOFILL.md).

```bash
npm run prepare:application -- --url https://boards.greenhouse.io/acme/jobs/123
```

---

## build:dashboard

Cross-platform build wrapper for the Go TUI dashboard: picks the
platform-correct output name (`career-dashboard.exe` on Windows, else
`career-dashboard`), since a bare `go build -o` writes an extension-less
binary on Windows. Requires Go 1.24+.

```bash
npm run build:dashboard
npm run serve:dashboard    # or run the TUI directly without building
```

---

## Agent-invoked utilities

These have no `npm run` binding — modes and agents call them with
`node <script>` directly. Each script's header comment documents its flags.

| Invocation | Purpose |
|------------|---------|
| `node set-status.mjs <report#\|company> <State> [--note]` | Canonical tracker write path: strict states.yml validation, shared lock, atomic write. Modes call this instead of hand-editing `applications.md` |
| `node mark-pdf-ready.mjs <report#> [--dry-run] [--json]` | Mark the matched tracker's PDF cell ready after the web PDF render path finishes; resolves the report number, uses the shared tracker lock, and writes atomically |
| `node followup-cadence.mjs [--summary]` | Follow-up cadence per active application; flags overdue entries |
| `node followup-seed.mjs [--backfill]` | Seed `data/follow-ups.md` with a pinned first follow-up date when a row turns Applied |
| `node reply-watch.mjs` | Classify employer replies from `data/reply-candidates.json`, match to tracker rows, print a review digest |
| `node process-quality.mjs [--summary]` | Aggregate `[process-friction]` tags from `data/active-interviews.md` per company |
| `node reserve-report-num.mjs [--count N]` | Atomically reserve report numbers for parallel workers (fixes the #749 race) |
| `node agent-inbox.mjs add "..."` | Append a request to the queue the agent drains at the next session start |
| `node generate-latex.mjs <input.tex> [output.pdf]` | Validate and compile a generated `.tex` CV via tectonic or pdflatex |
| `node classify-tier.mjs` | Classify a job title into intern / entry / mid / senior |
| `node plugins.mjs list\|run <id> [hook]` | CLI host for non-provider plugin hooks (see [PLUGINS.md](PLUGINS.md)) |
| `node plugin-install.mjs` | Clone/scaffold/validate community plugins (allowlisted URLs, pinned SHA) |
| `node plugin-audit.mjs` | Static safety scan for community/registry plugins |
| `node validate-plugin-registry.mjs` | Shape gate for `plugins-registry/<id>.json` files |

---

## set-status.mjs

Canonical tracker write path: strict `states.yml` validation, shared lock, atomic write. Modes and agents call this instead of hand-editing `applications.md`.

```bash
node set-status.mjs <report#|company> <state> [--note "..."] [--on YYYY-MM-DD] [--force] [--dry-run] [--json]
node set-status.mjs --row N <state> [--note "..."]          # explicit tracker row ID
node set-status.mjs --report N <state> [--note "..."]       # row whose Report cell links report #N
node set-status.mjs "Company Name" Applied --role "Role"    # narrow match by role fragment
node set-status.mjs --row 12 Applied
node set-status.mjs --report 345 Applied --on 2026-08-01
```

A bare number or company name is convenient, but becomes ambiguous when multiple tracker rows exist for a company or when tracker row IDs and report IDs diverge. That divergence is permanent once it starts: `reserve-report-num.mjs` treats tracker row IDs as occupied when it allocates a report number, so a row that never got a report still consumes a number the report sequence then skips — the two counters leapfrog each other and never realign. On a diverged tracker "5" may mean tracker row #5 or report #5, which are different applications. Base selectors resolve the main target, while explicit selectors and filters disambiguate the target row:

- `--row N`: Selects the row whose `#` cell is `N`.
- `--report N`: Selects the row whose `Report` cell links report `N`.
- `--role <role>`: Narrowing selector that refines a company, report, row, or bare-number match when multiple tracker rows exist for a single target.
- `--on <date>`: Specifies an explicit transition date (YYYY-MM-DD) for status logs and notes.
- `--json`: Formats command output as structured JSON.

`--row` and `--report` are mutually exclusive. Because an explicit selector answers the report-mismatch guard rather than overriding it, `--row` bypasses that guard without needing `--force` (which silences the check while the ambiguity is still real).

This is worth preferring in practice, not just in principle. Once the counters have diverged, a bare number trips the guard whenever the row it matches links a report number other than its own `#`, or links no report at all while a different row claims that number as its report — so on a tracker with a wide gap the check keeps firing, and a check that keeps firing teaches callers to pass `--force` by reflex, which disables it everywhere including the cases it was written to catch. Reach for a selector (or the company name) instead.

### Bare numbers vs. explicit selectors

- **Use a bare number** when tracker row IDs and report IDs are identical or when querying interactively.
- **Use `--row N` or `--report N`** in automated scripts, modes, or whenever row IDs and report IDs have diverged to avoid triggering report-number mismatch guards or ambiguous updates. Use `--role` alongside a base selector to narrow down multiple matching roles for a company.

Exit codes (the shared `CLI_EXIT` contract in `tracker-utils.mjs`, so these values are stable across every canonical tracker writer):

- `0` success, including an idempotent no-op re-run that changed nothing.
- `1` for an invalid or conflicting selector, or a non-canonical state.
- `2` when the selector matches no tracker row.
- `3` when a bare numeric selector triggers the report-number mismatch guard (`report-number-mismatch`), or a company matches several rows.
- `4` when the shared tracker lock is busy — retryable, unlike the others.

Nothing is written on any non-zero exit.

To identify a row before writing to it, [find](#find) resolves a number, company, or role fragment to its full identity and surfaces collisions between the two numbering schemes rather than picking one silently.

## mark-pdf-ready.mjs

The web PDF render path calls this utility after a CV PDF has been generated so
the matching tracker row can be marked ready. It is not normally a manual
day-to-day command. The argument is the report number from the `reports/NNN-...`
filename or Report cell, not the tracker row's `#` value.

```bash
node mark-pdf-ready.mjs <report#>                  # mark the matching row
node mark-pdf-ready.mjs <report#> --dry-run       # validate without writing
node mark-pdf-ready.mjs <report#> --json          # emit machine-readable output
```

The script resolves the report-to-row link, refuses ambiguous matches, and
leaves an already-ready row unchanged. Writes use the same shared tracker lock
and atomic replacement as `set-status.mjs`, so concurrent tracker updates do
not overwrite one another. Exit status `0` covers a successful mark and an
idempotent no-op; `1` is a usage, column, or write error; `2` means the tracker
or report row was not found; `3` means the report matched more than one row;
and `4` means the tracker lock timed out and the operation should be retried.

---

## stats.mjs

Aggregates lifetime pipeline stats into one JSON report. Stats include tracker, scanner, portals, follow-ups and runs. Reads from data/applications.md, data/scan-history.tsv, portals.yml, data/follow-ups.md and data/scan-runs.tsv. If a file doesn't exist yet, the section turns into null.

```bash
node stats.mjs --summary             # returns human-readable table
node stats.mjs                       # returns json
```
On a fresh clone, with no data yet, the JSON format is as follows:

```
{
  "metadata": {
    "generatedAt": "2026-07-07",
    "sources": {
      "tracker": false,
      "scanHistory": false,
      "followups": false,
      "portals": false,
      "scanRuns": false
    }
  },
  "tracker": null,
  "funnel": null,
  "scan": null,
  "portals": null,
  "followups": null,
  "runs": null
}
```

With --summary it returns:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pipeline Stats — 2026-07-07
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tracker:    — no data (data/applications.md missing)
Scanner:    — no data (data/scan-history.tsv missing)
Portals:    — no data (portals.yml missing)
Follow-ups: — no data (data/follow-ups.md missing)
Runs:       — no data (data/scan-runs.tsv missing; created by the next scan)
```

---

## data/scan-runs.tsv

`scan.mjs` appends one row to this file after each non-dry scan run, recording how many companies/boards it checked, how many postings it found vs. filtered out vs. flagged as duplicates vs. added, and how many errors occurred. `--dry-run` scans never write to this file. Stats appended include:

* `timestamp` — ISO timestamp of the scan
* `status` — always `completed` for now
* `companies` — number of companies scanned this run
* `boards` — number of job boards scanned this run
* `found` — total postings found
* `filtered_title` — filtered out by title mismatch
* `filtered_tier` — filtered out by tier
* `filtered_location` — filtered out by location
* `filtered_salary` — filtered out by salary
* `filtered_content` — filtered out by content
* `filtered_cooldown` — skipped because you recently applied to the same company + role and are still in the waiting period
* `dupes` — duplicate postings skipped
* `new_added` — new postings actually added to the pipeline
* `errors` — number of errors during the run
* `filtered_blacklist` — skipped because the company is on your `data/blacklist.md` do-not-apply list (#1742)

As the project is in continuous development, to parse for a stat we recommend doing it by column header instead of position.
