#!/usr/bin/env node
/**
 * jev-inject.mjs — Envelope B compose step: fuse the Jev envelope (System One
 * bounded enums) with the generative worker's prose slots and inject the
 * deterministic `## Machine Summary` block into a finished report.
 *
 * WHY THIS EXISTS
 *   run-prompts.mjs (web) and batch-runner.sh (batch) tell the truncated worker
 *   to write ONLY its residual free-text slots (score, final_decision, the
 *   string arrays, requirement_importance, verbatim JD scalars) to a slots JSON
 *   file and to leave an `<!-- machine-summary-slot -->` marker where the block
 *   belongs. This script reads that slots file plus the envelope that
 *   jev-decide.mjs produced, fuses them with composeMachineSummary()
 *   (lib/jev-machine-summary.mjs), validates the result against the
 *   batch-prompt.md contract, and writes the composed block into the report in
 *   place. Downstream consumers (analyze-patterns.mjs, upskill.mjs,
 *   salary-gap.mjs, check-jd-archive.mjs, verify-pipeline.mjs) read the exact
 *   same fence they always have, so they receive the composed schema with no
 *   change on their side.
 *
 * Root level, NOT scripts/: the web layer reaches core scripts through
 * runCoreScript() -> rootScript() (web/src/lib/career-ops.ts), which resolves
 * `<careerOpsRoot>/<name>.mjs` and nothing else.
 *
 * FAIL-OPEN BY CONSTRUCTION
 *   Everything here is best-effort and must never damage a report a worker just
 *   spent real tokens writing. A missing slots file, a malformed envelope, a
 *   composed summary that fails validation, a report with neither marker nor
 *   existing block to place — every path leaves the report byte-identical and
 *   still exits 0 (status: unavailable / invalid / noop). The caller logs the
 *   result and moves on.
 *
 * Usage:
 *   node jev-inject.mjs --report <reportFile> --slots <slotsJson>
 *                       [--envelope <envelopeJson>] [--dry-run]
 *
 * Prints the result JSON on stdout always.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { isMainModule } from './lib/is-main-module.mjs';
import { composeMachineSummary } from './lib/jev-machine-summary.mjs';
import { injectMachineSummary } from './lib/jev-machine-summary.mjs';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;

function parseJsonFile(path, label) {
  if (!existsSync(path)) return { ok: false, reason: `${label} file not readable: ${path}` };
  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return { ok: false, reason: `${label} file unreadable: ${path}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: `${label} file was not JSON: ${path}` };
  }
}

/**
 * Run the compose+inject step over a finished report. Accepts envelope/slots as
 * paths (via {envelopePath, slotsPath}) or as already-parsed objects (via
 * {envelope, slots}). Returns {status:'done'|'invalid'|'unavailable'|'noop',
 * mode?, problems?, file?} — never throws.
 */
export function runInject({
  reportPath,
  slotsPath,
  envelopePath,
  envelope,
  slots,
  dryRun = false,
}) {
  if (!reportPath || !existsSync(reportPath)) {
    return { status: 'unavailable', reason: `report file not readable: ${reportPath}` };
  }
  let reportText;
  try {
    reportText = readFileSync(reportPath, 'utf-8');
  } catch {
    return { status: 'unavailable', reason: `report file unreadable: ${reportPath}` };
  }

  let env = envelope;
  if (!env && envelopePath) {
    const p = parseJsonFile(envelopePath, 'envelope');
    if (!p.ok) return { status: 'unavailable', reason: p.reason };
    env = p.value;
  }
  if (!env || typeof env !== 'object') return { status: 'unavailable', reason: 'no envelope supplied' };
  if (env.status !== 'ok' || !env.machine || typeof env.machine !== 'object') {
    return { status: 'unavailable', reason: `envelope not ok (status: ${env?.status ?? 'missing'})` };
  }

  let slotObj = slots;
  if (!slotObj && slotsPath) {
    const p = parseJsonFile(slotsPath, 'slots');
    if (!p.ok) return { status: 'unavailable', reason: p.reason };
    slotObj = p.value;
  }
  if (!slotObj || typeof slotObj !== 'object' || Array.isArray(slotObj)) {
    return { status: 'unavailable', reason: 'no slots object supplied' };
  }

  const { summary, problems } = composeMachineSummary({
    jev: env.machine,
    slots: slotObj,
    jevConfidence: typeof env.confidence === 'string' ? env.confidence : null,
  });

  if (problems.length > 0) {
    return { status: 'invalid', problems, mode: 'invalid' };
  }

  const result = injectMachineSummary(reportText, summary);
  if (result.mode === 'invalid') {
    return { status: 'invalid', problems: result.problems, mode: 'invalid' };
  }

  if (dryRun) return { status: 'done', mode: result.mode, problems: [], dryRun: true, file: reportPath };

  try {
    writeFileSync(reportPath, result.markdown, 'utf-8');
  } catch {
    return { status: 'unavailable', reason: `report write failed: ${reportPath}` };
  }
  return { status: 'done', mode: result.mode, problems: [], file: reportPath, confidence: env.confidence };
}

function usage() {
  console.error(
    'Usage: node jev-inject.mjs --report <reportFile> --slots <slotsJson>\n'
    + '               [--envelope <envelopeJson>] [--dry-run]\n'
    + 'Fuses the Jev envelope + worker prose slots into the report Machine\n'
    + 'Summary block. Fails open to status unavailable/invalid/noop (exit 0)\n'
    + 'and never modifies the report in those cases. Exit 2 on usage errors.',
  );
}

export async function main(argv = process.argv.slice(2)) {
  const args = { report: null, slots: null, envelope: null, dryRun: false };
  let i = 0;
  for (; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--report' || a === '--slots' || a === '--envelope') {
      if (i + 1 >= argv.length) {
        usage();
        return EXIT_USAGE;
      }
      args[a.slice(2)] = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    usage();
    return EXIT_USAGE;
  }

  if (!args.report || !args.slots) {
    usage();
    return EXIT_USAGE;
  }

  const result = runInject({
    reportPath: args.report,
    slotsPath: args.slots,
    envelopePath: args.envelope,
    dryRun: args.dryRun,
  });
  console.log(JSON.stringify(result));
  return EXIT_OK;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main();
}