# Running career-ops with Hermes Agent

This page is the full guide for using this repository from [Hermes Agent](https://hermes-agent.nousresearch.com). It assumes no prior setup beyond a working Hermes install.

Hermes is not a special case for career-ops. The pipeline is the same set of markdown prompt files and Node scripts that every other CLI drives. What differs is only how you point Hermes at this folder, and two behaviours that are specific to Hermes.

## What you need

- Hermes Agent, desktop app or terminal, already working
- This repository cloned somewhere on your machine
- Node.js 18 or newer, which the helper scripts require

## Step 1 — Clone and install once

```bash
git clone https://github.com/career-ops-hq/career-ops.git
cd career-ops
npm install
```

Optional, only needed if you want the generated CV and cover letter PDFs:

```bash
npx playwright install chromium
```

## Step 2 — Open Hermes with this folder as the working directory

This step matters more than it looks. Both the project rules and the repository's own skill are tied to the folder you are in, so a Hermes session started somewhere else will not see either one.

**Desktop app.** The left sidebar lists your local Git repositories as projects, and this repo appears there automatically once cloned. Selecting it scopes new chats to the folder. If it does not appear, point the app at the folder directly:

```bash
hermes desktop --cwd /path/to/career-ops
```

**Terminal.**

```bash
cd /path/to/career-ops
hermes
```

Then **start a new chat**. Project rules are read once, when the session begins, so a chat that was already running when you moved into the folder will not pick them up.

## Step 3 — Trust the folder once, so its skill loads

Hermes does not load a skill that ships inside a project folder until you allow it. From inside the checkout:

```bash
hermes skills trust
```

That registers the router at `.agents/skills/career-ops/SKILL.md` for sessions in this directory. It is a one-time step per folder, and `hermes skills untrust` reverses it.

Without this step the tool still works, because the prompt files are ordinary files the agent can read. You just have to name the task yourself, for example "read the evaluation mode in `modes/oferta.md` and evaluate this posting", instead of letting the router pick it.

## Step 4 — Ask for what you want

Once you are in the folder, plain language is enough:

| You say | What happens |
|---|---|
| "evaluate this posting: <link>" | Full A–H evaluation of the posting against `cv.md`, written to `reports/`, plus a row in the tracker |
| "scan for new jobs" | Runs the zero-token portal scanner. Needs `portals.yml` to exist |
| "tailor my resume for report 001" | Builds a CV aimed at that posting and renders it to PDF |
| "write a cover letter for #1" | Drafts the letter from the evaluation report |
| "prep me for the interview for #1" | Builds an interview plan with stories and questions |
| "what does my pipeline look like" | Summarises the tracker |

The router in the skill maps those requests onto the mode files under `modes/`, which are what actually drive the work. If you want a specific one, name it: "run the scan mode", "run the pdf mode for the latest evaluation".

## Where things end up

- `reports/NNN-company-date.md` — one evaluation per file, with the posting archived verbatim inside it
- `data/applications.md` — the tracker, one row per evaluated role
- `output/` — generated CV and cover letter files
- `jds/` — captured job descriptions, when a posting is too long to inline

## Two Hermes-specific behaviours

### Project context files and the injection scanner

Before a project rules file reaches the model, Hermes scans it for prompt injection. A single pattern match drops the entire file, and the scanner anchors on attack strings, so a rule that quotes one literally can be dropped even when the sentence quoting it is forbidding that behaviour. Describe such phrasing instead of quoting it. This is why the untrusted-content rule in `AGENTS.md` is worded the way it now is.

If a file is dropped, Hermes shows a marker in place of the content. The skill still loads, so the pipeline keeps working. If you need to supply rules a different way, a personal `.hermes.md` in the checkout takes precedence over `AGENTS.md` and is not shared with the repository.

### Cost, and where the model is chosen

- The portal scan, the liveness check, and PDF generation run with no model tokens at all. Prefer them, and prefer `scan.mjs --verify`, which drops dead postings before they cost anything to evaluate.
- An evaluation sends roughly 25,000 tokens of instructions plus your CV and the posting. When the agent drives it interactively in the folder, the instructions are larger, around 38,000 tokens per evaluation. A batch of evaluations through the standalone script is cheaper than pasting links one at a time.
- `spend_tier` in `config/profile.yml` has no effect here. Hermes picks the model from its own configuration (`hermes model`), so set it there. If you want a cheap evaluation path, pin the model on the standalone script instead:

```bash
node openai-eval.mjs --url <endpoint> --model <model> --file jds/<posting>.txt
```

- Keeping an interactive session to about ten evaluations is a practical ceiling. Past that, output quality degrades before your quota does.

### Interactive only

Nothing in this repository drives a `hermes` binary headlessly, so there is no Hermes worker path and `batch/batch-runner.sh` stays Claude Code-specific. Everything else, including the full evaluation pipeline, works interactively.

## If something looks wrong

| Symptom | Cause |
|---|---|
| Hermes offers no career-ops modes and seems unaware of the repo | The session is not running in the checkout, or `hermes skills trust` was never run. Check with `hermes skills list` |
| The agent ignores the repository's rules | The rules file was dropped by the scanner. Look for the block marker, and describe quoted examples rather than quoting them |
| A script errors immediately | `npm install` has not been run in the checkout, or Node is older than 18 |
| Nothing happens after you paste a link | The posting is dead and the liveness check stopped the run. That is the check working |

## What the agent will never do

career-ops prepares, you decide. No Hermes session will submit an application, send an email, or click anything on your behalf.
