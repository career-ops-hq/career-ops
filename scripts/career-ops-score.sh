#!/bin/sh
# Advance one persisted scan/score task through the Python workflow CLI.
set -eu
workflow/.venv/bin/python -B -m workflow.career_ops cron-score
if [ "${CAREER_OPS_NOTIFICATIONS_ENABLED:-0}" = 1 ]; then
  workflow/.venv/bin/python -B -m workflow.notifications cron
fi
