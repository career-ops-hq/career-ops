#!/usr/bin/env bash
set -euo pipefail

# career-ops batch runner — standalone orchestrator for headless agent workers
# Reads batch-input.tsv, delegates each offer to a worker, tracks state in
# batch-state.tsv for resumability.
#
# Supported CLIs (--cli flag):
#   claude    — claude -p with --dangerously-skip-permissions (default)
#   opencode  — opencode run (falls back to ollama launch opencode if not in PATH)
#   gemini    — gemini -p
#   qwen      — qwen -p
#
# Only claude supports --strict-mcp-config, the rate-limit/session retry loop,
# and --parallel > 1; other CLIs run sequentially with a single attempt.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BATCH_DIR="$SCRIPT_DIR"
INPUT_FILE="$BATCH_DIR/batch-input.tsv"
STATE_FILE="$BATCH_DIR/batch-state.tsv"
PROMPT_FILE="$BATCH_DIR/batch-prompt.md"
PROFILE_FILE="$PROJECT_DIR/config/profile.yml"
LOGS_DIR="$BATCH_DIR/logs"
DISCARD_LOG="$LOGS_DIR/discard.log"
# Advisory pre-screen results live in their own file. discard.log is the record of
# decisions that removed a posting from the run; prescreen.log is the record of
# signals that were only noted. Keeping them apart is what makes the log honest.
PRESCREEN_LOG="$LOGS_DIR/prescreen.log"
TRACKER_DIR="$BATCH_DIR/tracker-additions"
REPORTS_DIR="$PROJECT_DIR/reports"
APPLICATIONS_FILE="$PROJECT_DIR/data/applications.md"
LOCK_FILE="$BATCH_DIR/batch-runner.pid"
PAUSE_FILE="$BATCH_DIR/batch-runner.paused"
STATE_LOCK_DIR="$BATCH_DIR/.batch-state.lock"
STATE_LOCK_PID_FILE="$STATE_LOCK_DIR/pid"
STATE_LOCK_TIMEOUT_SECONDS=30
MAIN_PID="${BASHPID:-$$}"

# Defaults
PARALLEL=1
DRY_RUN=false
RETRY_FAILED=false
RESUME_PAUSED=false
START_FROM=0
MAX_RETRIES=2
MIN_SCORE=0
SKIP_PDF=false
SKIP_LIVENESS=false
MODEL=""  # explicit override; otherwise resolved from config/profile.yml spend_tier
RESOLVED_MODEL=""
RESOLVED_SPEND_TIER=""
CLI=claude
RATE_LIMIT_SLEEP=300
BATCH_PAUSED=false
STATUS_ONLY=false
WATCH_MODE=false
LIMIT=0

# Return success for non-negative integer or decimal strings.
is_decimal_number() {
  [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]
}

usage() {
  cat <<'USAGE'
career-ops batch runner — process job offers in batch via headless agent workers
Defaults to claude; other CLIs via --cli. For claude the model is resolved from
spend_tier in config/profile.yml unless --model overrides it.

Usage: batch-runner.sh [OPTIONS]

Options:
  --cli NAME           Agent CLI to use: claude (default), opencode, gemini, qwen
  --model NAME         Model for the CLI (e.g. qwen2.5:32b for opencode/ollama).
                       For claude, overrides the tier-resolved model (otherwise
                       config/profile.yml spend_tier: economy/standard/premium;
                       default standard).
  --parallel N         Number of parallel workers (default: 1; claude only)
  --dry-run            Show what would be processed, don't execute
  --retry-failed       Only retry offers marked as "failed" in state
  --resume-paused      Resume offers paused by a Claude session/rate limit
  --start-from N       Start from offer ID N (skip earlier IDs)
  --limit N            Max number of offers to process in this run
  --max-retries N      Max retry attempts per offer (default: 2)
  --min-score N        Skip PDF/tracker for offers scoring below N (default: 0 = off)
  --skip-pdf           Skip PDF generation entirely (write ❌ in tracker PDF column)
  --skip-liveness      Skip the liveness pre-pass (no browser/network needed; every
                       posting then goes straight to a full evaluation)
  --rate-limit-sleep N Seconds to wait before retrying a rate-limited worker
                       (default: 300; claude only)
  --status             Show batch progress and a per-job table, then exit
  --watch              Live-refresh progress until the run completes
  -h, --help           Show this help

Files:
  batch-input.tsv      Input offers (id, url, source, notes)
  batch-state.tsv      Processing state (auto-managed)
  batch-prompt.md      Prompt template for workers
  logs/                Per-offer logs
  tracker-additions/   Tracker lines for post-batch merge

Examples:
  # Dry run to see pending offers
  ./batch-runner.sh --dry-run

  # Process all pending
  ./batch-runner.sh

  # Retry only failed offers
  ./batch-runner.sh --retry-failed

  # Process 2 at a time starting from ID 10 (claude only)
  ./batch-runner.sh --parallel 2 --start-from 10

  # Local LLM via OpenCode (free, runs sequentially)
  ./batch-runner.sh --cli opencode --model qwen2.5:32b
USAGE
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cli) CLI="$2"; shift 2 ;;
    --parallel) PARALLEL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --retry-failed) RETRY_FAILED=true; shift ;;
    --resume-paused) RESUME_PAUSED=true; shift ;;
    --start-from) START_FROM="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --max-retries) MAX_RETRIES="$2"; shift 2 ;;
    --min-score) MIN_SCORE="$2"; shift 2 ;;
    --skip-pdf) SKIP_PDF=true; shift ;;
    --skip-liveness) SKIP_LIVENESS=true; shift ;;
    --rate-limit-sleep)
      [[ $# -ge 2 ]] || { echo "ERROR: --rate-limit-sleep requires an argument"; exit 1; }
      RATE_LIMIT_SLEEP="$2"
      shift 2
      ;;
    --model) MODEL="$2"; shift 2 ;;
    --status) STATUS_ONLY=true; shift ;;
    --watch) WATCH_MODE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if ! [[ "$RATE_LIMIT_SLEEP" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --rate-limit-sleep must be a non-negative integer (seconds)."
  exit 1
fi

if ! is_decimal_number "$MIN_SCORE"; then
  echo "ERROR: --min-score must be a non-negative number."
  exit 1
fi

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --limit must be a non-negative integer."
  exit 1
fi

# Lock file to prevent double execution
acquire_lock() {
  if [[ -f "$LOCK_FILE" ]]; then
    local old_pid
    old_pid=$(cat "$LOCK_FILE")
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "ERROR: Another batch-runner is already running (PID $old_pid)"
      echo "If this is stale, remove $LOCK_FILE"
      exit 1
    else
      echo "WARN: Stale lock file found (PID $old_pid not running). Removing."
      rm -f "$LOCK_FILE"
    fi
  fi
  echo "$MAIN_PID" > "$LOCK_FILE"
}

release_lock() {
  if [[ "${BASHPID:-$$}" != "$MAIN_PID" ]]; then
    return
  fi
  rm -f "$LOCK_FILE"
}

# On any exit — clean, error, or Ctrl-C — drain the advisory pre-screens first so
# a backgrounded gate call cannot outlive the run that started it and write into
# the NEXT run's prescreen.log.
# declare -f guard: the trap can fire from an early prerequisite failure that
# happens before jev_drain is defined, and "command not found" in an EXIT trap
# would mask the real exit status.
trap 'declare -f jev_drain >/dev/null 2>&1 && jev_drain; release_lock' EXIT

# Validate prerequisites
check_prerequisites() {
  if [[ ! -f "$INPUT_FILE" ]]; then
    echo "ERROR: $INPUT_FILE not found. Add offers first."
    exit 1
  fi

  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "ERROR: $PROMPT_FILE not found."
    exit 1
  fi

  # Resolve the binary the configured CLI actually needs. opencode can run
  # natively or fall back to ollama, so check for either.
  local cli_cmd
  case "$CLI" in
    claude)   cli_cmd="claude" ;;
    opencode) command -v opencode &>/dev/null && cli_cmd="opencode" || cli_cmd="ollama" ;;
    gemini)   cli_cmd="gemini" ;;
    qwen)     cli_cmd="qwen" ;;
    *) echo "ERROR: Unknown --cli '$CLI'. Supported: claude, opencode, gemini, qwen"; exit 1 ;;
  esac

  if ! command -v "$cli_cmd" &>/dev/null; then
    echo "ERROR: '$cli_cmd' not found in PATH (required for --cli $CLI)."
    if [[ "$CLI" == "opencode" ]]; then
      echo "       Install opencode (https://opencode.ai) or Ollama (https://ollama.ai) with an opencode model."
    fi
    exit 1
  fi

  # Calibrated Jev bands, read once here so the concurrent prescreen subshells
  # and the log formatter share one source of truth (config/profile.yml).
  read_gate_bands

  # opencode's headless scope, derived ONCE per run (not per worker) and
  # exported for every opencode launch below. See opencode_permission_env for
  # why the worker needs it and why the mapping is not spelled out inline.
  if [[ "$CLI" == "opencode" ]]; then
    local oc_perm
    oc_perm="$(opencode_permission_env)"
    if [[ -n "$oc_perm" ]]; then
      export OPENCODE_CONFIG_CONTENT="$oc_perm"
    else
      echo "WARNING: could not derive the opencode permission scope (node or the lib missing)." >&2
      echo "         Workers will likely die on the first /tmp read with no report written." >&2
    fi
  fi

  # Parallelism, the rate-limit retry loop, and --strict-mcp-config are
  # claude-only; local models run one at a time.
  if [[ "$CLI" != "claude" && "$PARALLEL" -gt 1 ]]; then
    echo "WARN: --parallel >1 is not supported for --cli $CLI (local models run sequentially). Resetting to 1."
    PARALLEL=1
  fi

  mkdir -p "$LOGS_DIR" "$TRACKER_DIR" "$REPORTS_DIR"
}

# Status/watch mode only needs prior batch state, not worker prerequisites.
check_status_prerequisites() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No state file found at $STATE_FILE"
    exit 0
  fi
}

# Initialize state file if it doesn't exist
init_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    printf 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n' > "$STATE_FILE"
  fi
}

# A lock held longer than this is assumed abandoned, independent of the
# PID-liveness check below. This exists because `kill -0 $pid` is unreliable
# on Git Bash/Windows (MSYS PIDs from $!/$BASHPID don't reliably map to real
# Windows process IDs), so a genuinely-dead lock holder can otherwise never
# be recovered there and every other worker times out waiting for it.
STATE_LOCK_STALE_AGE_SECONDS=15

