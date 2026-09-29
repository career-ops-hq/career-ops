/** Collect bounded provider reachability facts for Python portal health decisions. */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { loadProviders, resolveProvider } from './_registry.mjs';
import { makeHttpCtx } from './_http.mjs';

const PROVIDERS_DIR = dirname(fileURLToPath(import.meta.url));
const REQUEST_BUDGET = 4;

class BudgetReached extends Error {}

export async function collectHealth(entry, providers = null, baseContext = null) {
  providers ??= await loadProviders(PROVIDERS_DIR);
  if (entry?.provider === 'local-parser') return { matched: false };
  const resolved = resolveProvider(entry, providers, { skipIds: ['local-parser'] });
  if (!resolved?.provider) return { matched: false };
  const provider = resolved.provider;
  const base = baseContext || makeHttpCtx();
  let used = 0;
  let budgetReached = false;
  const guard = (fetch) => async (...args) => {
    if (used >= REQUEST_BUDGET) {
      budgetReached = true;
      throw new BudgetReached();
    }
    used += 1;
    return fetch(...args);
  };
  try {
    const jobs = await provider.fetch(entry, {
      ...base, maxPages: 1, fetchJson: guard(base.fetchJson), fetchText: guard(base.fetchText),
    });
    return { matched: true, provider: provider.id,
      jobCount: Array.isArray(jobs) ? jobs.length : 0, budgetReached };
  } catch (error) {
    if (error instanceof BudgetReached) return { matched: true, provider: provider.id, budgetReached: true };
    return { matched: true, provider: provider.id, budgetReached,
      error: error?.message || String(error), httpStatus: error?.status ?? null,
      errorName: error?.name || null };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (inputPath === '--stream') {
    console.log = (...args) => console.error(...args);
    const providers = await loadProviders(PROVIDERS_DIR);
    const context = makeHttpCtx();
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      const result = await collectHealth(JSON.parse(line), providers, context)
        .catch(error => ({ matched: true, error: error?.message || String(error) }));
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } else if (!inputPath || !outputPath) {
    console.error('Usage: node providers/_health_probe.mjs <input.json> <output.json>');
    process.exitCode = 2;
  } else {
    try {
      writeFileSync(outputPath, JSON.stringify(await collectHealth(JSON.parse(readFileSync(inputPath, 'utf8')))));
    } catch (error) {
      console.error(`health probe failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
