#!/usr/bin/env node
/**
 * jev-post-linter.mjs — Gate 3 wrapper (post-tailoring compliance audit)
 *
 * Wraps `scripts/jev_gatekeeper.py <resume> <job> linter`, which returns
 *     {"is_ai_sibling": bool, "has_measurable_metrics": bool}
 *
 * and turns it into one of three decisions:
 *
 *   pass          both fields present and benign -> compile the PDF
 *   halt          a real finding              -> do NOT compile; fix the CV
 *   unavailable   the gate could not answer   -> compile anyway (fail-open)
 *
 * WHY FAIL-OPEN, and why that is the safe direction
 * ------------------------------------------------
 * The two fields are strict booleans. scripts/jev_gatekeeper.py derives them
 * with an internal `>= 0.5` threshold over a non-boolean likelihood, so there
 * is no percentage to compare against and no "85% confidence" to tune — the
 * strict rule is simply:
 *
 *     halt  <=>  is_ai_sibling === true  ||  has_measurable_metrics === false
 *
 * Everything that is NOT that finding is `unavailable`, never `halt`: a missing
 * key, a non-boolean, malformed JSON, a provider 401/429/5xx, a timeout, a
 * missing script. That is deliberate. Gate 3 is an audit, and an audit that
 * silently swallows every CV when the provider has an outage would be strictly
 * worse than no audit — it would look like a working safety net while removing
 * the operator's PDFs. The trade is the other way: a gate that is uncertain
 * says so, and lets the human decide.
 *
 * That uncertainty is surfaced rather than swallowed, so a caller can log it.
 * See `describe()` — the reason travels with the decision.
 *
 * WHY THIS LIVES AT THE ROOT, NOT IN web/
 * ----------------------------------------
 * Both real callers (generate-master-cvs.mjs, and any root-side pipeline step)
 * are plain Node processes. web/src/lib/ is the dashboard's import boundary and
 * nothing outside web/ imports from it — every `web/src/lib` reference in a
 * root file is a comment or a test assertion. Putting this there would create a
 * root -> web/ import that does not exist anywhere else in the codebase.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** Matches the gatekeeper's own default, so a silent timeout is not our doing. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Apply the Gate 3 rule to a parsed linter payload.
 *
 * Pure and exported so the decision logic is testable without spawning anything.
 * The boolean identity checks are deliberate: `is_ai_sibling === true` rather
 * than a truthiness test, so a string "true" or the number 1 counts as
 * unavailable (the shape is not what the gate documents) instead of silently
 * halting a build.
 *
 * @param {unknown} payload Parsed JSON from the gatekeeper.
 * @returns {{decision: 'pass'|'halt'|'unavailable', reasons: string[], fields: object|null}}
 */
export function linterVerdict(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { decision: 'unavailable', reasons: ['gate returned no JSON object'], fields: null };
  }

  // scripts/jev_gatekeeper.py's fail() prints {"error": ...} to STDOUT and exits
  // non-zero. So an error arrives as valid JSON on the same channel as a verdict,
  // and a bare JSON.parse would read a failed audit as a completed one.
  if (payload.error) {
    return {
      decision: 'unavailable',
      reasons: [`gate error: ${String(payload.error).slice(0, 200)}`],
      fields: null,
    };
  }

  const { is_ai_sibling: sibling, has_measurable_metrics: metrics } = payload;

  if (typeof sibling !== 'boolean' || typeof metrics !== 'boolean') {
    const shape = `is_ai_sibling=${JSON.stringify(sibling)} has_measurable_metrics=${JSON.stringify(metrics)}`;
    return {
      decision: 'unavailable',
      reasons: [`gate returned non-boolean fields (${shape}) — treating as unaudited`],
      fields: null,
    };
  }

  const reasons = [];
  if (sibling) reasons.push('is_ai_sibling: true — draft reads as AI copy-paste; strip JD-matched blocks and rewrite those lines');
  if (!metrics) reasons.push('has_measurable_metrics: false — weak experience lines; insert structured metrics (e.g. "[Insert Metric - e.g., % reduction or X hours saved]")');
  if (reasons.length) return { decision: 'halt', reasons, fields: { sibling, metrics } };

  return { decision: 'pass', reasons: [], fields: { sibling, metrics } };
}

