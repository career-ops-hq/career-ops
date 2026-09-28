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
workflow/.venv/bin/python -m workflow.career_ops discover
workflow/.venv/bin/python -m workflow.career_ops scan-discovered <opportunity-id> [--re-evaluate]
workflow/.venv/bin/python workflow/career_ops.py cron-score
workflow/.venv/bin/python workflow/career_ops.py show <task-or-opportunity-id>
workflow/.venv/bin/python workflow/career_ops.py list
workflow/.venv/bin/python workflow/career_ops.py scores
workflow/.venv/bin/python workflow/career_ops.py resume <task-id> [--input <scan-input.json>] [--feedback <text>] [--decision confirm|defer|accept-jd-change]
workflow/.venv/bin/python workflow/career_ops.py cancel <task-id>
workflow/.venv/bin/python workflow/career_ops.py application submit <opportunity-id> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python workflow/career_ops.py application transition <opportunity-id> <status> --confirmed --source <source> --idempotency-key <operation-id>
workflow/.venv/bin/python workflow/career_ops.py application activity <opportunity-id> <type> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python workflow/career_ops.py application outcome <opportunity-id> <outcome> --confirmed --source <source> --idempotency-key <operation-id>
workflow/.venv/bin/python workflow/career_ops.py application schedule <opportunity-id> <YYYY-MM-DD> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python workflow/career_ops.py application retire <opportunity-id> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python workflow/career_ops.py application reopen <opportunity-id> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python workflow/career_ops.py application view [opportunity-id]
workflow/.venv/bin/python workflow/career_ops.py application followups [--overdue-only] [--applied-days <days>]
workflow/.venv/bin/python -m workflow.career_ops reply import <message.json-or-pasted-email.txt>
workflow/.venv/bin/python -m workflow.career_ops reply paste [email.txt]
workflow/.venv/bin/python -m workflow.career_ops reply view <message-id>
workflow/.venv/bin/python -m workflow.career_ops reply confirm <message-id> --opportunity <id> --status responded|interview|offer|rejected --confirmed [--reason <reason>]
```

All commands emit JSON. `discover` calls the existing Node provider scanner as
a collection tool; its configured sources, filters, deduplication and source
health remain in that layer. The scanner writes to the same SQLite database and
retains browser JD captures for the LangGraph scan handoff. A WebSearch handoff
or failed capture is not a completed scan. `scan-discovered` and `cron-score`
retry one stale or missing JD snapshot through the same guarded browser reader;
redirects away from the posting and failed reads remain Unknown. A different
module or changed input cannot silently reuse an active task. The scheduled
score entry retries waiting source-Unknown scan tasks after pending jobs and
rotates failed probes so one blocked posting does not starve another.
`scan-discovered` can resume the same waiting task when refreshed evidence
arrives. Scan produces the validated
`jd_report_v1`; score and
apply consume completed upstream results by opportunity ID. The module fingerprint
binds those results to the current CV, profile, targeting, and rules. Existing
valid results are reused; changed inputs require `--re-evaluate`.

Tasks use `running`, `waiting`, `completed`, and `cancelled`. Business tables in
`opportunities.db` are authoritative; `workflow-checkpoints.db` records execution
progress only. After package generation, the graph calls the retained
Reactive Resume tool to update a task-owned copy and export a PDF. Readable
PDF pages, candidate identity, and every package file hash are recorded with
the draft. Confirmation checks the current inputs, PDF, and actual file
bytes before committing the whole package; failed exports can resume on the
same task. Apply pauses for user review/confirmation. No path submits an
application or sends a message.
`application submit` records only a user-confirmed actual submission, not an
apply-package confirmation. Pass `--payload '{"submitted_at":"YYYY-MM-DD"}'`
when the submission date is known; otherwise follow-up dates are explicitly
labelled as proxies. If several confirmed packages exist, also provide the
actual `package_result_key` in that payload; the CLI rejects ambiguous evidence.
`followup_sent` activity may similarly carry `sent_at`.
Follow-up queries compute the retained cadence from business history and
profile overrides; schedule/retire/reopen record manual decisions, not sends.
Reply import retains the original user-provided message, deterministic
classification, match signals, and ranked invite candidates. It only suggests
a status. Confirmation runs the application lifecycle graph; an unmatched or
ambiguous application or a different status needs an explicit reason.
