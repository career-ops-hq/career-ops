#!/bin/bash
# career-ops scheduled scan — Mon-Fri 07:00 via ~/Library/LaunchAgents/io.career-ops.scan.plist
# Zero-token portal sweep, then Gmail ingest of job-alert email into the same inbox.
# Gmail runs second so a Gmail/OAuth failure cannot cost us the portal scan; it is
# non-fatal for the same reason (expired refresh token, network, label renamed).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/fnm/node-versions/v24.15.0/installation/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
echo "=== $(date '+%Y-%m-%dT%H:%M:%S') scan run ==="
node scan.mjs
node plugins.mjs run gmail || echo "gmail ingest failed (non-fatal) — check GMAIL_REFRESH_TOKEN in .env"
echo "=== $(date '+%Y-%m-%dT%H:%M:%S') scan done ==="
