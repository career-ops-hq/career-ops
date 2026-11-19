# Hosted application work

Read `../PROJECT_HANDOFF.md` and `../docs/hosted/backend-design.md` before changing this subtree. Root `AGENTS.md` and `DATA_CONTRACT.md` still apply to engine behavior.

This subtree owns the hosted integration boundary. Reuse the engine instead of duplicating scoring, tracker parsing, fact validation or PDF rules. Keep upstream core modifications minimal and test behavior parity whenever extraction is necessary.

Build import-safe modules and allowlisted operations. Pass explicit immutable run context and per-child environments; reject browser-selected roots, executable names and raw flags. All fixtures must be synthetic. No production keys or personal documents in source or tests.

Use Node's built-in test runner for adapter tests where possible. Tests must verify behavior, including tenant separation and failure outcomes; a fake executable proves only the process contract. Document live engine verification separately.

Keep PROJECT_HANDOFF.md current after implementation chunks. Record exact commands/results and blockers. Never describe the product as deployed or secure merely because adapter unit tests pass.
