#!/bin/sh
# Run provider discovery through the Python CLI; Hermes does not decide workflow state.
set -eu
exec .venv/bin/python -B -m career_ops discover
