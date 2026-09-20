#!/bin/sh
# Run Python provider discovery only; Hermes does not reason about workflow state.
set -eu
cd "$(dirname "$0")/.."
exec workflow/.venv/bin/python -B -m workflow.career_ops discover
