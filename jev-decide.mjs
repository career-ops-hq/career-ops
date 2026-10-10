#!/usr/bin/env node
/**
 * jev-decide.mjs — Envelope B System One screen: run the atomic-core Block
 * A/D/G question set through JEVE's decide mode and emit a deterministic
 * Machine Summary machine-facts envelope.
 *
 * WHY THIS EXISTS
 *   The web evaluate lane and the batch runner both need the bounded-enum
 *   machine fields (legitimacy_tier, risk_level, work_auth, archetype) DECIDED
 *   deterministically BEFORE the generative worker is nudged to write only its
 *   residual prose slots. scripts/jev_gatekeeper.py owns the decide channel;
 *   this is the thin I/O seam that answers it (state = cv.md + JD), decodes the
 *   answers with lib/jev-atomic-core.mjs, maps them into the Machine Summary
 *   vocabulary with lib/jev-machine-summary.mjs, and prints (optionally writes)
 *   the envelope a caller can hand both to run-prompts.mjs (the truncated
 *   prompt) and to jev-inject.mjs (the post-run compose).
 *
 * Root level, NOT scripts/: the web layer reaches core scripts through
 * runCoreScript() -> rootScript() (web/src/lib/career-ops.ts), which resolves
 * `<careerOpsRoot>/<name>.mjs` and nothing else.
 *
 * FAIL-OPEN BY CONSTRUCTION
 *   A missing file, a missing Python, a provider outage, a malformed response —
 *   every failure path prints {"status":"unavailable", reason} and exits 0.
 *   The run must proceed unchanged (legacy hand-written Machine Summary) if the
 *   envelope does not exist. The callers gate on status === "ok".
 *
 * TEST SEAM
 *   JEV_PYTHON overrides the interpreter (batch-runner.sh already honors this
 *   name); JEV_GATEKEEPER_PY overrides the gatekeeper script path so tests can
 *   point it at a stub that prints a canned decide JSON.
 *
 * Usage:
 *   node jev-decide.mjs --jd <jdFile> [--resume <cvFile>] [--out <envelopePath>]
 *                       [--python <interpreter>] [--timeout-ms <ms>]
 *
 * `--timeout-ms` is the budget for the gatekeeper subprocess and falls straight
 * through to the spawnSync bridge; a slow network frame is killed at that
 * budget and reported as {"status":"unavailable"} (reason: "... timed out ...").
 * Invalid values are a usage error (exit 2) — they must never silently leave
 * the subprocess without a timeout.
 *
 * CONFIDENCE ESCALATION (Item 2)
 *   After decoding, the critical categorical decisions (the `choice` questions
 *   that map to a Machine Summary enum) whose confidence sits below the
 *   DEFAULT_CONFIDENCE_FLOOR are re-decided ONE KEY AT A TIME through an
 *   isolated micro-LLM string evaluation (gatekeeper `--micro`), bypassing any
 *   full generative regeneration. Set JEV_MICRO=1 to enable the subprocess
 *   channel; callers may instead inject `runMicro(payload)` directly. The
 *   escalation is fully advisory: below-floor keys with no evaluator, a failed
 *   call, or an option the question itself does not list keep their original
 *   decision, and the envelope records `escalation` only when it has targets.
 *
 * Prints the envelope JSON on stdout always.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { questionsForBlocks } from './lib/jev-atomic-core.mjs';
import { decodeAnswers } from './lib/jev-atomic-core.mjs';
import { criticalCategoricalDecisions } from './lib/jev-atomic-core.mjs';
import { escalateCriticalCategories } from './lib/jev-atomic-core.mjs';
import { machineSummaryForJev } from './lib/jev-machine-summary.mjs';
import { riskSummaryLegitimacyFromJev } from './lib/jev-machine-summary.mjs';
import { confidenceFromJevConfidence } from './lib/jev-machine-summary.mjs';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;

/** Fallback subprocess budget when no --timeout-ms and no env override. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** The Block A/D/G question set the envelope is decided from. */
export function envelopeQuestions() {
  return questionsForBlocks(['A', 'D', 'G']);
}

