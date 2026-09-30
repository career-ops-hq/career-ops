#!/bin/sh
# Advance one persisted scan/score task and deliver one eligible report.
set -eu
workflow/.venv/bin/python -B -m workflow.career_ops cron-score
CAREER_OPS_NOTIFICATIONS_ENABLED=1 workflow/.venv/bin/python -B -m workflow.notifications cron
