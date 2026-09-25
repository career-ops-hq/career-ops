# fork-notes — this fork's own documentation

**English** · [繁體中文](README.zh-TW.md)

This directory holds research, plans and process records that belong to **this fork only**
(`rojarsmith/career-ops-max`). Upstream (`santifer/career-ops`) does not ship it, so nothing here
can collide with an upstream update.

## Why it sits here and not in `docs/`

| Sync path | Why `fork-notes/` is safe |
|-----------|---------------------------|
| `git merge` from upstream | Upstream has no `fork-notes/` directory, so no merge can touch these files. |
| `node update-system.mjs apply` | `fork-notes/` is declared in `config/local-paths.txt` (see [Fork-local paths](../DATA_CONTRACT.md#fork-local-paths)), so the updater treats it as user layer and never writes to it. The same file keeps `validate-system-paths-coverage.mjs` from flagging these files as orphans. |

`docs/`, `README.md`, `AGENTS.md`, `CLAUDE.md` and `modes/*` are upstream-owned. Don't add files or links
there for fork-specific material; link from here instead.

## Rules for everything in this directory

1. **No private data.** No name, email, phone, ID numbers, salary figures, interviewer names, recruiter
   contacts, or copies of the CV. Private material lives in the gitignored user layer
   (`cv.md`, `config/profile.yml`, `data/`, `reports/`, `output/`, `local/`, …), never here.
2. **English is primary.** Every document is `name.md` (English) with a Taiwan Traditional Chinese
   twin `name.zh-TW.md`. Each links to the other on its first line. When they disagree, the English
   file is authoritative; update both in the same commit.

## Contents

| Document | Purpose |
|----------|---------|
| [tsmc/playbook.md](tsmc/playbook.md) | Step-by-step setup and workflow for the TSMC (Taiwan) search |
| [tsmc/journal.md](tsmc/journal.md) | Dated, privacy-safe log of the TSMC search |
| [snippets/custom-bilingual.md](snippets/custom-bilingual.md) | House rules to paste into `modes/_custom.md` (bilingual outputs) |
| [snippets/profile-language.yml](snippets/profile-language.yml) | `language:` block for `config/profile.yml` |
| [snippets/portals-tsmc.yml](snippets/portals-tsmc.yml) | Starting `portals.yml` entries for TSMC / Taiwan |
