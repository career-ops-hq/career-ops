#!/bin/sh
# Run Python provider discovery only; Hermes does not reason about workflow state.
set -eu
exec workflow/.venv/bin/python -B -m workflow.career_ops discover
