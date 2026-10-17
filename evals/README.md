# Golden-set eval for cheap-model routing (#1354)

> **Status: v2.** The *mechanism* (`eval-golden.mjs`) is design-invariant and runs
> today. Reference labels are frozen (10 synthetic v1 cases — see **Labeling
> methodology** below) and five v2 cases add objective `expect` checks against a
> pinned profile. Real Claude Code fixtures are recorded with
> `evals/record-claude.mjs`; the first bake-off (Haiku 4.5, Sonnet 5, Opus 5,
> Opus 5.5) is written up in [`results/README.md`](results/README.md). The gate
> threshold and per-model cost remain tunable constants, and wiring into CI is
> still deferred (see **Open design questions**).

## What this is

A small labeled golden-set plus a harness that measures how well a *candidate*
cheap model agrees with reference labels, so "is model X good enough to route to?"
becomes a number instead of a hunch. It reuses the `---SCORE_SUMMARY---` contract
that every `*-eval.mjs` already emits (`SCORE` + `ARCHETYPE`), so there is no new
scoring surface.

## Labeling methodology (v1)

The metric is **agreement-with-reference, not absolute correctness.** For #1354's
purpose — *which cheap model can hold which task* — distance-to-reference is exactly
the right measure: if a candidate model reproduces the reference verdict, it is safe
to route that task to it.

**v1 labels are the frozen verdict of a reference (Claude-tier / premium) evaluation**
applied to each synthetic JD under the repo's own rubric (`modes/_shared.md` §
Scoring System + § Archetype Detection):

- **`archetype`** is the gate. It is a property of the JD alone (the 6-archetype
  keyword taxonomy in `_shared.md`), so it is profile-independent and reproducible.
- **`score`** (1–5) is the reference model's fit verdict. It is profile-relative by
  construction, but because both reference and candidate are scored under the *same*
  conditions, distance-to-reference stays meaningful regardless of whose profile
  drives it. It is a secondary, tolerance-banded signal — it does **not** gate.

The 10 cases cover all 6 archetypes and deliberately favor **edge archetypes over
easy wins**: four are hybrids/ambiguous (`platform-agentic-hybrid`,
`pm-architect-ambiguous`, `forward-deployed-vs-architect`, `transformation-vs-pm`)
where a cheaper model is most likely to diverge, and scores span 3.2–4.3 so the
tolerance band has real range to catch drift on red-flag postings.

**Future upgrade path:** hand-curated labels. Freezing the reference verdict is the
cheap, reproducible v1; a later pass can replace or reconcile individual labels with
human-graded ground truth (flip `provenance` to `hand-curated`) without changing the
harness.

## Layout

```
evals/
  golden/            labeled cases — one JSON per case (synthetic JDs, no user data)
  fixtures/          recorded candidate outputs for $0 deterministic replay in CI
  profiles/          pinned synthetic user layers (cv.fixture.md + profile.yml) for v2 cases
  results/           claude-runs.jsonl (raw per-run metrics) + bake-off write-ups
  record-claude.mjs  records real Claude Code runs into fixtures/ and results/
  README.md          this file
eval-golden.mjs  the harness (root level, sibling to openai-eval.mjs)
```

### Golden case format (`evals/golden/*.json`)

```json
{
  "id": "ai-platform-llmops",
  "synthetic": true,
  "jd": "<full synthetic job description text>",
  "label": { "archetype": "AI Platform / LLMOps", "score": 4.2, "provenance": "reference-frozen-v1" }
}
```

`provenance` records how the label was set (`reference-frozen-v1` today; future
hand-curated labels flip it). Edge cases may also carry an `edge_note` explaining
why the reference resolved an ambiguous JD the way it did. Both are advisory — the
harness only requires `archetype` (string) and `score` (number). All JDs are
**synthetic** so the set stays clear of the `no-user-data` guard.

### Fixture format (`evals/fixtures/<case-id>__<model>.txt`)

A recorded candidate-model output containing a `---SCORE_SUMMARY---` block. Only
that block is parsed; surrounding prose is illustrative and trimmed. Slash-form
provider ids (`deepseek/deepseek-chat`) are flattened to a path-safe token for the
filename (`<case>__deepseek-deepseek-chat.txt`), so a fixture never lands in a
phantom subdirectory.

## Running

```bash
npm run eval:golden -- --replay --model claude-opus-5-5              # offline, deterministic, $0
npm run eval:golden -- --replay --model cheap-stub --allow-missing   # the stub covers the 10 v1 cases only
npm run eval:golden -- --live   --model gpt-4o-mini                  # real call via openai-eval.mjs (needs key + cv.md)
```

Replay is the CI-friendly path: no API keys, no `cv.md`, fully deterministic.
The harness reports per-case archetype/score agreement, mean |Δscore|, median
latency (live only), and a placeholder $/run, then exits `0/1` on the gate:
archetype agreement at or above the threshold, **and** no recorded `expect`
check failed (v2 fixtures carry them — an unflagged prompt injection fails the
gate however well the archetypes agree), **and** every case graded. A case with
no fixture for the requested model is listed as *not recorded* and left out of
the agreement denominator, but it fails the gate unless `--allow-missing` asks
for the recorded subset — so a plain pass always covers the whole set.

