# Next actions

Keep the replies, forms, assignments and outreach you still need to handle across sessions. Each action has its own evidence, owner, links and review history. Completing a questionnaire closes that task; application status remains a separate decision.

## Record and review an action

```bash
node next-actions.mjs add "Complete the questionnaire" --actor user --evidence "The recruiter requested this questionnaire" --link https://example.com/form --key questionnaire-request-1
node next-actions.mjs list --summary
node next-actions.mjs show <id>
node next-actions.mjs accept <id> --revision 1 --reason "User confirmed this next step"
node next-actions.mjs done <id> --revision 2 --reason "User confirmed the questionnaire was completed"
```

Replace `<id>` with the returned UUID. Always use the current revision from `show` or `list`. A stale revision fails instead of overwriting another session's changes. `add` and `import` create proposals; `accept` makes one open. The agent can record acceptance immediately when you have already explicitly requested that action.

`--key` makes a manual retry idempotent. Keep the same key and input when retrying. Without a key, another `add` deliberately creates another task. Identical titles or URLs do not prove two obligations are the same.

`list` returns compact current state, source identities and derived flags; full imported variants and revision snapshots are available through `show`. All commands return JSON by default; `--summary` provides a readable view. `list --all` also includes completed and dismissed items. The default list includes proposed, open, waiting and snoozed items, including tasks whose deadline or owner is unknown. It does not quietly hide unfinished work.

## Import several reviewed requests

Save this fictional example as a local JSON file:

```json
[
  {
    "source": { "namespace": "manual-review", "eventId": "message-a", "actionKey": "questionnaire" },
    "title": "Complete the questionnaire",
    "actor": "user",
    "evidence": { "text": "Please complete the form before our call", "ref": null },
    "links": [
      { "label": "Questionnaire", "ref": "https://example.com/form" },
      { "label": "Prepared answers", "ref": "local:interview-prep/example-answers.md" }
    ],
    "employerDue": { "kind": "unknown", "text": "Before our call; the call date is not established" }
  }
]
```

```bash
node next-actions.mjs import --file requests.json --dry-run
node next-actions.mjs import --file requests.json
```

The three source fields form an immutable producer identity. Give different obligations in one message distinct, persistent `actionKey` values. Before reprocessing input, inspect `list --all`, including done/dismissed items, then preserve those keys when reordering or reprocessing input. Neither application binding nor extraction array position belongs in this key. Re-pasting an email can generate a new message ID in `paste-reply.mjs`; that is not automatically recognized as a retry here.

Identical retries preserve edits, binding, revision and terminal state. A changed payload with an existing source identity fails the entire import without writing anything. Review it with `show`, use `edit` if task content should change, then acknowledge the source variant:

```bash
node next-actions.mjs ack-source <id> --revision <current-revision> --file corrected-proposal.json --reason "Reviewed the corrected source"
```

This file contains **one proposal object**, not an array. Acknowledgement records a recognized source variant; it does not replace task content or reopen a closed task. Both the original and acknowledged inputs subsequently retry without changes. New unrelated items in a conflicted batch can be imported separately while the conflict is reviewed.

This milestone accepts structured proposals supplied by you or your agent. It does not read your mailbox, extract multiple tasks automatically, monitor portals, or prove delivery. Existing `Need Action` classification can help the agent review a message; it is not a task or deadline extractor.

## Owner and the three clocks

`actor` is `user`, `company` or `unknown`. A question such as “are we waiting for them?” leaves it unknown until clarified. Company-owned items are shown as waiting, with any date warnings still visible.

| Field | Meaning | Input |
|---|---|---|
| `employerDue` | What the employer actually stated | Unknown, calendar date with optional timezone, or exact instant |
| `targetDate` | When you plan to act | Date and IANA timezone, or `null` |
| `snoozedUntil` | When to bring the item forward again | Exact instant with offset, or `null` |

Deadline formats:

```json
{"kind":"unknown","text":"No explicit deadline"}
{"kind":"date","date":"2030-03-05","timeZone":"Europe/Berlin","text":"Please finish by March 5, Berlin time"}
{"kind":"date","date":"2030-03-05","timeZone":null,"text":"Please finish by March 5; timezone unspecified"}
{"kind":"instant","at":"2030-03-05T17:00:00+01:00","text":"March 5 at 17:00 CET"}
```

