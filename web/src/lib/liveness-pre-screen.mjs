// liveness-pre-screen.mjs — zero-token "is this posting still open?" check for
// the dashboard run route, run BEFORE an expensive worker is launched.
//
// WHY THIS CAN STOP A RUN
// -----------------------
// A dead posting is the one cheap signal that is both certain and worth acting
// on. Jev ranks but cannot decide (see jev-pre-screen.mjs: 0/69 postings ever
// reached 4.0, so any cut-off cuts real roles). A liveness verdict is different:
// the posting is factually closed, so a full evaluation can only burn tokens to
// describe a page nobody can apply to.
//
// Measured over 30 real report URLs from this user's tracker: 9 active, 10
// expired, 11 uncertain — 33% dead. That is a third of the pipeline.
//
// WHY ONLY "expired" STOPS, AND ONLY WITHOUT A BROWSER FALLBACK
// --------------------------------------------------------------
// The dashboard gets the same policy as the batch liveness pre-pass:
//   * uncertain -> proceed. Wrongly blocking a live role is far more expensive
//     than evaluating a dead one, because the user is sitting watching one run.
//   * --no-fallback, so no browser is launched. This keeps the preflight fast
//     and token-free, and it means a verdict rests on one HTTP/ATS answer
//     rather than a heuristic scrape.
//   * A 404 without a browser check can also mean WAF/geo bot-blocking, so the
//     caller is expected to treat "expired" as stop-with-an-escape-hatch (the
//     run route's existing `force` flag), not as a silent kill.
//
// Fail-open by construction, same as jev-pre-screen: any spawn failure, timeout,
// or unparseable output returns decision "unavailable" and the evaluation
// proceeds untouched. This module never blocks a job search.

import { spawnSync } from "node:child_process";
import path from "node:path";

export const DEFAULTS = { timeoutMs: 20_000 };

/** Verdicts check-liveness.mjs can print, mapped from its line markers. */
const VERDICT_RE = /^\s*(?:❌\s*expired|✅\s*active|⚠️?\s*uncertain)\b/m;

/**
 * True for inputs this check understands. Anything else (a `local:` capture, a
 * bare report number, free text) is the caller's cue to skip entirely.
 * @param {string} input
 */
export function isCheckableUrl(input) {
  return typeof input === "string" && /^https?:\/\//i.test(input.trim());
}

/**
 * Parse check-liveness.mjs stdout into a verdict. Exported for tests: the
 * spawn is stubbed, so the parsing contract is what's actually under test.
 * @param {string} stdout
 * @returns {"active"|"expired"|"uncertain"|null}
 */
export function parseVerdict(stdout) {
  if (typeof stdout !== "string") return null;
  if (/^\s*❌\s*expired\b/m.test(stdout)) return "expired";
  if (/^\s*✅\s*active\b/m.test(stdout)) return "active";
  if (/^\s*⚠️?\s*uncertain\b/m.test(stdout)) return "uncertain";
  return null;
}

/** The indented reason line that follows the verdict, when present. */
function parseReason(stdout) {
  const m = /\n\s{2,}(\S[^\n]*)\n/.exec(stdout ?? "");
  return m ? m[1].trim() : null;
}

/**
 * Whether the verdict came from an ATS API rather than a direct fetch, read
 * from the "(N via API, ...)" summary. Parsed as a count, not matched as a
 * substring: "(0 via API" also contains the substring, which would have
 * reported every non-ATS URL as API-resolved.
 */
function parseViaApi(stdout) {
  const m = /\((\d+)\s+via API/.exec(stdout ?? "");
  return m ? Number(m[1]) > 0 : false;
}

/**
 * Ask check-liveness.mjs whether `url` is still open.
 *
 * @param {{url: string, root?: string, timeoutMs?: number}} opts — `root` is the
 *   career-ops data root that owns check-liveness.mjs.
 * @returns {{decision: "active"|"expired"|"uncertain"|"unavailable", verdict: string|null,
 *   reason: string|null, viaApi: boolean, wallMs: number, detail?: string}}
 */
export function livenessPreScreen({ url, root, timeoutMs = DEFAULTS.timeoutMs } = {}) {
  const started = Date.now();
  const base = { viaApi: false, reason: null, verdict: null };

  if (!isCheckableUrl(url)) {
    return { ...base, decision: "unavailable", wallMs: 0, detail: "not a url" };
  }

  const script = path.join(root ?? process.cwd(), "check-liveness.mjs");
  let res;
  try {
    res = spawnSync(process.execPath, [script, "--no-fallback", url], {
      encoding: "utf8",
      timeout: timeoutMs,
      cwd: root,
    });
  } catch (err) {
    return { ...base, decision: "unavailable", wallMs: Date.now() - started, detail: String(err?.message ?? err) };
  }

  const wallMs = Date.now() - started;
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;

  // Fail open on every abnormal shape: the flag itself, a spawn error, or
  // output with no verdict line all mean "we do not know", and "we do not
  // know" must never stop the run.
  if (res.error) {
    return { ...base, decision: "unavailable", wallMs, detail: res.error.message };
  }

  const verdict = parseVerdict(out);
  if (!verdict) {
    return { ...base, decision: "unavailable", wallMs, detail: "no verdict in output" };
  }

  return {
    decision: verdict,
    verdict,
    reason: parseReason(out),
    viaApi: parseViaApi(out),
    wallMs,
  };
}