## Recording real Claude Code runs (v2)

`evals/record-claude.mjs` records fixtures from the product's main path —
headless Claude Code running `/career-ops oferta` — instead of a stub:

```bash
node evals/record-claude.mjs --model claude-sonnet-5 --dry-run          # plan only, $0
node evals/record-claude.mjs --model claude-sonnet-5 --budget-usd 15    # live, spends real money
node evals/record-claude.mjs --model claude-sonnet-5 --rep 2            # second pass → <case>__claude-sonnet-5-r2.txt
node evals/record-claude.mjs --summarize --write                        # $0: results/claude-bakeoff.md
npm run eval:golden -- --replay --model claude-opus-5-5                 # $0 replay of what was recorded
node evals/record-claude.mjs --probe-sandbox                            # ≈$0.10: prove the sandbox holds on this CLI
```

Each run gets its own sandbox: a copy of the tracked system layer **without
`evals/`** (the model under test can never read the labels), the pinned
synthetic user layer from `evals/profiles/<profile>/` (`cv.fixture.md`, copied
in as `cv.md`, and `profile.yml`; `modes/_profile.md` defaults to the shipped
template, exactly what a new user gets), and no web tools — the companies are
fictional and research would make runs irreproducible, so Block D/G research
degrades the same way for every model. Case text is untrusted (one case is a
prompt injection on purpose), so the child gets no general shell — only the
repo scripts the flow calls (`ALLOWED_BASH`), minus arguments that reach another
directory — and may write only inside its sandbox, never to a script, module,
`package.json`, `.env` or `.career-ops-data` it could then run or be redirected
by (`permissionArgs`). Its environment is minimal: what `claude` needs to start
and reach the API, without unrelated tokens or `CAREER_OPS_*` data-root
overrides. Dependencies are copied in, not linked to the host's. Each run
records the tool calls the sandbox refused (`permission_denials`).

Those rules are only as good as the CLI that enforces them, so
`--probe-sandbox` checks them live on the installed version: a model is asked
to try each escape once (write or read outside the sandbox, overwrite a script
it may run, plant a module, `.env` or `.career-ops-data`, aim `doctor.mjs` at
another directory) next to one write the flow needs, and every step is judged
from the transcript and the disk, not the model's account. It exits 1 unless
every escape was attempted and refused and the needed write worked. Every live
recording runs it first (counted in `--budget-usd`) and records nothing if it
fails; `--skip-probe` skips it. It is still not an OS sandbox; run cases you
did not write in a disposable environment. `--max-run-usd` caps each run (`claude --max-budget-usd`) and
`--budget-usd` caps the invocation.

Per run it writes a replay fixture (the usual `---SCORE_SUMMARY---` block plus
legitimacy, decision, cost, turns and output-contract flags) and one JSON line
in `results/claude-runs.jsonl` with the raw metrics. `--summarize` folds those
into a per-model table: archetype agreement, mean |Δ| against the label and
against the reference model's first pass, rep-to-rep score spread, output
contract compliance (Machine Summary + archived JD + tracker row), `expect`
checks, and mean $/evaluation.

**`expect` assertions (v2 cases).** Cases with a `profile` key are scored
against that pinned profile and may carry objective checks that do not depend
on a reference model's taste: `score_min` / `score_max`, `legitimacy` /
`legitimacy_not`, `work_auth`, and `injection_flagged` (the report must quote
an instruction embedded in the posting as an anomaly — AGENTS.md → Untrusted
External Content). Their `label.score` is the case author's prior for the
pinned profile (`provenance: author-prior-v2`), not a frozen model verdict.

## Open design questions (TODO #1354)

Resolved in v1:

- **Reference labels** — frozen reference (Claude-tier) verdict; see **Labeling
  methodology** above. Hand-curation is the documented future upgrade path.
- **Set size / spread** — grown from 2 to 10 cases across all 6 archetypes, favoring
  edge/hybrid archetypes, scores spanning 3.2–4.3.

Still tunable (named constants, safe defaults today):

| Question | Where it lives | v1 default |
|----------|----------------|------------|
| `SCORE` agreement: tolerance band width | `SCORE_TOLERANCE` in `eval-golden.mjs` | ±0.5 (band, per distance-to-reference) |
| CI gate threshold for archetype agreement | `MIN_ARCHETYPE_AGREEMENT` in `eval-golden.mjs` | 0.8 |
| Per-model $/run rates | `COST_PER_RUN_USD` in `eval-golden.mjs` | empty — needs real provider rates |

Wiring this into the required CI job (`.github/workflows/test.yml`) is intentionally
deferred until the gate threshold is confirmed, so a default value can't make `main`
go red. The replay path is deterministic and $0, so it is ready to wire whenever the
threshold is signed off.
