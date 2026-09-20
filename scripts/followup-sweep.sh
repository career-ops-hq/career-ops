#!/bin/zsh
# Unattended follow-up sweep, run via launchd (see docs/AUTOMATION.md).
# Never sends anything -- writes drafts to output/ for the user to review.

set -euo pipefail

REPO="$(cd "$(dirname "${0}")/.." && pwd)"
OUT_DIR="$REPO/output"
DATE_STR="$(date +%Y-%m-%d)"
DRAFT_FILE="$OUT_DIR/followup-drafts-$DATE_STR.md"
LOG_FILE="$REPO/data/followup-sweep.log"

mkdir -p "$OUT_DIR"
cd "$REPO"

PROMPT="Run the career-ops 'followup' mode (modes/followup.md) against data/applications.md and data/follow-ups.md. Run node followup-cadence.mjs, and for every overdue/urgent entry generate the follow-up email/LinkedIn draft per the mode's framework (voice-dna.md guardrails apply). Write the full dashboard plus every generated draft to $DRAFT_FILE as markdown. Do NOT send, submit, or record anything as sent -- draft-only, for the user to review later. If there is nothing overdue/urgent, write a one-line note to that file saying so instead."

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') follow-up sweep starting ==="
  claude -p "$PROMPT"
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') follow-up sweep done -> $DRAFT_FILE ==="
} >> "$LOG_FILE" 2>&1

if [ -f "$DRAFT_FILE" ]; then
  osascript -e "display notification \"Follow-up drafts ready: $DRAFT_FILE\" with title \"career-ops\"" >/dev/null 2>&1 || true
fi