/** One-line human summary of a decision, for logs and console output. */
export function describe(result) {
  const label = `Gate 3 ${result.decision}`;
  return result.reasons.length ? `${label}: ${result.reasons.join('; ')}` : `${label}: clean`;
}

/**
 * Run Gate 3 against a tailored resume.
 *
 * @param {object} opts
 * @param {string} opts.resumePath  Path to the tailored resume (markdown).
 * @param {string} [opts.jobPath]   Target job description. Omitted for a lane
 *   set, which is not tailored to one posting.
 * @param {string} [opts.root]      Repo root holding scripts/jev_gatekeeper.py.
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.python]    Interpreter (default python3).
 * @returns {{decision: 'pass'|'halt'|'unavailable', reasons: string[], fields: object|null}}
 */
export function lintTailoredResume({ resumePath, jobPath, root = ROOT, timeoutMs = DEFAULT_TIMEOUT_MS, python = 'python3' } = {}) {
  const gatekeeper = join(root, 'scripts', 'jev_gatekeeper.py');

  if (!resumePath || !existsSync(resumePath)) {
    return { decision: 'unavailable', reasons: [`resume not found: ${resumePath ?? '(none given)'}`], fields: null };
  }
  if (!existsSync(gatekeeper)) {
    return { decision: 'unavailable', reasons: [`gatekeeper missing: ${gatekeeper}`], fields: null };
  }

  // The linter's whole job is comparing the CV against a job description.
  // Without one there is nothing to audit against, and inventing a comparison
  // (or silently passing) would report an audit that never happened.
  if (!jobPath) {
    return {
      decision: 'unavailable',
      reasons: ['no target job description supplied — a lane set is not tailored to one posting, so Gate 3 has nothing to compare against'],
      fields: null,
    };
  }
  if (!existsSync(jobPath)) {
    return { decision: 'unavailable', reasons: [`job description not found: ${jobPath}`], fields: null };
  }

  let proc;
  try {
    proc = spawnSync(python, [gatekeeper, resumePath, jobPath, 'linter'], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
  } catch (err) {
    return { decision: 'unavailable', reasons: [`gate spawn failed: ${String(err.message || err).slice(0, 200)}`], fields: null };
  }

  if (proc.error) {
    const timedOut = proc.error.code === 'ETIMEDOUT';
    return {
      decision: 'unavailable',
      reasons: [timedOut ? `gate timed out after ${timeoutMs}ms` : `gate could not run: ${String(proc.error.message || proc.error).slice(0, 200)}`],
      fields: null,
    };
  }

  const stdout = typeof proc.stdout === 'string' ? proc.stdout.trim() : '';
  if (!stdout) {
    const stderr = typeof proc.stderr === 'string' ? proc.stderr.trim().slice(0, 200) : '';
    return {
      decision: 'unavailable',
      reasons: [`gate produced no stdout (rc=${proc.status ?? 'null'})${stderr ? `: ${stderr}` : ''}`],
      fields: null,
    };
  }

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return { decision: 'unavailable', reasons: [`gate stdout was not JSON: ${stdout.slice(0, 200)}`], fields: null };
  }

  const verdict = linterVerdict(payload);
  // A non-zero exit with a parseable error object already carries the reason;
  // any other non-zero exit is still only a transport failure, never a finding.
  if (proc.status !== 0 && verdict.decision === 'pass') {
    return {
      decision: 'unavailable',
      reasons: [`gate exited ${proc.status} without a linter verdict`],
      fields: null,
    };
  }
  return verdict;
}

async function main(argv = process.argv.slice(2)) {
  const [resumePath, jobPath] = argv;
  if (!resumePath) {
    console.log('Usage: node jev-post-linter.mjs <resume.md> [job_description.txt]');
    console.log('Exits 0 on pass, 3 on halt, 0 on unavailable (fail-open).');
    return 0;
  }

  const result = lintTailoredResume({ resumePath, jobPath });
  console.log(describe(result));

  // Non-zero ONLY on a real finding, so a caller can gate compilation on the
  // exit status while a provider outage still exits 0 and never blocks a build.
  return result.decision === 'halt' ? 3 : 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main();
}
