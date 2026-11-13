# Search tracks

Four optional tracks sit on top of the normal career-ops flow. Each one is off
until you turn it on, and with all of them off nothing in the scan or the
evaluation changes.

| Track | What it adds |
|-------|--------------|
| **Europe** | European job boards; checks for work authorization, required languages and contract type; pay read in the posting's own currency and country convention |
| **AI gigs** | Boards and searches for AI engineering, agent, evaluation, automation and consulting work; nine AI archetypes; expert work told apart from per-task crowd work |
| **Freelance** | Freelance project boards; a rate analysis instead of a salary analysis; contract length, extension, client or agency, payment terms, Scheinselbstaendigkeit indicators; a pitch instead of a cover letter; gig rows in the tracker |
| **Remote** | A preference (remote only, remote first, hybrid is fine) that the evaluation checks against the posting's remote scope and time zone, and that the scanner can filter on |

The tracks follow the rules of the rest of the system: you stay in the loop,
nothing is submitted or sent, nothing about you is invented, and everything
stays on your machine. They add no scoring dimension: findings feed the
existing 1-5 score (`modes/tracks/README.md`).

## Turn them on

After onboarding has created `config/profile.yml` and `portals.yml`:

```bash
node tracks-setup.mjs --enable europe,ai_gigs,freelance --remote remote_first --country Germany --timezone Europe/Berlin
```

The command adds a `tracks:` block to your profile and merges the boards,
search queries and title keywords of the chosen tracks into your
`portals.yml`. It only adds. Every board, company, keyword and comment you
already have stays, and a second run changes nothing. `--dry-run` shows what
it would do. Then fill in the fields below, and run `node scan.mjs` as usual.

To turn a track off again, set its `enabled:` to `false` (or delete
`remote.preference`), and set `enabled: false` on the boards you no longer want.

## What you fill in

Everything lives under `tracks:` in `config/profile.yml`. Every field is
optional. An empty field is never guessed: the check that needs it reports
"unknown" and becomes a question in the evaluation.

```yaml
tracks:
  europe:
    enabled: true
    base_country: "Germany"            # where you live
    work_authorization: eu_citizen     # eu_citizen | uk_citizen | blue_card | residence_permit | needs_sponsorship
    target_countries: []               # empty = any country
    languages: { de: native, en: C1 }  # CEFR level (A1-C2) or native
    contract_types: []                 # empty = any; employment | fixed_term | eor | temp_agency | freelance
  ai_gigs:
    enabled: true
    focus: []                          # empty = all archetypes
    include_crowd_work: false
  freelance:
    enabled: true
    mode: alongside                    # alongside employment | only
    day_rate: { target: null, minimum: null, currency: EUR }
    hours_per_day: 8
    billable_days_per_year: 200
    min_contract_months: null
    max_payment_terms_days: null
    accept_agencies: true
    fx_to_base: {}                     # your own rates, e.g. { USD: 0.92, GBP: 1.17 }
  remote:
    preference: remote_first           # remote_only | remote_first | hybrid_ok | any
    timezone: "Europe/Berlin"
    hybrid_cities: []
    max_onsite_days_per_month: null
```

