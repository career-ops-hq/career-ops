# Repository consolidation, 2026-10-02

Implementation slices: `d09005d8` retires unused Node business closures and
execution oracles; `93e2e208` uses transactions for operations that need no pause;
`8b7b33cf` shares capability parsing and preparation plans; `4d9ff54e` groups
Python domains and Node adapters under the unified CLI; `6ad33e0b` moves inputs,
policies, tests, and CV facts to their canonical responsibilities.

The user approved one semantic correction: complete CV Skills hierarchy parsing
includes Production Engineering and supported prototypes, and excludes In
Progress. CV source bytes were not edited. Other path changes preserve business
query outputs, source envelopes, input serialization, workflow version, graph
node names, thread IDs, and artifact hashes.

| Former physical input | Current physical input |
| --- | --- |
| cv.md | inputs/cv.md |
| config/profile.yml | inputs/profile.yml |
| modes/_profile.md | inputs/targeting.md |
| voice-dna.md | inputs/voice.md |
| portals.yml | inputs/portals.yml |
| documents/ | inputs/documents/ |
| interview-prep/ | inputs/stories/ |
| writing-samples/ | inputs/writing-samples/ |
| modes/_custom.md | rules/scoring.md |
| modes/_brief.md | rules/workflow.md (private customization) |
| prompts/ | rules/ |
| markets/ | rules/markets/ |

Writing-sample logical keys and persisted candidate source labels remain stable.
Its README is retained inside the input directory because it participates in the
source envelope. Policies and the context manifest retain their original bytes,
including historical command labels. Current execution instructions live in
`../operations.md` and the agent router.

CV task and confirmation tables now use `data/opportunities.db`. A local search
found no pre-existing CV maintenance database requiring a row migration. The
isolated CV suite verifies confirmation, file rollback/recovery, idempotency, and
coexistence with unrelated business rows. Separate CV checkpoints remain valid.

Business and checkpoint stores, frozen artifacts, manifests, reports, personal
facts, and referenced historical work directories were not rewritten. Before and
after independent checks compared all existing business/checkpoint table rows,
274 current task fingerprints, 49 artifacts, and 85 provider names. Historical
reports and backups remain at their original referenced paths. History documents
were moved byte-for-byte; obsolete generated runtime files were removed only
after the root environment passed recovery checks.

Offline verification uses `scripts/check.py` over both nested test domains and
`node scripts/check-syntax.mjs`. The full implementation run passed 178 checks;
two test-boundary errors were then corrected and passed narrowly: a retired
venv path in the PDF fixture, and an uncontrolled browser refresh in the scan
fixture. The scan fixture now controls that boundary and retains the explicit
same-task refresh recovery case. These tests do not establish live provider
coverage, model quality, or a new external notification acceptance event.

Hermes was paused before runtime changes, and its installed wrapper copies were
synchronized with the repository. Original enabled states and schedule expressions
must be restored only after independent acceptance; the migration did not change
the schedule or trigger an operational model call, notification, or application.
