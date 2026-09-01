# Mode: interview/ready — Readiness Check

Run the weekly readiness check: rank what to study next from real question-bank history and the topic taxonomy, then hand off into practice.

---

## When to Run This Skill

- On a recurring cadence (weekly is the default rhythm) to decide what to study next
- Before an upcoming interview, to see what's still weak or untested
- Any time the candidate asks "what should I study" or "am I ready"

---

## Inputs

1. **Question bank** at `interview-prep/question-bank.md` — the history the ranking is built from
2. **Topic taxonomy** at `templates/interview-topics.yml` (or `config/interview-topics.yml` if the candidate has overridden it)
3. **JD path** (optional) — if the candidate names an upcoming interview with a JD file on hand, pass it through so JD-demanded topics are weighted higher

---

## Step 1 — Run the Ranker

Run the deterministic prioritizer in its default JSON mode so the full-count
metadata and all warning groups remain available — never re-rank its output by
hand:

```
node interview-readiness.mjs --top 5
```

If the candidate has a JD on hand for an upcoming interview, add it:

```
node interview-readiness.mjs --top 5 --jd <path>
```

The script itself never reads JD content beyond the path it's given — only its `--jd` argument is passed through from this mode. This mode does not ingest or interpret job-posting text itself.

The script is the sole authority on *what* to work on and in what order. This mode's job is to explain *why* each item matters and *what to do about it* — never to substitute its own judgment for the ranking, and never to invent a topic the script didn't return.

---

## Step 2 — Handle the Cold-Start Case

Before narrating results, check the **full, pre-`--top` counts** in the underlying JSON report: `metadata.totalTopics`, `metadata.untestedCount`, `metadata.orphanTopicCount`, and `metadata.unscoredEntryCount`. Do not use `topics.length`, `untested.length`, `metadata.returnedTopics`, or `metadata.returnedUntested` for this decision; those are display-limited by `--top` and can be zero even when valid output exists elsewhere.

Only use the cold-start response when **all four full counts are zero**. A missing question bank does not by itself mean there is nothing to report: a supplied JD can still produce valid untested topics. Likewise, orphan-tagged or unscored questions are actionable output even when no measured topic can be ranked. In those cases, continue and surface the available sections instead of stopping.

When all four full counts are zero, say so plainly — don't produce an empty ritual report:

> "There's no question-bank history to rank yet. Readiness needs real data first. Run `interview/drill` against a JD you have on hand to generate a starter set of questions, or `interview/debrief` after a real round to seed the bank from what actually got asked."

Stop here in the cold-start case; do not proceed to Step 3.

---

## Step 3 — Present the Two Lists

Present the script's two lists separately, using its own framing — never blend them into one undifferentiated ranking:

**Measured — from your tracked question-bank history.** These topics have real attempts, confidence ratings, or asked/practiced dates behind them. For each, explain in plain language what its `priority` score is telling the candidate: the combination of observed answer status, how long it's been since it was touched, whether it's demanded by the supplied JD, and the separate self-confidence rating. Name the specific topic and domain, not just a score.

**Not yet tested — nothing in your question bank has ever covered these.** These are the taxonomy's topics with zero history. State explicitly: an untested topic is an *unknown*, not a proven weakness — the script sets `weakness`, `staleness`, and `confidenceGap` to `null` for these because there's no data, and ranks them only by demand. Never describe an untested topic as "a weakness" or "underperforming" — describe it as "never been tested."

**Drilled but never answered.** A topic whose questions exist but have no verdict yet — `interview/drill` wrote them and `interview/practice` has not run them — appears in the *measured* list with `unanswered: true` and `answeredCount: 0`, and carries its own rationale. Report it as what it is: questions are queued, nothing has been answered out loud. Do not call it a gap; the script deliberately scores it on a no-evidence placeholder rather than a measured verdict, and calling it a gap would restate that placeholder as a result.

---

## Step 3b — Report Unscorable Questions

If `orphanTopics` is non-empty, surface it — do not skip it because it isn't a ranked topic. (`--summary` renders the same data as a `⚠` block after the two tables.) These are questions whose `topic:` tag names an id that does not exist in the taxonomy, usually a plausible-but-wrong variant (`rag/evaluation` where the taxonomy says `rag/rag-evaluation`). Scoring walks the taxonomy, so these questions are **invisible to the ranking entirely** — not ranked low, absent.

Say which tags are wrong and how many questions each is costing, and offer to fix the tags in `interview-prep/question-bank.md`:

> "[N] question(s) in your bank are tagged `[orphan-id]`, which isn't in the taxonomy — they're being skipped by the ranking completely. The closest real id looks like `[candidate-id]`. Want me to correct the tag?"

Never correct a tag silently, and never let the script guess: propose the correction, name the id you'd write, and let the candidate confirm. Remapping a tag without asking would assert an association the candidate never made.

If either list under `unscoredQuestions` is non-empty, surface that warning too:

- `missingTopic` contains otherwise valid question-bank entries with no `topic:` tag.
- `domainOnly` contains entries tagged only to a legal bare domain id, without a specific taxonomy topic.

The ranker cannot place either kind in a topic-level measured or untested list. State the full count and identify the questions using the script's own output. Offer to tag them against the active taxonomy, but do not guess or write a tag without confirmation. An unscored question is actionable missing specificity, not evidence that the candidate is ready.

---

## Step 4 — How the Ranking Works

Tell the candidate, briefly and honestly, how the priority score is built — this is not a black box:

- **Weakness** (40%) — observed 🔴/🟡/✅ answer-status history; unanswered questions do not dilute this factor
- **Staleness** (25%) — days since last asked or practiced, maxing out at a 60-day horizon
- **Demand** (20%) — whether the topic is called out in a supplied JD (baseline 0.4 when no JD is given, so nothing is ever weighted to zero on demand alone)
- **Confidence** (15%) — self-rated confidence gap, where no rating at all defaults to a moderately-under-confident placeholder rather than a false zero

The taxonomy driving both lists is `templates/interview-topics.yml`; the candidate can override it wholesale with `config/interview-topics.yml` (the override replaces the whole file — no deep merge) if the default 14 domains don't match their target roles.

---

## Step 5 — Route Into the Loop

End every run with one concrete recommendation. If the measured list is non-empty, use its first item: real question-bank evidence takes precedence over an unknown. Only use the first untested item when the measured list is empty. Never compare the two numeric priority values directly — the measured list uses the four-factor weighted formula, while the untested list uses demand alone, so their scores are intentionally not on the same scale.

> "Highest priority right now: **[topic]** — [one line from its rationale]. Want to run `interview/practice` scoped to this topic?"

If the recommendation came from the untested list, note in the same offer that there's nothing to practice against yet — offer `interview/drill` instead, scoped to that topic, to generate a starter question set before practicing it.

That handoff — into `interview/practice` or `interview/drill` — is the point of this mode. A readiness check that doesn't lead anywhere is just a report nobody acts on.

---

## Rules

- **Never re-rank the script's output.** If the ordering looks surprising, explain the rationale fields — don't silently reorder to match intuition.
- **Never compare measured and untested priority numbers.** Prefer the first measured item whenever one exists; only fall back to the first untested item when the measured list is empty.
- **Never invent a topic.** Only narrate topics the script actually returned.
- **Untested is not a weakness.** Keep the two lists distinct in language as well as in structure.
- **Never silently fix a topic tag.** Orphan tags are proposed for correction and confirmed by the candidate, never rewritten on their behalf.
- **Always end with a concrete next step**, not just a report.
