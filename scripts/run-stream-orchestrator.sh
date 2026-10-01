#!/usr/bin/env bash
# run-stream-orchestrator.sh — budget-aware resume loop around
# scripts/stream-feed-processor.mjs.
#
# WHY THE LOOP EXISTS
# -------------------
# The batch worker has a 12-minute global wall clock. A feed too large for that
# budget does not "mostly finish" — it is killed, and a killed run that kept no
# position restarts from row zero forever. This runner carves one feed into as
# many budget-sized rounds as it needs: each round runs the processor until its
# own deadline, the processor flushes its identity-bound cursor and exits 143,
# and the next round resumes at the exact row it reached.
#
# WHO OWNS THE DEADLINE
# ---------------------
# Not an external supervisor: SIGTERMing the process group at 12 minutes kills
# this script too, and no loop survives to resume. And not a shell watchdog
# either — see the note in the loop body for the orphaned-`sleep` failure that
# produced.
#
# Instead the budget is handed down as --time-budget and the processor arms it on
# itself, unwinding through the abort path it already uses for SIGTERM. So one
# code path owns "stop cleanly, write the cursor, report 143", and this script
# only has to read an exit code. A hard external SIGKILL remains unresumable;
# that is a property of the supervisor, and --max-rounds plus the no-progress
# guard are the backstops against a run that never converges.
#
# EXIT-CODE CONTRACT (mirrors the processor and the ledger)
#   0    feed exhausted, every record validated   -> stop, exit 0
#   2    feed exhausted, some records rejected    -> stop, exit 2
#   143  this round hit its deadline               -> resume from the cursor
#   other  fatal or structural                     -> stop, preserve the code
#
# That last case is the anti-footgun rule: a missing source, an unreadable
# cursor, a rejected host. Resuming on any of those is an infinite failure loop
# that never produces output and never terminates, so anything unrecognized
# stops immediately with the processor's own code intact.
#
# STDOUT
# ------
# The processor inherits this script's stdout (or appends to --out). Rounds are
# strictly sequential — a round's process exits before the next starts — so lines
# cannot interleave, and the processor flushes stdout before exiting rather than
# relying on the event loop to drain. Diagnostics go to stderr and never
# interleave with the data stream.
#
# POSIX: no bashisms (no [[ ]], arrays, $SECONDS, `local -n`). Uses only
# parameter expansion, `case`, `trap`, `kill`, `sleep`, `date`, `printf`, so it
# runs under dash as well as bash.
#
# Usage:
#   bash scripts/run-stream-orchestrator.sh --src <path-or-url> --resume-token <path> [options]
#
# Options:
#   --src <path|url>        REQUIRED. Local export or public, rate-compliant feed.
#   --resume-token <path>   REQUIRED for resumption. Cursor file; the loop's
#                           entire reason for existing.
#   --format <fmt>          Passed through (ndjson | json-array | json | csv).
#   --require <a,b.c>       Passed through. Dotted paths every record must have.
#   --limit <n>             Passed through. PER ROUND — that is the point; it
#                           bounds each round, not the whole feed.
#   --out <file>            Append each round's stdout here. Default: inherit
#                           this script's stdout, so `... | tee out.ndjson`
#                           works with no flag.
#   --budget <sec>          Per-round wall clock, passed down as --time-budget.
#                           Default 600 (10 min), leaving headroom inside a
#                           12-minute worker.
#   --cooldown <sec>        Pause after a 143 before resuming, so the previous
#                           round's sockets close. Default 2.
#   --max-rounds <n>        Backstop; 0 = unlimited (default). A run that keeps
#                           returning 143 without the cursor advancing trips the
#                           no-progress guard instead — see below.
#   --dry-run               Print the round command and the resolved paths, run
#                           nothing, exit 0.
#   -h | --help             This text.
#
# Examples:
#   # 4 rounds of 9 minutes each, resuming, accumulating into one file
#   bash scripts/run-stream-orchestrator.sh \
#     --src exports/ats.ndjson --resume-token batch/cursor.json \
#     --require url,title --budget 540 --out data/ats.ndjson
#
#   # pipe straight out (no interleaving: rounds are sequential)
#   bash scripts/run-stream-orchestrator.sh --src exports/ats.ndjson \
#     --resume-token batch/cursor.json | head -500

set -u

PROC_REL="scripts/stream-feed-processor.mjs"
SRC=""
CURSOR=""
FORMAT=""
REQUIRE=""
LIMIT=""
OUT=""
BUDGET=600
COOLDOWN=2
MAX_ROUNDS=0
DRY_RUN=0

PROG="$(basename "$0")"

# ── logging (stderr only, always) ────────────────────────────────────────────
ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { printf '%s [%s] %s\n' "$(ts)" "$PROG" "$*" >&2; }
die()  { log "ERROR: $*"; exit 1; }

usage() {
  sed -n '2,/^set -u$/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -u$/d'
}

