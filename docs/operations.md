# Local operations

Install dependencies with `uv sync --locked` and `npm ci`. The root `.venv`
is the Career Ops Python environment. Run `.venv/bin/python -B -m career_ops
--help`; each command has its own `--help`.

| Command | Purpose |
| --- | --- |
| `discover [global]` | Collect configured sources or sweep public ATS directories |
| `evaluate ID` | Scan and score a retained opportunity |
| `apply` | Prepare materials; record confirmed events, replies and salary; communication and prefill |
| `interview` | Preparation plans, skill gaps, stories and durable sessions |
| `cv` | Preview, confirm, recover and check candidate facts |
| `show ID` | Show an opportunity and its retained results |
| `list --view VIEW` | Opportunities (default), scores, decisions, applications or followups |
| `insights` | Aggregate retained evidence |
| `task` | Start explicit inputs; inspect, resume, run and cancel tasks |
| `dashboard` | Serve a read-only local page of scanned, scored and applied jobs (`--port`, default 8765) |
| `system` | Doctor, portal maintenance, liveness, company resolution, advance and notify |

Daily commands derive inputs from the opportunity ID:

```bash
.venv/bin/python -B -m career_ops list
.venv/bin/python -B -m career_ops evaluate 123
.venv/bin/python -B -m career_ops apply prepare 123
.venv/bin/python -B -m career_ops interview preparation-plan 123
.venv/bin/python -B -m career_ops interview jd-skill-gap 123
.venv/bin/python -B -m career_ops task show TASK_ID
.venv/bin/python -B -m career_ops task resume TASK_ID --decision confirm
```

Use `task start scan|score|apply ID INPUT` for explicit input imports. Business
commands emit JSON by default. Put global sweep options after `discover global`.
`discover --throttle MS` takes milliseconds; zero disables the delay.
`system resolve-company` previews by default; `--write` and `--dry-run` cannot
be combined. Application events retain confirmation, source attribution and
idempotency requirements; preparing materials never records submission.

`--directory PATH` before the command selects the business store directory;
its default is `data/`. Interview context maps it to `opportunities.db`.
Read-only file tools do not use a business directory. Application preparation
never submits an application. New model calls and external sends require the
appropriate user authorization.

Personal data belongs in `inputs/`: `cv.md`, `profile.yml`, `targeting.md`,
`portals.yml`, `voice.md`, optional `article-digest.md`, `documents/`, `stories/`,
and `writing-samples/`. Copy example profile and fact constraints from
`docs/examples/` when setting up a fresh checkout; copy `portals.yml` there
to `inputs/portals.yml` for source configuration. `CAREER_OPS_INPUT_ROOT` may
select another input directory. Its sibling `rules/` holds scoring and workflow
policies. Inherited environment settings take priority over `.env`.

`rules/scoring.md`, domain policies, shared contract, and market rules retain
their existing bytes. Their historical path and command labels are stable
source labels in persisted inputs, not executable entrypoints. The context
manifest is also preserved as a record of those labels. Use this document and
the agent router for current command paths; editing frozen policies intentionally
invalidates affected results and waiting confirmations.

`data/opportunities.db` owns business facts, including CV task previews and
confirmations. `workflow-checkpoints.db` owns scan/score/apply/interview/delivery
execution progress; `cv-checkpoints.db` owns CV preview progress. Completed
business commits remain idempotent even if a process stops before checkpoint
save. CV file application verifies the confirmed preview, locks updates, and
recovers the same task after interruption.

Reports, captured sources, frozen payloads, PDFs, package manifests, and stored
absolute artifact references retain their existing physical locations and bytes.
They are not moved into a cosmetic new layout. Historical working directories
remain where referenced by checkpoint state or manifests. New operation paths
must not overwrite those artifacts.

Hermes invokes `scripts/career-ops-scan.sh` and `scripts/career-ops-score.sh`;
installed copies under `~/.hermes/scripts/` must match. Scan collects discovery;
score advances existing evaluation tasks and uses the previously authorized
notification policy. Check `system doctor --json` and the offline suite before enabling
changed wrappers. Neither doctor nor offline fixtures send candidate data.

JD capture cache lives at `data/cache/scan-jds/` and is reused for at most 24 hours.
Retained source evidence belongs to the business store and referenced artifacts.
Unreferenced acceptance output, expired captures and old tracker-import batches
are removed without an archive.