acquire_state_lock() {
  if [[ "${STATE_LOCK_DISABLED:-0}" -eq 1 ]]; then
    return 0
  fi

  local waited=0
  local max_waits=$((STATE_LOCK_TIMEOUT_SECONDS * 10))

  while true; do
    if mkdir "$STATE_LOCK_DIR" 2>/dev/null; then
      if printf '%s\t%s\n' "${BASHPID:-$$}" "$(date +%s)" > "$STATE_LOCK_PID_FILE"; then
        STATE_LOCK_OWNED=1
        return 0
      fi
      rm -f "$STATE_LOCK_PID_FILE" 2>/dev/null || true
      rmdir "$STATE_LOCK_DIR" 2>/dev/null || true
      echo "ERROR: Failed to initialize state lock metadata at $STATE_LOCK_DIR" >&2
      return 1
    fi

    if [[ ! -d "$STATE_LOCK_DIR" ]]; then
      if (( PARALLEL <= 1 )); then
        echo "WARN: State lock creation failed. Falling back to lock-free operation (single-worker mode)." >&2
        STATE_LOCK_DISABLED=1
        STATE_LOCK_OWNED=0
        return 0
      fi
      echo "ERROR: Failed to create state lock directory $STATE_LOCK_DIR" >&2
      return 1
    fi

    if [[ -f "$STATE_LOCK_PID_FILE" ]]; then
      local lock_pid lock_epoch
      lock_pid=$(cut -f1 "$STATE_LOCK_PID_FILE" 2>/dev/null || true)
      lock_epoch=$(cut -f2 "$STATE_LOCK_PID_FILE" 2>/dev/null || true)
      local stale=false
      local stale_reason=""

      # SAFETY INVARIANT: never treat the lock as stale while kill -0
      # positively confirms the recorded PID is still running — a
      # confirmed-alive owner may still write update_state_unlocked's
      # rewrite of STATE_FILE, and reclaiming under it would let two
      # processes rewrite $STATE_FILE.tmp concurrently (real data loss).
      # The age-based fallback below only ever fires when the PID check
      # could NOT confirm liveness (empty/missing PID, or kill -0 itself
      # reported not-running) — it narrows, but does not replace, the PID
      # check. This intentionally leaves one Windows/Git-Bash edge case
      # unhandled: a `kill -0` FALSE POSITIVE (reports alive for a PID
      # that Windows has actually reused for an unrelated process). That
      # gap is accepted because the alternative — reclaiming while any
      # chance remains the owner is genuinely alive — risks silent
      # concurrent-write corruption, which is worse than this lock
      # occasionally timing out (recoverable via retry) in that rare case.
      local pid_confirmed_alive=false
      if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
        pid_confirmed_alive=true
      fi

      if [[ "$pid_confirmed_alive" == "false" ]]; then
        if [[ -n "$lock_pid" ]]; then
          stale=true
          stale_reason="PID $lock_pid not running"
        elif [[ "$lock_epoch" =~ ^[0-9]+$ ]]; then
          local now age
          now=$(date +%s)
          age=$((now - lock_epoch))
          if (( age >= STATE_LOCK_STALE_AGE_SECONDS )); then
            stale=true
            stale_reason="lock age ${age}s >= ${STATE_LOCK_STALE_AGE_SECONDS}s (no PID recorded to check liveness against)"
          fi
        fi
      fi

      if [[ "$stale" == "true" ]]; then
        rm -f "$STATE_LOCK_PID_FILE"
        if rmdir "$STATE_LOCK_DIR" 2>/dev/null; then
          echo "WARN: Recovered stale state lock ($stale_reason)." >&2
          continue
        fi
      fi
    fi

    if (( waited >= max_waits )); then
      echo "ERROR: Timed out waiting for state lock at $STATE_LOCK_DIR" >&2
      echo "If no batch-runner worker is active, remove the stale lock directory." >&2
      return 1
    fi

    sleep 0.1
    ((waited += 1))
  done
}

release_state_lock() {
  if [[ "${STATE_LOCK_OWNED:-0}" -ne 1 ]]; then
    return
  fi
  rm -f "$STATE_LOCK_PID_FILE" 2>/dev/null || true
  rmdir "$STATE_LOCK_DIR" 2>/dev/null || true
  STATE_LOCK_OWNED=0
}

run_with_state_lock() {
  acquire_state_lock || return $?

  local status=0
  if "$@"; then
    status=0
  else
    status=$?
  fi

  release_state_lock
  return "$status"
}

# Get status of an offer from state file
get_status() {
  local id="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "none"
    return
  fi
  local status
  status=$(awk -F'\t' -v id="$id" '$1 == id { print $3 }' "$STATE_FILE")
  echo "${status:-none}"
}

# Get retry count for an offer
get_retries() {
  local id="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "0"
    return
  fi
  local retries
  retries=$(awk -F'\t' -v id="$id" '$1 == id { print $9 }' "$STATE_FILE")
  echo "${retries:-0}"
}

# Read spend_tier from config/profile.yml. Defaults to "standard" if the key
# is absent or invalid.
read_spend_tier() {
  local raw=""

  if [[ -f "$PROFILE_FILE" ]]; then
    raw=$(
      awk -F: '
        /^[[:space:]]*spend_tier[[:space:]]*:/ {
          value = substr($0, index($0, ":") + 1)
          print value
          exit
        }
      ' "$PROFILE_FILE"
    )
    raw="${raw%%#*}"
    raw="${raw//$'\r'/}"
    raw="${raw#"${raw%%[![:space:]]*}"}"
    raw="${raw%"${raw##*[![:space:]]}"}"
    case "$raw" in
      \"*\") raw="${raw#\"}"; raw="${raw%\"}" ;;
      \'*\') raw="${raw#\'}"; raw="${raw%\'}" ;;
    esac
    raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  fi

  case "$raw" in
    economy|standard|premium)
      printf '%s\n' "$raw"
      ;;
    "")
      printf '%s\n' "standard"
      ;;
    *)
      echo "WARN: Invalid spend_tier \"$raw\" in ${PROFILE_FILE#"$PROJECT_DIR/"}; falling back to standard." >&2
      printf '%s\n' "standard"
      ;;
  esac
}

# Tier -> model mapping. Keep in sync with the table in modes/_shared.md.
spend_tier_to_model() {
  case "$1" in
    economy) echo "claude-haiku-4-5" ;;
    premium) echo "claude-opus-5" ;;
    standard|*) echo "claude-sonnet-5" ;;
  esac
}

# Resolve the model to pass to the worker CLI. --model always wins.
# spend_tier maps to Claude model names, so it only applies to --cli claude;
# other CLIs use --model verbatim, or their own default when it is unset.
resolve_worker_model() {
  if [[ -n "$MODEL" ]]; then
    RESOLVED_MODEL="$MODEL"
    RESOLVED_SPEND_TIER="override"
    return 0
  fi

  if [[ "$CLI" != "claude" ]]; then
    RESOLVED_MODEL=""
    RESOLVED_SPEND_TIER="cli-default"
    # The tier table above is Claude model names, so it cannot be applied to
    # another CLI -- but silently dropping it means a stated cost preference
    # is honoured for --cli claude and ignored everywhere else, with no sign
    # the budget changed. Surface it instead. "standard" is the default, so it
    # is only worth a warning when the user actually moved off it.
    local cfg_tier
    cfg_tier="$(read_spend_tier)"
    if [[ "$cfg_tier" != "standard" ]]; then
      echo "WARN: spend_tier '$cfg_tier' only maps to Claude model names, so it is" >&2
      echo "      NOT applied to --cli $CLI; the worker runs on this CLI's default model." >&2
      echo "      Pass --model <name> to pin one, or run with --cli claude to honor the tier." >&2
    fi
    return 0
  fi

  RESOLVED_SPEND_TIER="$(read_spend_tier)"
  RESOLVED_MODEL="$(spend_tier_to_model "$RESOLVED_SPEND_TIER")"
}

# Append a one-line, auditable record of a pre-screen-gate discard to
# batch/logs/discard.log (see modes/batch.md — Pre-screen gate). Format:
# {ISO8601 timestamp}\t{job id}\t{url}\t{reason}
log_discard() {
  local id="$1" url="$2" reason="$3"
  mkdir -p "$LOGS_DIR"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\t%s\t%s\t%s\n' "$ts" "$id" "$url" "$reason" >> "$DISCARD_LOG"
}

# Append a one-line record of an ADVISORY pre-screen result to
# batch/logs/prescreen.log. Format (tab-separated):
#   {ISO8601}\t{job id}\t{url}\t{verdict}\t{detail}
# where verdict is one of: jev, liveness, or skip:<reason>.
# This log is deliberately SEPARATE from discard.log: a Jev score is a weak prior
# that never discards anything, and mixing it into the discard log would make an
# advisory signal indistinguishable from a real filtering decision.
log_prescreen() {
  local id="$1" url="$2" verdict="$3" detail="$4"
  mkdir -p "$LOGS_DIR"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\t%s\t%s\t%s\t%s\n' "$ts" "$id" "$url" "$verdict" "$detail" >> "$PRESCREEN_LOG"
}

# opencode's headless `run` auto-rejects ANY tool touching a path outside the
# workspace (permission `external_directory`, ask -> auto-reject with no TTY).
# This runner's worker contract reads its prefetched JD from a mktemp path under
# ${TMPDIR:-/tmp} (see prefetch_jd), so without a scope granting /tmp the worker
# dies on the very first Read and produces no report. The web run route has
# always supplied this via OPENCODE_CONFIG_CONTENT (see
# web/src/lib/opencode-permission.mjs); the batch path did not, which is why a
# --cli opencode batch reported "completed" with no report on disk.
#
# The block is DERIVED from that same module rather than spelled out here, so the
# two launch paths cannot drift: claude-invocation.mjs owns the tool scope per
# run kind, opencode-permission.mjs owns the claude->opencode permission
# vocabulary. A batch worker evaluates and persists a report, so its scope is
# the "evaluate" kind -- Write+Edit+Bash plus read, matching the web worker.
opencode_permission_env() {
  command -v node >/dev/null 2>&1 || return 0
  # Absolute path: the runner is invoked from any cwd, and a relative import
  # would resolve against the caller's directory, not the repo root.
  PROJECT_DIR="$PROJECT_DIR" node -e '
    const { pathToFileURL } = await import("node:url");
    const { toolScopeFor } = await import(pathToFileURL(process.env.PROJECT_DIR + "/web/src/lib/claude-invocation.mjs"));
    const { opencodePermissionBlock } = await import(pathToFileURL(process.env.PROJECT_DIR + "/web/src/lib/opencode-permission.mjs"));
    const scope = toolScopeFor("evaluate");
    process.stdout.write(opencodePermissionBlock({ allowed: scope.allowed, disallowed: scope.disallowed }));
  ' 2>/dev/null
}

