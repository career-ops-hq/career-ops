# Golden-set eval for cheap-model routing (#1354)

> **Status: v1.** The *mechanism* (`eval-golden.mjs`) is design-invariant and runs
> today. Reference labels are now frozen (10 synthetic cases — see **Labeling
> methodology** below); the gate threshold and per-model cost remain tunable
> constants, and wiring into CI is still deferred (see **Open design questions**).

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
  golden/      labeled cases — one JSON per case (synthetic JDs, no user data)
  fixtures/    recorded candidate outputs for $0 deterministic replay in CI
  README.md    this file
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
npm run eval:golden -- --replay --model cheap-stub   # offline, deterministic, $0
npm run eval:golden -- --live   --model gpt-4o-mini  # real call via openai-eval.mjs (needs key + cv.md)
```

Replay is the CI-friendly path: no API keys, no `cv.md`, fully deterministic.
The harness reports per-case archetype/score agreement, mean |Δscore|, median
latency (live only), and a placeholder $/run, then exits `0/1` on the archetype
agreement gate.

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
