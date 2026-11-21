#!/usr/bin/env node

/**
 * naukri-import.mjs — paste a Naukri job-alert email into your pipeline.
 *
 * Naukri cannot be scanned: its listing and posting pages are client-rendered
 * shells and its own JSON endpoint answers `recaptcha required` (docs/NAUKRI.md,
 * measured 2026-11-20). The alert email in your own inbox is the part that is
 * yours, so this reads that and makes no network request at all — the same
 * shape as `linkedin-import.mjs`.
 *
 * Every posting lands in `data/pipeline.md` as its Naukri URL. Because Naukri is
 * an aggregator, the pipeline then confirms the role at the employer before
 * evaluating (AGENTS.md → "Aggregator Listings -- Confirm at the Employer").
 */

import { mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { naukriOffers, planNaukriImport } from './lib/naukri-import.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';

const USAGE = `Paste a Naukri job-alert email into your pipeline.

  node naukri-import.mjs                 Read the alert from stdin
  node naukri-import.mjs --file alert.eml
  node naukri-import.mjs --dry-run       Print the count and write nothing
  node naukri-import.mjs --json          Print one JSON object
`;

function readIf(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return '';
    throw new Error(`I can't read ${path} (${err.message}). Nothing was saved.`);
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, ['--file', '--dry-run', '--json', '--help', '-h'], USAGE, {
    valueFlags: ['--file'],
    requireOperand: true,
  });
  const file = flagValue(args, '--file');
  const dryRun = hasFlag(args, '--dry-run');
  const json = hasFlag(args, '--json');

  let text;
  if (file !== undefined) {
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      console.error(`I can't read that file (${err.message}).`);
      process.exit(1);
    }
  } else {
    text = await readStdin();
    if (text === null) {
      console.log(USAGE);
      process.exit(0);
    }
  }

  const root = getCareerOpsRoot();
  const pipelinePath = process.env.CAREER_OPS_PIPELINE?.trim() || join(root, 'data', 'pipeline.md');
  const applicationsPath = resolveTrackerPath(root);
  const plan = planNaukriImport(text, `${readIf(pipelinePath)}\n${readIf(applicationsPath)}`, { dryRun });

  let historyError = null;
  if (!dryRun && !plan.error && plan.added.length > 0) {
    const { appendToPipeline, appendToScanHistory } = await import('./scan.mjs');
    const { localToday } = await import('./lib/local-today.mjs');
    const offers = naukriOffers(plan.added, text);
    mkdirSync(dirname(pipelinePath), { recursive: true });
    await appendToPipeline(offers, { pipelinePath });
    try {
      await appendToScanHistory(offers, localToday(), 'added');
    } catch (err) {
      historyError = err instanceof Error ? err.message : String(err);
    }
  }

  const payload = {
    added: plan.added.length,
    already: plan.already.length,
    found: plan.found,
    message: historyError ? `${plan.message} The scan history could not be updated.` : plan.message,
    ...(plan.error ? { error: plan.error } : {}),
    ...(historyError ? { historyError } : {}),
  };
  if (json) console.log(JSON.stringify(payload));
  else console.log(payload.message);
  if (plan.error) process.exit(1);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
