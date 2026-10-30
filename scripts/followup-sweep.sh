#!/usr/bin/env bash
# Unattended follow-up sweep, run via launchd (see docs/AUTOMATION.md).
# Never sends anything -- writes drafts to output/ for the user to review.

set -euo pipefail

REPO="$(cd "$(dirname "${0}")/.." && pwd)"
cd "$REPO"

# Same data root as followup-cadence.mjs (CAREER_OPS_ROOT, CAREER_OPS_DATA_DIR,
# or .career-ops-data), so drafts, logs, and the enabled check stay aligned.
ROOT="$(node --input-type=module -e "import { getCareerOpsRoot } from './path-resolver.mjs'; process.stdout.write(getCareerOpsRoot())")"
OUT_DIR="$ROOT/output"
DATE_STR="$(date +%Y-%m-%d)"
DRAFT_FILE="$OUT_DIR/followup-drafts-$DATE_STR.md"
LOG_FILE="$ROOT/data/followup-sweep.log"

mkdir -p "$OUT_DIR" "$(dirname "$LOG_FILE")"

# Skip before spending an agent turn when the user turned follow-ups off.
# Exit 0 = off, 1 = on, anything else = the check itself failed.
set +e
node --input-type=module -e "
import { loadFollowupsEnabled } from './followup-cadence.mjs';
try {
  process.exit(loadFollowupsEnabled() ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(2);
}
"
enabled_status=$?
set -e
case "$enabled_status" in
  0)
    {
      echo "=== $(date '+%Y-%m-%d %H:%M:%S') follow-up sweep skipped: follow-ups are turned off (follow_ups.enabled: false) ==="
    } >> "$LOG_FILE"
    exit 0
    ;;
  1)
    ;;
  *)
    {
      echo "=== $(date '+%Y-%m-%d %H:%M:%S') follow-up sweep aborted: enabled check failed (exit $enabled_status) ==="
    } >> "$LOG_FILE"
    exit "$enabled_status"
    ;;
esac

PROMPT="Run the career-ops 'followup' mode (modes/followup.md) against $ROOT/data/applications.md and $ROOT/data/follow-ups.md. Run node followup-cadence.mjs, and for every overdue/urgent entry generate the follow-up email/LinkedIn draft per the mode's framework (voice-dna.md guardrails apply). Write the full dashboard plus every generated draft to $DRAFT_FILE as markdown. Do NOT send, submit, or record anything as sent -- draft-only, for the user to review later. If there is nothing overdue/urgent, write a one-line note to that file saying so instead."

# Headless claude -p denies any tool call that would need approval, so grant
# exactly what the sweep needs: the read-only scripts modes/followup.md runs,
# and a write to today's draft file. --add-dir lets it read the tracker when
# the data root is outside the checkout. `//` makes an Edit rule an absolute
# path.
#
# --allowedTools only adds approvals; it does not narrow what the user's own
# settings already allow. dontAsk overrides an inherited acceptEdits or auto
# default, so nothing beyond these rules and the user's explicit allow rules
# runs, and the deny rules (which beat any allow rule) block the recording
# scripts and Edit/Write under data/. They can't fence off a broad Bash rule
# in the user's own settings (`node -e` can write any file); that is the
# user's grant, and the sweep adds nothing to it.
{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') follow-up sweep starting ==="
  claude -p "$PROMPT" \
    --permission-mode dontAsk \
    --add-dir "$ROOT" \
    --allowedTools \
      "Bash(node followup-cadence.mjs *)" \
      "Bash(node funnel-velocity.mjs *)" \
      "Bash(node rejection-latency.mjs *)" \
      "Bash(node company-history.mjs *)" \
      "Edit(/$DRAFT_FILE)" \
    --disallowedTools \
      "Bash(node set-status.mjs *)" \
      "Bash(node followup-seed.mjs *)" \
      "Edit(/$ROOT/data/**)"
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') follow-up sweep done -> $DRAFT_FILE ==="
} >> "$LOG_FILE" 2>&1

if [ -f "$DRAFT_FILE" ]; then
  osascript -e "display notification \"Follow-up drafts ready: $DRAFT_FILE\" with title \"career-ops\"" >/dev/null 2>&1 || true
fi
