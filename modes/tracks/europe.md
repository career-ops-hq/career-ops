# Track: Europe

Read `tracks.europe` from `config/profile.yml`: `base_country`,
`work_authorization`, `target_countries`, `languages`, `contract_types`.
`lib/europe.mjs` holds the country facts `track-signals.mjs` uses; they are
conventions to check against the posting, not statements about one employer.

Market wording and legal vocabulary for a specific country stay with the
market modes (`language.modes_dir`, for example `modes/de`). This track adds
the cross-border checks a single-market mode does not make.

## Work authorization

Extend Block A's work-authorization check with the candidate's status:

| `work_authorization` | May work without a new permit in |
|----------------------|----------------------------------|
| `eu_citizen` | EU and EEA states, and Switzerland under the free-movement agreement (a permit is issued, not sponsored). Not the UK since 2021. |
| `uk_citizen` | UK and Ireland |
| `blue_card`, `residence_permit` | The issuing country (`base_country`) only. Another EU state needs a new permit; long-term mobility rules shorten that but do not remove it. |
| `needs_sponsorship` | Nowhere without sponsorship |

- "Right to work in the UK required" with no sponsorship is a **blocker** for
  an EU citizen. "EU work permit required" is a blocker for someone who needs
  sponsorship and fine for an EU citizen.
- A posting that offers sponsorship, a Blue Card or relocation support turns a
  blocker into a caution: name the route and its usual lead time as something
  to ask about, never as a promise.
- Security clearance or citizenship clauses ("SC cleared", "Sicherheitsüberprüfung",
  "citizens only") are a caution to read with the user.
- A remote role "from anywhere in Europe" still needs an engaging entity:
  local employment, an employer of record, or a contractor agreement. If the
  posting does not say which, that is a question, not a flaw.

This is a reading aid, not immigration advice. Say so once when the report
relies on it.

## Languages

Postings in German, French, Spanish, Dutch, Italian, Polish and Portuguese are
in scope. Evaluate them in the user's `language.output`; quote requirements in
the posting's own language.

- A posting written in a language other than English expects that language at
  working level even when it does not say so. Treat it as an implied
  requirement at C1.
- Map wording to CEFR: `verhandlungssicher`, "fließend", `fluent`,
  "business fluent" are C1; "gute Kenntnisse", `good`, `conversational` are B2;
  "Grundkenntnisse", `basic` are A2; "Muttersprache", `native` is native.
- Compare with `tracks.europe.languages`. A required language the candidate
  lacks, or holds two or more levels below the ask, is a **blocker**. One
  level below is a caution. "Is a plus", "von Vorteil", "wünschenswert" are
  optional and never block.
- Never state a language level for the candidate that the profile does not
  list. If `languages` is empty, report the requirement and ask.

## Contract type

Name it in Block A ("Engagement"): permanent (`unbefristet`, CDI), fixed-term
(`befristet`, CDD, maternity cover), employer of record (hired through Deel,
Remote, Oyster and similar), temp agency ("Arbeitnehmerüberlassung", umbrella
company), or freelance (then `modes/tracks/freelance.md` applies).

- Fixed-term: state the end date and whether the posting mentions conversion.
  The existing fixed-term disclosure signal in `modes/oferta-signals/` still runs.
- Employer of record: the EOR is the legal employer. Benefits, notice and
  equity follow the EOR's local contract, and equity often does not transfer.
  A caution to price in, not a red flag.
- If `contract_types` is set and the posting's type is not in it, say so as a
  caution.

## Pay (Block D)

- Work in the posting's currency (EUR, GBP, CHF, or a local one) and state the
  conversion you used and its date when comparing with the user's target.
  Never present a converted figure as the offer.
- Normalise to **annual gross** before comparing. Conventions by country
  (from `lib/europe.mjs`): Austria and Portugal pay 14 salaries; Spain, Italy
  and Greece 12 to 14 depending on contract; Switzerland usually 13; the
  Netherlands adds an 8% holiday allowance; Belgium about 13.92 with benefits
  in kind; Poland quotes employment and B2B separately; Sweden and Denmark
  quote monthly. Check which convention the posting uses before multiplying.
- Research comp per country, not per continent: the same title pays very
  differently in Zurich, Munich, Lisbon and Warsaw. Name the source and the
  country of every benchmark. If you cannot find one for that country, say
  "no country benchmark found" instead of borrowing another market's number.
- Net pay depends on personal tax circumstances. Do not estimate take-home
  unless the user asks, and then label it an estimate.
- Remote roles paid by location band: say which band the posting implies for
  the candidate's country, or that it does not say.

With no target or minimum configured, pay is information: show how the offer
sits against the market and never count it against the role.
