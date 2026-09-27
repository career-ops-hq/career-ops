<!-- Maps the retained Node application behavior to the OII-339 Python cutover. -->

# OII-339 Node behavior baseline

| Node behavior | Python replacement |
|---|---|
| `application-lifecycle.mjs view` | `application view` |
| `application-lifecycle.mjs followups` | `application followups` |
| `application-lifecycle.mjs transition` | LangGraph `validate -> commit` transition |
| `application-lifecycle.mjs activity` | LangGraph `validate -> commit` activity |
| `application-outcome.mjs` outcome mapping and preserved-artifact response | LangGraph `validate -> commit` outcome with current artifact references |
| `followup-cadence.mjs` active states, profile/default intervals, urgency, cold cutoff and overdue filter | `application followups` over canonical lifecycle and sent-activity dates |
| `followup-cadence.mjs` intermediary, notes, sent-history and report context | `application followups` fields from submission, activity and retained score result |
| `followup-seed.mjs` next-date pins and `followup-cadence.mjs` cleared directives | idempotent LangGraph `application schedule`, `retire`, and `reopen` directives |
| `store.mjs` applied/responded/interview/offer/rejected/discarded/hired states and forward-only edges | `STATUSES` and `TRANSITIONS` |
| candidate-confirmed submission after a verified package | explicit `application submit --confirmed` after a confirmed Python apply result |

Python additionally binds every write to an idempotency key. Replaying a
completed operation returns the retained result without adding an event or
activity. Package confirmation remains distinct from the user's report that an
application was actually submitted.
The legacy Markdown follow-up CLIs remain callable until the real submitted
record acceptance gate passes; they are not a second canonical business store.
