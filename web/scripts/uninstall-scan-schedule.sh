#!/bin/sh
# Remove the scheduled-scan worker. Keeps data/, the tick file, and the log.
set -eu

LABEL=io.career-ops.scheduled-scan
MARKER='# career-ops recurring scan'

OS=$(uname -s)

if [ "$OS" = Darwin ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  existed=0
  [ -f "$PLIST" ] && existed=1
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  if [ "$existed" -eq 1 ]; then
    echo "Removed $LABEL."
  else
    echo "$LABEL is not installed."
  fi
elif [ "$OS" = Linux ]; then
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

  if ! grep -q -F "$MARKER" "$TMP"; then
    echo "$MARKER is not installed."
    exit 0
  fi

  # grep exits 1 when no line remains; that is expected.
  grep -v -F "$MARKER" "$TMP" >"$NEW" || true
  if [ -s "$NEW" ]; then
    crontab - <"$NEW"
  else
    crontab -r
  fi
  echo "Removed $MARKER."
else
  echo "unsupported OS: $OS" >&2
  exit 1
fi
