<!-- Maps the effective pre-cutover Node score path to the corrected OII-335 workflow. -->

# OII-335 Node score baseline

Baseline sources are `score-job.mjs` and `scripts/hermes-score.py` from
`6530b9f5^`, as required by OII-333.

| Effective Node behavior | Python + LangGraph replacement |
|---|---|
| Prepare one immutable packet from JD and candidate sources | Strict `jd_report_v1` input plus whole-module fingerprint |
| Prescreen complete/live evidence and preserve Unknown | `workflow.prescreen` and evidence-insufficient waiting |
| One bounded research round with frozen retrieved quotations | `model_adapter.RESEARCH`, frozen files and checkpointed graph state |
| Evidence-linked four-dimension assessment and interval score | `model_adapter.ASSESS` plus `report.attractiveness` |
| Reuse research during bounded mechanical repair | evaluate/review loop with the prior frozen artifact and review |
| Independent review of citations, dimensions, capabilities and gates | isolated `review` model process with complete candidate facts and rules |
| Reject failed review checks and require current liveness | structural review gate; `Fail` never passes as `approve` |
| Validate report, review hash and score before atomic publish | `BusinessStore.publish` transaction and idempotent result key |
| Recover after process interruption without duplicate publish | SQLite LangGraph checkpoint plus authoritative business-result reconciliation |
| Enforce 20 tool calls and 15 minutes | cumulative task counters across retries and resumes |
| Select current results by interval and coverage | `scores`: `L+(U-L)*P`, then coverage, then opportunity ID |

The Python entrypoint has no synthetic score/exclusion branch. Test fixtures
replace only the external model process and still pass through the production
graph, validation, review and business commit boundaries.
