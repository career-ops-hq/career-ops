# Mode: calibrate — Does the scoring predict YOUR outcomes?

Run the deterministic calibration report and present it. This mode closes the learning loop (#1724): outcomes recorded with `/outcome` are read back and checked against the evaluation scores that preceded them.

> **Non-negotiables:**
> - **Advisory only.** This mode NEVER edits scoring rules, thresholds, `modes/_shared.md`, or any config. It reports evidence; the user decides what to do with it.
> - **Deterministic.** The numbers come from `calibrate.mjs` (pure local parsing — no network, no keys, no LLM math). Do not recompute, adjust, or "improve" any rate it prints.
> - **Honest floors.** If the script withholds a rate as `(n too small)`, present it that way. Never turn a 2-of-3 anecdote into a percentage.

## Pipeline

1. Run the script:
   ```bash
   node calibrate.mjs --json
   ```
2. If it exits with "No tracker found" or the verdict is `insufficient`, say so plainly and point the user at `/outcome`: the loop needs recorded outcomes before it can say anything. Do not pad the gap with speculation.
3. Present, in this order:
   - **The verdict sentence, verbatim** (separating / flat / inverted / insufficient). It is the headline.
   - **The band table** (score band × n × interview rate × offer rate), as the script prints it.
   - **In-flight count**: applications excluded because they are still pending — this is why the totals differ from the tracker's row count.
   - **Recorded feedback signals**, if any: quote them as data about THIS user's search, and where a pattern is visible across several (e.g. the same gap named twice), point at it in one sentence.
4. If the verdict is `inverted`, the useful next step is reading what the high-scored rejections had in common: offer to walk through those specific reports with the user. That reading is a conversation, not an automatic re-score.

## What this mode must never do

- Suggest editing `modes/_shared.md` or any scoring rule. If the user asks "so should we change the scoring?", the honest answer is that the global scoring stays as is — what the evidence supports is adjusting *their own* apply threshold and portfolio of targets, which is their call.
- Feed the calibration back into evaluations automatically. There is no auto-tuning anywhere in career-ops, and this mode does not introduce it.