# ── root resolution ──────────────────────────────────────────────────────────
# Same rule as modes/batch.md and the batch agent: never trust the caller's cwd.
# Walk up from THIS file until a directory holds both AGENTS.md and modes/.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR"
while [ "$ROOT" != "/" ]; do
  if [ -f "$ROOT/AGENTS.md" ] && [ -d "$ROOT/modes" ]; then
    break
  fi
  ROOT="$(dirname "$ROOT")"
done
if [ ! -f "$ROOT/AGENTS.md" ]; then
  ROOT="$SCRIPT_DIR/.."
fi
PROC="$ROOT/$PROC_REL"

# ── cursor position (for the no-progress guard) ──────────────────────────────
# Read with node rather than grep: the cursor is JSON, and a regex that happens
# to match a "consumed" inside a nested value would report progress that never
# happened. -1 means "unknown", which is treated as progress by the guard below
# so an unreadable cursor never silently wedges the loop.
cursor_consumed() {
  [ -n "$CURSOR" ] || { printf '%s' "-1"; return 0; }
  node -e '
    const fs = require("fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const n = Number(c && c.position && c.position.consumed);
      process.stdout.write(Number.isFinite(n) ? String(n) : "-1");
    } catch { process.stdout.write("-1"); }
  ' "$CURSOR" 2>/dev/null || printf '%s' "-1"
}

# ── arg parsing ──────────────────────────────────────────────────────────────
need() {
  # need <flag> <count-of-remaining>
  [ "$2" -ge 2 ] || die "$1 requires a value"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --src)           need "$1" $#; SRC="$2"; shift 2 ;;
    --resume-token)  need "$1" $#; CURSOR="$2"; shift 2 ;;
    --format)        need "$1" $#; FORMAT="$2"; shift 2 ;;
    --require)       need "$1" $#; REQUIRE="$2"; shift 2 ;;
    --limit)         need "$1" $#; LIMIT="$2"; shift 2 ;;
    --out)           need "$1" $#; OUT="$2"; shift 2 ;;
    --budget)        need "$1" $#; BUDGET="$2"; shift 2 ;;
    --cooldown)      need "$1" $#; COOLDOWN="$2"; shift 2 ;;
    --max-rounds)    need "$1" $#; MAX_ROUNDS="$2"; shift 2 ;;
    --dry-run)       DRY_RUN=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               usage >&2; die "unrecognized argument: $1" ;;
  esac
done

# ── validation ───────────────────────────────────────────────────────────────
[ -n "$SRC" ] || die "--src is required"
case "$BUDGET" in
  ''|*[!0-9]*) die "--budget must be a whole number of seconds (got: $BUDGET)" ;;
esac
[ "$BUDGET" -gt 0 ] || die "--budget must be greater than 0"
case "$COOLDOWN" in
  ''|*[!0-9]*) die "--cooldown must be a whole number of seconds (got: $COOLDOWN)" ;;
esac
case "$MAX_ROUNDS" in
  ''|*[!0-9]*) die "--max-rounds must be a non-negative integer (got: $MAX_ROUNDS)" ;;
esac

if [ ! -f "$PROC" ]; then
  die "processor not found at $PROC — run this from a career-ops checkout"
fi

