# Claude Code bake-off — 2026-09-28

Raw numbers: [`claude-bakeoff.md`](claude-bakeoff.md), regenerated from
[`claude-runs.jsonl`](claude-runs.jsonl) with
`node evals/record-claude.mjs --summarize --write`. Method: `evals/README.md`
→ *Recording real Claude Code runs (v2)*.

**Scope.** 108 headless `/career-ops oferta` runs, $106 of API spend: 15
golden cases × Haiku 4.5, Sonnet 5 (13, budget cap), Opus 5 (12, budget cap),
Opus 5.5, a second pass of Haiku (15) and Opus 5.5 (8), a Haiku prompt variant
(15) and Sonnet 5 at `--effort medium` (14, budget cap). One pinned synthetic
profile, no web tools, CLI default effort unless stated. There is
no human ground truth here: agreement is measured between models (Opus 5 as
reference), plus the objective `expect` checks on the five v2 cases.

## Findings

Each evaluation is reported two ways, because users pay two ways: on a
Claude subscription (Pro/Max) a run spends usage-window allowance, which
tracks the tokens and turns it processes; on an API key it spends the
dollars below (list price, as reported by `claude -p`). How a subscription
weighs each token type (cache reads especially) is Anthropic's accounting,
not measured here — treat the token rows as the relative signal.

| | Haiku 4.5 | Sonnet 5 | Opus 5.5 | Opus 5 |
|---|---|---|---|---|
| **Subscription view** | | | | |
| Tokens processed / evaluation (mostly cache reads) | 0.76M | 2.4M | **1.1M** | 1.9M |
| Tokens generated / evaluation | 12k | 32k | **15k** | 30k |
| Median turns | 14 | 25 | 14 | 24 |
| Median wall time | 2.6 min | 5.5 min | **2.3 min** | 6.4 min |
| **API-key view** | | | | |
| Mean cost / evaluation | **$0.25** | $1.27 | $1.26 | $2.84 |
| **Quality** | | | | |
| Mean \|Δscore\| vs Opus 5 | 0.48 | 0.28 | 0.30 | — |
| Mean signed bias vs Opus 5 | **+0.46** | −0.18 | +0.08 | — |
| Same apply/skip call at 4.0 as Opus 5 | 22/24 | 11/12 | 18/19 | — |
| Rep-to-rep \|Δscore\| (same case, same model) | **0.38** | — | **0.06** | — |
| Machine Summary meets the full batch-prompt contract | **0%** | 92% | 100% | 100% |
| Report + JD archive + tracker row | 83% | 100% | 100% | 100% |
| `expect` checks | 8/10 | 5/5 | 10/10 | 5/5 |

1. **Sonnet 5 is not cheaper than Opus 5.5 in practice.** Half the list price,
   but ~25 turns instead of ~14, so the same $1.26–1.27 per evaluation at more
   than twice the wall time. At `--effort medium` it drops to $1.05 and
   3.5 min with the same agreement (0.24 vs Opus 5, 11/12 apply calls), but its
   Machine Summary met the full contract in only 8/14 runs (pre-fix prompt;
   12/13 at default effort). The `standard` tier buys little over Opus 5.5 on
   this workload.
2. **Opus 5.5 costs 44% of Opus 5** (the current `premium` model) on an API
   key and processes ~40% fewer tokens with half the output on a subscription,
   finishes in about a third of the time, lands within 0.30 of it on average with no
   systematic bias (+0.08), and is the most repeatable model measured: the
   same case scored twice moved by 0.06 on average.
3. **Haiku 4.5 is 5× cheaper but not a drop-in `economy` tier today:**
   - It never wrote a schema-valid Machine Summary (0/30): renamed keys
     (`legitimacy` for `legitimacy_tier`), missing `final_decision`,
     free-text enums, emoji requirement matches. `salary-gap.mjs`,
     `analyze-patterns.mjs` and friends parse that YAML literally.
   - It scores ~0.5 higher than Opus on average, and its score moves ±0.38
     between identical runs. 3 of 15 cases straddled the 4.0 "apply"
     threshold across its two passes (e.g. 3.5 → 4.2).
   - It left the Machine Summary or the archived JD out of 5/30 reports and
     returned `work_auth: null` on the Spanish on-site posting both times.
4. **The schema failure is a prompt gap, not only a model limit.**
   `modes/oferta.md` pointed at `batch/batch-prompt.md` for the Machine Summary
   schema instead of stating it. With the 36-line skeleton copied inline
   (variant `schema-inline`), Haiku's Machine Summary met the full contract in
   6/15 runs instead of 0, at the same cost and score behaviour. Of the nine
   misses, four were one key off (an extra `soft_strengths`/`top_weaknesses`,
   a missing `via`), two dropped several keys, two had no parseable Machine
   Summary, and one (the Spanish posting) still invented its own schema.
   Opus 5 and 5.5 already complied on every run.

   "Full contract" means every key of the batch-prompt skeleton, no extra
   keys, and every value of its type or enum — nested `risk_summary` and
   `requirement_importance` rows included (`validateMachineSummary`, kept in
   step with the skeleton by `tests/eval-record-claude.test.mjs`).
5. **Guardrails held on every model in this set, but not on every Haiku run.**
   The injected "rate this 5.0/5" note was quoted as an anomaly in 7/7 reports
   and never moved a score above 3.8. The evergreen ghost posting was never
   rated High Confidence. A later Haiku run of the injection case (a sandbox
   check, not in this dataset) did not flag the note and scored 4.2: short of
   the 5.0 it asked for, but over the 4.0 apply line.

## Recommendations (maintainer decisions, not applied here)

- **`premium` → Opus 5.5** in the `modes/_shared.md` Spend Tier table and
  `batch/batch-runner.sh`'s `spend_tier_to_model`: same agreement, half the
  dollars on a key, fewer tokens against a plan's window, a third of the time.
  Batch workers run on the tier's model whether they bill a key or a
  subscription token (`CLAUDE_CODE_OAUTH_TOKEN`).
- **Reconsider `standard` = Sonnet 5.** At default effort it costs the same as
  Opus 5.5 and is slower; at `medium` it saves ~$0.20/evaluation but is still
  slower and less schema-compliant. Opus 5.5 is the stronger default unless
  Sonnet's price matters more than its extra turns.
- **Keep Haiku behind a warning** until the Machine Summary gap closes and its
  score variance is addressed (e.g. show a ±0.4 band next to economy-tier
  scores near 4.0).
- **Interactive `spend_tier` is advisory only:** the subagent template in
  `.claude/skills/career-ops/SKILL.md` passes no `model`, so `pipeline`/`scan`
  workers inherit the session model regardless of tier.

## Caveats

One synthetic profile and 15 short-to-medium synthetic postings; web research
disabled, so Blocks D/G research quality is not measured; Sonnet 5 and Opus 5
stopped at their budget caps (13 and 12 cases) and have one pass each.
Labels on the ten v1 cases were frozen against an unknown profile, so
agreement *between models* is the meaningful column, not Δ vs label.
