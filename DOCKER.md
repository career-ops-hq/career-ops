# Running career-ops in Docker

Use this when the host can't install Playwright/Chromium directly (e.g. Ubuntu
26.04, NixOS without the `playwright-driver` shell, locked-down corporate
laptops). The image is based on Microsoft's official Playwright image, which
ships Chromium preinstalled and works on any Linux kernel Docker supports.

The container runs the project's scripts: PDF generation, scanner, liveness
checker, dashboard (Go), LaTeX, the API-key evaluators (`./cops gemini:eval`)
and the update system. Your project directory is bind-mounted, so reports, CVs,
profile, tracker, and all generated artifacts live on the host as before.

**The image has no AI coding CLI.** Claude Code, Codex, OpenCode, Gemini CLI
and the others are not installed in it, so the agent modes (evaluating a pasted
job, tailoring a CV, `apply`) run in the CLI on your host. Those modes call
scripts such as `node generate-pdf.mjs` and `node check-liveness.mjs` directly,
with the host's Node, so on a host where Playwright can't run, those steps fail
just as they would without Docker. When one does, run the script yourself
through `./cops`, for example `./cops pdf output/cv.html output/cv.pdf`.
Batch mode (`batch/batch-runner.sh`) starts a worker CLI for every offer, so it
can't run inside the container at all.

## Prerequisites

- Docker Engine 24+ with the Compose plugin (`docker compose version`)
- ~2 GB free disk for the image

## First-time setup

```bash
# from project root
./cops up           # builds image (first run takes a few minutes) and starts container
./cops doctor       # confirms node + playwright + chromium + go are present
```

That's it. Container stays running in the background. Re-runs are instant.

## Daily use

The `./cops` wrapper forwards any command into the container.

| Task | Command |
|------|---------|
| Health check | `./cops doctor` |
| Verify pipeline | `./cops verify` |
| Generate PDF | `./cops pdf output/cv.html output/cv.pdf` |
| Scan portals | `./cops scan` |
| Check liveness | `./cops liveness <url>` |
| Merge tracker | `./cops merge` |
| Dedup tracker | `./cops dedup` |
| Normalize statuses | `./cops normalize` |
| Update check | `./cops update:check` |
| Apply update | `./cops update` |
| Rollback | `./cops rollback` |
| Interactive shell | `./cops shell` |
| Raw node script | `./cops node check-liveness.mjs <url>` |
| Build dashboard | `./cops bash -c 'cd dashboard && go build -buildvcs=false -o career-dashboard . && ./career-dashboard --path ..'` |

Unknown subcommands fall through to `docker compose exec` so anything works:

```bash
./cops node test-all.mjs --quick
./cops bash -c 'find reports -name "*.md" | wc -l'
```

## Lifecycle

```bash
./cops up        # start (idempotent)
./cops down      # stop and remove the container (volumes kept)
./cops rebuild   # rebuild the image and recreate the node_modules volume
                 # (use after Dockerfile or deps change)
./cops logs      # tail container logs
```

## How it works

- `Dockerfile` — installs Node, Playwright/Chromium (preinstalled in base image),
  Go (for the dashboard), LaTeX (for `generate-latex.mjs`), and project deps.
- `docker-compose.yml` — bind-mounts the project at `/app` so host edits appear
  inside the container immediately. `node_modules` lives in a named volume to
  avoid host/container ABI mismatches. Docker fills that volume from the image
  only when it is created, so `./cops rebuild` removes and recreates it.
- `.dockerignore` — keeps generated and personal data out of the build context.

## API keys

Drop your keys in `.env` at the project root or export them in the shell that
runs `./cops`. The compose file forwards `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`,
and `OPENAI_API_KEY` into the container.

```bash
echo "GEMINI_API_KEY=..." >> .env
./cops gemini:eval
```

## Data persistence

Everything under the project root is on your host filesystem:

- `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml`
- `data/applications.md`, `data/pipeline.md`, `data/scan-history.tsv`
- `reports/`, `output/`, `interview-prep/`, `jds/`

Nothing important is stored inside the container. `./cops down` is safe.

## Updating

Career-ops updates work the same as native:

```bash
./cops update:check
./cops update
```

If `package.json` deps change, run `./cops rebuild` once. It rebuilds the image
and recreates the `node_modules` volume from it, so the container picks up the
new packages.

## Troubleshooting

**`docker: not found`** — install Docker Engine + Compose plugin first.

**Playwright still complains** — you're running the host's Node, not the
container's. Always go through `./cops`. That includes a script an AI CLI on
the host ran for you: run it again with `./cops node <script>`.

**Permission errors on generated files** — the container runs as root by
default. If host files end up root-owned, either:
- run `sudo chown -R "$USER" .` once, or
- add `user: "${UID}:${GID}"` to `docker-compose.yml` (export `UID`/`GID`
  in your shell first).

**Slow first build** — base image is ~1.5 GB. Subsequent builds reuse layers
and finish in seconds.