# Resolving relative paths against ROOT here, once, keeps the round command and
# the cursor-consumed read pointing at the same file. The processor resolves
# relative paths the same way, so nothing shifts between rounds.
case "$CURSOR" in
  /*) : ;;
  *) CURSOR="$ROOT/$CURSOR" ;;
esac

log "root=$ROOT"
log "src=$SRC"
log "cursor=$CURSOR"
log "budget=${BUDGET}s cooldown=${COOLDOWN}s max-rounds=$MAX_ROUNDS"

# ── the round's argument list, built ONCE ────────────────────────────────────
# Built with `set --` rather than inline ${VAR:+--flag "$VAR"} because that
# form is a quoting trap: the expansion happens inside a single word, so the
# quotes are LITERAL and the processor receives `--format "ndjson"` — quotes
# included — as its argument. Optional arguments are assembled as positional
# parameters here, which quotes correctly and stays inside POSIX.
# The SOURCE IS POSITIONAL in the processor's own interface — `node
# stream-feed-processor.mjs <path-or-url> [flags]`. The runner's own --src is a
# convenience so the flag set reads uniformly; it must not be forwarded as a flag,
# or the processor's validator rejects the whole round as an unrecognized flag.
set -- "$SRC"
[ -n "$FORMAT" ]  && set -- "$@" --format "$FORMAT"
[ -n "$REQUIRE" ] && set -- "$@" --require "$REQUIRE"
[ -n "$LIMIT" ]   && set -- "$@" --limit "$LIMIT"
# The deadline is handed to the processor rather than enforced here. See the note
# above `wait` in the loop for why a shell-side watchdog is the wrong shape.
[ "$BUDGET" -gt 0 ] && set -- "$@" --time-budget "$BUDGET"
set -- "$@" --resume-token "$CURSOR"

# ── dry run ──────────────────────────────────────────────────────────────────
# Prints the EXACT argument list the loop will build, by reading positional
# parameters rather than re-deriving them from the variables. Re-deriving is how
# a dry run drifts from the real command — the flag set here and the set above
# are then two lists that must be kept in sync by hand, and the one that gets
# forgotten is the one the operator trusted before running it for real.
if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY RUN — no rounds executed"
  printf '  node %s' "$PROC_REL"
  for a in "$@"; do printf ' %s' "$a"; done
  printf '\n'
  if [ -n "$OUT" ]; then
    printf '  stdout -> %s (append)\n' "$OUT"
  else
    printf '  stdout -> inherited (pipe or redirect as desired)\n'
  fi
  printf '  budget   -> enforced here by SIGTERM at %ss; not passed to the processor\n' "$BUDGET"
  printf '  cooldown -> %ss after each 143\n' "$COOLDOWN"
  if [ -f "$CURSOR" ]; then
    printf '  cursor   -> consumed=%s (round 1 resumes here)\n' "$(cursor_consumed)"
  else
    printf '  cursor   -> none yet (round 1 starts from the beginning)\n'
  fi
  exit 0
fi

# ── the loop ─────────────────────────────────────────────────────────────────
round=0
last_consumed=""
no_progress=0
NO_PROGRESS_LIMIT=3

cd "$ROOT" || die "cannot cd to $ROOT"

while :; do
  round=$((round + 1))

  if [ "$MAX_ROUNDS" -gt 0 ] && [ "$round" -gt "$MAX_ROUNDS" ]; then
    log "round $round: --max-rounds $MAX_ROUNDS reached, stopping"
    exit 143
  fi

  log "round $round: starting (budget ${BUDGET}s)"

  # One round. The processor arms its OWN deadline (--time-budget, passed above)
  # and returns 143 when it expires, having flushed its cursor through the same
  # abort path a SIGTERM uses.
  #
  # There is deliberately no `sleep N; kill` watchdog here. That shape is a
  # background subshell whose `sleep` is a grandchild: `kill` on the subshell
  # reaps the subshell and orphans the sleep, which keeps the caller's stdout open
  # for the rest of the budget. Measured here — a completed feed left the pipe
  # held by an orphaned `sleep 600` and the run appeared to hang long after every
  # record had been written. A timer we own and always disarm has no such tail.
  #
  # stdout appends to $OUT when requested; rounds are strictly sequential (this
  # `wait` returns before the next round starts), so lines cannot interleave, and
  # the processor flushes stdout before exiting rather than trusting the event
  # loop to drain it.
  if [ -n "$OUT" ]; then
    node "$PROC" "$@" >> "$OUT" &
  else
    node "$PROC" "$@" &
  fi
  PROC_PID=$!

  wait "$PROC_PID"
  rc=$?

  consumed_now="$(cursor_consumed)"

  case "$rc" in
    0)
      log "round $round: exit 0 — feed complete, every record validated"
      exit 0
      ;;
    2)
      log "round $round: exit 2 — feed complete, some records were rejected"
      log "round $round: the sink holds every VALID record; rejected rows are counted on stderr"
      exit 2
      ;;
    143)
      log "round $round: exit 143 — budget of ${BUDGET}s reached, cursor at consumed=$consumed_now"
      if [ -z "$CURSOR" ]; then
        # Unreachable via the flag parser (--resume-token is required for the
        # loop), but if this ever runs without a cursor the next round would
        # restart at row zero and loop forever. Refuse rather than spin.
        die "exit 143 without a resume token — refusing to loop (this would never progress)"
      fi
      # No-progress guard: a round that returns 143 without the cursor ADVANCING
      # made no headway, so resuming again would repeat it identically. The stall
      # guard firing immediately every round is the realistic cause.
      if [ "$consumed_now" != "$last_consumed" ] && [ "$consumed_now" != "-1" ]; then
        no_progress=0
      else
        no_progress=$((no_progress + 1))
        log "round $round: cursor did not advance (consumed=$consumed_now, was=$last_consumed)"
        if [ "$no_progress" -ge "$NO_PROGRESS_LIMIT" ]; then
          log "round $round: no progress after $no_progress consecutive round(s); stopping to avoid an infinite loop"
          exit 1
        fi
      fi
      last_consumed="$consumed_now"
      log "round $round: cooling down ${COOLDOWN}s before resuming"
      sleep "$COOLDOWN"
      continue
      ;;
    *)
      # Anything else is fatal or structural: bad source, blocked host, unreadable
      # or mismatched cursor, bad flag. Resuming on these is the infinite failure
      # loop, so stop and preserve the processor's own exit code.
      log "round $round: exit $rc — fatal; stopping without resuming"
      exit "$rc"
      ;;
  esac
done
