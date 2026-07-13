# Career-Ops on the Free Tier (Antigravity CLI)

career-ops works with **Antigravity CLI's free tier** — no API key or paid
subscription required. This guide covers setup, limits, and trade-offs.

## Quick Start

1. Install Antigravity CLI:

   On macOS / Linux:

   ```bash
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   ```

   On Windows (PowerShell):

   ```powershell
   irm https://antigravity.google/cli/install.ps1 | iex
   ```

   On Windows (CMD):

   ```cmd
   curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd
   ```

2. Authenticate with your Google account:

   ```bash
   agy auth login
   ```

3. Run career-ops as usual:

   ```bash
   agy          # interactive — paste a URL, evaluate, scan, etc.
   agy -p "..." # headless / batch mode
   ```

## Daily Limits

The free tier has daily request and token caps set by Google. Typical
limits (subject to change):

| Resource            | Approximate daily limit |
|---------------------|------------------------|
| Requests            | 1,000                  |
| Input tokens        | ~1 M                   |
| Output tokens       | ~100 K                 |

Limits reset at midnight Pacific Time. If you hit a cap the CLI returns
a rate-limit error; career-ops will pause and suggest retrying tomorrow.

## Batch Mode Behavior

- `batch-runner.sh` spawns `claude -p` workers by default (Claude Code
  specific). To use Antigravity CLI workers instead, invoke them manually:

  ```bash
  agy -p "evaluate <URL>"
  ```

- With free-tier limits, keep `--parallel 1` to avoid burning through
  your daily quota on parallel requests.
- Large batches (50+ offers) will likely span multiple days. Use
  `--start-from` to resume where you left off.

## What Works Without Paying

| Feature                 | Free tier | Notes                            |
|-------------------------|-----------|----------------------------------|
| Offer evaluation (A-F)  | ✅        | Full scoring pipeline            |
| Report generation (.md) | ✅        | Markdown reports                 |
| Portal scanning         | ✅        | Zero-token — hits APIs directly  |
| PDF generation          | ✅        | Uses local Playwright, no tokens |
| Batch processing        | ⚠️        | Limited by daily quota           |

## Upgrading

If you outgrow the free tier, you can switch to a paid Google AI plan
or use Claude Code (`claude` CLI) with a Claude Max subscription. Both
are fully supported — just authenticate with your preferred provider.
