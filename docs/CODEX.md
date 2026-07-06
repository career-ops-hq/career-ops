# Codex Guide

Career-ops supports Codex through the same shared router used by the other CLI integrations.

## How Codex maps to career-ops

- `AGENTS.md` is the shared instruction source.
- Root `CODEX.md` is the thin Codex wrapper that imports `AGENTS.md`.
- This file is the human-facing guide for running career-ops workflows from Codex.

## Interactive Codex

Start Codex in the repository root:

```bash
cd career-ops
codex
```

Codex may not expose a native `/career-ops` slash command. When it does not, ask for the same workflow in plain language:

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops email mode for the latest evaluated role. Draft only; never sends, submits, or clicks.
Run the career-ops tracker mode and summarize the current statuses.
```

## One-shot workers

For single commands or batch workers, use `codex exec`:

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo and summarize new matches."
codex exec "Run career-ops pipeline mode for data/pipeline.md."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops email mode for the latest evaluated role. Draft only; do not send, submit, or click anything."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

## Notes

- If your Codex environment exposes slash commands, the shared `/career-ops` router semantics still apply.
- If it does not, use the same mode names through prompts or `codex exec`.
- Browser-heavy flows such as `scan`, `pipeline`, and `apply` still depend on Playwright browser tools being available in the active agent setup.
