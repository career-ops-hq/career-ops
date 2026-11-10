# Running career-ops on NixOS

career-ops runs on NixOS through the repository's flake dev shell. Most of it is plain Node and works anywhere. The exception is Playwright, which renders PDFs and verifies postings: the browsers it downloads link against library paths that don't exist on NixOS, so they fail to start with errors such as `libglib-2.0.so.0: cannot open shared object file`.

The dev shell replaces those downloads with browsers that nixpkgs builds for NixOS.

## Checklist

- [ ] Flakes enabled (`nix-command` and `flakes` in `experimental-features`)
- [ ] Working inside the dev shell: `direnv allow` once, or `nix develop` each time
- [ ] Shell re-entered after every `npm install`
- [ ] Playwright MCP configured as `mcp-server-playwright`, not `npx @playwright/mcp`
- [ ] Your AI CLI started from inside the dev shell
- [ ] `node doctor.mjs` reports `Playwright chromium installed`

## 1. Enter the dev shell

With [direnv](https://direnv.net/) and [nix-direnv](https://github.com/nix-community/nix-direnv), allow the repository's `.envrc` once:

```bash
direnv allow
```

Without direnv, enter the shell each time you work in the repository:

```bash
nix develop
```

The shell provides Node.js, Playwright's browsers from nixpkgs, the Playwright MCP server, and `poppler-utils` (`pdftotext`, `pdftoppm`). It also sets two variables:

- `PLAYWRIGHT_BROWSERS_PATH` points Playwright at the nixpkgs browsers.
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` makes `npm install` skip its `playwright install chromium` step, which cannot write to the Nix store.

The first time you enter it, the shell installs the npm dependencies.

## 2. Re-enter the shell after `npm install`

nixpkgs builds one browser revision, and each npm release of Playwright looks for exactly one revision. On entry, the shell pins the npm `playwright` package to the version that matches the nixpkgs browsers. When it pins, it prints a line like this one:

```text
Pinning playwright to 1.58.2 to match Nix-provided browsers...
```

`npm install` reinstalls the version from `package.json`, which looks for a revision the shell doesn't have. Browser launches then fail with `Executable doesn't exist at .../chromium_headless_shell-<revision>`. To fix it, re-enter the shell:

```bash
direnv reload      # with direnv
exit; nix develop  # without direnv
```

The same applies after a career-ops update, because the updater runs `npm install`. The updater's own `playwright install chromium` step can't write to the Nix store either, so it pauses for up to two minutes and then reports `playwright install skipped`. Inside the dev shell, that message is expected.

## 3. Configure Playwright MCP

The npm package `@playwright/mcp` bundles its own copy of Playwright, so it ignores the version pin and looks for a browser the shell doesn't provide. Use the `mcp-server-playwright` command from the dev shell instead. nixpkgs builds it against the same browsers.

For Claude Code, create `.mcp.json` in the repository root:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "mcp-server-playwright"
    }
  }
}
```

For OpenCode, set the `command` in `opencode.json` to `["mcp-server-playwright"]`.

Start your AI CLI from inside the dev shell. The CLI resolves `mcp-server-playwright` from its own `PATH`, and only the dev shell puts it there.

## 4. Don't run `npx playwright install`

`npx playwright install chromium` downloads about 600 MB of browsers that can't run on NixOS. If `node doctor.mjs` reports that Chromium is missing, check that you are inside the dev shell and have re-entered it since the last `npm install`.

## 5. Tools the dev shell doesn't include

These features need tools that aren't in the dev shell. To use one, run it with `nix shell` and the matching package:

| Feature | Needs | Example |
|---------|-------|---------|
| Go dashboard (`dashboard/`) | `go` | `nix shell nixpkgs#go -c node build-dashboard.mjs` |
| LaTeX CV modes (`latex`, `latex-tex`) | `tectonic` or `pdflatex` | `nix shell nixpkgs#tectonic`, then run the mode |

The HTML-to-PDF CV path (`generate-pdf.mjs`) needs only the dev shell.
