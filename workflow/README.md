<!-- Documents the local Python workflow entrypoint and its persisted contract. -->

# Career Ops workflow

Install the locked environment with:

```bash
uv sync --project workflow
```

Direct CLI execution loads the repository `.env` without overriding inherited
environment variables, matching the former Node scan entrypoint. This includes
the local transparent-proxy setting used by provider fetches.

The CLI writes business state to the canonical `data/opportunities.db` and
execution checkpoints to `data/workflow-checkpoints.db`:

```bash
workflow/.venv/bin/python -m workflow.career_ops start scan <opportunity-id> <scan-input.json>
workflow/.venv/bin/python -m workflow.career_ops start score <opportunity-id> scan:<opportunity-id>
workflow/.venv/bin/python -m workflow.career_ops start apply <opportunity-id> score:<opportunity-id>
workflow/.venv/bin/python -m workflow.career_ops discover [--dry-run] [--resume]
workflow/.venv/bin/python -m workflow.career_ops global --ats greenhouse,workday [--seeds yc,a16z] [--since 3] [--limit 100] [--liveness] [--md-out DIR] [--dry-run] [--resume]
workflow/.venv/bin/python -m workflow.career_ops resolve-company --in <companies.yml> [--vendors gh,ashby,lever,workday] [--write]
workflow/.venv/bin/python -m workflow.career_ops scan-discovered <opportunity-id> [--re-evaluate]
workflow/.venv/bin/python -m workflow.career_ops cron-score
workflow/.venv/bin/python -m workflow.career_ops show <task-or-opportunity-id>
workflow/.venv/bin/python -m workflow.career_ops list
workflow/.venv/bin/python -m workflow.career_ops scores
workflow/.venv/bin/python -m workflow.career_ops decisions
workflow/.venv/bin/python -m workflow.portal_config --file portals.yml
workflow/.venv/bin/python -m workflow.liveness_check [--file urls.txt | <url> ...] [--no-fallback] [--throttle=5000]
workflow/.venv/bin/python -m workflow.cv_facts <generated-cv.md> [--source cv.md] [--json]
workflow/.venv/bin/python -m workflow.application_prefill --url <ATS-apply-url> --pdf output/<reviewed-resume.pdf> [--cover <cover.txt>]
workflow/.venv/bin/python -m workflow.notifications preview <opportunity-id>
workflow/.venv/bin/python -m workflow.career_ops resume <task-id> [--input <scan-input.json>] [--feedback <text>] [--decision confirm|defer|accept-jd-change]
workflow/.venv/bin/python -m workflow.career_ops cancel <task-id>
workflow/.venv/bin/python -m workflow.career_ops application submit <opportunity-id> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python -m workflow.career_ops application transition <opportunity-id> <status> --confirmed --source <source> --idempotency-key <operation-id>
workflow/.venv/bin/python -m workflow.career_ops application activity <opportunity-id> <type> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python -m workflow.career_ops application outcome <opportunity-id> <outcome> --confirmed --source <source> --idempotency-key <operation-id>
workflow/.venv/bin/python -m workflow.career_ops application schedule <opportunity-id> <YYYY-MM-DD> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python -m workflow.career_ops application retire <opportunity-id> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python -m workflow.career_ops application reopen <opportunity-id> --confirmed --idempotency-key <operation-id>
workflow/.venv/bin/python -m workflow.career_ops application view [opportunity-id]
workflow/.venv/bin/python -m workflow.career_ops application followups [--overdue-only] [--applied-days <days>]
workflow/.venv/bin/python -m workflow.career_ops reply import <message.json-or-pasted-email.txt>
workflow/.venv/bin/python -m workflow.career_ops reply paste [email.txt]
workflow/.venv/bin/python -m workflow.career_ops reply view <message-id>
workflow/.venv/bin/python -m workflow.career_ops reply confirm <message-id> --opportunity <id> --status responded|interview|offer|rejected --confirmed [--reason <reason>]
workflow/.venv/bin/python -m workflow.career_ops insights stats|reposts|company|company-signals|salary|stated|upskill|jd-skill-gap|preparation-plan [options]
workflow/.venv/bin/python -m workflow.career_ops insights preparation-plan --jd <jd.md> --company <name> --role <title> [--report <score.md>] [--output <plan.json>]
workflow/.venv/bin/python -m workflow.career_ops salary record <observation.json> --idempotency-key <operation-id> --confirmed
workflow/.venv/bin/python -m workflow.communications draft <opportunity-id>
workflow/.venv/bin/python -m workflow.communications show <opportunity-id>
```