Dates without a timezone remain uncertain and are never labelled overdue. Date-only deadlines keep that precision; no cutoff hour is invented. Exact instants require seconds and `Z` or an explicit offset. Relative timing stays in evidence until its date can be established. No deadline is inferred from the date of an email or from a bot leaving a chat.

`list --time-zone Europe/Berlin` controls the calendar display of instant deadlines; the default is UTC and is included in the output. Date-only deadlines and personal targets use their own declared timezone.

For example, `patch.json` can contain:

```json
{
  "targetDate": { "date": "2030-03-03", "timeZone": "Asia/Bangkok" },
  "snoozedUntil": "2030-03-04T09:00:00+07:00"
}
```

```bash
node next-actions.mjs edit <id> --revision <current-revision> --file patch.json --reason "User planned to finish tomorrow"
```

Snooze never moves the employer's deadline. A reached or past deadline/target overrides snoozing in the actionable view; the requested snooze remains stored. A past **personal target** is not an overdue employer deadline. Unknown-deadline user tasks remain ready, ordered by age.

## Application references and lifecycle

```bash
node next-actions.mjs bind <id> --revision <current-revision> --tracker-id 42 --reason "User selected this application"
node next-actions.mjs unbind <id> --revision <current-revision> --reason "The message concerns a different role"
node next-actions.mjs dismiss <id> --revision <current-revision> --reason "This request no longer applies"
node next-actions.mjs reopen <id> --revision <current-revision> --reason "User wants to review this again"
```

Binding uses the exact tracker row ID, not the report number or a fuzzy company match. Duplicate or malformed IDs fail. A binding stores the selected tracker and the observed company, role, report and posting URL. If those change, the task requires review. With no report/posting identity, the binding is explicitly weaker; identical names cannot guarantee an ID was never reused. Unmatched outreach tasks are valid.

| Operation | Allowed starting state | Result |
|---|---|---|
| `accept` | `proposed` | `open` |
| `done` | `open` | `done` |
| `dismiss` | `proposed`, `open` | `dismissed` |
| `reopen` | `done`, `dismissed` | `proposed`, for fresh review |
| `edit`, `bind`, `unbind` | `proposed`, `open` | Same state; snooze requires `open` |
| `ack-source` | Any | Same state and task content; recognized input added |

`edit` accepts only `title`, `actor`, `evidence`, `links`, `employerDue`, `targetDate` and `snoozedUntil`. Every mutation of an existing task requires a revision and a reason. Task ID, source identity and imported evidence cannot be replaced. Use `set-status.mjs` separately for an independently reviewed application transition.

## Storage and failure behavior

`data/next-actions.json` belongs to the User Layer under the resolved Data Root: `CAREER_OPS_ROOT` / `CAREER_OPS_DATA_DIR`, then `.career-ops-data`, then the code root. An explicit `CAREER_OPS_TRACKER` changes the tracker used for binding, not the task store. Relative tracker overrides resolve against the code root. Existing `data/*` ignore and updater protection cover the store.

The schema is versioned (`schemaVersion: 1`). Each task contains a UUID, an immutable source and original import, acknowledged source variants, mutable state, revision and history. Each history entry has a timestamp, operation, reason and complete mutable `after` snapshot. The writer validates revision continuity and snapshot consistency, then commits state and history in one atomic replacement under the existing process lock.

Missing store means an empty list. Reading and dry-run do not create files or locks; dry-run is not a reservation. Corrupt, unsupported or oversized stores fail closed without replacing the original. Imports are limited to 500 proposals / 1 MiB; the store is limited to 16 MiB. History and completed-task identity are never silently discarded to fit a limit. Before that limit is reached, a separately designed archive preserving retry identity is needed.

The writer resolves parent symlinks for lock identity and rejects a symlink at the store file itself. This is a local filesystem contract; it does not promise network filesystem locking or power-loss durability beyond the existing atomic writer. Disabling the feature leaves its data intact. No automatic migration or historical backfill runs.

Links are plain data. HTTP(S) links cannot contain URL credentials; `local:` paths must be relative to the Data Root without traversal. Core never opens links or executes evidence text. Private form URL parameters stay local, so do not copy raw stores into public reports or issues.
