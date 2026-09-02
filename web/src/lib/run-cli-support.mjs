// Plain .mjs (same pattern as tracker-table.mjs/clean-chips.mjs/spawn-cli.mjs)
// so tests/lib/run-cli-support.test.mjs can import it directly under Node. Import it
// with the .mjs extension included (e.g. "@/lib/run-cli-support.mjs" or
// "./run-cli-support.mjs") — unlike .ts files, which TypeScript resolves
// without an extension, ESM specifiers for plain JS modules must be fully
// specified.
import { isReservedReportFile } from "./report-files.mjs";

/**
 * Dashboard-friendly shape both `parseCodexEvent` and `parseClaudeEvent` return.
 * Usually at most one payload field (`tool`/`text`/`tokens`/`costUsd`/`error`) is
 * set per event; `status` may accompany any of them, and `tokens`/`costUsd` may
 * co-occur on a Claude `result` event.
 * `costUsd` is `number | null`: null is a REPORTED absence, not a missing field —
 * Codex sends usage with no cost, and callers must not fill that in with a rate.
 * @typedef {{status?: string, tool?: string, text?: string, tokens?: number, costUsd?: number | null, error?: string}} ParsedEvent
 */

const STATUS_READY = "Agent ready";
const STATUS_RECONNECTING = "Reconnecting…";

/**
 * Token accounting across CLIs — the two conventions are OPPOSITE, and the
 * formula is the only place that difference is visible (adapted from #2689,
 * which reached this from the accounting side).
 *
 * The dashboard's metric is TOKENS BILLED AT FULL RATE — `/api/usage/route.ts`
 * defines it as input + output + cache-creation, deliberately omitting
 * discounted cache reads.
 *
 *   Claude  `input_tokens` EXCLUDES cache reads (they live in
 *           `cache_read_input_tokens`), and cache writes are a separate pool
 *           billed at full rate. → input + output + cache_creation
 *   Codex   `input_tokens` INCLUDES `cached_input_tokens` (OpenAI's
 *           convention), so adding is double-counting and the cached portion
 *           must be SUBTRACTED. → (input − cached) + output
 *
 * Getting this wrong throws nothing and reddens no test — it silently inflates
 * one runtime against another (~4.7× on a real run) in the very comparison
 * people use to control cost.
 */

/**
 * A usage figure, or 0 — guards nulls and junk in a partial usage block.
 *
 * `isSafeInteger`, not `isFinite`: a token count is a whole number, so a
 * fractional value from a malformed event is junk and must not reach the total
 * (CodeRabbit's finding on #2689's `n`, whose shape this shares).
 */
function tokenCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Auth failures, in wording shared across agent CLIs. Deliberately narrow: a
 * structured-output CLI's own event stream + exit code are authoritative for
 * everything else, so a stderr classifier only needs to catch the failures that
 * produce no usable stream at all. */
const FATAL_AUTH_STDERR_RE =
  /unauthorized|forbidden|not authenticated|please log in|sign[ -]?in required|credential.*missing/i;

/** Quota/rate-limit failures — fatal like auth, EXCEPT when the line announces
 * its own retry: the CLI is handling it, and the run can still complete
 * cleanly. Same reasoning as CODEX_TRANSIENT_ERROR_RE, for the stderr channel —
 * flagging a self-retrying 429 fatal re-creates the false-red #2085 exists to
 * remove (sawError fails the honesty gate even on exit 0 with a written
 * report). Auth gets no such carve-out: it never heals by retrying. */
const FATAL_QUOTA_STDERR_RE = /quota|rate limit/i;
// Only a retry the CLI ANNOUNCES AS IN PROGRESS ("retrying", "retry in 5s",
// "will retry") — a bare /retry/ would also match terminal wording like
// "do not retry" or "retry limit exhausted" and silence a genuine failure.
const RETRYING_STDERR_RE = /retrying|retry\s+in\b|will\s+retry/i;
const isFatalQuotaStderr = (line) => FATAL_QUOTA_STDERR_RE.test(line) && !RETRYING_STDERR_RE.test(line);