| Field | Effect |
|-------|--------|
| `europe.work_authorization` | Decides where you may work without a new permit. Unset, the authorization check stays "unknown". EU citizens are treated as authorized in the EU, the EEA and Switzerland, and not in the UK. A Blue Card or residence permit counts for `base_country` only. |
| `europe.languages` | Compared with what the posting requires. A required language you lack, or hold two levels below the ask, is a blocker; one level below is a caution. A posting written in a language other than English implies that language. |
| `ai_gigs.focus` | Archetype ids you want: `llm_engineer`, `agent_engineer`, `applied_ai`, `ml_engineer`, `llmops`, `evals`, `ai_automation`, `ai_consulting`, `ai_product`. |
| `ai_gigs.include_crowd_work` | `false`: per-task labelling and rating work is marked as outside the track. `true`: it is evaluated like expert work. |
| `freelance.day_rate` | With a target or minimum, a stated rate is compared with it. With neither, pay is shown with a market comparison and never counts against a gig. |
| `freelance.billable_days_per_year` | Used to turn a day rate into a contract value and to compare a rate with a salary. A day rate is never multiplied by 260. |
| `freelance.fx_to_base` | Your own conversion rates into the day-rate currency. Without one, a rate in another currency is shown unconverted and not compared. |
| `remote.preference` | `remote_only`: hybrid and on-site are mismatches. `remote_first`: hybrid is a compromise, on-site a mismatch. `hybrid_ok`: hybrid is fine. |
| `remote.timezone` | Required working hours are compared with it. "Pacific hours" from Central European Time is a mismatch; "4 hours of overlap with Eastern" is a caution. |

## In the scanner

`tracks-setup.mjs` writes this block to `portals.yml` when you choose a remote
preference. Without the block the scan is unchanged.

```yaml
tracks_filter:
  remote_fit: drop        # drop | off
  engagement: any         # any | freelance_only | employment_only
```

- `remote_fit: drop` removes a posting only when it **states** a mismatch:
  remote for another region ("Remote (US only)", "US-based candidates only"), a
  required far time zone, or on-site against a remote preference. A posting
  that does not say stays in. A city with no word on remote work is "unknown",
  not a mismatch; narrow by place with the existing `location_filter`.
- `engagement` keeps only freelance work or only employment, again only on a
  stated type.
- Dropped postings are counted on the summary line "Filtered by tracks".
- Most providers hand the scanner a title and a location only, so the filter
  mostly reads those two. The full check happens in the evaluation.

## In the evaluation

When the profile has a `tracks:` block, `oferta`, the pipeline and batch
workers read `modes/tracks/README.md` and run

```bash
node track-signals.mjs jds/acme.md --title "AI Engineer" --location "Remote (EMEA)" --company "Acme"
```

It is offline and uses no model. It prints, per enabled track, what the posting
states, the sentence each finding came from, and flags at three levels:
`blocker`, `caution`, `info`. The agent checks each finding against the posting
and quotes the posting in the report. The reader is conservative: wording it
does not recognise comes back as "unknown", never as a pass or a fail.

In the report, the tracks add rows to Block A (remote fit, work authorization,
languages, engagement, AI archetype), a flag line at the top of Block B for
each blocker, and for a gig a rate analysis in Block D in place of the salary
analysis. A confirmed blocker caps the global score at 2.0.

Three modes go with the freelance and AI gigs tracks:

| Mode | Use |
|------|-----|
| `/career-ops pitch` | Short proposal for a freelance or contract project. Draft only. |
| `/career-ops rate` | Rate position: opening number, target, walk-away line. |
| `/career-ops gig` | Expert profile for AI-training and AI-evaluation platforms. Draft only. |

## In the tracker

The tracker keeps its columns and states. A gig row starts its Notes with

```text
gig: 850 EUR/day, 6 mo, via Hays; ...
```

and `node gigs.mjs --summary` lists those rows with the day rate, the contract
value the length implies, the agency, and the rate against your target.

## Sources per track

`tracks-setup.mjs` takes these from `templates/tracks/portals.tracks.yml`. All
are public APIs, feeds or pages read without logging in. Each can be switched
off with `enabled: false` in your `portals.yml`.

