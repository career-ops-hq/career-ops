# Mode: agent-inbox — Queue requests for the next session

A durable bridge between *looking at* the pipeline and *acting on* it. career-ops
runs from an AI session, but there's no place to drop a request when you're not
in one. The agent inbox is that place: an append-only checklist
(`data/agent-inbox.md`) that any tool — this CLI, a dashboard button, a cron job,
or you by hand — can append to, and that the agent drains at the start of a
session.

Local-first, human-in-the-loop, zero dependencies: **nothing here auto-submits.**
Queued items are *intents* for the agent to action and the user to review.

## Queue a request

```bash
node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"
node agent-inbox.mjs add "draft a follow-up for application #7"
node agent-inbox.mjs add "run a scan and triage anything new"
```

## Inspect / resolve

```bash
node agent-inbox.mjs list            # pending items
node agent-inbox.mjs list --all      # include resolved items
node agent-inbox.mjs resolve 1 --expect "Acme" --result "scored 4.3 — report 012"
```

**Item numbers are stable file positions, not positions in the pending list.**
`add` only appends, so a number never changes meaning once printed: you can read
a whole batch off a single `list` and resolve them in any order. `list` shows
gaps as items get resolved (1, 3, 5) — that is the receipt that something was
already handled, not a display bug.

Two loud failures protect the write: resolving an item that is already `[x]`
aborts rather than overwriting its result, and `--expect "<substring>"` aborts
unless the target item contains that substring (case-insensitive). Prefer
`--expect` whenever you know what you mean to resolve — it turns "right command,
wrong row" into an error instead of a plausible-looking wrong result line.

`data/agent-inbox.md` is user-layer (gitignored). Items look like:

```markdown
- [ ] 2026-06-21 09:30 — evaluate https://acme.com/jobs/42
- [x] 2026-06-20 18:05 — run a scan → result: 3 new, 1 worth evaluating
```

## Agent protocol (when the user invokes this mode, or at session start)

1. Read `data/agent-inbox.md`. If it doesn't exist or has no unchecked items,
   say so and stop.
2. Run each **unchecked** item top-to-bottom by routing it to the right mode
   (a URL → `auto-pipeline`; "follow-up" → `followup`; "scan" → `scan`; etc.).
3. After each, mark it `[x]` and append `→ result: <one line>` — either by hand
   or with `node agent-inbox.mjs resolve <n> --expect "<distinctive words from
   the item>" --result "..."`. Pass `--expect` every time: this is a provenance
   log, and a result stamped onto the wrong item is worse than no result.
4. Items that need **live user input** (a mock interview, a pasted transcript, a
   decision, anything that would submit an application) → do **not** run them;
   ask the user to start them instead. The inbox never bypasses human review.

This mode pairs naturally with a dashboard: a "queue this" button writes to the
same file, so a click while browsing the tracker becomes work the next session
picks up.
