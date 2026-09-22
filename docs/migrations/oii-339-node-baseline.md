<!-- Maps the retained Node application behavior to the OII-339 Python cutover. -->

# OII-339 Node behavior baseline

| Node behavior | Python replacement |
|---|---|
| `application-lifecycle.mjs view` | `application view` |
| `application-lifecycle.mjs followups` | `application followups` |
| `application-lifecycle.mjs transition` | LangGraph `validate -> commit` transition |
| `application-lifecycle.mjs activity` | LangGraph `validate -> commit` activity |
| `application-outcome.mjs` outcome mapping | LangGraph `validate -> commit` outcome |
| `store.mjs` applied/responded/interview/offer/rejected/discarded/hired states and forward-only edges | `STATUSES` and `TRANSITIONS` |
| candidate-confirmed submission after a verified package | explicit `application submit --confirmed` after a confirmed Python apply result |

Python additionally binds every write to an idempotency key. Replaying a
completed operation returns the retained result without adding an event or
activity. Package confirmation remains distinct from the user's report that an
application was actually submitted.
