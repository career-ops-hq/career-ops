<!-- Documents the local Python workflow entrypoint and its persisted contract. -->

# Career Ops workflow

Install the locked environment with:

```bash
uv sync --project workflow
```

The CLI writes business state to the canonical `data/opportunities.db` and
execution checkpoints to `data/workflow-checkpoints.db`:

```bash
workflow/.venv/bin/python workflow/career_ops.py start scan <opportunity-id> <scan-input.json>
workflow/.venv/bin/python workflow/career_ops.py start score <opportunity-id> scan:<opportunity-id>
workflow/.venv/bin/python workflow/career_ops.py start apply <opportunity-id> score:<opportunity-id>
workflow/.venv/bin/python workflow/career_ops.py cron-score
workflow/.venv/bin/python workflow/career_ops.py show <task-or-opportunity-id>
workflow/.venv/bin/python workflow/career_ops.py list
workflow/.venv/bin/python workflow/career_ops.py resume <task-id> [--input <scan-input.json>] [--feedback <text>] [--decision confirm|defer|accept-jd-change]
workflow/.venv/bin/python workflow/career_ops.py cancel <task-id>
```

All commands emit JSON. Scan produces the reviewed `jd_report_v1`; score and
apply consume reviewed upstream results by opportunity ID. The module fingerprint
binds those results to the current CV, profile, targeting, and rules. Existing
valid results are reused; changed inputs require `--re-evaluate`.

Tasks use `running`, `waiting`, `completed`, and `cancelled`. Business tables in
`opportunities.db` are authoritative; `workflow-checkpoints.db` records execution
progress only. Apply pauses for review/confirmation. No path submits an
application or sends a message.
