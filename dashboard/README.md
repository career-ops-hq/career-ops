# dashboard/

Standalone Go TUI for browsing the career-ops pipeline.

## Purpose

A terminal UI over the application tracker: filter tabs, sort modes,
grouped/flat views, lazy-loaded report previews, and an inline status picker.
It is isolated from the Node core — optional, never required by any other
component.

## Prerequisites and running

Requires Go 1.24+ (`go.mod`). From the repo root:

```bash
npm run serve:dashboard    # go run . --path .. (launch against the repo root)
npm run build:dashboard    # build the standalone binary
```

`build-dashboard.mjs` exists because `go build -o career-dashboard .` writes
an extension-less binary on Windows; the wrapper picks the platform-correct
output name (`career-dashboard.exe` on Windows, `career-dashboard` elsewhere).

The binary accepts `--path <dir>` pointing at a career-ops directory
(default `.`). The data loader tries both `{path}/applications.md` and
`{path}/data/applications.md` for layout compatibility.

## Package layout

- `main.go` — entry point, flag parsing, top-level Bubble Tea model and view
  state (pipeline / report viewer / progress).
- `open_*.go` — platform-specific "open file/URL" commands (darwin, linux,
  windows, unix, unsupported).
- `internal/data/` — parses `applications.md` (`career.go`), derives
  aggregate metrics (`derive.go`), and resolves generated PDFs (`pdf.go`).
- `internal/model/` — the application row model.
- `internal/theme/` — Catppuccin Mocha (dark) and Latte (light) themes;
  `NewTheme("auto")` picks by detected terminal background.
- `internal/ui/screens/` — the pipeline list, report viewer, and progress
  screens.

## Dependencies

External: [Bubble Tea](https://github.com/charmbracelet/bubbletea) (TUI
framework), [Lipgloss](https://github.com/charmbracelet/lipgloss) (styling),
termenv (background detection). The module has no dependency on the Node
side; it only reads the tracker files.

## Tests

Go tests live next to their packages (`*_test.go`). The Node suite builds
the dashboard as part of `node test-all.mjs` (skipped with `--quick`).
