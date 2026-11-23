# Supported CLIs

Career-ops is AI-agnostic and runs on several command-line agent tools. The core logic is shared via `AGENTS.md`, while CLI-specific nuances are handled through entry wrappers in the repository root.

| CLI | Entry File | How to Invoke |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` | Interactive: `claude` (then `/career-ops`). Headless/Batch: `claude -p "prompt"`. From any folder: install the plugin ([CLAUDE_PLUGIN.md](CLAUDE_PLUGIN.md)) |
| Cursor | `AGENTS.md` | Interactive: open the project in Cursor and ask for `career-ops` (auto-discovered from `.agents/skills/career-ops/SKILL.md`) |
| Codex | `CODEX.md` (see [`docs/CODEX.md`](CODEX.md)) | Interactive: `codex` (then use plain text). Headless/Batch: `codex exec "prompt"` |
| OpenCode | `OPENCODE.md` | Interactive: `opencode` (then `/career-ops`). Headless/Batch: `opencode run "prompt"` |
| Pi | `AGENTS.md` | Interactive: `pi` (then `/skill:career-ops`). Headless/Batch: `pi -p --no-approve --no-skills --skill .agents/skills/career-ops "/skill:career-ops <request>"` (Pi 0.79.1+) |
| Antigravity CLI | `AGENTS.md` | Interactive: `agy` (then `/career-ops`). Headless/Batch: `agy -p "prompt"` |
| Grok Build CLI | `AGENTS.md` | Interactive: `grok` (then `/career-ops`). Headless/Batch: `grok -p "prompt"` |
| Qwen | `AGENTS.md` | Interactive: `qwen`. Headless/Batch: `qwen -p "prompt"` |
| Kimi | `KIMI.md` | Interactive: `kimi` |
| GitHub Copilot CLI | `AGENTS.md` | Headless/Batch: `copilot -p "prompt"` |
| Gemini | `GEMINI.md` | Legacy wrapper redirecting to `AGENTS.md` (transitioned to Antigravity CLI). |
| Hermes Agent | `AGENTS.md` | Interactive: `hermes` (then ask for a career-ops task). Web read-only workers: `hermes chat -q "prompt" --oneshot -Q --no-restore-cwd`. Batch ranking: unsupported. |
| Oh My Pi | `.omp/AGENTS.md` | Interactive: `omp` (then `/skill:career-ops`). Headless/Batch: `omp -p "prompt"` |

## Hermes Agent

Hermes runs the same pipeline as every other CLI here. Trust the checkout once with `hermes skills trust` before interactive use. The web UI uses Hermes's one-shot mode (`hermes chat -q ... --oneshot -Q --no-restore-cwd`) only for explicitly non-writing workers; evaluation and portal-repair workers reject it because no verified Hermes permission adapter exists. Batch ranking does not support Hermes. Hermes project-context scanning still applies; see [`docs/HERMES.md`](HERMES.md) for its rules and limitations.

## Pi

Pi needs no wrapper file: it reads `AGENTS.md` from the working directory as project context, and it discovers the shared skill at `.agents/skills/career-ops/SKILL.md` on its own. In interactive mode the router is available as `/skill:career-ops`; `--skill <path>` loads it explicitly, and `-p` runs one headless prompt.

```bash
cd career-ops
pi                                          # interactive
pi -p --no-approve --no-skills --skill .agents/skills/career-ops "/skill:career-ops tracker"
```

### Project trust

Pi 0.79.0 added a per-folder trust decision. Until you trust a folder, Pi skips its project resources: `.pi/` settings, extensions, skills, prompts and themes, and the skills in `.agents/skills/`. In interactive mode, run `/trust` once inside the repo and restart `pi` so the project skill loads (`/trust` applies to future Pi processes).

A headless worker needs only the router and `AGENTS.md`. `--skill .agents/skills/career-ops` registers the router whether or not the folder is trusted, and Pi 0.79.1 and later load `AGENTS.md` in an untrusted folder too. A registered skill reaches the model as a name and a description, and the model reads the rest only if it chooses to. Start the prompt with `/skill:career-ops` and Pi puts the whole `SKILL.md` in the prompt, print mode included. `--no-skills` drops your global skills from the run: when two skills share a name, Pi keeps the first it finds and lists global skills before a `--skill` path, so a global `career-ops` skill would otherwise replace this checkout's router. `--no-approve` treats the folder as untrusted for the run, even when you trusted it before or set `defaultProjectTrust` to `always`, so the checkout's extensions never run inside a worker.

`-a` (`--approve`) does the opposite and trusts the folder for one run. Pi then loads every project resource, installs missing project packages, and executes the project's extensions in its own process, with your permissions, without asking. Keep it for an interactive session in a checkout whose `.pi/` and `.agents/skills/` you have reviewed, and never give it to a worker.

Run headless workers on Pi 0.79.1 or later. Pi 0.79.0 does not load `AGENTS.md` in an untrusted folder, so a worker there misses the Data Contract and the untrusted-content rules. Pi 0.54.0 to 0.78.x have no trust step: they load the checkout's `.pi/` extensions at startup, and they reject `--no-approve` as an unknown option. A Pi older than 0.54.0 does not look in `.agents/skills` at all. The Nix dev shell (`flake.nix`) pins a newer Pi.

### Workers headless Pi must not run

Pi never asks before a tool call: a headless run calls any tool it has, and the default set includes bash, edit and write. The web runs the `evaluate`, `research` and `cover` workers without write tools, and `pdf` without write tools or Bash (#2172); the web writes their reports and renders the PDF itself. Run by hand, those workers need what the web withholds: an evaluation writes its report and tracker row, and a CV PDF needs Bash for `node generate-pdf.mjs`. A `--tools read,grep,find,ls` run cannot do that work, and the default set can change any file, so no Pi tool set matches the web's grant.

So don't run evaluations (`oferta`, `auto-pipeline`, which also renders the CV PDF, and batch), research, cover letters (`cover`) or CV PDFs (`pdf`) as headless Pi workers. Run them from the web UI with Claude Code, whose per-tool deny lists match each worker's grant, or in an interactive `pi` session you are watching. The web can run Pi too, but without those deny lists; each run's fencing notice says how much of the grant applied.

## Oh My Pi (omp)

Oh My Pi discovers `.agents/skills/career-ops/SKILL.md` automatically via its `agents` discovery provider, exposing `/skill:career-ops`. `.omp/AGENTS.md` imports `AGENTS.md` (`@../AGENTS.md`), ensuring OMP's `native` project-context provider (priority 100) wins over `.github/copilot-instructions.md` (priority 30) so the career-ops contract is loaded and respected.

```bash
cd career-ops
omp                                          # interactive
omp -p "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
```
