#!/bin/sh
# Run provider discovery only; Hermes schedules this process but does not reason about workflow state.
set -eu
cd "$(dirname "$0")/.."
export CAREER_OPS_OPPORTUNITY_DB="${CAREER_OPS_OPPORTUNITY_DB:-data/opportunities.db}"
exec node scan.mjs