/** Claude Code's own wording for the same class of failure. */
const CLAUDE_FATAL_STDERR_RE = /invalid api key|please run \/login|credit balance|usage limit reached/i;

/** Codex `error` events that it recovers from on its own (see parseCodexEvent). */
const CODEX_TRANSIENT_ERROR_RE = /reconnect/i;

/**
 * Whether one Codex stderr chunk should be treated as a fatal error.
 *
 * Codex can emit benign ERROR-level diagnostics (e.g. a stale local model-cache
 * schema) and still complete successfully, so anything outside the auth/quota
 * set is left to its JSONL stream and exit code — and even a quota/rate-limit
 * line is non-fatal while it says the CLI is retrying.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isFatalCodexStderr(line) {
  return FATAL_AUTH_STDERR_RE.test(line) || isFatalQuotaStderr(line);
}

/**
 * Whether one Claude Code stderr chunk should be treated as a fatal error.
 *
 * Same reasoning as `isFatalCodexStderr`: Claude also has a structured stream
 * and a meaningful exit code, so the generic "contains the word error" fallback
 * would fail runs that actually succeeded — and a self-retrying rate limit gets
 * the same transient carve-out. Claude's own wording (invalid key, /login,
 * credit/usage limits) is always hard: none of those heal by retrying.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isFatalClaudeStderr(line) {
  return FATAL_AUTH_STDERR_RE.test(line) || CLAUDE_FATAL_STDERR_RE.test(line) || isFatalQuotaStderr(line);
}

/**
 * Fallback classifier for a CLI with no `stderrIsFatal` of its own.
 *
 * Only claude and codex define one, so SIX of the eight entries in KNOWN reach
 * this path — including every runtime people pick to spend less than they would
 * on those two.
 *
 * The terms are ANCHORED. Unanchored, `auth` matched inside ordinary words and a
 * successful run got reported as failed because a word appeared:
 *
 *   "Authentication successful"   → fatal    ← a SUCCESS message
 *   "warning: no author found"    → fatal    ← "auth" inside "author"
 *   "fetching author metadata"    → fatal
 *   "Errors: 0"                   → fatal
 *
 * That is the same failure #2085 exists to remove, on the path #2102 left
 * untouched. Found by @gregaro in #1974.
 *
 * Anchoring, NOT narrowing: `not authenticated` and `authentication failed`
 * still match, and the multi-word phrases keep no `\b` because they cannot
 * collide with prose. Lives here rather than inline in route.ts so it can be
 * tested — the reason the drift went unnoticed is that a regex in a .ts closure
 * had no reachable test.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isFatalGenericStderr(line) {
  return GENERIC_FATAL_STDERR_RE.test(line);
}

const GENERIC_FATAL_STDERR_RE =
  /\berror\b|\bdenied\b|\bfatal\b|not found|\bunauthorized\b|\bforbidden\b|not authenticated|authentication failed|\blogin\b|log in|\bcredentials?\b|api[ -]?key|\bquota\b|rate limit/i;

/**
 * The argv that makes `codex exec` emit the JSONL `parseCodexEvent` reads.
 *
 * Lives beside that parser rather than inline in clis.ts because the two are one
 * contract: `--json` is what produces the events, and `--color never` keeps ANSI
 * escapes out of the JSON strings. A caller that wants plain text must use
 * `CliSpec.args` instead — every non-dashboard surface reads codex's stdout
 * directly (`<<offer:>>`/`<<cv:>>` envelopes, the apply planners' JSON array).
 *
 * @param {string} prompt
 * @returns {string[]}
 */
export function codexStreamArgs(prompt) {
  return ["exec", "--json", "--color", "never", prompt];
}

/**
 * Convert one `codex exec --json` JSONL event into dashboard-friendly data.
 * @param {string} line
 * @returns {ParsedEvent | null}
 */
