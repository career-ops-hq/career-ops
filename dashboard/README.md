# dashboard/

Standalone Go TUI for browsing the career-ops pipeline.

## Purpose

A terminal UI over the application tracker: filter tabs, sort modes,
grouped/flat views, lazy-loaded report previews, and an inline status picker.
The report viewer opens the job posting with `o`, using the tracker row's URL
or, failing that, the report's `**URL:**` header.
It is isolated from the Node core — optional, never required by any other
component.

The list's DATE column shows a row's most recent transition in the ledger
beside the tracker, `status-log.tsv` — when its status last changed — and
falls back to the tracker's own Date cell (the evaluation date, which nothing
rewrites) for rows with no ledger history. The date sort orders by the same
value.

A status change is written by `set-status.mjs`, never by editing the table.
The row is named by its report link (`--report-link`) or, for a row added
without an evaluation and so without one, by its tracker `#` (`--row`) — two
independent counters, so the selector always states which. A row with neither
identity — no report link, and a `#` cell that is not a positive number (a
backfill sentinel `N/A` / `—`, or a literal `0`) — cannot be changed from the
TUI: nothing identifies it but its position in the table. Give that row a
number first.

### Inbox tab

The INBOX tab, left of ALL, lists the unchecked rows of the Pending section of
`data/pipeline.md`: rank, company, role, batch status, location and posted
date, in the tracker tabs' column order and with their company, location and
posted widths. A row with no rank shows the tracker's `—`. ALL stays the tab
the dashboard opens on. The rank is the first-pass
rank `rank-pipeline.mjs` writes (`rank: 4.2/5 — reason`), not an evaluation
score; rows are ordered by it, highest first, with unranked rows after them,
and the preview shows the rank reason and the URL. The status is what
`batch/batch-input.tsv` and `batch/batch-state.tsv` record for the URL
(Queued, Running, Paused, Needs answer, Failed or Done), read from the same
place the tracker's URL lookup reads them.

Five keys act on rows. `e` queues the selected row for evaluation. It runs
`sync-batch-input.mjs --url <url>`, which appends that one row to
`batch/batch-input.tsv`. The footer then names `batch/batch-runner.sh` as the
command to run; the dashboard never runs it and starts no evaluation. A row
the batch files already hold is left alone and the footer says so (for a
Failed row, it points to `batch/batch-runner.sh --retry-failed`). So is a row
that is not an http(s) URL, or one whose URL does not come first after
`- [ ] `, which the script cannot read.

`x` skips the selected row: it runs `inbox-skip.mjs --url <url>`, which turns
that row's `- [ ]` into `- [x]` in `data/pipeline.md` under the pipeline lock,
the same change the web inbox's Skip makes, with the same code. The
row leaves the Inbox. `u` undoes the last `x` of this session, whichever row
is selected: `inbox-skip.mjs --url <url> --undo` unchecks every Pending row
with that URL, as the web inbox's Undo does. There is no history beyond that
one skip. As with `e`, a row whose URL does not come
first after `- [ ] ` is left alone and the footer says why.

`a` ranks the selected row and `A` ranks the unranked rows, up to 20 per run.
Ranking calls your agent CLI and spends tokens, so neither key starts on its
own: the footer asks whether to rank the selected row, or how many rows, and
says it uses your CLI and tokens. Only `y` starts it; any other key, `Y`
included, cancels. The dashboard then runs `rank-pipeline.mjs --url <url>` or
`rank-pipeline.mjs --limit <n>`. With `--url` the script looks for the row
only in the Pending section. With `--limit` it takes unchecked rows from the
whole file, as it does when run by hand, so a hand-edited `- [ ]` row outside
Pending can use one of the run's slots; the footer then says how many rows are
still not ranked, and `A` again ranks them. It ranks rows in batches of up to
10, one model call per batch (so twenty rows take two calls), with tools off
where the CLI has a switch for it (see `docs/SCRIPTS.md`), and writes each
`rank:` cell into `data/pipeline.md` under the pipeline lock. The summary line
shows the run until it ends; then the Inbox is read again, and the footer
gives the new rank, or for `A` how many rows are still not ranked. `e`, `x`,
`u`, `a` and `A` do nothing on the tracker tabs.

Otherwise the tab changes no file, and no key on it evaluates a row:
navigation, tabs, `/`, `s`, `r`, `o` (http(s) rows only), `e`, `x`, `u`, `a`,
`A`, `p`, `S`, `m`, `t`, `?` and `q` work, and every other key does nothing.
The rows are read at startup, on each reload (`r`, or after a status change)
and after `e`, `x`, `u`, `a` and `A`, never on a timer. A missing `pipeline.md` is an empty Inbox;
one that cannot be read keeps the rows already shown and says why.

The tab reads `data/pipeline.md` under the data root, as the web inbox does.
It does not follow `CAREER_OPS_PIPELINE`: a second search lane's inbox is not
shown.

## Prerequisites and running

Requires Go 1.26+ (`go.mod`). From the repo root:

```bash
npm run serve:dashboard    # go run . --path .. (The script automatically resolves external data directories by falling back through CAREER_OPS_ROOT and CAREER_OPS_DATA_DIR enviornment variables,defaulting to repository root.)
npm run build:dashboard    # build the standalone binary
```

`build-dashboard.mjs` exists because `go build -o career-dashboard .` writes
an extension-less binary on Windows; the wrapper picks the platform-correct
output name (`career-dashboard.exe` on Windows, `career-dashboard` elsewhere).

The binary accepts `--path <dir>` pointing at a career-ops directory
(default `.`). The data loader tries both `{path}/applications.md` and
`{path}/data/applications.md` for layout compatibility.

In the report viewer, `http(s)` links (bare URLs and markdown links) are
clickable in terminals that support OSC 8 hyperlinks (iTerm2, WezTerm, kitty,
VS Code, Windows Terminal, recent GNOME Terminal). Other terminals show the
same text, unlinked. Other link schemes stay plain, because report text comes
from untrusted job postings.

## Package layout

- `main.go` — entry point, flag parsing, top-level Bubble Tea model and view
  state (pipeline / report viewer / progress).
- `open_*.go` — platform-specific "open file/URL" commands (darwin, linux,
  windows, unix, unsupported).
- `internal/data/` — parses `applications.md` (`career.go`), derives
  aggregate metrics (`derive.go`), resolves generated PDFs (`pdf.go`), and
  reads the Inbox tab's pending rows (`pending.go`).
- `internal/model/` — the application row model.
- `internal/theme/` — Catppuccin Mocha (dark) and Latte (light) themes;
  `NewTheme("auto")` picks by detected terminal background.
- `internal/ui/screens/` — the pipeline list, report viewer, and progress
  screens.

## Dependencies

External: [Bubble Tea](https://github.com/charmbracelet/bubbletea) (TUI
framework), [Lipgloss](https://github.com/charmbracelet/lipgloss) (styling),
termenv (background detection). The module has no dependency on the Node
side; it reads the tracker files, `data/pipeline.md` and the batch files.

## Tests

Go tests live next to their packages (`*_test.go`). The Node suite builds
the dashboard as part of `node test-all.mjs` (skipped with `--quick`).
