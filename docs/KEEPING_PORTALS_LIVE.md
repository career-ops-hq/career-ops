# Keeping portals.yml live

`portals.yml` is the list of companies and job boards your scanner walks. It is not
a one-time setup file — it is the thing that decides *who gets scanned*, so the
moment it goes stale, your search quietly narrows: a company you liked but never
added is never re-checked, and a board you added once can rot into returning nothing
while still "looking" configured.

"Keeping it live" means: every time a company crosses your path — you paste a job
URL, mention it out loud, or finish evaluating one — it ends up resolved and
appended to `portals.yml`, without you having to remember to do it by hand. This
page shows the house rule that automates that, and how to check the file afterwards.

> `portals.yml` is a **user-layer** file. Whatever you configure here survives
> `node update-system.mjs`. Nothing on this page requires editing a system file.

---

## 1. The set-and-forget way: a `modes/_custom.md` house rule

`modes/_custom.md` holds your own procedural rules, and the agent reads it on every
run. Add this rule there and adding companies to `portals.yml` stops being a task
you have to remember:

```markdown
- **Auto-add companies to the scan list.** Whenever a company comes up (I paste a
  JD or URL, name a company out loud, or we finish evaluating one), check
  `portals.yml` first. If it is not already in `tracked_companies` — under any
  name variant — add it immediately, without waiting to be asked:
  1. `node discover-ats.mjs "<Company>"` to resolve the ATS (preview only;
     `--write` appends the resolved entries to `portals.yml`).
  2. If unresolved or the board is empty, add a manual entry: `careers_url` plus
     `api` when the ATS is known, or `scan_method: websearch` + `scan_query` when
     no public ATS exists or the site blocks plain HTTP.
  3. `enabled: true` by default, and a `notes:` line saying what the company is
     and which report/URL it came from.
  4. Confirm in one line what was added; run `node validate-portals.mjs` after
     adding several at once.
  Only skip the add when I say the company is a one-off or not worth tracking.
```

Where it goes: `modes/_custom.md`, under **House Rules**. If the file does not exist
yet, it is copied from `modes/_custom.template.md` on first run — open it and paste
the rule in. A helpful side effect of putting it there rather than in a system file
is that your rule also tells the agent *why* and *how*, so it resolves the ATS and
writes a `notes:` line instead of guessing.

Prefer not to automate it? The same steps work on demand: paste a job URL and ask
*"add this company to `portals.yml`"*, or run discovery yourself:

```bash
node discover-ats.mjs "Acme Corp"           # preview — writes nothing
node discover-ats.mjs "Acme Corp" --write   # append the resolved entries
```

---

## 2. Validate the file after it changes

Run these after any edit. The first ones are pure config checks with **zero LLM
tokens** — no model needed.

```bash
node validate-portals.mjs                                  # schema + config sanity
node discover-ats.mjs "<Company>"                          # does the ATS resolve?
node verify-portals.mjs                                    # does the board answer?
node audit-portals.mjs --company "<Company>" --summary     # what is actually on the board?
```

- **`validate-portals.mjs`** — catches malformed entries, unknown fields, and
  config the scanner would silently skip. This is the everyday check.
- **`discover-ats.mjs`** — resolves a company to its ATS and shows the entries it
  *would* write. Preview by default; `--write` appends them.
- **`verify-portals.mjs`** — proves each board actually responds. `--strict` exits
  non-zero if any slug is unresolved, which is handy in a script.
- **`audit-portals.mjs`** — goes further than "does it answer": it fetches each
  board and reports *whose* postings are on it. Verdicts to watch are `no-provider`
  (enabled but nothing claims it, so the scanner skips it silently) and `empty` /
  `error` (the board answers but returns nothing). Keep a `--json` snapshot and
  pass it back later as `--baseline prev.json` to catch a board that suddenly lost
  most of its postings — the shape an ATS migration takes.

Then confirm the scanner actually reads it, without spending tokens:

```bash
node scan.mjs --company "<Company>" --dry-run --json
```

A dry run resolves the company, fetches (or parses) its board, and prints what it
found without writing to `data/pipeline.md`.

---

## 3. Run the checks through your agent CLI

You do not have to memorize the commands — hand the job to the CLI you use. The
same `portals.yml` and the same scripts are behind all of them.

| CLI | Invoke | Example prompt |
| --- | --- | --- |
| Claude Code | `claude` (then `/career-ops`) | "Validate my `portals.yml` and tell me which entries are broken." |
| OpenCode | `opencode` (then `/career-ops`) | "Add Acme Corp to my portals and validate it." |
| Codex | `codex` (plain text) | "Run career-ops: add Acme Corp to portals.yml and validate." |
| Antigravity CLI | `agy` (then `/career-ops`) | "Check my portals.yml for dead boards." |
| Qwen | `qwen` | "Validate portals.yml and report broken companies." |
| Copilot CLI | `copilot -p "…"` | `copilot -p "Validate portals.yml in this repo"` |

Both interactive and headless invocation work; see
[Supported CLIs](SUPPORTED_CLIS.md) for the full table, and
[Automation](AUTOMATION.md) if you want the check to run on a schedule.

A good rule after adding several companies at once: ask the agent to run
`node validate-portals.mjs` **and** `node audit-portals.mjs --summary`, so you see
both "is it well-formed" and "is it returning real postings".

---

## 4. Why a company can look configured but return nothing

"0 jobs" is not the same as "broken", and the difference is worth knowing:

- **Board answers, zero postings** — the entry is valid, the board is simply empty
  right now. `audit-portals.mjs` labels this `empty`. Nothing to fix.
- **No provider claims it (`no-provider`)** — the entry is enabled but its
  `careers_url` matches no provider, so `scan.mjs` skips it on every run while it
  reads as coverage. `audit-portals.mjs` flags this first because it is the easiest
  of these to miss.
- **Wrong entity** — the board is real and full of jobs, but they belong to a
  parent company, a regional subsidiary, or a same-named unrelated tenant. No
  heuristic catches this; it is why the audit *shows* you sample titles and
  locations instead of pretending to a verdict. A human has to eyeball it.

Which provider covers which board — and what each one needs in `portals.yml` — is
in [Supported job boards](SUPPORTED_JOB_BOARDS.md).
