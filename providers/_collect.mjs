#!/usr/bin/env node
/** Fetch raw postings through the existing provider plugins for Python discovery. */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProviders, resolveProvider } from './_registry.mjs';
import { makeHttpCtx } from './_http.mjs';
import { isResolverFailure } from './_dns-cache.mjs';
import { classifyFetchError } from './_fetch_error.mjs';

const providerDirectory = dirname(fileURLToPath(import.meta.url));
const REVERSE_TIMEOUT_MS = 5 * 60_000;
const CONFIGURED_TIMEOUT_MS = 10 * 60_000;

async function withTimeout(promise, label, timeoutMs) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function collect(input, providers = null, onResult = null) {
  providers ??= await loadProviders(providerDirectory);
  if (!Array.isArray(input.targets)) throw new Error('targets must be an array');
  if (input.since_ms != null && (!Number.isFinite(input.since_ms) || input.since_ms < 0)) {
    throw new Error('since_ms must be a nonnegative timestamp');
  }
  if (input.concurrency != null && (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > 20)) {
    throw new Error('concurrency must be an integer from 1 to 20');
  }
  if (input.mode != null && !['configured', 'reverse'].includes(input.mode)) {
    throw new Error('mode must be configured or reverse');
  }
  const timeoutMs = input.mode === 'configured' ? CONFIGURED_TIMEOUT_MS : REVERSE_TIMEOUT_MS;
  const results = new Array(input.targets.length);
  const record = (index, result) => {
    results[index] = result;
    onResult?.(index, result);
  };
  let next = 0;
  async function worker() {
    while (next < input.targets.length) {
      const index = next++;
      const target = input.targets[index];
      if (!target || typeof target !== 'object' || typeof target.name !== 'string' || !target.name.trim()) {
        record(index, { status: 'invalid', error: 'target name is required' });
        continue;
      }
      let resolved = resolveProvider(target, providers);
      if (!resolved) {
        record(index, target.scan_method === 'websearch'
          ? { status: 'handoff', query: target.scan_query || target.search_query || target.careers_url || '' }
          : { status: 'unmatched' });
        continue;
      }
      if (resolved.error) {
        record(index, { status: 'error', error: resolved.error, kind: 'configuration' });
        continue;
      }
      let provider = resolved.provider;
      let warning = null;
      const startedAt = Date.now();
      try {
        const context = { ...makeHttpCtx(), sinceMs: input.since_ms ?? null,
          includeUndated: input.include_undated ?? true, syntheticEntries: input.synthetic_entries === true };
        let jobs;
        try {
          jobs = await withTimeout(provider.fetch(target, context), `${provider.id}/${target.name}`, timeoutMs);
        } catch (error) {
          if (provider.id !== 'local-parser') throw error;
          resolved = resolveProvider(target, providers, { skipIds: ['local-parser'] });
          if (!resolved?.provider) throw error;
          provider = resolved.provider;
          jobs = await withTimeout(provider.fetch(target, context), `${provider.id}/${target.name}`, timeoutMs);
          warning = `local parser failed, used API fallback: ${error.message}`;
        }
        if (!Array.isArray(jobs)) throw new Error(`${provider.id}: fetch() did not return an array`);
        record(index, {
          status: 'fetched', provider: provider.id, jobs, warning,
          deadline_ms: startedAt + timeoutMs,
          truncated: jobs.collectionTruncated === true || jobs.workdayTruncated === true || jobs.workdayCapReached === true,
          truncation_kind: jobs.collectionTruncated === true ? jobs.collectionTruncationKind || 'page_cap'
            : jobs.workdayCapReached === true ? 'page_cap'
            : jobs.workdayTruncated === true ? 'network' : null,
          no_date_skip: jobs.workdayNoDateSkip === true,
          capped: jobs.icimsTruncated === true,
        });
      } catch (error) {
        record(index, { status: 'error', provider: provider.id, error: error.message,
                        kind: classifyFetchError(error), resolver_failure: isResolverFailure(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(input.concurrency ?? 10, input.targets.length) }, worker));
  return { results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('Usage: node providers/_collect.mjs <input.json> <output.json>');
    process.exitCode = 2;
  } else {
    try {
      writeFileSync(`${outputPath}.progress`, '');
      const result = await collect(JSON.parse(readFileSync(inputPath, 'utf8')), null,
        (index, row) => appendFileSync(`${outputPath}.progress`, `${JSON.stringify({ index, row })}\n`));
      writeFileSync(outputPath, JSON.stringify(result));
    } catch (error) {
      console.error(`provider collection failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
