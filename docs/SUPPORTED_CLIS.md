# Supported CLIs

Career-ops is AI-agnostic and runs on several command-line agent tools. The core logic is shared via `AGENTS.md`, while CLI-specific nuances are handled through entry wrappers in the repository root.

| CLI | Entry File | How to Invoke |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` | Interactive: `claude` (then `/career-ops`). Headless/Batch: `claude -p "prompt"` |
| Cursor | `AGENTS.md` | Interactive: open the project in Cursor and ask for `career-ops` (skill auto-discovered from `.agents/skills/career-ops/SKILL.md`) |
| Codex | `CODEX.md` (see [`docs/CODEX.md`](CODEX.md)) | Interactive: `codex` (then use plain text). Headless/Batch: `codex exec "prompt"` |
| OpenCode | `OPENCODE.md` | Interactive: `opencode` (then `/career-ops`). Headless/Batch: `opencode run "prompt"` |
| Pi | `AGENTS.md` | Interactive: `pi` (then `/skill:career-ops`). Headless/Batch: `pi -p "prompt"` |
| Antigravity CLI | `AGENTS.md` | Interactive: `agy` (then `/career-ops`). Headless/Batch: `agy -p "prompt"` |
| Grok Build CLI | `AGENTS.md` | Interactive: `grok` (then `/career-ops`). Headless/Batch: `grok -p "prompt"` |
| Qwen | `AGENTS.md` | Interactive: `qwen`. Headless/Batch: `qwen -p "prompt"` |
| Kimi | `KIMI.md` | Interactive: `kimi` |
| GitHub Copilot CLI | `AGENTS.md` | Headless/Batch: `copilot -p "prompt"` |
| Gemini | `GEMINI.md` | Legacy wrapper redirecting to `AGENTS.md` (transitioned to Antigravity CLI). |
| Hermes Agent | `AGENTS.md` | Interactive: `hermes` (then ask for a career-ops task). Web read-only workers: `hermes chat -q "prompt" --oneshot -Q --no-restore-cwd`. Batch ranking: unsupported. |

## Hermes Agent

Hermes runs the same pipeline as every other CLI here. Trust the checkout once with `hermes skills trust` before interactive use. The web UI uses Hermes's one-shot mode (`hermes chat -q ... --oneshot -Q --no-restore-cwd`) only for explicitly non-writing workers; evaluation and portal-repair workers reject it because no verified Hermes permission adapter exists. Batch ranking does not support Hermes. Hermes project-context scanning still applies; see [`docs/HERMES.md`](HERMES.md) for its rules and limitations.

## Pi

Pi needs no wrapper file: it reads `AGENTS.md` from the working directory as project context, and it discovers the shared skill at `.agents/skills/career-ops/SKILL.md` on its own. In interactive mode the router is available as `/skill:career-ops`; `--skill <path>` loads it explicitly, and `-p` runs one headless prompt.

```bash
cd career-ops
pi                                          # interactive
pi -p "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
```
