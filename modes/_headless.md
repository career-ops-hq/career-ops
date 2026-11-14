# Headless and batch workers

AGENTS.md → "Headless / Batch Mode" sends you here. Read this file before spawning a headless worker, before a parallel fan-out of evaluators, and before writing or reviewing code that launches an agent CLI headless.

Headless worker command per CLI:

| CLI | Command |
|-----|---------|
| Claude Code | `claude -p "prompt"` |
| **OpenCode** | `opencode run "prompt"` (falls back to `ollama launch opencode -y -- run "prompt"` if `opencode` binary is not in PATH) |
| Pi | `pi -a -p "prompt"` |
| Copilot CLI | `copilot -p "prompt"` |
| Codex | `codex exec "prompt"` |
| Qwen | `qwen -p "prompt"` |
| Antigravity CLI | `agy -p "prompt"` |
| Grok Build CLI | `grok -p "prompt"` |

**Headless worker permissions — one rule for every entry point (#2876).** A worker never gets more write power headless than the web grants the same worker kind. The web's grant is the audited one: `WRITE_CAPABLE_TOOLS` and the per-kind deny lists in `web/src/lib/claude-invocation.mjs` (`pdf` has had no Bash since #2172 and must never regain it).
- Never add a blanket auto-approve flag (`--dangerously-skip-permissions`, `--always-approve`, `--yolo`, `--full-auto`, …) to a new spawner. If a CLI has no per-tool deny list to express the restriction, withhold the write-capable workers from that CLI instead of auto-approving them.
- Prefer moving the write out of the agent: the worker returns content and the harness writes the file or renders the PDF, which is how the web's `pdf` path stays read-only.
- `batch-tailor.mjs` and `batch/batch-runner.sh` still pass such a flag. That is known debt tracked in #2876, not a precedent. `tests/headless-permission-flags.test.mjs` discovers every code file that passes one and fails on any file outside that list, or on any grant added inside it. It sees flags only: a CLI that auto-approves headless without one is outside what it can check (`batch/batch-runner.sh` also launches `opencode`, `gemini` and `qwen` with no flag), so review such a launch against this rule by hand.

**Parallel fan-outs — reserve report numbers first.** Before spawning N parallel evaluators, reserve the range: `node reserve-report-num.mjs --count N` (prints e.g. `042-049`); hand each worker its own number. The allocator treats report files, sentinels, tracker row IDs, tracker report links, and tracker numbers still named in `status-log.tsv`, `data/follow-ups.md`, `data/salary-observations.tsv` or `data/contacts.tsv` as occupied, so a deleted or merged-away row's number is never handed to a new application; each slot claim is individually atomic (on collision, claimed slots are released and the reservation restarts past it — permanent, harmless gaps). Release with `node reserve-report-num.mjs --release 042-049` when done; stale sentinels are GC'd after 4h, so reserve right before spawning. Never let parallel workers compute `max+1` themselves — that is the #749 race.
