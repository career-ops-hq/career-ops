<!-- Maps the effective pre-cutover Node score path to the current OII-335 workflow. -->

# OII-335 Node score baseline

Baseline sources are `score-job.mjs` and `scripts/hermes-score.py` from
`6530b9f5^`, as required by OII-333.
The later `1c905b95` change removed the independent model review stage. The
user confirmed that this removal remains the current product decision. Score
acceptance therefore checks deterministic evidence validation and the human
review boundary before any application, while preserving the historical Node
behavior below for parity accounting.

| Effective Node behavior | Python + LangGraph replacement |
|---|---|
| Prepare one immutable packet from JD and candidate sources | Strict `jd_report_v1` input plus whole-module fingerprint |
| Prescreen complete/live evidence and preserve Unknown | `workflow.prescreen` and evidence-insufficient waiting |
| One bounded research round with frozen retrieved quotations | `model_adapter.RESEARCH`, frozen files and checkpointed graph state |
| Evidence-linked four-dimension assessment and interval score | `model_adapter.ASSESS` plus `report.attractiveness` |
| Reuse research during bounded mechanical repair | bounded assessment repair with the prior frozen research artifact |
| Independent review of citations, dimensions, capabilities and gates | deterministic report and evidence validation; no independent model review stage |
| Reject failed review checks and require current liveness | deterministic evidence and liveness gates; failed gates cannot publish |
| Validate report, review hash and score before atomic publish | `BusinessStore.publish` transaction and idempotent result key, without a review hash |
| Recover after process interruption without duplicate publish | SQLite LangGraph checkpoint plus authoritative business-result reconciliation |
| Enforce 20 tool calls and 15 minutes | cumulative task counters across retries and resumes |
| Select current results by interval and coverage | `scores`: `L+(U-L)*P`, then coverage, then opportunity ID |

The Python entrypoint has no synthetic score/exclusion branch. Test fixtures
replace only the external model process and still pass through the production
graph, deterministic validation and business commit boundaries.
