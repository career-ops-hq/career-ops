# Mode: titles — Adjacent Job-Title Suggestions

## Purpose

This mode owns `portals.yml`'s `title_filter.positive`: it proposes what goes
in, and — with the same confirmation — what comes out.

The scanner only surfaces what `title_filter.positive` matches —
and that list is written from the titles the user already knows to search for.
The same job ships under many names (Solutions Architect / Forward Deployed
Engineer / Customer Engineer), so the search is silently narrower than the CV
justifies. This mode reads the CV and proposes adjacent titles the user isn't
searching for yet — then, only after explicit confirmation, writes the accepted
keywords into `title_filter.positive` so the very next `scan` casts the wider net.

**Adding is not enough on its own.** A list that can only grow keeps whatever
it started as, and on day zero it starts as `templates/portals.example.yml` —
37 keywords describing the market the tool was built for, copied because
`doctor` says to copy them. Nothing downstream can then tell "the user chose
these" from "the user never looked", and the wrong ones survive every future
run of this mode. So this mode can also propose REMOVALS, under the rules in
*Retiring a keyword* below. The user confirms both halves of the diff; nothing
is ever regenerated silently.

`patterns` Step 1b makes the same kind of retargeting recommendation
("consider adding archetype X and reweighting `portals.yml`
`title_filter.positive`"), but only after ≥5 progressed applications and only
from interview-session signal. This mode is the day-zero, CV-driven complement.
It is also the inverse of `upskill`: upskill finds skills missing for current
targets; this finds new targets reachable from current skills.

## Inputs

- `cv.md` — the **only** source of evidence for suggestions (required)
- `config/profile.yml` — `archetypes` (name / level / fit) for what's already targeted
- `modes/_profile.md` — target roles, framing, and any deal-breakers the user has recorded
- `portals.yml` — the current `title_filter.positive` (and `negative`) keywords
- Optional: if `data/applications.md` has ≥5 entries progressed beyond
  `Evaluated`, note which suggestions the outcome data supports (e.g. an axis
  that is already converting) — cross-reference `patterns` rather than
  duplicating its analysis.

## The Three Axes

Classify every suggestion on exactly one axis, and say which:

- **Lateral** — same work, different label. The core recall win: the user
  already does this job; the market just posts it under a name they don't
  search for.
- **Stretch** — one level up or larger scope than the CV's strongest evidence.
  Plausible, but a hiring manager would probe the gap.
- **Pivot** — an adjacent function reachable from existing CV evidence
  (e.g. heavy client-facing delivery work → pre-sales engineering).

## Output Contract (per suggestion)

For each suggested title, show exactly:

- **Title** — the market title as actually posted, not an invented hybrid
- **Axis** — Lateral / Stretch / Pivot
- **CV evidence** — 1–2 lines from `cv.md` **quoted verbatim**. If you cannot
  quote it, do not suggest it.
- **Honest gap note** — what a hiring manager would question; "none" is allowed
  for Lateral suggestions but must be earned
- **Market-reality note** — how common the title is, where it tends to be
  posted, seniority skew, or noise level

Aim for 5–10 suggestions, Lateral first. Fewer good suggestions beat a padded
list — this system optimizes for quality, not quantity.

## Filters (apply BEFORE showing suggestions)

1. **Dedup against existing coverage.** Mirror the matcher semantics in
   `scan.mjs` (`buildTitleFilter` / `compileKeyword`): the scanner lowercases
   both sides and keeps a job when any positive keyword is a
   case-insensitive substring of the title (2–3 letter keywords match on word
   boundaries instead). So drop any candidate title that an existing positive
   keyword already substring-matches — it is already covered, and suggesting
   it adds zero new recall.
2. **Deal-breaker filter.** Never suggest titles that violate the
   deal-breakers recorded in `modes/_profile.md` (e.g. "no people management"
   rules out Engineering Manager; "no on-site" rules out field roles). Titles
   matching `title_filter.negative` keywords are also off the table — the user
   already excluded them.
3. **Never invent experience.** Every suggestion must be traceable to quoted
   `cv.md` lines — the source-of-truth boundary applies to suggestions exactly
   as it does to CV content. Keywords get reformulated, never fabricated. If
   the evidence isn't in `cv.md`, ask the user; don't stretch a quote to fit.

## Confirm Gate — Writing Accepted Titles (HARD RULE)

When the user accepts one or more suggestions:

1. Derive **keywords, not raw titles**. The filter matches substrings, so the
   keyword should be the shortest phrase that still identifies the role family
   ("Forward Deployed" covers Forward Deployed Engineer/Architect/Lead).
2. Attach a **breadth warning** to any substring-dangerous keyword: because
   matching is substring-based, a short or generic keyword floods the scan.
   Propose "Solutions Architect", never bare "Architect" — bare "Architect"
   would also match Data Architect, Enterprise Architect, Security Architect.
   If the user insists on a broad keyword, warn once and comply.
3. Skip keywords that duplicate existing coverage (same dedup rule as above);
   preserve the casing style already used in the user's `portals.yml`.
4. Show the **exact YAML diff** against `portals.yml` `title_filter.positive`
   before touching anything.
5. **Never write to `portals.yml` without explicit user confirmation.**
   "Show me the diff" is not a yes. Silence is not a yes.
6. **The diff shows both halves.** Additions and any removals proposed under
   *Retiring a keyword* go in ONE diff under separate headings, confirmed
   together — a user deciding whether to widen their search is entitled to see
   what narrows in the same breath. If they accept the additions and refuse the
   removals, write the additions; never treat a yes to one as a yes to both.
7. `portals.yml` (user layer) is **the only file this mode writes by
   default**. This mode proposes no negative keywords — precision guards for
   noisy keywords are deferred to #1353's seniority-tier helper.
8. **Separately-confirmed exception:** accepted titles can additionally become
   `fit: adjacent` archetypes in `config/profile.yml` (an existing schema
   field — see `config/profile.example.yml`). Mention that this is possible,
   but do it **only if the user asks** — never write archetypes by default.
   When the user does ask, that write gets its **own YAML diff and its own
   separate confirmation**; never bundle the `portals.yml` and
   `config/profile.yml` writes into one confirmation.

## Retiring a keyword (HARD RULE)

`portals.yml` is a **user-layer file**. Nothing here may regenerate a config
someone has curated: a removal is proposed one keyword at a time, with its
reason, in the same diff as the additions, and it happens only on the user's
explicit yes. There is no bulk "replace" and no silent rewrite — someone who
spent an evening pruning 116 companies down to 30 must never find that work
undone by a mode they ran to widen their search.

**A keyword may be proposed for removal on exactly one ground: `cv.md` does not
support it.** Not "it looks unrelated", not "it seems too broad" — the same
evidence bar the additions are held to, applied in the other direction. If you
cannot say which line of the CV is missing, do not propose the removal.

**"Support" means the CV evidences the CAPABILITY, never that it contains the
word.** This is the same rule the suggestions run on — the market's word for a
capability is usually not the CV's — and getting it backwards here is the way
this feature does damage. Measured on one real setup: of 49 curated keywords,
**39 do not appear anywhere in `cv.md` as a string**, and among those 39 are
`AI Engineer`, `Deep Learning`, `Research Engineer`, `Compiler`, `MLIR` and
`CUDA` — every one of them a legitimate target for a CV whose summary reads
*"LLM inference optimization and on-device / edge AI deployment"* and whose
bullets describe *"kernel- and graph-level optimizations"*. A string test would
have proposed deleting three quarters of a working filter.

So before proposing any removal, ask the question in this form: **is there work
in `cv.md` that would make this person a plausible candidate for a posting
carrying this keyword?** If yes, keep it, whatever words the CV used. Only when
the answer is no — no line, no adjacent capability, nothing the keyword could
be reaching for — is it a candidate for removal, and then it still goes through
the diff with its reason.

Two cases, and they are told apart by what the current list is:

1. **The list is still byte-identical to the shipped example.**
   `title_filter.positive` matches `templates/portals.example.yml`, which is
   evidence it was never edited — `doctor` copies the template, so an untouched
   install lands exactly here. But it is an **inference, not a record**:
   `portals.yml` stores keywords, never who put them there. So state it as an
   inference the user can correct — *"this list is still identical to the
   shipped example, so I am reading it as defaults rather than your choices;
   say if any of them are actually yours"* — and then propose the full
   CV-derived set with the unsupported template keywords listed for removal.
   This is the day-zero case and the reason this mode can remove at all. If the
   user names even one keyword as theirs, the list was chosen after all: drop to
   case 2 for the rest of the session.
2. **The list has been edited.** Then some of it was chosen, and you cannot
   tell which. Propose removals only for keywords with no CV support, list them
   individually with the reason, and default to keeping anything you are unsure
   about. A keyword wrongly kept costs some noise in the next scan; a keyword
   wrongly removed costs a job the user never sees.

**Never remove:**

- a keyword the user added during this session. **`portals.yml` records no
  provenance**, so "the user added this in a previous run" is not a fact you can
  check — treat it as unknowable rather than as false. That is what case 2's
  default-to-keep is for; never reason that a keyword must be the template's
  merely because you did not watch it being added.
- anything in `title_filter.negative` — this mode does not touch exclusions
- the last remaining positive keyword. An empty `positive` means the scanner
  matches every posting on every board, which is a worse state than a wrong
  keyword. If every keyword is unsupported, say so and stop; do not empty the
  list.

Show removals under their own heading in the diff, never folded in among the
additions — the user must be able to see what they are losing without reading
a `-` at the start of a line.

## After the Write

- Suggest `/career-ops scan` — the wider filter only pays off on the next scan.
- Suggest `upskill` scoped to a Stretch title the user liked, to see the gap
  map between the CV and that next-level target.

## Error Handling

- `cv.md` missing → stop and point at onboarding (`node doctor.mjs --json`).
  There is no evidence base to suggest from, and inventing one is forbidden.
- `portals.yml` missing, or `title_filter` / `title_filter.positive` absent or
  empty → **derive the list from `cv.md` here rather than sending the user away
  to copy an example.** An absent key and an empty list are the same thing to
  the scanner — both match every posting — so handle them the same way. An
  empty positive list means the scanner matches every posting, so it cannot be
  left empty — but the way out of empty is the CV, which this mode already
  reads. Offer `templates/portals.example.yml` second, as *"or start from an
  example and edit it"*, for a user who would rather begin from a shape than
  from their own history. Copying the example is a valid choice; it is not the
  default, because what it copies is someone else's market. Write back the
  `title_filter` key alone: every other key in `portals.yml` — the company list
  above all — is outside this mode's ownership and must survive the write
  unchanged.
- `config/profile.yml` or `modes/_profile.md` missing → **hard stop**: do not
  generate suggestions. Point at onboarding (`node doctor.mjs --json`) and
  stop, then re-run this mode once both files exist — the same
  fix-first-then-re-run behavior as a missing `portals.yml` above.
  Deal-breakers live in `modes/_profile.md` — suggestions generated without
  them can propose exactly what the user excluded.
