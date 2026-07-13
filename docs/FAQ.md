# Frequently Asked Questions

Common questions from the community, answered in one place. For setup details see [docs/SETUP.md](SETUP.md). For anything not covered here, ask in [Discord](https://discord.gg/8pRpHETxa4) or open a [GitHub Discussion](https://github.com/santifer/career-ops/discussions).

---

## 1. Skills aren't loading on Windows — symlink error on install

Windows does not create symlinks by default, so Git checks out the CLI skill entrypoints (`.claude/skills/`, `.opencode/skills/`, etc.) as plain pointer files instead of real symlinks. The installer and updater both detect this automatically: run `node update-system.mjs apply` (or `npx @santifer/career-ops init` on a fresh install) and the `materializeSkillEntrypoints` step will replace the pointer files with the full canonical skill content. No manual `mklink` or Developer Mode changes are needed.

## 2. What is the difference between `scan` and `scan:full`?

`npm run scan` is the standard portal scanner — it reads the companies you have configured in `portals.yml`, hits their ATS APIs (Greenhouse, Ashby, Lever) directly, and consumes zero LLM tokens. Use it for your regular daily or weekly discovery run. `npm run scan:full` inverts the direction: instead of scanning your curated list, it walks public ATS company directories and surfaces any fresh postings that match your `title_filter` / `location_filter`, so you catch roles from companies you haven't manually added to `portals.yml`. Run `scan:full` when you want broader discovery beyond your tracked list.

## 3. How do I avoid hitting token or rate limits during a batch run?

Pass `--limit <N>` to `batch-runner.sh` to cap the number of offers processed in a single run (e.g. `./batch/batch-runner.sh --limit 5`) — this lets you inspect output quality before committing to a larger run. If a run is interrupted mid-way by a rate limit or network error, do not restart from scratch; use `./batch/batch-runner.sh --resume-paused` to skip already-completed jobs and pick up where you left off, avoiding wasted tokens on work that finished successfully.

## 4. Can I run career-ops on a cheaper or local model?

Yes — career-ops is fully AI-agnostic and works with any AI coding CLI or standalone script. See [docs/RUNNING_ON_A_BUDGET.md](RUNNING_ON_A_BUDGET.md) for a full guide covering OpenCode, Qwen CLI, DeepSeek, OpenRouter, Ollama, and other local or low-cost providers, along with recommended model sizes and token-saving best practices.