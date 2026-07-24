# Running career-ops in Claude Cowork

career-ops was built for AI coding CLIs, but it also runs inside [Claude Cowork](https://www.anthropic.com/news/cowork) — Anthropic's desktop "work with your files" surface — with no changes to the system. If a terminal is a barrier for you, this is the friendlier door.

**First-party verified (July 2026):** the full cycle — onboarding from a PDF CV, portal config, a complete A–G evaluation of a live Greenhouse posting, and canonical tracker registration via `merge-tracker.mjs` — ran end to end inside Cowork. Bonus: Cowork renders the onboarding steps as native clickable options and a progress checklist.

## How it works

Cowork mounts your career-ops folder and the agent reads the same instruction files the CLIs read (`CLAUDE.md` → `AGENTS.md`, `modes/`). There are no slash commands: you just talk — "evaluate this job posting", "scan my portals", "update my tracker" — and Claude runs the matching mode. You watch every file change in the sidebar, which reinforces the system's core rule: **you review everything before anything goes out.**

## Quick start

1. In a terminal (one time), clone career-ops **and install its dependencies** — Cowork's local shell has no npm network access, so do this before opening the folder:
   ```bash
   git clone https://github.com/santifer/career-ops.git ~/career-ops
   cd ~/career-ops && npm install
   ```
2. Install [Claude Cowork](https://claude.com/download) and, in **Colaborar/Collaborate** mode, add the `~/career-ops` folder.
3. Say (anchored, so Cowork's own generic setup doesn't hijack the phrase "set me up"):
   > *"This folder contains career-ops. Read AGENTS.md, run its startup check (`node doctor.mjs --json`) and walk me through career-ops onboarding based on its output."*
4. Hand over your CV any way you like — paste the text, or just point the agent at an existing **PDF**: it reads the file itself and converts it to `cv.md` (the parsing is your agent's ability, not a career-ops script).
5. Evaluate your first posting: paste a job URL or the JD text into the chat. From there, everything in the [README](../README.md) applies — same modes, same files, same data contract.

## What runs where

| Piece | In Cowork |
|---|---|
| Evaluations, tracker, reports, all modes | ✅ Native — the agent edits your mounted folder directly |
| Zero-token portal scan (`scan.mjs`, API-based) | ✅ Runs in Cowork's Linux sandbox (`node` available) |
| Merge/validation scripts (`merge-tracker.mjs`, `verify-pipeline.mjs`, …) | ✅ Sandbox |
| **PDF generation** (`generate-pdf.mjs`) and **browser-driven checks** (Playwright) | ⚠️ Playwright's Chromium lives on your machine, not in the sandbox — run these through the local shell when asked, or generate the HTML in Cowork and print to PDF |

That Playwright caveat is the only real difference from the CLI experience. Two more small notes from verification: run `npm install` in a terminal before starting (Cowork's local shell can't reach npm), and if a stray `reports/.reserve-*` sentinel file survives a run (Cowork's file bridge can't delete files), it's harmless — the allocator garbage-collects stale sentinels after 4 hours.

## Credit where due

The community got here first: [woolly-earth/career-ops-cowork-guide](https://github.com/woolly-earth/career-ops-cowork-guide) is an excellent independent deep-dive — setup walkthrough plus customization patterns for multi-track senior searches — and the earlier `career-ops-plugin` adaptation showed how much demand there was for this surface. This page exists because they proved it works. If you want the long-form version with worked examples, read that guide.
