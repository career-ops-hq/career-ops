#!/usr/bin/env node
/** Probe one explicitly selected ATS board for Python's company resolver. */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { loadProviders } from './_registry.mjs';
import { makeHttpCtx } from './_http.mjs';

export async function probe(input, providers = null, context = null) {
  if (!input || typeof input !== 'object' || !['name', 'provider', 'careers_url'].every(key =>
    typeof input[key] === 'string' && input[key].trim())) {
    throw new Error('name, provider and careers_url are required');
  }
  providers ??= await loadProviders(dirname(fileURLToPath(import.meta.url)));
  const provider = providers.get(input.provider);
  if (!provider) throw new Error(`unknown provider: ${input.provider}`);
  const entry = { name: input.name, careers_url: input.careers_url };
  if (!provider.detect?.(entry)) return { status: 'error', jobCount: 0, error: 'no API URL derivable' };
  try {
    const fetchContext = context || makeHttpCtx();
    const jobs = await provider.fetch(entry, input.provider === 'workday'
      ? { ...fetchContext, maxPages: 1 } : fetchContext);
    const jobCount = Array.isArray(jobs) ? jobs.length : 0;
    return { status: jobCount ? 'match' : 'empty', jobCount };
  } catch (error) {
    const result = { status: 'error', jobCount: 0, error: error?.message || String(error) };
    if (Number.isInteger(error?.status)) result.httpStatus = error.status;
    return result;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (inputPath === '--stream') {
    console.log = (...args) => console.error(...args);
    const providers = await loadProviders(dirname(fileURLToPath(import.meta.url)));
    const context = makeHttpCtx();
    const pending = new Set();
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      const request = JSON.parse(line);
      const task = probe(request, providers, context)
        .catch(error => ({ status: 'error', jobCount: 0, error: error?.message || String(error) }))
        .then(result => process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`));
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
    await Promise.all(pending);
  } else if (!inputPath || !outputPath) {
    console.error('Usage: node providers/_probe.mjs <input.json> <output.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = await probe(JSON.parse(readFileSync(inputPath, 'utf8')));
      writeFileSync(outputPath, JSON.stringify(result));
    } catch (error) {
      console.error(`provider probe failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