# Cheap deterministic ATS pre-screen (Jev) for ONE posting whose JD text is
# already on disk at $2. Purely advisory: it records a prior and never discards.
#
# Why advisory and not a gate: measured over 69 real postings in jds/, Jev's
# ats_pass_probability never reached 4.0 (max 3.82, median 2.98) while the
# mode's own rule demanded >= 4.0 -- a hard gate there would discard 100% of the
# pipeline. It correlates r=0.743 with the candidate's own A-F scores, which is
# useful for ranking and worthless as a cut-off. A 2.6 cut-off still drops 6
# roles the user actually applied to. So this returns text for the worker prompt
# and appends to prescreen.log; it does not gate.
#
# Fails open everywhere: a missing script, a missing key, a provider error, an
# unreadable resume, or an empty JD all return 0 and leave the job alone.
# Calibrated band thresholds, read once at startup and exported so the background
# prescreen subshells inherit them. Defaults are the measured cut points; the
# profile is authoritative when present.
JEV_BAND_LOW="2.26"
JEV_BAND_GUARDED="2.6"
JEV_BAND_MID="3.2"
read_gate_bands() {
  local profile="$PROJECT_DIR/config/profile.yml"
  [[ -f "$profile" ]] || return 0
  local block
  block="$(awk '/^jev_gate:[[:space:]]*$/{f=1;next} f&&/^[^[:space:]]/{f=0} f' "$profile" 2>/dev/null)" || return 0
  local v
  v="$(printf '%s\n' "$block" | sed -n 's/^[[:space:]]*band_low:[[:space:]]*\([0-9.]\+\).*/\1/p' | head -1)"
  [[ -n "$v" ]] && JEV_BAND_LOW="$v"
  v="$(printf '%s\n' "$block" | sed -n 's/^[[:space:]]*band_guarded:[[:space:]]*\([0-9.]\+\).*/\1/p' | head -1)"
  [[ -n "$v" ]] && JEV_BAND_GUARDED="$v"
  v="$(printf '%s\n' "$block" | sed -n 's/^[[:space:]]*band_mid:[[:space:]]*\([0-9.]\+\).*/\1/p' | head -1)"
  [[ -n "$v" ]] && JEV_BAND_MID="$v"
  # Explicit success. A bare `[[ -n "$v" ]] && X="$v"` evaluates to FALSE when the
  # key is absent, and under `set -e` that is a non-zero status at the end of a
  # function — which aborted the whole runner for any profile without a jev_gate
  # block, before a single worker launched. Missing bands must fall back to the
  # measured defaults, never end the run.
  return 0
}
export JEV_BAND_LOW JEV_BAND_GUARDED JEV_BAND_MID

prescreen_jev() {
  local id="$1" jd_file="$2" url="$3"
  local gatekeeper="$PROJECT_DIR/scripts/jev_gatekeeper.py"
  local resume="$PROJECT_DIR/cv.md"
  local py="${JEV_PYTHON:-python3}"

  [[ -f "$gatekeeper" && -f "$resume" ]] || {
    log_prescreen "$id" "$url" "skip:unavailable" "gatekeeper or cv.md missing"
    return 0
  }
  [[ -s "$jd_file" ]] || {
    log_prescreen "$id" "$url" "skip:no-jd-text" "JD prefetch produced no text (JS shell or curl absent)"
    return 0
  }
  command -v "$py" >/dev/null 2>&1 || {
    log_prescreen "$id" "$url" "skip:no-python" "$py not found"
    return 0
  }

  local out err rc errtext
  err="$(mktemp "${TMPDIR:-/tmp}/jev-err-${id}.XXXXXX")"
  out="$("$py" "$gatekeeper" "$resume" "$jd_file" triage 2>"$err")" && rc=0 || rc=$?
  # Read stderr BEFORE unlinking it: it carries provider/model/timing/usage, so
  # deleting the temp file first silently reported every call as metadata-free.
  errtext="$(cat "$err" 2>/dev/null)"
  rm -f "$err"
  if [[ $rc -ne 0 ]]; then
    local reason
    # jev_gatekeeper.py's fail() prints {"error": "..."} to STDOUT, not stderr,
    # so stdout is the only place the reason exists. Prefer it, fall back to
    # stderr for a traceback, and never let an empty reason hide the failure.
    reason="$(printf '%s' "$out" | tr '\n\t' '  ' | cut -c1-200 | sed 's/[[:space:]]*$//')"
    [[ "$reason" == "{"* || -n "$reason" ]] || reason="$(printf '%s' "$errtext" | tr '\n\t' '  ' | cut -c1-200 | sed 's/[[:space:]]*$//')"
    log_prescreen "$id" "$url" "skip:unavailable" "jev failed (rc=$rc): ${reason:-unknown}"
    return 0
  fi

  # stdout is {"ats_pass_probability": N, "has_core_skills": bool}. Parse both
  # streams in one node call; a malformed payload degrades to a logged skip
  # rather than a bash arithmetic error. This must NOT run in a pipeline: the
  # body of a pipeline is a subshell, so anything it assigns is discarded and the
  # caller would never see the result.
  # Pass the calibrated bands in as argv so the parser reads the same thresholds
  # as config/profile.yml (read above via read_gate_bands) instead of literals.
  local detail
  detail="$(node -e '
    const [out, err, bLow, bGuarded, bMid] = process.argv.slice(1);
    let d = {};
    try { d = JSON.parse(out); } catch (e) {
      process.stdout.write("skip:bad-json"); process.exit(0);
    }
    const score = Number(d.ats_pass_probability);
    if (!Number.isFinite(score)) { process.stdout.write("skip:no-score"); process.exit(0); }
    const core = d.has_core_skills === true ? "core-skills present" : "core-skills not established";
    const meta = {};
    for (const k of ["provider", "model", "http_ms", "total_ms"]) {
      const m = new RegExp("\\b" + k + "=(\\S+)").exec(err || "");
      if (m) meta[k] = m[1];
    }
    const u = /usage=(\{.+?\})/.exec(err || "");
    if (u) { try { const j = JSON.parse(u[1]); if (j.input_tokens != null) meta.in = j.input_tokens; if (j.output_tokens != null) meta.out = j.output_tokens; } catch (e) {} }
    // Bands come from the profile, never from literals here. A copy of the
    // thresholds in this file drifts the moment the calibration moves: the log
    // would keep calling a 2.26 "low" while every dashboard run called it
    // "guarded", with nothing to notice. Falls back to the measured defaults.
    const lo = Number(meta.band_low) || 2.26, gu = Number(meta.band_guarded) || 2.6, mi = Number(meta.band_mid) || 3.2;
    process.stdout.write(
      "score " + score.toFixed(2) + "/5, band " + (score < lo ? "low" : score < gu ? "guarded" : score < mi ? "mid" : "high") +
      ", " + core + (meta.provider ? ", via " + meta.provider : "") +
      (meta.total_ms ? ", " + meta.total_ms + "ms" : "") +
      (meta.in ? ", " + meta.in + "in/" + (meta.out || 0) + "out tokens" : "")
    );
  ' "$out" "$errtext" "$JEV_BAND_LOW" "$JEV_BAND_GUARDED" "$JEV_BAND_MID" 2>/dev/null)" || detail=""
  [[ -n "$detail" ]] || detail="skip:no-output"

  # The verdict column distinguishes a real score from a gate that could not
  # answer, so a reviewer scanning prescreen.log can tell "we scored this 1.6"
  # apart from "we never got a score". Both still proceed to full evaluation.
  case "$detail" in
    skip:*)
      log_prescreen "$id" "$url" "skip:unavailable" "${detail#skip:} (advisory gate produced no usable score)"
      ;;
    *)
      log_prescreen "$id" "$url" "jev" "$detail"
      echo "    🧪 Jev prior: $detail"
      ;;
  esac
  return 0
}

# ---------------------------------------------------------------------------
# Concurrent advisory pre-screen
#
# prescreen_jev is ~1s and ~2.7k input tokens per job and NOTHING reads its
# answer: the prior goes to prescreen.log for the audit trail and to the
# operator's screen. So it is run in the background and the worker continues
# immediately, instead of adding a second of latency per posting.
#
# Bounded by JEV_MAX_BG (default 4). Unbounded backgrounding would fire every
# gate call at once — with a few hundred pending postings that is hundreds of
# concurrent HTTPS requests for a gate whose only consumer is a log file.
#
# Bash 3.2 compatible: no `wait -n` (4.3+), no associative arrays (4.0+), no
# negative array indices (4.2+). The drain below polls `kill -0`, which is what
# `wait -n` would abstract over.
# ---------------------------------------------------------------------------
JEV_MAX_BG="${JEV_MAX_BG:-4}"
JEV_BG_PIDS=""
JEV_BG_COUNT=0

# Block until a slot frees. Spins rather than sleeps one fixed interval so an
# idle runner does not pay that interval per call.
jev_await_slot() {
  local spins=0
  while [ "$JEV_BG_COUNT" -ge "$JEV_MAX_BG" ]; do
    jev_reap
    if [ "$JEV_BG_COUNT" -lt "$JEV_MAX_BG" ]; then
      return 0
    fi
    sleep 0.2 2>/dev/null || sleep 1
    spins=$((spins + 1))
  done
  return 0
}

# Drop finished PIDs from the live set. Rebuilding the list rather than splicing
# in place keeps this correct on bash 3.2, where "${arr[@]:i}" wrap-around and
# array slicing behave differently than in 4.x.
jev_reap() {
  [ -n "$JEV_BG_PIDS" ] || return 0
  local kept="" pid
  for pid in $JEV_BG_PIDS; do
    if kill -0 "$pid" 2>/dev/null; then
      kept="$kept $pid"
    fi
  done
  JEV_BG_PIDS="${kept# }"
  JEV_BG_COUNT="$(printf '%s\n' $JEV_BG_PIDS | wc -w | tr -d ' ')"
  JEV_BG_PIDS="${JEV_BG_PIDS# }"
  return 0
}

jev_track() {
  JEV_BG_PIDS="$JEV_BG_PIDS $1"
  JEV_BG_COUNT=$((JEV_BG_COUNT + 1))
}

# Wait for every tracked gate call. Called before the tracker merge, before the
# summary, and on the exit path, so no prescreen.log line can land after the run
# reports "done" — a log that keeps growing after the summary is the exact shape
# of a truncated audit trail.
jev_drain() {
  [ -n "$JEV_BG_PIDS" ] || return 0
  local pid guard=0
  for pid in $JEV_BG_PIDS; do
    wait "$pid" 2>/dev/null
  done
  jev_reap
  # Belt-and-braces: if a PID was somehow not ours to wait on, poll it out rather
  # than let the shell reap it later at an arbitrary point.
  guard=0
  while [ -n "$JEV_BG_PIDS" ] && [ "$guard" -lt 600 ]; do
    jev_reap
    [ -n "$JEV_BG_PIDS" ] || break
    sleep 0.2 2>/dev/null || sleep 1
    guard=$((guard + 1))
  done
  JEV_BG_PIDS=""
  JEV_BG_COUNT=0
  return 0
}

