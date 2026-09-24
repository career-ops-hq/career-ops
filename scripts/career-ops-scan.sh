#!/bin/sh
# Run provider discovery through the Python CLI; Hermes does not decide workflow state.
set -eu
exec workflow/.venv/bin/python -B -m workflow.career_ops discover
