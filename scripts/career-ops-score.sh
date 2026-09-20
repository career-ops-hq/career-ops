#!/bin/sh
# Advance one persisted scan/score task through the Python workflow CLI.
set -eu
exec workflow/.venv/bin/python -B -m workflow.career_ops cron-score
