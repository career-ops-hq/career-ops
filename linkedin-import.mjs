#!/usr/bin/env node

import { mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { linkedInOffers, planLinkedInImport } from './lib/linkedin-import.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';

const USAGE = `Paste a LinkedIn job alert into your pipeline. No Google account.

  node linkedin-import.mjs                 Read the alert from stdin
  node linkedin-import.mjs --file alert.eml
  node linkedin-import.mjs --dry-run       Print the count and write nothing
  node linkedin-import.mjs --json          Print one JSON object

On the dashboard, paste into LinkedIn job alerts.
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
  const plan = planLinkedInImport(text, `${readIf(pipelinePath)}\n${readIf(applicationsPath)}`, { dryRun });

  if (!dryRun && !plan.error && plan.added.length > 0) {
    const { appendToPipeline, appendToScanHistory } = await import('./scan.mjs');
    const { localToday } = await import('./lib/local-today.mjs');
    const offers = linkedInOffers(plan.added, text);
    mkdirSync(dirname(pipelinePath), { recursive: true });
    await appendToPipeline(offers, { pipelinePath });
    await appendToScanHistory(offers, localToday(), 'added');
  }

  const payload = {
    added: plan.added.length,
    already: plan.already.length,
    found: plan.found,
    message: plan.message,
    ...(plan.error ? { error: plan.error } : {}),
  };
  if (json) console.log(JSON.stringify(payload));
  else console.log(plan.message);
  if (plan.error) process.exit(1);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