Commands emit JSON unless `resolve-company --summary` requests a human-readable
table. `resolve-company` probes public ATS boards through Node provider tools;
Python owns input validation, vendor priority, Workday hints, deduplication and
the preview or explicit `--write` decision. The default preview leaves
`portals.yml` untouched. `global` runs directory collection, VC seed collection,
final evidence gates and publication as checkpointed LangGraph nodes. Its
per-batch JSON checkpoint retains the original date window and exact source
position under the selected `--directory`; the SQLite stage checkpoint keeps
hashed references to decision and result artifacts. Accepted postings go to
the same SQLite business store.
`--resume` checks the directory fingerprint before continuing. `discover` runs
collection, decision and business publication as a checkpointed LangGraph under
`cache/configured-discovery` in the selected directory. Its checkpoint stores
artifact paths and hashes; raw provider batches and decisions stay in separate
local JSON files. `discover --resume` continues the last interrupted run with
its original date cutoffs and refuses changed inputs. Node provider plugins
fetch raw postings and the guarded browser reads JD pages; Python applies the
configured filters, trust rules, deduplication, cooldowns, verification outcomes,
and source health before writing to the same SQLite database.

Sources belong to two lists in `portals.yml`: `tracked_companies` contains
employer/ATS sources (including searches across ATS domains); `job_boards`
contains multi-employer aggregators. Collection method is independent of this
classification. Keyword-based providers use `target_roles.search_keywords` from
the selected `config/profile.yml`, frozen once at the start of each discovery
run. Changing this list takes effect on the next run and invalidates resume of
an interrupted run. Source entries contain no role keyword overrides; title
filters still decide which collected postings match. Full-feed providers keep
their existing fetch-then-filter behavior.

`provider: search` supports `search.method: linkedin` with one `locations` value
and `sites: [linkedin.com/jobs/view]`, or `search.method: web` with explicit
domain/path `sites` and optional `locations`. Web searches call the existing
Hermes search tool directly using its configured backend and credentials; no
model is invoked. Browser reads retain the existing public-network guard.
Results must match the configured source scope, and an individual detail page
must provide an employer, title and substantive JD through structured JobPosting
markup, the page's own job payload (eFinancialCareers), or a supported labelled
page (European Chamber). Search summaries never become JD evidence.
Keywords take turns supplying results;
`max_results` (default 50) counts unique postings for the whole source/location.
Search result limits, repeated pages, time limits and failed detail reads are
reported as incomplete coverage. Actual queries are retained with the run and
the discovered postings. A failed capture is not a completed scan.

`scan-discovered` and `cron-score`
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
`scores` shows the three dimension scores and input validity. `decisions` groups
current scores as focus when at least two dimensions are scored and every scored
dimension is at least 4; otherwise they are deprioritized. A confirmed failed
hard gate is discarded; uncertain prescreen evidence does not block attention.
Stale scores are listed separately and receive no action. The current
JD report does not retain a verified deadline or work estimate, so those
ordering fields remain null. Notifications use the same attention rule.

