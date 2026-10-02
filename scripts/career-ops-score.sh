#!/bin/sh
# Advance one persisted scan/score task and deliver one eligible report.
set -eu
.venv/bin/python -B -m career_ops cron-score
CAREER_OPS_NOTIFICATIONS_ENABLED=1 .venv/bin/python -B -m career_ops notify cron
