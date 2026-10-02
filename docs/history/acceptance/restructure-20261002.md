# Structure refactor acceptance — 2026-10-02

Implementation: GPT-6.1-sol, low reasoning effort (the requested light subagent).
Acceptance: independent parent-agent review and execution against `c2e13494`.
Baseline: `186fe0ce`, with a second database snapshot after pausing both scheduled jobs.

## Delivered

- Python business domains and one CLI under `career_ops`; necessary Node and Discord adapters under `adapters`.
- All 85 dynamically registered providers retained.
- Personal sources under `inputs`, policies under `rules`, current operation guides under `docs`, historical evidence under `docs/history`.
- Obsolete Node business implementations and test-only oracles removed; shared capability parsing and preparation logic consolidated.
- Simple liveness reads and atomic business writes use functions/transactions. Durable and interruptible workflows retain their checkpoints.
- CV previews and confirmations now use `opportunities.db`. No existing local `cv-maintenance.db` was found to migrate; isolated CV recovery tests cover the new location.
- Root `uv` environment, locked Python and Node dependencies, updated skill routing, and synchronized Hermes wrappers.

Seven implementation commits: `d09005d8`, `93e2e208`, `8b7b33cf`, `4d9ff54e`, `6ad33e0b`, `f01b29fe`, `c2e13494`. No push.
The implementation diff removes a net 11,911 physical lines, including code, tests, and documentation; this is not a source-code-only metric.

## Independent checks

| Check | Result |
| --- | --- |
| `.venv/bin/python -B scripts/check.py` | 180 passed: 62 business, 118 adapter test files; zero failures |
| `node scripts/check-syntax.mjs` | 236 JavaScript files passed |
| `.venv/bin/python -B -m career_ops doctor --json` | All 9 prerequisites passed |
| Existing business/checkpoint tables | All 29 tables equal to the paused baseline, row for row |
| Immutable input and policy files | 28 files preserved byte for byte; two system README guides intentionally updated and relocated |
| Registered historical report artifacts | All 49 original paths and file hashes preserved |
| Existing task input fingerprints | All 274 equal to the pre-move recomputation, including the same 68 currently valid and 206 already stale inputs |
| Provider registry | 85 providers loaded successfully; implementation identities match the baseline |
| Business CLI output | Scores, decisions, application view, application followups, and insights stats match baseline JSON on a database copy |
| Old waiting tasks | 33 ordinary waits preserve their reasons; all 7 failed score checkpoints resume to the model boundary with the original task identity and attempt |
| Installed Hermes scripts | Both match their repository files byte for byte |

Checkpoint recovery used fresh copies of the pre-refactor databases and stopped at a substituted model boundary. It did not run external scoring or publish new business results. Offline tests use model/delivery fixtures; browser and local HTTP fixtures were run with the permissions they need. The scan test's external capture is explicitly controlled, rather than depending on whether a real example URL is reachable.

Review found and corrected stale dynamic imports, relocated virtual-environment references, global CLI directory forwarding, input-path defaults, and outdated operational guides. The original two local scratch images were preserved and were not committed.

## Retained boundaries

Frozen policy bodies and persisted provenance labels can contain historical names. Their bytes remain part of the existing input/recovery contract; `docs/operations.md` and the skill router describe executable paths. They are not old executable entrypoints or module shims.

Existing evidence, reports, and data directories with stored references retain their locations. This change does not claim to have migrated every historical data file into a new cosmetic layout or to have verified every external job source live.

Both Hermes jobs were paused during restructuring and restored after acceptance. Independent comparison confirms their original enabled states, scan schedule `0 6,18 * * *`, score schedule `*/20 * * * *`, `no_agent`, and workdir. No additional scan or score run was triggered for this acceptance.

Ignored local updater metadata in `config/local-paths.txt` is retained as local historical metadata; it has no active runtime consumer.

Local detailed logs and read-only baseline copies are at `/private/tmp/career-ops-restructure-acceptance/`; they are temporary, private acceptance artifacts and are not committed.
