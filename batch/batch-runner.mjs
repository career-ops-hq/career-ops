#!/usr/bin/env node
// @ts-check
/**
 * batch-runner.mjs — Node.js orchestrator for batch evaluating job postings.
 * Cross-platform replacement for batch-runner.sh.
 *
 *   node batch/batch-runner.mjs [--parallel N] [--dry-run] [--limit N] [--model <name>] [--status]
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagValue, hasFlag } from '../lib/cli-flags.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BATCH_DIR = path.join(ROOT, 'batch');
const INPUT_FILE = path.join(BATCH_DIR, 'batch-input.tsv');
const STATE_FILE = path.join(BATCH_DIR, 'batch-state.tsv');
const PROMPT_FILE = path.join(BATCH_DIR, 'batch-prompt.md');
const LOGS_DIR = path.join(BATCH_DIR, 'logs');
const ADDITIONS_DIR = path.join(BATCH_DIR, 'tracker-additions');

function parseTSV(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split('\t').map(c => c.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ''; });
    return row;
  });
}

async function runWorker(item, model, dryRun) {
  const num = item.num || item.ID || '0';
  const company = item.company || item.Company || 'Unknown';
  const url = item.url || item.URL || '';

  if (dryRun) {
    console.log(`[DRY-RUN] Worker evaluating: [${num}] ${company} -> ${url}`);
    return { num, company, success: true, dryRun: true };
  }

  const logFile = path.join(LOGS_DIR, `${num}-${company}.log`);
  console.log(`[Worker ${num}] Processing ${company}...`);

  const promptText = existsSync(PROMPT_FILE) ? readFileSync(PROMPT_FILE, 'utf8') : '';
  const inputPrompt = `Evaluate job #${num} for ${company} from URL: ${url}\n\n${promptText}`;

  const cliArgs = ['-p', inputPrompt, '--dangerously-skip-permissions'];
  if (model) cliArgs.push('--model', model);

  return new Promise((resolve) => {
    const child = spawn('claude', cliArgs, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', code => {
      mkdirSync(LOGS_DIR, { recursive: true });
      writeFileSync(logFile, stdout + '\n--- STDERR ---\n' + stderr, 'utf8');
      const success = code === 0;
      console.log(`[Worker ${num}] Finished ${company} (Exit code: ${code})`);
      resolve({ num, company, success, exitCode: code });
    });

    child.on('error', err => {
      console.error(`[Worker ${num}] Failed to launch worker: ${err.message}`);
      resolve({ num, company, success: false, error: err.message });
    });
  });
}

export async function main() {
  const argv = process.argv.slice(2);

  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    console.log(`
career-ops batch runner — Node.js orchestrator
Usage: node batch/batch-runner.mjs [options]

Options:
  --parallel <N>  Number of concurrent workers (default: 1)
  --limit <N>     Maximum number of items to process
  --dry-run       Preview execution without spawning AI CLI workers
  --model <name>  Override AI model name
  --status        Show current batch state summary
    `);
    return;
  }

  mkdirSync(LOGS_DIR, { recursive: true });
  mkdirSync(ADDITIONS_DIR, { recursive: true });

  const inputRows = parseTSV(INPUT_FILE);
  if (hasFlag(argv, '--status')) {
    console.log(`Batch Input: ${inputRows.length} items queued.`);
    return;
  }

  if (inputRows.length === 0) {
    console.log(`No items found in ${INPUT_FILE}. Add job rows to batch-input.tsv first.`);
    return;
  }

  const parallel = parseInt(flagValue(argv, '--parallel') || '1', 10);
  const limit = parseInt(flagValue(argv, '--limit') || '0', 10);
  const model = flagValue(argv, '--model') || '';
  const dryRun = hasFlag(argv, '--dry-run');

  const targetRows = limit > 0 ? inputRows.slice(0, limit) : inputRows;
  console.log(`🚀 Starting batch execution for ${targetRows.length} jobs (Concurrency: ${parallel}, Dry-Run: ${dryRun})...\n`);

  // Run pool with concurrency limit
  const results = [];
  for (let i = 0; i < targetRows.length; i += parallel) {
    const chunk = targetRows.slice(i, i + parallel);
    const chunkResults = await Promise.allSettled(chunk.map(item => runWorker(item, model, dryRun)));
    results.push(...chunkResults);
  }

  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  console.log(`\n✅ Batch execution complete. Succeeded: ${succeeded}/${targetRows.length}`);
}

if (process.argv[1] && process.argv[1].endsWith('batch-runner.mjs')) {
  main().catch(err => {
    console.error('Fatal batch runner error:', err);
    process.exit(1);
  });
}
