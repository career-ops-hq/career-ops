<!-- Documents the local Python workflow entrypoint and its persisted contract. -->

# Career Ops workflow

Install the locked environment with:

```bash
uv sync --project workflow
```

The CLI writes business state and LangGraph checkpoints below `data/workflow/`:

```bash
workflow/.venv/bin/python workflow/career_ops.py start score <opportunity-id> <jd-report.json>
workflow/.venv/bin/python workflow/career_ops.py show <task-or-opportunity-id>
workflow/.venv/bin/python workflow/career_ops.py list
workflow/.venv/bin/python workflow/career_ops.py resume <task-id> [--input <jd-report.json>]
workflow/.venv/bin/python workflow/career_ops.py cancel <task-id>
```

All commands emit JSON. A score input must be a `jd_report_v1` JSON document
with a complete active JD and evidence-constrained prescreen result. The module
fingerprint binds that report to the current CV, profile, targeting, and scoring
rules. Existing valid scores are reused; changed inputs require the explicit
`--re-evaluate` flag.

Tasks use `running`, `waiting`, `completed`, and `cancelled`. Business results in
`business.db` are authoritative; `checkpoints.db` only records execution progress.
No score path requests human approval, submits an application, or sends a message.