/**
 * `--timeout-ms`/env normalization: a positive finite integer or the given
 * fallback. An invalid value is never allowed to silently disable the timeout
 * (NaN makes spawnSync run forever); it falls back instead.
 */
function normalizeTimeout(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Turn decoded answers + the gatekeeper response into the envelope. Exported
 * for the test suite; pure over its inputs. `escalation` is the advisory trace
 * of the confidence escalation (Item 2) and is included ONLY when it has
 * targets to report, so a run that never needed escalation is byte-identical
 * to a pre-escalation envelope.
 */
export function buildEnvelope({ decoded, gatekeeper, questions, escalation }) {
  const machine = machineSummaryForJev(decoded);
  const confidences = Object.values(decoded)
    .map((d) => d?.confidence)
    .filter((c) => typeof c === 'number' && Number.isFinite(c));
  const confidence = confidenceFromJevConfidence(confidences) ?? 'Low';

  const factBits = [];
  const tier = machine.legitimacy_tier;
  if (tier) factBits.push(`Block G legitimacy: ${tier}`);
  if (machine.archetype) factBits.push(`archetype: ${machine.archetype}`);
  if (machine.risk_level) factBits.push(`risk level: ${machine.risk_level}`);
  if (machine.work_auth) factBits.push(`work authorization: ${machine.work_auth}`);

  const envelope = {
    status: 'ok',
    decision_count: Object.keys(decoded).length,
    question_names: Object.keys(questions),
    machine,
    legitimacy_key: riskSummaryLegitimacyFromJev(decoded),
    confidence,
    confidence_count: confidences.length,
    provider: gatekeeper?.provider ?? null,
    model: gatekeeper?.model ?? null,
    facts: factBits.join(' | ') || 'no machine facts (all decisions unanswered)',
  };
  if (escalation && escalation.targets > 0) {
    envelope.escalation = {
      targets: escalation.targets,
      escalated: escalation.escalated ?? [],
      skipped: escalation.skipped ?? 0,
      failures: escalation.failures ?? [],
      threshold: escalation.threshold,
    };
  }
  return envelope;
}

/**
 * Run the decide screen. Returns the envelope ({status:'ok', ...}) or a
 * fail-open {status:'unavailable', reason}. Never throws.
 */
export function runDecide({
  jdFile,
  resumeFile,
  python = process.env.JEV_PYTHON || 'python3',
  gatekeeperPath = process.env.JEV_GATEKEEPER_PY || null,
  timeoutMs = Number(process.env.JEV_DECIDE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  runMicro,
} = {}) {
  python = python || process.env.JEV_PYTHON || 'python3';
  timeoutMs = normalizeTimeout(timeoutMs, DEFAULT_TIMEOUT_MS);
  const root = getCareerOpsRoot();
  const gate = gatekeeperPath || join(root, 'scripts', 'jev_gatekeeper.py');

  if (!jdFile || !existsSync(jdFile)) return { status: 'unavailable', reason: `jd file not readable: ${jdFile}` };
  const resume = resumeFile
    ? existsSync(resumeFile) ? readFileSync(resumeFile, 'utf-8') : null
    : (() => {
        const candidate = join(root, 'cv.md');
        return existsSync(candidate) ? readFileSync(candidate, 'utf-8') : '';
      })();
  if (resume === null) return { status: 'unavailable', reason: `resume file not readable: ${resumeFile}` };
  if (!existsSync(gate)) return { status: 'unavailable', reason: `gatekeeper not readable: ${gate}` };

  const questions = envelopeQuestions();
  const state = `RESUME:\n${resume}\n\nJOB:\n${readFileSync(jdFile, 'utf-8')}`;

  const dir = mkdtempSync(join(tmpdir(), 'jev-decide-'));
  const qFile = join(dir, 'questions.json');
  const sFile = join(dir, 'state.txt');
  writeFileSync(qFile, JSON.stringify(questions), 'utf-8');
  writeFileSync(sFile, state.slice(0, 200_000), 'utf-8');

  let out;
  let err = '';
  try {
    const res = spawnSync(python, [gate, '--questions', `@${qFile}`, '--state', `@${sFile}`], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 24 * 1024 * 1024,
    });
    out = res.stdout || '';
    err = (res.stderr || '') || '';
    // spawnSync surfaces its own `timeout` expiry as a launch-style error
    // (res.error.code === 'ETIMEDOUT') on Linux, and as a null-status signal
    // kill elsewhere. Both are the same slow-frame fallback: name it as such
    // instead of reading it as an opaque spawn failure or exit-null.
    if (res.error) {
      if (res.error.code === 'ETIMEDOUT' || /timed out|timeout/i.test(res.error.message || '')) {
        return { status: 'unavailable', reason: `gatekeeper timed out after ${timeoutMs}ms` };
      }
      return { status: 'unavailable', reason: `gatekeeper spawn failed: ${res.error.message}` };
    }
    if (res.signal && res.status === null) {
      return { status: 'unavailable', reason: `gatekeeper timed out after ${timeoutMs}ms (signal: ${res.signal})` };
    }
    if (res.status !== 0) {
      const reason = (out || err).split('\n')[0].trim().slice(0, 300);
      return { status: 'unavailable', reason: `gatekeeper exited ${res.status}: ${reason || 'unknown'}` };
    }
  } catch (e) {
    return { status: 'unavailable', reason: `gatekeeper failed to launch: ${e?.message ?? String(e)}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  let json;
  try {
    json = JSON.parse(out);
  } catch {
    return { status: 'unavailable', reason: 'gatekeeper stdout was not JSON' };
  }
  const decisions = json?.decisions;
  if (!decisions || typeof decisions !== 'object') {
    return { status: 'unavailable', reason: 'gatekeeper response carried no decisions' };
  }

  const decoded = decodeAnswers(questions, decisions);

  // Item 2: confidence escalation. The decoded run is intercepted and ONLY the
  // critical categorical decisions below the floor are re-decided, per key,
  // through the gatekeeper's --micro channel. Fully advisory — no keys below
  // the floor, no evaluator configured, or any per-key failure keeps the
  // original decision and is reported on the envelope.
  const escalation = resolveEscalation({ questions, decoded, python, gate, timeoutMs, runMicro });

  return buildEnvelope({ decoded: escalation.decoded, gatekeeper: json, questions, escalation });
}

/**
 * Confidence escalation seam. Returns `{decoded, targets, escalated, skipped,
 * failures}` where `decoded` is the run patched with re-decided micro keys.
 * The evaluator order is: injected `runMicro` (tests, callers), else when
 * `JEV_MICRO=1` the gatekeeper's `--micro` mode over the same python + script
 * seam as the decide call itself, else nothing (targets skipped, fail-open).
 */
export function resolveEscalation({ questions, decoded, python, gate, timeoutMs, runMicro }) {
  const targets = criticalCategoricalDecisions(decoded, questions);
  if (targets.length === 0) {
    return { decoded, targets: 0, escalated: [], skipped: 0, failures: [] };
  }
  let micro = runMicro;
  if (typeof micro !== 'function') {
    if (process.env.JEV_MICRO === '1') {
      micro = (payload) => runMicroViaGatekeeper({ python, gate, timeoutMs, payload });
    } else {
      return { decoded, targets: targets.length, escalated: [], skipped: targets.length, failures: [] };
    }
  }
  const es = escalateCriticalCategories({ questions, decoded, runMicro: micro });
  return { decoded: es.decoded, targets: es.targets, escalated: es.escalated, skipped: 0, failures: es.failures };
}

/**
 * Run ONE isolated micro string evaluation through the gatekeeper's `--micro`
 * mode: a single-question payload in, the option-key string + confidence out.
 * Fail-open: any failure throws, and escalateCriticalCategories converts it
 * into an advisory failure that keeps the original decision.
 */
function runMicroViaGatekeeper({ python, gate, timeoutMs, payload }) {
  const dir = mkdtempSync(join(tmpdir(), 'jev-micro-'));
  try {
    const qFile = join(dir, 'micro-question.json');
    const sFile = join(dir, 'micro-state.txt');
    writeFileSync(qFile, JSON.stringify({ [payload.question.name]: payload.question }), 'utf-8');
    // The isolated-key context is the state the re-decision is bound to.
    writeFileSync(sFile, JSON.stringify(payload), 'utf-8');
    const res = spawnSync(python, [gate, '--micro', '--questions', `@${qFile}`, '--state', `@${sFile}`], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 24 * 1024 * 1024,
    });
    if (res.error && res.error.code === 'ETIMEDOUT') throw new Error(`micro timed out after ${timeoutMs}ms`);
    if (res.error) throw new Error(`micro spawn failed: ${res.error.message}`);
    if (res.signal && res.status === null) throw new Error(`micro timed out after ${timeoutMs}ms`);
    if (res.status !== 0) {
      throw new Error(`micro exited ${res.status}: ${(res.stdout || res.stderr || '').split('\n')[0].trim().slice(0, 200)}`);
    }
    const json = JSON.parse(res.stdout || '');
    const value = typeof json?.decision === 'string' ? json.decision : null;
    if (!value) throw new Error('micro gatekeeper returned no decision string');
    return {
      name: payload.question.name,
      value,
      confidence: typeof json.confidence === 'number' && Number.isFinite(json.confidence) ? json.confidence : undefined,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function usage() {
  console.error(
    'Usage: node jev-decide.mjs --jd <jdFile> [--resume <cvFile>] [--out <envelopePath>]\n'
    + '                 [--python <interpreter>] [--timeout-ms <ms>]\n'
    + 'Prints the envelope JSON on stdout; --out also persists it. Fails open to\n'
    + '{"status":"unavailable"} (exit 0) on any error; exit 2 on usage errors.',
  );
}

export async function main(argv = process.argv.slice(2)) {
  const args = { jd: null, resume: null, out: null, python: null, timeoutMs: null };
  let i = 0;
  for (; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--jd' || a === '--resume' || a === '--out' || a === '--python' || a === '--timeout-ms') {
      if (i + 1 >= argv.length) {
        usage();
        return EXIT_USAGE;
      }
      const key = a.slice(2);
      args[key === 'timeout-ms' ? 'timeoutMs' : key] = argv[i + 1];
      i += 1;
      continue;
    }
    usage();
    return EXIT_USAGE;
  }

  if (!args.jd) {
    usage();
    return EXIT_USAGE;
  }

  // A malformed --timeout-ms is a usage error: silently ignoring it (old 0 /
  // NaN handling) left spawnSync with no timeout at all, so a slow network
  // frame hung instead of failing open.
  let timeoutMs;
  if (args.timeoutMs !== null) {
    const n = Number(args.timeoutMs);
    if (!Number.isInteger(n) || n <= 0) {
      usage();
      return EXIT_USAGE;
    }
    timeoutMs = n;
  }

  const envelope = runDecide({
    jdFile: args.jd,
    resumeFile: args.resume,
    python: args.python,
    timeoutMs,
  });

  if (args.out) {
    try {
      writeFileSync(args.out, JSON.stringify(envelope), 'utf-8');
    } catch {
      // The stdout envelope is the contract; a failed persist is advisory.
    }
  }
  console.log(JSON.stringify(envelope));
  return EXIT_OK;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main();
}