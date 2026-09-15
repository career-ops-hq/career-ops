# Mode: outcome — Canonical Application Outcomes

Record only a candidate-confirmed outcome for one canonical opportunity:

```bash
node application-outcome.mjs <opportunity-id> <interview_progress|offer_received|hired|offer_declined|rejected|no_response|interview_only> --db "$CAREER_OPS_OPPORTUNITY_DB"
```

The command validates the lifecycle transition, appends an auditable outcome
activity only after that transition succeeds, and returns linked report and
application artifacts. It never rewrites tracker Markdown or discards linked
artifacts.

Ask for confirmation when the outcome or target opportunity is ambiguous. Do
not infer an outcome from silence. Draft-only; never contact an employer.