Tasks use `running`, `waiting`, `completed`, and `cancelled`. Business tables in
`opportunities.db` are authoritative; `workflow-checkpoints.db` records outer task
progress. `workflow-drafts/<input-hash>/scan-checkpoints.db` records JD extraction,
prescreen and report nodes; the neighboring `score-checkpoints.db` records score
research, assessment and report nodes. `apply-checkpoints.db` records drafting,
revision merge, validation and one repair under the package input fingerprint.
The model process uses the same Python interpreter as the workflow so these
LangGraph nodes are available. It loads the local Hermes agent and its installed
dependencies from `~/.hermes/hermes-agent/venv`, while Hermes remains the model
configuration authority. Each model attempt runs in its own process group; a timed-out
attempt terminates its descendants before the task waits for recovery. After
package generation, the graph calls the retained
Reactive Resume tool to update a task-owned copy and export a PDF. Readable
PDF pages, candidate identity, source-backed CV facts, and every package file hash are recorded with
the draft. Confirmation checks the current inputs, PDF, and actual file
bytes before committing the whole package; failed exports can resume on the
same task. Apply pauses for user review/confirmation. No path submits an
application or sends an application message. The separate high-score Discord
notification runs from the scheduled score wrapper.
`application submit` records only a user-confirmed actual submission, not an
apply-package confirmation. Pass `--payload '{"submitted_at":"YYYY-MM-DD"}'`
when the submission date is known; otherwise follow-up dates are explicitly
labelled as proxies. No generated application package is required: a candidate
may submit independently using their default resume. Record material details
in payload `notes`. Only provide `package_result_key` when that confirmed
package was actually submitted; the CLI validates that it belongs to this
opportunity and never selects a package automatically.
`followup_sent` activity may similarly carry `sent_at`.
Follow-up queries compute the retained cadence from business history and
profile overrides; schedule/retire/reopen record manual decisions, not sends.
Reply import retains the original user-provided message, deterministic
classification, match signals, and ranked invite candidates. It only suggests
a status. Confirmation runs the application lifecycle graph; an unmatched or
ambiguous application or a different status needs an explicit reason.

Communication drafts use the same published scan and current score, candidate
sources, and application language/market rules. The LangGraph draft and
independent review must both succeed before the pair is saved. No contact
record is needed; these commands never send messages.
`python -m workflow.communications draft <opportunity-id> --statement '<current user statement>'`
optionally adds one explicit user statement as a candidate source for that
draft. Repeat the same `--statement` with `show` to retrieve its version;
without it, the statement cannot validate a claim in another draft.

Interview preparation is a separate LangGraph task over the same canonical
opportunity and published scan/score. The read-only evidence tools replace the
former Node interview commands:

```bash
workflow/.venv/bin/python -m workflow.interview_tools context <opportunity-id> --db data/opportunities.db
workflow/.venv/bin/python -m workflow.interview_tools match-star "<question>" --jd <jd-file>
workflow/.venv/bin/python -m workflow.interview_tools story-provenance
workflow/.venv/bin/python -m workflow.interview_tools preparation-plan --jd <jd-file> --company <company> --role <role>
workflow/.venv/bin/python -m workflow.interview_tools jd-skill-gap <jd-file>
workflow/.venv/bin/python -m workflow.interviews start prepare <opportunity-id> <session-key> --request '{"interview_at":"unknown"}'
workflow/.venv/bin/python -m workflow.interviews show <task-id>
workflow/.venv/bin/python -m workflow.interviews show <task-id> --format markdown
workflow/.venv/bin/python -m workflow.interviews resume <task-id> --feedback '<review notes>'
workflow/.venv/bin/python -m workflow.interviews confirm <task-id>
workflow/.venv/bin/python -m workflow.interviews history <opportunity-id> <session-key>
```

`start` also accepts `practice`, `debrief`, and `learn`; debrief requires a real
user-provided transcript. Model calls require the explicit interview-model gate
and authorization for the configured endpoint. A model-approved draft remains
unconfirmed until the user reviews it and runs `confirm`; this never sends an
application or message. Use `--directory <isolated-data-dir>` for acceptance
checks so the operational database stays unchanged.
`show` defaults to JSON for scripts; `--format markdown` presents the same
stored version, source quotes, and review status as a human-readable draft
without confirming or changing it.

The scheduled score wrapper runs the notification graph after `cron-score`.
Direct notification CLI sends require `CAREER_OPS_NOTIFICATIONS_ENABLED=1`.
The graph checks current score inputs, report
bytes and the profile alert line before claiming a Discord delivery in SQLite.
An interrupted or timed-out send remains uncertain and is never retried
automatically.
