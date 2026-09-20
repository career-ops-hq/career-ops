#!/bin/sh
# Advance one persisted scan/score task through the Python workflow CLI.
set -eu
cd "$(dirname "$0")/.."
exec workflow/.venv/bin/python -B workflow/career_ops.py cron-score