export function parseCodexEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  // JSON.parse("null") SUCCEEDS and yields null, and a bare scalar line yields a
  // number or string — none of which the try above rejects, so reading `.type`
  // off them throws past this function into the stdout handler. A parser written
  // to survive hostile input has to survive its own success cases too.
  if (!event || typeof event !== "object") return null;

  if (event.type === "thread.started") return { status: STATUS_READY };
  // Kind-agnostic on purpose: this parser serves every run kind (evaluate, pdf,
  // research, fix-portal), so the status must not claim one of them.
  if (event.type === "turn.started") return { status: "Agent working" };

  if (event.type === "item.started") {
    const type = event.item?.type;
    if (type === "command_execution") return { tool: "Bash" };
    if (type === "web_search") return { tool: "WebSearch" };
    if (type === "mcp_tool_call") return { tool: event.item?.tool || "Working" };
  }

  if (event.type === "item.completed" && event.item?.type === "agent_message") {
    // Empty text carries nothing: emitting it would put a blank line in the run
    // log and an extra newline inside pdf mode's line-anchored envelope stream.
    if (typeof event.item.text !== "string" || event.item.text === "") return null;
    // Newline-terminate each message: Codex sends complete messages with NO
    // trailing newline ("hello", not "hello\n"), so consecutive messages would
    // otherwise concatenate mid-line downstream. That glued narration into one
    // run-on log line AND broke pdf mode outright — the <<cv-html>> markers are
    // line-anchored by design (cv-envelope.mjs, fail-closed), so an envelope
    // message following unterminated narration parsed as "no envelope" and the
    // honesty gate failed a run whose CV was fully emitted.
    const text = event.item.text;
    return { text: text.endsWith("\n") ? text : text + "\n" };
  }

  if (event.type === "turn.completed") {
    // No `usage` block means nothing to report — return null rather than a
    // {tokens: 0}, so the caller's `typeof === "number"` guard skips it instead
    // of clobbering a correct running total from an earlier turn.
    if (!event.usage) return null;
    const usage = event.usage;
    // Subtraction, not addition: see the header note on the two conventions.
    // Clamped at 0 so a malformed usage block can never report negative tokens.
    const fresh = Math.max(0, tokenCount(usage.input_tokens) - tokenCount(usage.cached_input_tokens));
    // costUsd stays null rather than being invented from a token count and a
    // guessed rate — Codex reports no cost, and a fabricated one reads as real.
    return { tokens: fresh + tokenCount(usage.output_tokens), costUsd: null };
  }

  if (event.type === "turn.failed" || event.type === "error") {
    const message = String(event.error?.message || event.message || "Codex failed before finishing");
    // `turn.failed` is terminal by definition, but a bare `error` event also
    // carries transient conditions Codex recovers from — a "Reconnecting..."
    // notice mid-run would otherwise flag the whole run as failed even though
    // the turn goes on to complete. Report it as progress, not as an error.
    if (event.type === "error" && CODEX_TRANSIENT_ERROR_RE.test(message)) return { status: STATUS_RECONNECTING };
    return { error: message };
  }

  return null;
}

/**
 * Convert one Claude Code `--output-format stream-json` line into the same
 * dashboard-friendly shape `parseCodexEvent` produces.
 * @param {string} line
 * @returns {ParsedEvent | null}
 */
