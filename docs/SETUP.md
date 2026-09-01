# Setup Guide

## Prerequisites

- An AI coding CLI — [Claude Code](https://claude.ai/code), Gemini CLI, Codex, Qwen Code, OpenCode, GitHub Copilot CLI, Antigravity CLI, or Grok Build CLI (see [Supported CLIs](SUPPORTED_CLIS.md))
- [Node.js](https://nodejs.org) 18+ and `git` (`npx` ships with Node — the installer refuses to run without them) — note: the Gemini CLI integration requires Node.js 20+
- (Optional) Go 1.21+ (for the dashboard TUI)

## Quick Start

### Browser-only — Claude Code on the web

[Claude Code on the web](https://code.claude.com/docs/en/web-quickstart) can run
career-ops without a local checkout. It is currently a research preview for
eligible Claude plans. A web session clones a GitHub repository into an
isolated cloud VM; it does not have your machine's files or local configuration.

1. Put career-ops in a **private GitHub repository** that your account can
   access. You can use [GitHub Importer](https://docs.github.com/en/migrations/importing-source-code/using-github-importer/importing-a-repository-with-github-importer)
   with `https://github.com/career-ops-hq/career-ops.git` as the source. A normal
   fork of this public repository is public, so do not use one for personal
   career data.
2. Open [claude.ai/code](https://claude.ai/code), connect GitHub, and select the
   private repository and branch. The Default cloud environment is enough for
   the first run; Anthropic's quick start explains plan-specific onboarding.
3. Submit this first task:

   ```text
   Set up career-ops in this checkout. Run npm install, then start the first-run
   onboarding. Keep cv.md, data/, and reports/ out of Git.
   ```

career-ops still uses ordinary workspace files in the cloud checkout, not
browser storage:

| Path (from the repository root) | What it holds |
|---|---|
| `cv.md` | Your master CV |
| `data/` | Tracker and other private workflow state |
| `reports/` | Job evaluations and generated reports |

`cv.md`, runtime content under `data/`, and Markdown files directly under
`reports/` are intentionally git-ignored because they contain personal data.
That also means a normal web-session branch push does **not** persist them to
GitHub: a new cloud session starts from the repository again, without the
ignored files from the previous VM. Keep a personal workflow in one session
and move any output you need to secure storage before its environment expires.
Never force-add these paths. For a durable workspace shared across many
sessions, use the local quick start below.

### Recommended — one command

```bash
npx @santifer/career-ops init
```

`npx` ships with Node.js — it runs the installer once without installing anything globally. This clones the latest release into `./career-ops` and installs dependencies. Then move into the workspace and open your AI CLI:

```bash
cd career-ops
claude   # or codex / qwen / opencode / agy / grok
```

**On first launch, career-ops walks you through setup by chatting** — it asks for your CV, your details (name, target roles, salary), and sets up the job scanner with pre-configured companies. Nothing to edit by hand: just answer its questions. Then paste a job offer URL or description and it evaluates it, writes a report, generates a tailored PDF, and tracks it.

If you are using Codex, start the interactive session with `codex`. Slash commands are not guaranteed in Codex, so use the same mode names in a prompt if `/career-ops` is unavailable:

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode.
Run the career-ops pipeline mode.
Run the career-ops pdf mode.
Run the career-ops email mode for the latest evaluated role. Draft only; never sends, submits, or clicks.
Run the career-ops tracker mode.
```

For one-shot workers or batch tasks in Codex, use `codex exec`. See [docs/CODEX.md](CODEX.md) for the full guide.

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo."
codex exec "Run career-ops pipeline mode for data/pipeline.md."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops email mode for the latest evaluated role. Draft only; do not send, submit, or click anything."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

### Advanced — clone manually

<details>
<summary>Prefer to clone the repo yourself?</summary>

```bash
git clone https://github.com/career-ops-hq/career-ops.git
cd career-ops
npm install
```

Then open your AI CLI in the folder — the same first-run onboarding applies. Use this path if you want to track a specific branch, contribute, or audit the code before installing dependencies.

</details>

### Contributing for the first time

If you want to contribute to career-ops, start with a small, focused change. Bug fixes, documentation, translations, and new zero-auth scanner providers can go straight to a pull request; new features, modes, commands, or architecture changes should start with an issue first.

The basic workflow is:

1. Fork the repository and create a branch from `main`.
2. Make one focused change and keep personal data such as `cv.md`, `profile.yml`, applications, and reports out of the commit.
3. Run the relevant checks; for a broad validation, use `node test-all.mjs --quick`.
4. Commit and push your branch to your fork.
5. Open a pull request against `career-ops-hq/career-ops` and explain what changed and why.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution guidelines and examples of good first contributions.

### PDF rendering (one-time)

PDFs are rendered with a headless Chromium. Install it once per machine:

```bash
npx playwright install chromium
```

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/career-ops scan` or ask the agent to run `scan` |
| Process pending URLs | `/career-ops pipeline` or ask the agent to run `pipeline` |
| Generate a PDF | `/career-ops pdf` or ask the agent to run `pdf` |
| Draft application email | `/career-ops email` or ask the agent to run `email`; draft-only, never sends, submits, or clicks |
| Batch evaluate | `/career-ops batch` or use `codex exec "Run career-ops batch mode ..."` |
| Check tracker status | `/career-ops tracker` or ask the agent to run `tracker` |
| Fill application form | `/career-ops apply` or ask the agent to run `apply` |

## Verify Setup

```bash
node cv-sync-check.mjs      # Check configuration
node verify-pipeline.mjs     # Check pipeline integrity
```

## Build Dashboard (Optional)

```bash
npm run serve:dashboard     # Opens TUI pipeline viewer
npm run build:dashboard     # Optional: build the standalone binary
```