| Track | Board | Provider | Access |
|-------|-------|----------|--------|
| Europe | Arbeitnow | `arbeitnow` | public API |
| Europe | Arbeitsagentur (German federal employment agency) | `arbeitsagentur` | official public API |
| Europe | GermanTechJobs | `germantechjobs` | RSS feed |
| Europe | Landing.jobs | `landingjobs` | public API |
| Europe | The Hub | `thehub` | public API |
| Europe | EU Remote Jobs | `euremotejobs` | the board's listing endpoint |
| Europe | Berlin Startup Jobs | `berlinstartupjobs` | RSS feed |
| Europe | Munich Startup | `munich-startup` | public page |
| Europe | karriere.at | `karriere-at` | public listing page (JSON view) |
| AI gigs | Agentic Engineering Jobs | `agentic-jobs` | public API |
| AI gigs | Hacker News "Who is hiring?" | `hackernews` | public API |
| AI gigs | Welcome to the Jungle | `wttj` | public search index |
| AI gigs | Alignerr | `alignerr` | the site's job list endpoint |
| AI gigs | Mercor | `mercor` | public page |
| AI gigs | DataAnnotation | `dataannotation` | public page |
| AI gigs | Surge AI | `surge` | public careers page |
| Freelance | freelancermap | `freelancermap` | the site's project search, first page per query |
| Freelance | Braintrust | `braintrust` | public API |
| Freelance | Etengo | `etengo` | the site's project filter |
| Freelance | Freelancer.com | `freelancer-com` | official public API |
| Freelance | Arbeitsagentur, self-employment offers | `arbeitsagentur` with `angebotsart: [2]` | official public API |
| Freelance | Hacker News "Freelancer?" thread | `hackernews` with `thread: freelancer` | public API |
| Remote | Remotive, RemoteOK, We Work Remotely, Working Nomads, Himalayas, NoDesk, Jobicy (Europe) | their own providers | public APIs and feeds |
| Remote | RemoteYeah, Real Work From Anywhere | `remoteyeah`, `realworkfromanywhere` | RSS feeds |

Each track also adds two web-search queries to `search_queries` for the agent-driven scan.

Also available, not in a preset: `get-in-it` and `efellows` (German graduate boards), `jobs-ch` and `jobscout24ch` (Switzerland), `a16z-portfolio`. Their example stanzas are in `templates/portals.example.yml`.

Things to know: the Hacker News freelancer thread had no client posts in its latest edition at the time of writing. freelancermap and Etengo show anonymous visitors only part of their inventory. The per-task AI platforms list many roles limited to certain countries or languages; the evaluation checks that.

Other boards in `docs/SUPPORTED_JOB_BOARDS.md` can be added by hand in the same way.

## Sources left out

These are not scanned, because their terms or access rules do not allow it.
Check them by hand, or through their own alerts.

| Source | Why |
|--------|-----|
| freelance.de | Its robots.txt forbids automated access |
| Malt, Hays, SOLCOM | Bot walls on the project pages |
| Upwork | API access needs an approved key |
| GULP, Outlier | Only an undocumented internal endpoint is available, and their terms were not reviewed. Many Outlier projects also appear on Braintrust |
| absolventa, jobs.de, micro1 | Blocked by a CAPTCHA, a bot challenge or a 403 when tested |
| stellenanzeigen.de, yourfirm.de | Refused from the test machine's country (403); not tested from Germany |
| LinkedIn, XING, Indeed, StepStone, Glassdoor | Login walls or terms that forbid scraping. Use their own job alerts; career-ops has LinkedIn alert import (`docs/LINKEDIN_ALERTS.md`) |
| Paid job-data APIs (Adzuna, Jooble, SerpAPI and similar) | Need a key; nothing in the tracks depends on a paid service |

## Limits

- The readers work on wording. They cover English and German well, and French,
  Spanish, Dutch, Italian, Polish and Portuguese for language detection and
  common phrases only.
- Work authorization and Scheinselbstaendigkeit output is a reading aid, not
  legal advice. Only a status determination by the Deutsche Rentenversicherung
  settles a classification question.
- Country pay conventions in `lib/europe.mjs` are general rules to check
  against the posting. Rows with no pay note carry the EU four-week leave floor,
  not a researched national figure.
- No exchange rates are fetched. Conversions use only the rates you enter.
