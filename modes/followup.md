# Mode: followup — Canonical Follow-up View

Read active applications only from SQLite:

```bash
node application-lifecycle.mjs followups --db "$CAREER_OPS_OPPORTUNITY_DB"
```

Each row is a derived view: company, role, lifecycle status, last transition,
and last recorded follow-up. Never write `data/follow-ups.md` or
`data/applications.md`.

For a user-confirmed sent follow-up, record the event:

```bash
node application-lifecycle.mjs activity <opportunity-id> --type followup_sent --confirmed --db "$CAREER_OPS_OPPORTUNITY_DB"
```

For a user-confirmed status change, use the only transition path:

```bash
node application-lifecycle.mjs transition <opportunity-id> <responded|interview|offer|rejected|discarded> --source candidate-confirmed --db "$CAREER_OPS_OPPORTUNITY_DB"
```

Draft-only. Never send a message or submit an application.
