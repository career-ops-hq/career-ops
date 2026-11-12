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

### Inbox tab

The INBOX tab, left of ALL, lists the unchecked rows of the Pending section of
`data/pipeline.md`: rank, company, role, location, posted date and batch
status. ALL stays the tab the dashboard opens on. The rank is the first-pass
rank `rank-pipeline.mjs` writes (`rank: 4.2/5 — reason`), not an evaluation
score; rows are ordered by it, highest first, with unranked rows after them,
and the preview shows the rank reason and the URL. The status is what
`batch/batch-input.tsv` and `batch/batch-state.tsv` record for the URL
(Queued, Running, Paused, Needs answer, Failed or Done), read from the same
place the tracker's URL lookup reads them.

The tab is read only. It changes no file, and no key on it skips, queues or
evaluates a row: navigation, tabs, `/`, `s`, `r`, `o` (http(s) rows only),
`p`, `S`, `m`, `t`, `?` and `q` work, and every other key does nothing. The
rows are read at startup and on each reload (`r`, or after a status change),
never on a timer. A missing `pipeline.md` is an empty Inbox; one that cannot
be read keeps the rows already shown and says why.

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
