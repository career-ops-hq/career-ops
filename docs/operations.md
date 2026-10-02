# Local operations

Install dependencies with `uv sync --locked` and `npm ci`. The root `.venv`
is the Career Ops Python environment. Run `.venv/bin/python -B -m career_ops
--help`; each command has its own `--help`.

| Domain | Commands |
| --- | --- |
| Discovery | discover, global, resolve-company, portal validate/repair/health, liveness |
| Evaluation and recovery | start, run, resume, cancel, scan-discovered, cron-score, show, list, scores, decisions |
| Applications | application, reply, communication, prefill |
| Interview preparation | interview start/show/resume/confirm/history, context, match-star, story-provenance, preparation-plan, jd-skill-gap |
| Candidate facts | cv preview/apply/show/resume, cv check |
| Retained insights | insights |
| Runtime and delivery | doctor, notify |

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
notification policy. Check `doctor --json` and the offline suite before enabling
changed wrappers. Neither doctor nor offline fixtures send candidate data.