export function parseClaudeEvent(line) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  // Same reason as parseCodexEvent's guard: JSON.parse("null") succeeds.
  if (!ev || typeof ev !== "object") return null;

  if (ev.type === "stream_event") {
    const e = ev.event;
    if (e?.type === "content_block_start" && e.content_block?.type === "tool_use") {
      return { tool: e.content_block.name };
    }
    if (e?.type === "content_block_delta" && e.delta?.text) {
      return { text: e.delta.text };
    }
    return null;
  }

  if (ev.type === "system" && ev.subtype === "init") {
    return { status: STATUS_READY };
  }

  if (ev.type === "result") {
    // Usage first, so a FAILED result still reports what it burned — the tokens
    // were spent either way, and dropping them undercounts exactly the runs a
    // user most wants to see the cost of.
    const result = {};
    if (ev.usage) {
      // Addition here, subtraction for Codex — see the header note. Claude's
      // input_tokens excludes cache reads, so cache writes must be added back
      // in; this is the same formula /api/usage uses.
      const u = ev.usage;
      result.tokens = tokenCount(u.input_tokens) + tokenCount(u.output_tokens) + tokenCount(u.cache_creation_input_tokens);
      if (typeof ev.total_cost_usd === "number") result.costUsd = ev.total_cost_usd;
    }
    // A terminal failure, the counterpart of parseCodexEvent's turn.failed. The
    // route's gate would otherwise have to infer this from the exit code alone,
    // and a non-zero exit is not guaranteed — a run that failed while exiting 0
    // would be banked as a confident score, the dishonest-success case this
    // whole file exists to prevent. `is_error` is the authoritative flag;
    // subtype is checked by PREFIX because the real values are
    // `error_max_turns` / `error_during_execution`, never a bare "error".
    if (ev.is_error === true || (typeof ev.subtype === "string" && ev.subtype.startsWith("error"))) {
      // `result` carries the final text and is empty on failure, so it is only a
      // fallback; the subtype names the failure when no diagnostic is supplied.
      const diagnostic =
        (typeof ev.error === "string" && ev.error) ||
        (typeof ev.result === "string" && ev.result) ||
        (typeof ev.subtype === "string" && ev.subtype) ||
        "Claude failed before finishing";
      result.error = String(diagnostic);
    }
    // Null over an empty object: nothing to report must not look like an event.
    return Object.keys(result).length > 0 ? result : null;
  }

  return null;
}

/**
 * Fold one parsed event's token count into a running total. `turn.completed`
 * (Codex) and `result` (Claude) usage is per-event, not cumulative-since-start,
 * so callers must accumulate across multiple events in one run rather than
 * overwrite — otherwise a multi-turn run silently undercounts.
 *
 * @param {number} current
 * @param {ParsedEvent | null | undefined} ev
 * @returns {number}
 */
export function accumulateTokens(current, ev) {
  return typeof ev?.tokens === "number" ? current + ev.tokens : current;
}

/**
 * Completed report filenames from a raw `reports/` listing.
 * Reservation sentinels are not completed reports — `isReservedReportFile` is
 * the single definition of that convention, shared with career-ops.ts.
 *
 * @param {string[]} entries
 * @returns {Set<string>}
 */
export function completedReportNames(entries) {
  return new Set(entries.filter((name) => name.endsWith(".md") && !isReservedReportFile(name)));
}

/**
 * Whether `afterEntries` contains a completed report name absent from
 * `beforeEntries` — i.e. persistence actually happened, as opposed to a
 * `NNN-RESERVED.md` sentinel merely being replaced or churned.
 * @param {string[]} beforeEntries
 * @param {string[]} afterEntries
 * @returns {boolean}
 */
export function hasNewCompletedReport(beforeEntries, afterEntries) {
  const before = completedReportNames(beforeEntries);
  const after = completedReportNames(afterEntries);
  for (const name of after) {
    if (!before.has(name)) return true;
  }
  return false;
}

// Graceful-SIGTERM budget (ms) for a run, kept safely under the route's 800s
// maxDuration. pdf reserves headroom for its post-agent render+mark phase; a
// plain evaluate has no such phase, so it gets nearly the whole budget. The old
// 285s evaluate floor killed real evaluations mid-run — ~25 Bash calls plus web
// searches routinely run longer — and the kill then misreported as "didn't save
// a report" (#3124).
export const RUN_MAX_DURATION_S = 800;
export function killMsForKind(kind) {
  return kind === "pdf" ? 600_000 : 780_000;
}

// Message for a run the route stopped at its own time limit. It names the limit,
// offers a re-run / Claude Code, and DELIBERATELY never says the CLI "didn't save
// a report": a timeout and a CLI that couldn't write are different failures, and
// blaming the CLI sends the user to re-check the wrong thing (#3124).
export function timeoutMessage(killMs, kind) {
  return `This run passed the ${Math.round(killMs / 1000)}s time limit and was stopped before it could finish — re-run it, or run a very long ${kind} on Claude Code directly. The CLI was working; we cut it off, so it isn't recorded as a result.`;
}
