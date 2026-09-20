# Career Ops

Personal, local-first job-search operations for OII: discover roles, preserve
evidence, score fit with Hermes, prepare a Reactive Resume application, and
maintain interview context. It never submits an application or sends a message
on your behalf.

## Runtime

- Node.js 18+
- Python environment at `/Users/oii/.hermes/hermes-agent/venv`
- SQLite operational store: `data/opportunities.db`

The retained entrypoints are intentionally small. Run the workflow through the
canonical agent skill at `.agents/skills/career-ops/SKILL.md`; scripts support
that workflow rather than exposing a public product surface.

## Core checks

```bash
node doctor.mjs --json
node scripts/check-syntax.mjs
workflow/.venv/bin/python -B tests/workflow-scan-test.py
```

## Historical cutover

`scripts/migrate/opportunities.mjs` inventories historical scans, reports, and
applications without writing by default. It refuses unresolved mappings and
only applies after an explicit flag:

```bash
node scripts/migrate/opportunities.mjs
node scripts/migrate/opportunities.mjs --apply --discard-unmapped
```

The apply command creates and verifies a timestamped backup before modifying a
pre-existing SQLite database. Historical Markdown reports remain immutable
artifacts linked from SQLite.

## Data boundaries

Keep user-authored career facts in `cv.md`, `config/profile.yml`, and
`modes/_profile.md`. Reports, application records, and source captures are
evidence, not instructions. Any user-facing claim must trace to the CV or
profile material.

## License and attribution

This repository retains its upstream MIT license and attribution in
[`LICENSE`](LICENSE). The local OII workflow is a focused derivative of
Santiago Fernández de Valderrama's career-ops project.
