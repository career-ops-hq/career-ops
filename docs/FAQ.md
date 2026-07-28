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

## 5. What does the "possible cross-listing" warning mean during a scan?

When the scanner shows a warning like:

```
⚠ Possible cross-listing: Acme Corp / Senior AI Engineer ↔ TalentBridge / Senior AI Engineer (similarity 0.96)
```

it means the job description text of two listings from **different companies** is nearly identical — typically because a recruitment agency has re-posted a direct employer's role with the employer name removed or replaced.

**Why it matters:** if you apply through both channels, both the agency and the employer will see your application independently. This is known as a double-submission and it can damage your relationship with the hiring team.

**What to do:**

1. Read both listings and confirm one is a direct company post and the other is an agency re-post.
2. Choose ONE channel to apply through. Applying direct is usually safer; applying via an agency can be useful if the agency has a relationship with the hiring manager.
3. If the two listings turn out to be genuinely different roles that happen to share boilerplate text (e.g. a generic engineering role template), the warning is a false positive — you can ignore it and apply to both.

**Technical note:** the scanner computes a 64-bit SimHash fingerprint of each JD body and stores it in the 8th column of `data/scan-history.tsv` (`jd_fingerprint`). Fingerprints are computed locally from text already returned by the ATS API — no extra network request is made. Postings without a usable description never receive a fingerprint and are never flagged. See [docs/SCRIPTS.md](SCRIPTS.md#cross-listing-detection) for the full column reference.

## 6. Can I use my own CV template?

Yes. Set `cv.template` (and/or `cover_letter.template`) in `config/profile.yml` to the kebab-case name of a template file in `templates/` — a value of `modern` resolves to `templates/cv-template.modern.html` (cover letters use `templates/cover-letter-template.<name>.html`). Leave the field unset and career-ops falls back to the built-in default template (`templates/cv-template.html`). You can also pick a template per generation just by asking (e.g. "use the modern template"). See the commented `cv.template` / `cover_letter.template` fields in `config/profile.example.yml` for the full reference.

## How do I stop a company from showing up in scans?

Copy `templates/blacklist.example.md` to `data/blacklist.md`, then list one company per line.

If a listed company is encountered, the scan reports that it was skipped (never silently). You can bypass the filter with `--include-blacklisted` if you want to audit matching postings.

See the Company blacklist section in `docs/SCRIPTS.md` for the full behavior and supported workflow.