# Sequential liveness pre-pass over the whole pending list, run ONCE before any
# worker is launched. This is the only automatic discard in the pipeline.
#
# Sequential by design: check-liveness.mjs must never run concurrently with
# itself (project rule -- a single shared browser), and the batch runner may be
# launched with --parallel > 1. Doing this up front keeps exactly one browser.
#
# Only a CONCLUSIVE "expired" discards. "uncertain" (a Cloudflare wall, a
# timeout, a JS-only board) proceeds to the full evaluation: a false discard
# costs a real opportunity, a wasted evaluation costs a few cents.
#
# Echoes one URL per line, tab-prefixed with "expired\t", for confirmed-dead
# postings only. A Jev score is never consulted here.
prescreen_liveness() {
  local -a urls=("$@")
  [[ ${#urls[@]} -gt 0 ]] || return 0
  command -v node >/dev/null 2>&1 || return 0
  [[ -f "$PROJECT_DIR/check-liveness.mjs" ]] || return 0

  local out
  # --no-fallback: a batch run is headless with no display, and a headed retry
  # would stall the whole queue. That reads as "uncertain", which is fail-open.
  out="$(node "$PROJECT_DIR/check-liveness.mjs" --no-fallback --throttle "${urls[@]}" 2>&1)" || true

  # Parse the report lines. The status is anchored to the leading icon so a URL
  # containing the literal word "expired" cannot be mistaken for a verdict.
  printf '%s\n' "$out" | node -e '
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => {
      for (const raw of data.split("\n")) {
        const m = /^(?:\u274c|\u26a0\ufe0f|\u2705)\s+(active|expired|uncertain)\s+(?:\(api\)\s+)?(\S+)/.exec(raw.trim());
        if (m && m[1] === "expired") process.stdout.write("expired\t" + m[2] + "\n");
      }
    });
  '
}


# Update or insert state for an offer.
# Caller must hold STATE_LOCK_DIR while this runs.
update_state_unlocked() {
  local id="$1" url="$2" status="$3" started="$4" completed="$5" report_num="$6" score="$7" error="$8" retries="$9"

  # batch-state.tsv is tab-separated with one row per line -- a literal tab,
  # newline, or carriage return inside $error (e.g. from a worker's raw error
  # text, or JSON.parse unescaping \n/\r/\t in a caller upstream) would split
  # into extra columns or extra rows and corrupt every row after it. Collapse
  # them to spaces centrally here so every caller is protected, not just the
  # one that happened to trigger this.
  error=${error//$'\r'/ }
  error=${error//$'\n'/ }
  error=${error//$'\t'/ }

  if [[ ! -f "$STATE_FILE" ]]; then
    init_state
  fi

  local tmp="$STATE_FILE.tmp"
  local found=false

  # Write header
  head -1 "$STATE_FILE" > "$tmp"

  # Process existing lines
  while IFS=$'\t' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries; do
    [[ "$sid" == "id" ]] && continue  # skip header
    if [[ "$sid" == "$id" ]]; then
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$id" "$url" "$status" "$started" "$completed" "$report_num" "$score" "$error" "$retries" >> "$tmp"
      found=true
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$sid" "$surl" "$sstatus" "$sstarted" "$scompleted" "$sreport" "$sscore" "$serror" "$sretries" >> "$tmp"
    fi
  done < "$STATE_FILE"

  if [[ "$found" == "false" ]]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$id" "$url" "$status" "$started" "$completed" "$report_num" "$score" "$error" "$retries" >> "$tmp"
  fi

  mv "$tmp" "$STATE_FILE"
}

update_state() {
  run_with_state_lock update_state_unlocked "$@"
}

# Durable last-resort records of state transitions that could NOT be written
# into $STATE_FILE (state-lock exhausted its retries). ONE FILE PER RECORD:
# each failed transition gets its own uniquely-named file via mktemp
# (O_CREAT|O_EXCL — atomic creation, guaranteed-unique name), so no two
# workers ever write to the same file and no shared-file truncate/append
# race can exist on any platform. That matters here because recovery writes
# are CORRELATED, not independent: they fire exactly when the state lock is
# jammed, which makes all parallel workers fail (and try to record) at the
# same moment — a shared recovery file is racing precisely when it is
# needed most (PR #2417 review). This mechanism must also never depend on
# the state lock that just failed, and it doesn't: creation is the only
# synchronization. reconcile_recovery_records() (start of the next run,
# single-threaded, before any worker spawns) merges each record into
# $STATE_FILE and deletes its file only on success — there is no
# rewrite-and-rename step, so nothing here needs cross-filesystem atomicity.
RECOVERY_DIR="$BATCH_DIR/batch-state-recovery.d"

append_recovery_record() {
  local id="$1" url="$2" status="$3" started="$4" completed="$5" report_num="$6" score="$7" error="$8" retries="$9"
  # Same rationale as update_state_unlocked: a literal tab/newline/CR in
  # $error would split this single-line record into extra fields or rows,
  # corrupting the record and the state row it later reconciles into.
  error=${error//$'\r'/ }
  error=${error//$'\n'/ }
  error=${error//$'\t'/ }
  # \x1f is used as the in-memory delimiter when this record is read back
  # (see reconcile_recovery_records); strip it here too so a stray unit
  # separator in $error can't inject a field boundary on the read side.
  error=${error//$'\x1f'/ }
  mkdir -p "$RECOVERY_DIR" || return 1
  local rec
  rec=$(mktemp "$RECOVERY_DIR/rec-XXXXXX") || return 1
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$id" "$url" "$status" "$started" "$completed" "$report_num" "$score" "$error" "$retries" > "$rec"
}

# A recovery record is ALWAYS older than whatever $STATE_FILE holds for the
# same id: the record is only written when the lock was unreachable, so any
# row present for that id now was written afterwards by a path that did reach
# the lock. Merging it blindly therefore rolls a finished offer backwards --
# the score and completed_at are overwritten, and since rate_limited and
# failed are NOT terminal, the offer re-enters pending selection in main()
# and gets evaluated a second time. Cost: one lost evaluation plus one
# duplicate run, on a path that by construction only fires when something
# already went wrong.
#
# Terminal set mirrors the pending-selection guard in main() exactly. Keep
# the two in sync: adding a terminal status there without adding it here
# reopens this rollback for that status.
recovery_record_is_superseded() {
  local current="$1"
  [[ "$current" == "completed" || "$current" == "skipped" ]]
}

# Merge one recovery record, but only into a row that has not already reached
# a terminal state. The status read happens INSIDE the lock deliberately: a
# check-then-write gap would let a worker finish between the two and
# reintroduce the same rollback. get_status is a lock-free reader (plain awk
# over $STATE_FILE), so calling it here does not re-enter the non-reentrant
# mkdir lock.
#
# Exit codes: 0 merged · 3 superseded (record is stale, caller should drop
# it) · anything else is a real failure. 3 avoids colliding with the 1 that
# acquire_state_lock returns when the lock itself is unreachable.
reconcile_one_unlocked() {
  local id="$1"
  local current
  current=$(get_status "$id")
  if recovery_record_is_superseded "$current"; then
    echo "    Superseded: offer id=$id already '$current' in state — discarding stale recovery record (would have rolled it back to '$3')."
    return 3
  fi
  update_state_unlocked "$@"
}

reconcile_one() {
  run_with_state_lock reconcile_one_unlocked "$@"
}

# Merge any recovery records left by a prior run into $STATE_FILE. Runs
# single-threaded at the very start of main(), before any worker is spawned,
# so there is no lock contention here — this is the one place these records
# are guaranteed a clean shot at the lock. Each record file is deleted only
# after its transition lands in $STATE_FILE (or is found to be superseded);
# genuine failures leave the file in place for the run after that.
reconcile_recovery_records() {
  [[ -d "$RECOVERY_DIR" ]] || return 0

  local -a rec_files=()
  local f
  for f in "$RECOVERY_DIR"/rec-*; do
    [[ -f "$f" ]] || continue
    rec_files+=("$f")
  done
  if (( ${#rec_files[@]} == 0 )); then
    rmdir "$RECOVERY_DIR" 2>/dev/null || true
    return 0
  fi

  echo "=== Reconciling ${#rec_files[@]} recovery record(s) from a prior interrupted run ==="
  local merged=0 superseded=0 still_failed=0
  local rid rurl rstatus rstarted rcompleted rreport rscore rerror rretries
  local rline
  local rc
  for f in "${rec_files[@]}"; do
    rline=""
    # Don't split with `IFS=$'\t' read`: tab is IFS *whitespace*, so a run of
    # tabs around an empty interior field (e.g. an empty completed_at on a
    # non-terminal record) collapses to one delimiter and every later field
    # shifts left, corrupting the merge. Read the line raw, then split on \x1f
    # (a non-whitespace unit separator that preserves empty fields) after
    # translating the on-disk tabs to it. Same rationale as process_offer.
    IFS= read -r rline < "$f" || true
    IFS=$'\x1f' read -r rid rurl rstatus rstarted rcompleted rreport rscore rerror rretries <<< "${rline//$'\t'/$'\x1f'}"
    if [[ -z "$rid" ]]; then
      echo "    WARN: discarding unreadable recovery record $f" >&2
      rm -f "$f"
      continue
    fi
    rc=0
    reconcile_one "$rid" "$rurl" "$rstatus" "$rstarted" "$rcompleted" "$rreport" "$rscore" "$rerror" "$rretries" || rc=$?
    if (( rc == 0 )); then
      rm -f "$f"
      merged=$((merged + 1))
    elif (( rc == 3 )); then
      # Stale by definition, not a failure — the row it targets already
      # finished. Dropping the file is correct; keeping it would retry the
      # same rollback on every subsequent run.
      rm -f "$f"
      superseded=$((superseded + 1))
    else
      still_failed=$((still_failed + 1))
    fi
  done

  echo "    Merged: $merged | Superseded: $superseded | Still unrecovered: $still_failed"
  if (( still_failed > 0 )); then
    echo "    WARN: $still_failed record(s) could not be merged even single-threaded — check $STATE_LOCK_DIR for a genuinely stuck lock. Unmerged records remain in $RECOVERY_DIR." >&2
  else
    rmdir "$RECOVERY_DIR" 2>/dev/null || true
  fi
}

# Retry wrapper around update_state. Bare `update_state ...` calls under
# `set -e` will silently kill the entire background worker subshell if a
# single lock-timeout failure propagates — this wrapper retries a few times
# and, if it still fails, falls back to append_recovery_record so the
# transition is never actually lost (only delayed until the next run's
# reconcile step), then logs a clear warning and returns non-zero so the
# CALLER can still decide whether to skip side effects that assumed success
# (found under --parallel 5 on Git Bash/Windows: ~47 of 50 jobs silently
# dropped in one run from exactly this before the retry+recovery-log fix).
update_state_retrying() {
  local attempt=0
  local max_attempts=3
  while (( attempt < max_attempts )); do
    if update_state "$@"; then
      return 0
    fi
    attempt=$((attempt + 1))
    if (( attempt < max_attempts )); then
      echo "    ⚠️  State update failed (attempt $attempt/$max_attempts), retrying in 2s..." >&2
      sleep 2
    fi
  done
  if append_recovery_record "$@"; then
    echo "    ⚠️  State update failed after $max_attempts attempts — offer id=$1 status=$3 recorded to $RECOVERY_DIR for reconciliation on next run." >&2
  else
    echo "    ❌ State update failed after $max_attempts attempts AND recovery-record write also failed — offer id=$1 status=$3 was NOT recorded anywhere. It will be retried as pending next run." >&2
  fi
  return 1
}

is_rate_limit_log() {
  local log_file="$1"
  grep -Eiq '(rate limit|rate_limit|too many requests|429|quota exceeded|try again later|temporarily unavailable)' "$log_file"
}

is_session_limit_log() {
  local log_file="$1"
  grep -Eiq '(session limit|resets [0-9:]+[ap]m|usage limit|limit[[:space:]]+reached)' "$log_file"
}

mark_paused_rate_limit() {
  local id="$1" url="$2" started_at="$3" report_num="$4" retries="$5" log_file="$6"
  local completed_at
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local error_msg
  error_msg=$(tail -5 "$log_file" 2>/dev/null | tr '\n' ' ' | cut -c1-200 || echo "session/rate limit reached")
  update_state_retrying "$id" "$url" "paused_rate_limit" "$started_at" "$completed_at" "$report_num" "-" "$error_msg" "$retries" || true
  printf '%s\t%s\t%s\n' "$id" "$report_num" "$error_msg" > "$PAUSE_FILE"
  BATCH_PAUSED=true
}

reserve_report_num_unlocked() {
  local id="$1" url="$2" started="$3" retries="$4"

  # Use the shared, cross-process-atomic reservation system (O_CREAT|O_EXCL
  # sentinel files in reserve-report-num.mjs) instead of the old bash-native
  # max(existing report files, batch-state.tsv numbers)+1 scan. The bash-native
  # version had zero visibility into reservations made by any OTHER process
  # calling `node reserve-report-num.mjs` directly -- e.g. an interactively
  # dispatched Agent evaluating one offer with a browser tool while a batch
  # run is in flight. Both could independently compute the same "next" number
  # and collide on disk. Found 2026-07-30: two separate collisions (report
  # 049, report 051) in one batch run for exactly this reason -- routing every
  # caller through the same node script means they all share one real lock.
  local report_num=""
  report_num=$(node "$PROJECT_DIR/reserve-report-num.mjs" 2>/dev/null | tr -d '[:space:]')
  if [[ -n "$report_num" ]]; then
    update_state_unlocked "$id" "$url" "processing" "$started" "-" "$report_num" "-" "-" "$retries"
  fi

  printf '%s\n' "$report_num"
}

# Release a report-number reservation via the shared atomic system. Safe to
# call even if the number was never actually reserved this way (e.g. a
# resumed/paused offer) -- the underlying script no-ops on a missing sentinel.
release_report_num() {
  local report_num="$1"
  [[ -n "$report_num" && "$report_num" != "-" ]] || return 0
  node "$PROJECT_DIR/reserve-report-num.mjs" --release "$report_num" >/dev/null 2>&1 || true
}

reserve_report_num() {
  run_with_state_lock reserve_report_num_unlocked "$@"
}

# Retry wrapper — same rationale as update_state_retrying above. A bare
# `x=$(reserve_report_num ...)` under `set -e` kills the worker subshell
# silently on a single lock-timeout; this retries and logs instead.
reserve_report_num_retrying() {
  local attempt=0
  local max_attempts=3
  local result=""
  while (( attempt < max_attempts )); do
    if result=$(reserve_report_num "$@"); then
      printf '%s\n' "$result"
      return 0
    fi
    attempt=$((attempt + 1))
    if (( attempt < max_attempts )); then
      echo "    ⚠️  Report-number reservation failed (attempt $attempt/$max_attempts), retrying in 2s..." >&2
      sleep 2
    fi
  done
  echo "    ❌ Report-number reservation failed after $max_attempts attempts for offer id=$1 — leaving it pending for next run." >&2
  return 1
}

# Process a single offer
process_offer() {
  local id="$1" url="$2" source="$3" notes="$4"

  local started_at
  started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local retries
  retries=$(get_retries "$id")
  local report_num
  if ! report_num=$(reserve_report_num_retrying "$id" "$url" "$started_at" "$retries"); then
    return 1
  fi
  local date
  date=$(date +%Y-%m-%d)
  # Use mktemp instead of a predictable /tmp path: a fixed name like
  # /tmp/batch-jd-${id}.txt is guessable, so an attacker on a shared machine
  # could pre-create it as a symlink and redirect or clobber the write.
  local jd_file
  jd_file="$(mktemp "${TMPDIR:-/tmp}/batch-jd-${id}.XXXXXX")"
  # The worker is a native process. Under Git Bash / MSYS the path above is a
  # POSIX one (/tmp/... or /c/...) that a Windows binary cannot open, so every
  # worker read "JD source unavailable" even when curl had filled the file.
  # cygpath -m yields C:/... which both bash and the worker resolve.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) command -v cygpath >/dev/null 2>&1 && jd_file="$(cygpath -m "$jd_file")" ;;
  esac

  # Pre-populate $jd_file with a static curl fetch so the worker reads HTML
  # directly instead of always falling through to WebFetch (#2492). WebFetch is
  # unreliable on JS-rendered boards (Phenom, Workday, iCIMS) because it hits
  # the rendered JS shell rather than the actual JD text. curl returns the raw
  # HTML in a single round-trip; for static boards that is exactly the JD.
  # For JS-rendered boards the file will be thin (JS shell only), which the
  # sufficiency check below detects — the file is then truncated to 0 bytes so
  # the worker's Step-1 WebFetch fallback fires exactly as designed.
  # If curl is absent or fails, $jd_file stays empty and WebFetch fires too.
  # Minimum visible word count to treat a fetched page as a real JD rather than
  # a JS shell. A JS app shell (Workday, Phenom, iCIMS) has near-zero visible
  # words after HTML stripping; a real JD has hundreds. 80 is a conservative
  # lower bound — any genuine posting has at least a title, summary, and a few
  # requirements, which together exceed 80 stripped words.
  local prefetch_min_words=80
  local jd_prefetch_words=0
  if command -v curl >/dev/null 2>&1; then
    # Reject loopback, link-local, and private-network destinations before curl
    # connects. --proto/--proto-redir restrict schemes but not destination IPs,
    # so a malicious offer URL could reach cloud metadata (169.254.169.254) or
    # internal services without this guard.
    local _url_safe
    local current_url="$url"
    local redirect_count=0
    local curl_status=0
    local redirect_headers
    local redirect_location
    while :; do
      _url_safe=$(node -e "
      try {
        const u = new URL(process.argv[1]);
        const h = u.hostname.toLowerCase().replace(/\.\$/, '');
        const blocked =
          h === 'localhost' || h === 'localhost.localdomain' ||
          h.endsWith('.local') || h.endsWith('.internal') ||
          h.includes(':') ||
          /^127\./.test(h) || /^169\.254\./.test(h) ||
          /^10\./.test(h) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h) ||
          /^192\.168\./.test(h) || /^0\./.test(h);
        process.stdout.write(blocked ? '0' : '1');
      } catch (e) { process.stdout.write('0'); }
      " "$current_url" 2>/dev/null)
      if [[ "$_url_safe" != "1" ]]; then
        echo "    ℹ️  JD prefetch: blocked — private/loopback destination ($current_url)"
        : > "$jd_file"
        break
      else
        redirect_headers="$(mktemp "${TMPDIR:-/tmp}/batch-jd-headers.XXXXXX")"
        curl_status=0
        curl --silent --show-error --location --max-redirs 0 \
          --max-time 20 --connect-timeout 5 \
          --fail --compressed \
          --proto '=http,https' --proto-redir 'https,http' --max-filesize 5000000 \
          --user-agent "Mozilla/5.0 (compatible; career-ops/batch)" \
          --header "Accept: text/html,application/xhtml+xml,*/*;q=0.8" \
          --dump-header "$redirect_headers" \
          --output "$jd_file" \
          -- "$current_url" 2>/dev/null || curl_status=$?
        redirect_location=""
        if [[ "$curl_status" -eq 47 ]]; then
          redirect_location="$(awk 'tolower($0) ~ /^location:[[:space:]]*/ { value=$0; sub(/^[^:]*:[[:space:]]*/, "", value) } END { print value }' "$redirect_headers")"
        fi
        rm -f "$redirect_headers"
        if [[ "$curl_status" -eq 47 && -n "$redirect_location" ]]; then
          if [[ "$redirect_count" -ge 10 ]]; then
            : > "$jd_file"
            echo "    ℹ️  JD prefetch: too many redirects — worker will WebFetch"
            break
          fi
          current_url="$(node -e "
            try { process.stdout.write(new URL(process.argv[2], process.argv[1]).href); }
            catch (e) { process.stdout.write(''); }
          " "$current_url" "$redirect_location" 2>/dev/null)"
          if [[ -z "$current_url" ]]; then
            : > "$jd_file"
            break
          fi
          redirect_count=$((redirect_count + 1))
          continue
        fi
        if [[ "$curl_status" -ne 0 ]]; then
          : > "$jd_file"
        fi
        break
      fi
    done
      # Strip HTML tags and count visible words to distinguish a real JD (hundreds
      # of words) from a JS shell (near zero visible text).
      jd_prefetch_words=$(node -e "
        const fs = require('fs');
        try {
          const text = fs.readFileSync(process.argv[1], 'utf-8')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&(nbsp|#160|#xa0);/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          fs.writeFileSync(process.argv[1], text);
          process.stdout.write(String(text.split(' ').filter(Boolean).length));
        } catch (e) { process.stdout.write('0'); }
      " "$jd_file" 2>/dev/null) || jd_prefetch_words=0
      # Ensure jd_prefetch_words is always a non-negative integer. A non-integer
      # (e.g. empty string, "NaN") would cause bash arithmetic to fail or
      # miscompare. Strip everything that is not a digit and default to 0.
      jd_prefetch_words="${jd_prefetch_words//[^0-9]/}"
      jd_prefetch_words="${jd_prefetch_words:-0}"
      if [[ "$jd_prefetch_words" -lt "$prefetch_min_words" ]]; then
        : > "$jd_file"
        echo "    ℹ️  JD prefetch: thin content (${jd_prefetch_words} words) — worker will WebFetch"
      else
        echo "    ℹ️  JD prefetch: ${jd_prefetch_words} words written to JD file"
      fi
  fi

  # Advisory ATS pre-screen on the JD text the prefetch above just materialized.
  # Records a prior for the audit trail and echoes it; it never gates. Costs
  # ~1s and ~2.7k input tokens per job, which is why it is not on the critical
  # path for anything that depends on the answer.
  #
  # Backgrounded ONLY when this worker is the main shell (PARALLEL=1). Under
  # --parallel N, process_offer runs as a subshell, so a jev call started here is
  # a child of THAT subshell: the parent's `wait` cannot reach it, and its
  # prescreen.log line could land after merge_tracker and print_summary have
  # already reported the run finished. And there is nothing to win there anyway
  # — N concurrent workers already mean N concurrent gate calls.
  if [[ "$PARALLEL" -le 1 ]]; then
    jev_await_slot
    prescreen_jev "$id" "$jd_file" "$url" &
    jev_track $!
  else
    prescreen_jev "$id" "$jd_file" "$url" || true
  fi

  echo "--- Processing offer #$id: $url (report $report_num, attempt $((retries + 1)))"

  # Build the prompt with placeholders replaced
  local prompt
  if [[ "$SKIP_PDF" == "true" ]]; then
    prompt="Process this job offer. Run the pipeline: A-G evaluation + report .md + tracker line. Do not generate PDF; write ❌ in the tracker PDF column and set \"pdf\": null in the final JSON."
    echo "    ⏭️  --skip-pdf set — skipping PDF generation for #$id ($url)"
  else
    prompt="Process this job offer. Run the full pipeline: A-G evaluation + report .md + optional PDF + tracker line."
  fi
  prompt="$prompt URL: $url"
  prompt="$prompt JD file: $jd_file"
  prompt="$prompt Report number: $report_num"
  prompt="$prompt Date: $date"
  prompt="$prompt Batch ID: $id"

  local log_file="$LOGS_DIR/${report_num}-${id}.log"

  # Prepare system prompt with placeholders resolved
  local resolved_prompt="$BATCH_DIR/.resolved-prompt-${id}.md"
  # Escape sed delimiter characters in variables to prevent substitution breakage
  local esc_url esc_jd_file esc_report_num esc_date esc_id
  esc_url="${url//\\/\\\\}"
  esc_url="${esc_url//|/\\|}"
  # In a sed replacement, & means "the whole match", so an unescaped & in a
  # query-string URL splices {{URL}} back in and corrupts the interpolation.
  esc_url="${esc_url//&/\\&}"
  esc_jd_file="${jd_file//\\/\\\\}"
  esc_jd_file="${esc_jd_file//|/\\|}"
  esc_report_num="${report_num//|/\\|}"
  esc_date="${date//|/\\|}"
  esc_id="${id//|/\\|}"
  sed \
    -e "s|{{URL}}|${esc_url}|g" \
    -e "s|{{JD_FILE}}|${esc_jd_file}|g" \
    -e "s|{{REPORT_NUM}}|${esc_report_num}|g" \
    -e "s|{{DATE}}|${esc_date}|g" \
    -e "s|{{ID}}|${esc_id}|g" \
    "$PROMPT_FILE" > "$resolved_prompt"

  # Inject user-layer personalization into the temporary worker prompt.
  # The resolved prompt is gitignored runtime state, so user profile data stays
  # out of the system layer while batch scoring matches interactive scoring.
  for context_file in "$PROJECT_DIR/modes/_profile.md" "$PROJECT_DIR/config/profile.yml" "$PROJECT_DIR/modes/_custom.md"; do
    if [[ -f "$context_file" ]]; then
      {
        printf '\n\n---\n\n'
        printf '## Runtime personalization: %s\n\n' "${context_file#"$PROJECT_DIR/"}"
        sed 's/^/    /' "$context_file"
        printf '\n'
      } >> "$resolved_prompt"
    fi
  done

  # Build the launch command for the configured CLI.
  # For claude the model is resolved once per run from spend_tier unless --model
  # was passed; other CLIs take --model verbatim. Building claude's command in an
  # array keeps quoting safe regardless.
  # --strict-mcp-config (with no --mcp-config) starts workers with no MCP
  # servers: they only evaluate offers and need none. Without it each parallel
  # worker inherits the parent session's MCP (e.g. Playwright) and they deadlock
  # fighting over the single shared browser when --parallel > 1 (issue #506).
  local -a claude_args=(-p --dangerously-skip-permissions --strict-mcp-config)
  if [[ -n "$RESOLVED_MODEL" ]]; then
    claude_args+=(--model "$RESOLVED_MODEL")
  fi
  claude_args+=(--append-system-prompt-file "$resolved_prompt" "$prompt")

  # Non-claude CLIs lack --append-system-prompt-file, so concatenate the
  # resolved system prompt and the per-job prompt into a single argument.
  # model_args is expanded with the ${arr[@]+"${arr[@]}"} idiom below: under
  # `set -u`, bash 3.2 (macOS /bin/bash) treats an empty array expansion as an
  # unbound variable and would abort every worker launched without --model.
  local full_prompt=""
  local -a model_args=()
  if [[ "$CLI" != "claude" ]]; then
    full_prompt="$(cat "$resolved_prompt")"$'\n\n'"$prompt"
    [[ -n "$MODEL" ]] && model_args=(--model "$MODEL")
  fi

  # Non-claude CLIs run a single attempt (explicit break after dispatch); the
  # rate-limit/session retry loop only applies to claude.
  local exit_code=0
  local terminal_failure_recorded=false
  local shim_retries=0
  local max_shim_retries=4
  while true; do
    exit_code=0
    case "$CLI" in
      claude)
        claude "${claude_args[@]}" > "$log_file" 2>&1 || exit_code=$?
        ;;
      opencode)
        if command -v opencode &>/dev/null; then
          opencode run ${model_args[@]+"${model_args[@]}"} "$full_prompt" > "$log_file" 2>&1 || exit_code=$?
        else
          ollama launch opencode ${model_args[@]+"${model_args[@]}"} -y -- run "$full_prompt" > "$log_file" 2>&1 || exit_code=$?
        fi
        ;;
      gemini)
        gemini ${model_args[@]+"${model_args[@]}"} -p "$full_prompt" > "$log_file" 2>&1 || exit_code=$?
        ;;
      qwen)
        qwen ${model_args[@]+"${model_args[@]}"} -p "$full_prompt" > "$log_file" 2>&1 || exit_code=$?
        ;;
    esac

    # Non-claude CLIs run a single attempt: the session-limit and rate-limit
    # detection below greps generic phrases (429, quota, session limit) that
    # another CLI's log could match by coincidence and pause or retry the batch.
    if [[ "$CLI" != "claude" ]]; then
      break
    fi

    if [[ $exit_code -eq 0 ]]; then
      break
    fi

    # Check for Claude Code npm shim swap (exit code 127 + command not found)
    if [[ $exit_code -eq 127 ]] && grep -qE "(claude: command not found|claude:.*not found|cannot find.*claude)" "$log_file" && (( shim_retries < max_shim_retries )); then
      shim_retries=$((shim_retries + 1))
      echo "    ⏳ Claude command not found (shim swap detected). Retrying in 30s (attempt $shim_retries/$max_shim_retries)..."
      sleep 30
      continue
    fi

    if is_session_limit_log "$log_file"; then
      mark_paused_rate_limit "$id" "$url" "$started_at" "$report_num" "$retries" "$log_file"
      echo "    ⏸️  Session/rate limit reached; pausing batch without consuming retry budget."
      terminal_failure_recorded=true
      break
    fi

    if is_rate_limit_log "$log_file" && (( retries < MAX_RETRIES )); then
      if (( RATE_LIMIT_SLEEP <= 0 )); then
        mark_paused_rate_limit "$id" "$url" "$started_at" "$report_num" "$retries" "$log_file"
        echo "    ⏸️  Rate limited and --rate-limit-sleep is 0; pausing batch without consuming retry budget."
        terminal_failure_recorded=true
        break
      fi
      retries=$((retries + 1))
      local retry_completed_at
      retry_completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      update_state_retrying "$id" "$url" "rate_limited" "$started_at" "$retry_completed_at" "$report_num" "-" "rate-limit; retrying after ${RATE_LIMIT_SLEEP}s" "$retries" || true
      echo "    ⏳ Rate limited (attempt $retries/$MAX_RETRIES). Waiting ${RATE_LIMIT_SLEEP}s before retry..."
      sleep "$RATE_LIMIT_SLEEP"
      continue
    fi

    break
  done

  # Cleanup resolved prompt and pre-fetched JD file
  rm -f "$resolved_prompt" "$jd_file"

  local completed_at
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [[ $exit_code -eq 0 ]]; then
    # A worker can exit 0 (no crash) but still self-report failure inside its
    # own JSON summary — e.g. it correctly declines to fabricate an evaluation
    # when the JD couldn't be extracted (Data Contract: never fabricate).
    # Without this check such offers were silently marked "completed" with no
    # report file on disk and score "-" (found 2026-07-29, offer id 6 / report
    # 019 — Deepgram JD unextractable in headless mode). Only the downstream
    # reconcile-pipeline.mjs safety net (which leaves an entry in Pending when
    # its report file is missing) prevented the offer from being lost.
    # Extract only the LAST ```json fenced block in the log -- that's the
    # worker's one authoritative final result (batch-prompt.md Step 6), not
    # arbitrary text anywhere else in stdout/stderr -- and parse it as real
    # JSON so an unrelated line merely containing the substring
    # `"status": "failed"` can never falsely flip a successful run.
    local worker_result_json
    worker_result_json=$(awk '
      /^```json[[:space:]]*$/ { in_block=1; block=""; next }
      in_block && /^```[[:space:]]*$/ { in_block=0; last=block; next }
      in_block { block = block $0 "\n" }
      END { printf "%s", last }
    ' "$log_file" 2>/dev/null || true)

    # Parse status, error, AND score from the same authoritative JSON object
    # in one pass -- score extraction used to be a separate sed regex over
    # the whole log (`.*"score":...`), which grabbed the first match
    # anywhere in the log rather than the one from this final result object,
    # producing a spurious score "-" whenever an earlier line in the log
    # (reasoning text, an intermediate example, Block D's "Comp score: 4/5"
    # mention, etc.) matched first. Reading it from the same parsed object
    # as status/error fixes both by construction -- there's only one place
    # left to look.
    local worker_failed_match="" worker_error_match="" score="-"
    if [[ -n "$worker_result_json" ]]; then
      local parsed
      parsed=$(printf '%s' "$worker_result_json" | node -e '
        let data = "";
        process.stdin.on("data", d => data += d);
        process.stdin.on("end", () => {
          try {
            const obj = JSON.parse(data);
            const status = typeof obj.status === "string" ? obj.status : "";
            const error = typeof obj.error === "string" ? obj.error : "";
            const score = typeof obj.score === "number" ? String(obj.score) : "";
            process.stdout.write(status + "\x1f" + error + "\x1f" + score);
          } catch {
            process.stdout.write("");
          }
        });
      ' 2>/dev/null || true)
      if [[ -n "$parsed" ]]; then
        # \x1f (US), not \t: tab is IFS *whitespace*, so bash collapses runs of it
        # and strips leading/trailing ones. On the common path -- a worker that
        # succeeded, so `error` is empty -- the two tabs around that empty field
        # collapse into one, `score` slides into parsed_error, and parsed_score
        # comes back empty. The `elif` below then never fires and every
        # successful offer records score "-". A non-whitespace delimiter gets
        # one-field-per-unit splitting with empty fields preserved.
        IFS=$'\x1f' read -r parsed_status parsed_error parsed_score <<< "$parsed"
        if [[ "$parsed_status" == "failed" ]]; then
          worker_failed_match="failed"
          worker_error_match="$parsed_error"
        elif [[ -n "$parsed_score" ]]; then
          score="$parsed_score"
        fi
      fi
    fi

    if [[ -n "$worker_failed_match" ]]; then
      [[ -z "$worker_error_match" ]] && worker_error_match="worker reported status:failed (exit code 0)"
      if (( retries < MAX_RETRIES )); then
        retries=$((retries + 1))
      fi
      update_state_retrying "$id" "$url" "failed" "$started_at" "$completed_at" "$report_num" "-" "$worker_error_match" "$retries" || true
      release_report_num "$report_num"
      echo "    ❌ Failed (worker-reported, attempt $retries): $worker_error_match"
      return 0
    fi

    # A worker can exit 0, self-report a non-"failed" status (or no parseable
    # JSON at all), and STILL never actually write the report file it claims
    # -- exit code and JSON status alone are not proof a report exists. Found
    # 2026-07-30: offer id 6/report 049 was marked "completed" this way with
    # no file on disk, silently freeing that number for a second, unrelated
    # offer to claim (a real collision). Verify the file before trusting
    # "completed" -- fail closed, not open.
    if [[ -z "$(compgen -G "$REPORTS_DIR/${report_num}-*.md")" ]]; then
      if (( retries < MAX_RETRIES )); then
        retries=$((retries + 1))
      fi
      update_state_retrying "$id" "$url" "failed" "$started_at" "$completed_at" "$report_num" "-" "worker exited cleanly but wrote no report file for this report number" "$retries" || true
      release_report_num "$report_num"
      echo "    ❌ Failed (no report file on disk, attempt $retries)"
      return 0
    fi

    # Check min-score gate
    if is_decimal_number "$score" && LC_ALL=C awk -v min="$MIN_SCORE" 'BEGIN{exit !(min > 0)}'; then
      # LC_ALL=C: under a non-English locale awk parses "4.5" as 4, so the
      # MIN_SCORE comparison would silently run on truncated integers.
      if LC_ALL=C awk -v score="$score" -v min="$MIN_SCORE" 'BEGIN{exit !(score < min)}'; then
        update_state_retrying "$id" "$url" "skipped" "$started_at" "$completed_at" "$report_num" "$score" "below-min-score" "$retries" || true
        release_report_num "$report_num"
        echo "    ⏭️  Skipped (score: $score < min-score: $MIN_SCORE)"
        return 0
      fi
    fi

    update_state_retrying "$id" "$url" "completed" "$started_at" "$completed_at" "$report_num" "$score" "-" "$retries" || true
    release_report_num "$report_num"
    echo "    ✅ Completed (score: $score, report: $report_num)"
  elif [[ "$terminal_failure_recorded" == "false" ]]; then
    if (( retries < MAX_RETRIES )); then
      retries=$((retries + 1))
    fi
    local error_msg
    error_msg=$(tail -5 "$log_file" 2>/dev/null | tr '\n' ' ' | cut -c1-200 || echo "Unknown error (exit code $exit_code)")
    update_state_retrying "$id" "$url" "failed" "$started_at" "$completed_at" "$report_num" "-" "$error_msg" "$retries" || true
    release_report_num "$report_num"
    echo "    ❌ Failed (attempt $retries, exit code $exit_code)"
  fi
}

# Merge tracker additions into applications.md
merge_tracker() {
  echo ""
  echo "=== Merging tracker additions ==="
  node "$PROJECT_DIR/merge-tracker.mjs"
  echo ""
  echo "=== Reconciling pipeline.md ==="
  node "$PROJECT_DIR/reconcile-pipeline.mjs" || echo "⚠️  Pipeline reconcile had issues (see above)"
  echo ""
  echo "=== Verifying pipeline integrity ==="
  node "$PROJECT_DIR/verify-pipeline.mjs" || echo "⚠️  Verification found issues (see above)"
}

# Print summary
print_summary() {
  echo ""
  echo "=== Batch Summary ==="

  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No state file found."
    return
  fi

  local total=0 completed=0 skipped=0 failed=0 pending=0
  local score_sum=0 score_count=0

  while IFS=$'\t' read -r sid _ sstatus _ _ _ sscore _ _; do
    [[ "$sid" == "id" ]] && continue
    total=$((total + 1))
    case "$sstatus" in
      completed) completed=$((completed + 1))
        if is_decimal_number "$sscore"; then
          score_sum=$(LC_ALL=C awk -v sum="$score_sum" -v score="$sscore" 'BEGIN{print sum + score}' 2>/dev/null || echo "$score_sum")
          score_count=$((score_count + 1))
        fi
        ;;
      skipped) skipped=$((skipped + 1)) ;;
      failed) failed=$((failed + 1)) ;;
      *) pending=$((pending + 1)) ;;
    esac
  done < "$STATE_FILE"

  echo "Total: $total | Completed: $completed | Skipped: $skipped | Failed: $failed | Pending: $pending"

  if (( score_count > 0 )); then
    local avg
    # LC_ALL=C: under e.g. a German locale awk formats "%.1f" as "4,5"
    # instead of "4.5", and a decimal comma breaks every downstream parser.
    avg=$(LC_ALL=C awk -v sum="$score_sum" -v count="$score_count" 'BEGIN{printf "%.1f", sum / count}' 2>/dev/null || echo "N/A")
    echo "Average score: $avg/5 ($score_count scored)"
  fi

  if [[ -f "$BATCH_DIR/aggregate-tokens.mjs" ]]; then
    if ! node "$BATCH_DIR/aggregate-tokens.mjs"; then
      echo "Warning: token aggregation failed." >&2
    fi
  fi
}

print_status_table() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No state file found at $STATE_FILE"
    return
  fi

  local total=0 completed=0 processing=0 failed=0 pending=0 skipped=0 rate_limited=0 paused_rate_limit=0
  local score_sum=0 score_count=0

  # Read first line to skip header
  local header=true
  while IFS=$'\t' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries || [[ -n "$sid" ]]; do
    if [[ "$header" == "true" ]]; then
      header=false
      continue
    fi
    [[ -z "$sid" ]] && continue
    sstatus="${sstatus%$'\r'}"
    sscore="${sscore%$'\r'}"
    serror="${serror%$'\r'}"
    sreport="${sreport%$'\r'}"
    total=$((total + 1))
    case "$sstatus" in
      completed)
        completed=$((completed + 1))
        if is_decimal_number "$sscore"; then
          score_sum=$(LC_ALL=C awk -v sum="$score_sum" -v score="$sscore" 'BEGIN{print sum + score}' 2>/dev/null || echo "$score_sum")
          score_count=$((score_count + 1))
        fi
        ;;
      processing) processing=$((processing + 1)) ;;
      failed) failed=$((failed + 1)) ;;
      skipped) skipped=$((skipped + 1)) ;;
      rate_limited) rate_limited=$((rate_limited + 1)) ;;
      paused_rate_limit) paused_rate_limit=$((paused_rate_limit + 1)) ;;
      *) pending=$((pending + 1)) ;;
    esac
  done < "$STATE_FILE"

  echo "=== Batch Progress ==="
  echo "Total: $total | Completed: $completed | Processing: $processing | Failed: $failed | Pending: $pending | Skipped: $skipped | Rate Limited: $rate_limited | Paused: $paused_rate_limit"
  if (( score_count > 0 )); then
    local avg
    # LC_ALL=C: under e.g. a German locale awk formats "%.1f" as "4,5"
    # instead of "4.5", and a decimal comma breaks every downstream parser.
    avg=$(LC_ALL=C awk -v sum="$score_sum" -v count="$score_count" 'BEGIN{printf "%.1f", sum / count}' 2>/dev/null || echo "N/A")
    echo "Average score: $avg/5 ($score_count scored)"
  fi
  echo ""

  # Format the per-job table:
  # Columns: ID, Status, Report, Score, Target (URL or Error Message)
  printf "%-4s | %-17s | %-6s | %-5s | %-40s\n" "ID" "Status" "Report" "Score" "URL / Error"
  printf "%-4s+%-19s+%-8s+%-7s+%-42s\n" "----" "-------------------" "--------" "-------" "------------------------------------------"

  header=true
  while IFS=$'\t' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries || [[ -n "$sid" ]]; do
    if [[ "$header" == "true" ]]; then
      header=false
      continue
    fi
    [[ -z "$sid" ]] && continue
    sstatus="${sstatus%$'\r'}"
    sscore="${sscore%$'\r'}"
    serror="${serror%$'\r'}"
    sreport="${sreport%$'\r'}"
    local target="$surl"
    if [[ "$sstatus" == "failed" && -n "$serror" && "$serror" != "-" ]]; then
      target="Error: $serror"
    fi
    # Trim target to fit nicely (e.g. 50 chars)
    if (( ${#target} > 50 )); then
      target="${target:0:47}..."
    fi
    printf "%-4s | %-17s | %-6s | %-5s | %-50s\n" "$sid" "$sstatus" "$sreport" "$sscore" "$target"
  done < "$STATE_FILE"
}

watch_status() {
  local active_pid=""
  if [[ -f "$LOCK_FILE" ]]; then
    active_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  fi

  if [[ -n "$active_pid" ]] && kill -0 "$active_pid" 2>/dev/null; then
    echo "Watching batch-runner (PID $active_pid)... Press Ctrl+C to stop."
    while kill -0 "$active_pid" 2>/dev/null; do
      clear || printf "\033[c"
      echo "=== Watching Batch Progress (PID $active_pid) ==="
      print_status_table
      sleep 2
    done
    echo ""
    echo "=== Batch runner process (PID $active_pid) has finished ==="
  else
    echo "No active batch-runner detected."
  fi

  echo "Showing final status:"
  print_status_table

  # Chain verify-pipeline.mjs
  if [[ -f "$PROJECT_DIR/verify-pipeline.mjs" ]]; then
    echo ""
    echo "=== Running pipeline verification ==="
    node "$PROJECT_DIR/verify-pipeline.mjs" || echo "⚠️  Verification found issues"
  fi
}

# Main
main() {
  if [[ "$STATUS_ONLY" == "true" ]]; then
    check_status_prerequisites
    print_status_table
    exit 0
  fi

  if [[ "$WATCH_MODE" == "true" ]]; then
    check_status_prerequisites
    watch_status
    exit 0
  fi

  check_prerequisites

  resolve_worker_model

  if [[ "$DRY_RUN" == "false" ]]; then
    acquire_lock
    rm -f "$PAUSE_FILE"
  fi

  init_state

  if [[ "$DRY_RUN" == "false" ]]; then
    reconcile_recovery_records
  fi

  # Count input offers (skip header, ignore blank lines)
  local total_input
  total_input=$(tail -n +2 "$INPUT_FILE" | grep -c '[^[:space:]]' 2>/dev/null || true)
  total_input="${total_input:-0}"

  if (( total_input == 0 )); then
    echo "No offers in $INPUT_FILE. Add offers first."
    exit 0
  fi

  echo "=== career-ops batch runner ==="
  if (( LIMIT > 0 )); then
    echo "Parallel: $PARALLEL | Max retries: $MAX_RETRIES | Limit: $LIMIT"
  else
    echo "Parallel: $PARALLEL | Max retries: $MAX_RETRIES"
  fi
  if [[ "$RESOLVED_SPEND_TIER" == "override" ]]; then
    echo "CLI: $CLI | Model: $RESOLVED_MODEL (explicit --model override)"
  elif [[ "$RESOLVED_SPEND_TIER" == "cli-default" ]]; then
    echo "CLI: $CLI | Model: $CLI default"
  else
    echo "CLI: $CLI | Model: $RESOLVED_MODEL (spend_tier=${RESOLVED_SPEND_TIER})"
  fi
  echo "Input: $total_input offers"
  echo ""

  # Build list of offers to process
  local -a pending_ids=()
  local -a pending_urls=()
  local -a pending_sources=()
  local -a pending_notes=()

  while IFS=$'\t' read -r id url source notes; do
    [[ "$id" == "id" ]] && continue  # skip header
    [[ -z "$id" || -z "$url" ]] && continue

    # Guard against non-numeric id values
    [[ "$id" =~ ^[0-9]+$ ]] || continue

    # Skip if before start-from
    if (( id < START_FROM )); then
      continue
    fi

    local status
    status=$(get_status "$id")

    if [[ "$RESUME_PAUSED" == "true" ]]; then
      if [[ "$status" != "paused_rate_limit" ]]; then
        continue
      fi
    elif [[ "$RETRY_FAILED" == "true" ]]; then
      # Only process failed offers
      if [[ "$status" != "failed" ]]; then
        continue
      fi
      # Check retry limit
      local retries
      retries=$(get_retries "$id")
      if (( retries >= MAX_RETRIES )); then
        echo "SKIP #$id: max retries ($MAX_RETRIES) reached"
        continue
      fi
    else
      # Skip terminal offers
      if [[ "$status" == "completed" || "$status" == "skipped" ]]; then
        continue
      fi
      # Paused rate-limit offers resume explicitly with --resume-paused.
      if [[ "$status" == "paused_rate_limit" ]]; then
        continue
      fi
      # Skip failed offers that hit retry limit (unless --retry-failed)
      if [[ "$status" == "failed" ]]; then
        local retries
        retries=$(get_retries "$id")
        if (( retries >= MAX_RETRIES )); then
          echo "SKIP #$id: failed and max retries reached (use --retry-failed to force)"
          continue
        fi
      fi
    fi

    if (( LIMIT > 0 )) && (( ${#pending_ids[@]} >= LIMIT )); then
      break
    fi

    pending_ids+=("$id")
    pending_urls+=("$url")
    pending_sources+=("$source")
    pending_notes+=("$notes")
  done < "$INPUT_FILE"

  local pending_count=${#pending_ids[@]}

  if (( pending_count == 0 )); then
    echo "No offers to process."
    print_summary
    exit 0
  fi

  echo "Pending: $pending_count offers"
  echo ""

  # Dry run: just list
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN (no processing) ==="
    for i in "${!pending_ids[@]}"; do
      local status
      status=$(get_status "${pending_ids[$i]}")
      echo "  #${pending_ids[$i]}: ${pending_urls[$i]} [${pending_sources[$i]}] (status: $status)"
    done
    echo ""
    echo "Would process $pending_count offers"
    exit 0
  fi

  # ---- Liveness pre-pass: the only automatic discard in the pipeline. --------
  # Runs once, sequentially, before any worker is launched. A confirmed-dead
  # posting would otherwise consume a full A-F evaluation (the most expensive
  # thing this runner does) to produce a report nobody should act on. A posting
  # that is merely UNCERTAIN is kept: a false discard loses a real opportunity,
  # while a wasted evaluation costs a fraction of a cent.
  #
  # Suppressed by --skip-liveness, which exists because a liveness pass needs
  # network and a browser and some users batch from an environment without either.
  if [[ "${SKIP_LIVENESS:-false}" != "true" ]]; then
    local -a alive_ids=() alive_urls=() alive_sources=() alive_notes=()
    local -a dead_ids=() dead_urls=()
    local -a liveness_urls=()
    for i in "${!pending_ids[@]}"; do
      liveness_urls+=("${pending_urls[$i]}")
    done

    echo "=== Liveness pre-pass (${#liveness_urls[@]} posting(s), sequential) ==="
    local liveness_report
    liveness_report="$(prescreen_liveness ${liveness_urls[@]+"${liveness_urls[@]}"})" || liveness_report=""
    local dead_count=0
    if [[ -n "$liveness_report" ]]; then
      while IFS=$'\t' read -r _verdict dead_url; do
        [[ -n "$dead_url" ]] || continue
        dead_count=$((dead_count + 1))
      done <<< "$liveness_report"
    fi
    echo "    confirmed dead: $dead_count (uncertain postings are kept)"

    for i in "${!pending_ids[@]}"; do
      local pid="${pending_ids[$i]}" purl="${pending_urls[$i]}"
      local is_dead="false"
      if [[ -n "$liveness_report" ]]; then
        while IFS=$'\t' read -r _verdict dead_url; do
          [[ -n "$dead_url" ]] || continue
          if [[ "$dead_url" == "$purl" ]]; then
            is_dead="true"
            break
          fi
        done <<< "$liveness_report"
      fi
      if [[ "$is_dead" == "true" ]]; then
        dead_ids+=("$pid")
        dead_urls+=("$purl")
        log_discard "$pid" "$purl" "confirmed dead posting (liveness pre-pass)"
        log_prescreen "$pid" "$purl" "liveness" "expired — discarded before worker launch"
        # Mark the row skipped so --resume and the summary agree with the discard.
        # update_state_unlocked reads all 9 positionals, and `set -u` turns a
        # short call into an unbound-variable abort. The posting never got a
        # report number or a score, so both stay "-".
        update_state "$pid" "$purl" "skipped" "-" "-" "-" "-" "liveness: posting confirmed expired" "0" 2>/dev/null \
          || log_prescreen "$pid" "$purl" "skip:state-write-failed" "discarded, but batch-state was not updated"
        echo "    ❌ #$pid $purl — dead, skipped (logged to logs/discard.log)"
      else
        alive_ids+=("$pid")
        alive_urls+=("$purl")
        alive_sources+=("${pending_sources[$i]}")
        alive_notes+=("${pending_notes[$i]}")
      fi
    done

    # ${arr[@]+"${arr[@]}"} rather than "${arr[@]}": under `set -u`, bash 3.2
    # (macOS /bin/bash) treats an empty array expansion as an unbound variable and
    # aborts -- which is exactly the all-dead case this block exists to handle.
    pending_ids=(${alive_ids[@]+"${alive_ids[@]}"})
    pending_urls=(${alive_urls[@]+"${alive_urls[@]}"})
    pending_sources=(${alive_sources[@]+"${alive_sources[@]}"})
    pending_notes=(${alive_notes[@]+"${alive_notes[@]}"})
    pending_count=${#pending_ids[@]}
    echo ""

    if (( pending_count == 0 )); then
      echo "All $dead_count pending posting(s) are closed — nothing left to evaluate."
      print_summary
      exit 0
    fi
  fi

  # Process offers
  if (( PARALLEL <= 1 )); then
    # Sequential processing
    for i in "${!pending_ids[@]}"; do
      process_offer "${pending_ids[$i]}" "${pending_urls[$i]}" "${pending_sources[$i]}" "${pending_notes[$i]}"
      if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
        echo "=== Batch paused: session/rate limit reached. Resume later with --resume-paused. ==="
        break
      fi
    done
  else
    # Parallel processing with job control
    local running=0
    local -a pids=()
    local -a pid_ids=()

    for i in "${!pending_ids[@]}"; do
      if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
        echo "=== Batch paused: session/rate limit reached. Waiting for running workers, not scheduling new offers. ==="
        break
      fi

      # Wait if we're at parallel limit
      while (( running >= PARALLEL )); do
        # Wait for any child to finish
        for j in "${!pids[@]}"; do
          if ! kill -0 "${pids[$j]}" 2>/dev/null; then
            wait "${pids[$j]}" 2>/dev/null || true
            unset 'pids[j]'
            unset 'pid_ids[j]'
            running=$((running - 1))
          fi
        done
        # Compact arrays
        pids=("${pids[@]}")
        pid_ids=("${pid_ids[@]}")
        if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
          echo "=== Batch paused: session/rate limit reached. Waiting for running workers, not scheduling new offers. ==="
          break
        fi
        sleep 1
      done

      if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
        break
      fi

      # Launch worker in background
      process_offer "${pending_ids[$i]}" "${pending_urls[$i]}" "${pending_sources[$i]}" "${pending_notes[$i]}" &
      pids+=($!)
      pid_ids+=("${pending_ids[$i]}")
      running=$((running + 1))
    done

    # Wait for remaining workers
    for pid in "${pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi

  # Drain advisory pre-screens BEFORE the tracker merge and the summary, so every
  # prescreen.log line for this run is on disk by the time the run reports done.
  jev_drain

  # Merge tracker additions
  merge_tracker

  # Print summary
  print_summary

  exit 0
}

main "$@"
