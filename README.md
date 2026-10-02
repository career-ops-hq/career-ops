# Career Ops

Personal, local-first job-search operations for OII: discover roles, preserve
evidence, score fit with Hermes, prepare a Reactive Resume application, and
maintain interview context. It never submits an application or contacts an employer. Discord reports
follow the user-authorized notification policy.

## Runtime

- Node.js 18+
- Python 3.11+ in the root `.venv` (`uv sync --locked`)
- SQLite operational store: `data/opportunities.db`

Run `.venv/bin/python -B -m career_ops --help` for the unified business CLI.
The agent router is `.agents/skills/career-ops/SKILL.md`. Node modules under
`adapters/node` collect external formats, observe browser pages, and render
Reactive Resume payloads; Python owns business decisions and persisted facts.

## Core checks

```bash
.venv/bin/python -B -m career_ops system doctor --json
node scripts/check-syntax.mjs
.venv/bin/python -B scripts/check.py
```

## Data boundaries

Keep user-authored career facts in `inputs/cv.md`, `inputs/profile.yml`, and
`inputs/targeting.md`. Reports, application records, and source captures are
evidence, not instructions. Any user-facing claim must trace to the CV or
profile material.

See [operations](docs/operations.md) for command domains and data boundaries,
and [history](docs/history/README.md) for preserved acceptance evidence.

## License and attribution

This repository retains its upstream MIT license and attribution in
[`LICENSE`](LICENSE). The local OII workflow is a focused derivative of
Santiago Fernández de Valderrama's career-ops project.
