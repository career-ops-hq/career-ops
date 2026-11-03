#!/bin/sh
# Install the 15-minute scheduled-scan worker for the current user.
# macOS: launchd LaunchAgent. Linux: one marked crontab line.
set -eu

LABEL=io.career-ops.scheduled-scan
MARKER='# career-ops recurring scan'

if [ "$(id -u)" -eq 0 ]; then
  echo "must not run as root: the scan schedule belongs to the current user" >&2
  exit 1
fi

OS=$(uname -s)
case "$OS" in
  Darwin | Linux) ;;
  *) echo "unsupported OS: $OS" >&2; exit 1 ;;
esac

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RUNNER="$ROOT/web/scripts/scheduled-jobs-runner.mjs"
if [ ! -f "$RUNNER" ]; then
  echo "runner not found: $RUNNER" >&2
  exit 1
fi

NODE=$(command -v node || true)
if [ -z "$NODE" ]; then
  echo "node not found on PATH" >&2
  exit 1
fi

# Pin the real binary: version-manager shims and fnm per-shell paths do not survive reboot,
# and the runner already spawns scans with process.execPath.
NODE=$("$NODE" -e 'process.stdout.write(process.execPath)')

# A Homebrew binary resolves to a path that names its version (.../Cellar/node/26.12.1_1/bin/node),
# and `brew upgrade` deletes that folder, so every scheduled tick then fails with exit 127.
# The opt symlink (.../opt/node/bin/node) follows the current version; use it when it is the same binary.
case "$NODE" in
  */Cellar/*/*/bin/node)
    BREW_PREFIX=${NODE%%/Cellar/*}
    BREW_FORMULA=${NODE#*/Cellar/}
    BREW_FORMULA=${BREW_FORMULA%%/*}
    STABLE="$BREW_PREFIX/opt/$BREW_FORMULA/bin/node"
    if [ -x "$STABLE" ] && [ "$("$STABLE" -e 'process.stdout.write(process.execPath)' 2>/dev/null)" = "$NODE" ]; then
      NODE=$STABLE
    fi
    ;;
esac

# Keep the runner on the same store as the web app: schedulers start with a minimal
# environment, so bake in the path overrides that are set now.
ENV_PREFIX=""
for VAR in CAREER_OPS_ROOT CAREER_OPS_DATA_DIR CAREER_OPS_SCHEDULED_JOBS_PATH; do
  eval "VALUE=\${$VAR:-}"
  [ -n "$VALUE" ] || continue
  case "$VALUE" in
    *"'"*) echo "$VAR must not contain a single quote" >&2; exit 1 ;;
  esac
  ENV_PREFIX="$ENV_PREFIX$VAR='$VALUE' "
done

# The web app and the runner share this store path; the tick file and log live beside it.
STORE=$("$NODE" --input-type=module -e '
import { pathToFileURL } from "node:url";
const root = process.argv[1];
const { getCareerOpsRoot } = await import(pathToFileURL(root + "/path-resolver.mjs"));
const { scheduledStorePath } = await import(pathToFileURL(root + "/web/src/lib/scheduled-runner-path.mjs"));
console.log(scheduledStorePath(getCareerOpsRoot()));
' "$ROOT")
if [ -z "$STORE" ]; then
  echo "could not resolve the scheduled jobs store path" >&2
  exit 1
fi

# The command quotes paths with single quotes, so a quote in a path cannot be escaped.
case "$ROOT$NODE$STORE" in
  *"'"*) echo "paths containing a single quote are not supported" >&2; exit 1 ;;
esac

mkdir -p "$(dirname "$STORE")"

# The tick file records the last check time for the status banner.
TICK="touch '$STORE.tick'"
RUN="$ENV_PREFIX'$NODE' 'web/scripts/scheduled-jobs-runner.mjs' >/dev/null 2>>'$(dirname "$STORE")/scheduled-jobs.log'"
CMD="cd '$ROOT' && $TICK && $RUN"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

if [ "$OS" = Darwin ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$(dirname "$PLIST")"
  BACKUP=
  if [ -f "$PLIST" ]; then
    BACKUP=$(mktemp)
    cp "$PLIST" "$BACKUP"
  fi
  # Until bootstrap succeeds, any exit (failure, INT, TERM, HUP) restores the previous schedule.
  rollback() {
    if [ -n "$BACKUP" ]; then
      mv "$BACKUP" "$PLIST"
      launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
    else
      rm -f "$PLIST"
    fi
  }
  trap rollback EXIT
  trap 'exit 1' INT TERM HUP
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>$(xml_escape "$CMD")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT")</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Minute</key><integer>0</integer></dict>
    <dict><key>Minute</key><integer>15</integer></dict>
    <dict><key>Minute</key><integer>30</integer></dict>
    <dict><key>Minute</key><integer>45</integer></dict>
  </array>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  # bootout can return before launchd drops the old job, so retry bootstrap briefly.
  BOOTSTRAPPED=0
  for ATTEMPT in 1 2 3 4 5; do
    if launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
      BOOTSTRAPPED=1
      break
    fi
    [ "$ATTEMPT" -lt 5 ] && sleep 1
  done
  if [ "$BOOTSTRAPPED" -ne 1 ]; then
    echo "launchctl bootstrap failed; a logged-in GUI session is required" >&2
    exit 1
  fi
  trap - EXIT
  rm -f "$BACKUP"
  echo "Installed $LABEL (launchd, every 15 minutes)."
else
  TMP=$(mktemp)
  ERR=$(mktemp)
  NEW=$(mktemp)
  trap 'rm -f "$TMP" "$ERR" "$NEW"' EXIT

  if ! crontab -l >"$TMP" 2>"$ERR"; then
    if grep -q 'no crontab' "$ERR"; then
      : >"$TMP"
    else
      cat "$ERR" >&2
      exit 1
    fi
  fi

  # grep exits 1 when no line remains; that is expected.
  grep -v -F "$MARKER" "$TMP" >"$NEW" || true
  # cron treats an unescaped % as a newline.
  CRON_CMD=$(printf '%s' "$CMD" | sed 's/%/\\%/g')
  printf '*/15 * * * * %s %s\n' "$CRON_CMD" "$MARKER" >>"$NEW"
  crontab - <"$NEW"
  echo "Installed $MARKER (cron, every 15 minutes)."
fi
