#!/usr/bin/env node
/** Read public iCIMS detail pages to add dates after Python's cheap filters. */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import icims from './icims.mjs';
import { makeHttpCtx } from './_http.mjs';

export async function enrich(input, context = null, onResult = null) {
  if (!input || !Array.isArray(input.jobs)) throw new Error('jobs must be an array');
  const ctx = context || makeHttpCtx();
  const output = [];
  for (const [index, original] of input.jobs.entries()) {
    const job = { ...original };
    try {
      const url = new URL(job.url);
      if (url.protocol === 'https:' && /^[a-z0-9-]+\.icims\.com$/i.test(url.hostname)
          && /^\/jobs\/\d+\//.test(url.pathname)) {
        await icims.enrichDate(job, ctx);
      }
    } catch {}
    output.push(job);
    onResult?.(index, job);
  }
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('Usage: node providers/_enrich.mjs <input.json> <output.json>');
    process.exitCode = 2;
  } else {
    try {
      writeFileSync(`${outputPath}.progress`, '');
      const result = await enrich(JSON.parse(readFileSync(inputPath, 'utf8')), null,
        (index, job) => appendFileSync(`${outputPath}.progress`, `${JSON.stringify({ index, job })}\n`));
      writeFileSync(outputPath, JSON.stringify(result));
    } catch (error) {
      console.error(`provider enrichment failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
