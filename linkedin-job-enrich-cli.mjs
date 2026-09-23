#!/usr/bin/env node
/**
 * linkedin-job-enrich-cli.mjs — One-shot LinkedIn title fix via Cursor CLI (cursor-agent).
 *
 *   node linkedin-job-enrich-cli.mjs
 *   node linkedin-job-enrich-cli.mjs --batch-size 50 --start 0
 *   node linkedin-job-enrich-cli.mjs --prepare-only
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectLinkedInPipelineRows } from './linkedin-job-enrich.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BATCH_DIR = join(ROOT, 'batch');
const MODE_PATH = join(ROOT, 'modes', 'linkedin-title-fix.md');
const STATE_PATH = join(BATCH_DIR, 'linkedin-title-fix-state.tsv');
const DATA_ROOT = getCareerOpsRoot();

function findCursorAgent() {
  const candidates = [
    process.env.CURSOR_AGENT_BIN,
    join(process.env.HOME ?? '', '.local/bin/cursor-agent'),
    'cursor-agent',
  ].filter(Boolean);
  for (const bin of candidates) {
    if (bin.includes('/') && existsSync(bin)) return bin;
  }
  return 'cursor-agent';
}

function writeBatchFiles(rows, batchSize) {
  mkdirSync(BATCH_DIR, { recursive: true });
  const batches = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const num = Math.floor(i / batchSize) + 1;
    const path = join(BATCH_DIR, `linkedin-title-fix-${num}.tsv`);
    const lines = ['lineIdx\turl\tcompany\ttitle\tlocation', ...chunk.map((r) => [r.lineIdx, r.url, r.company, r.title, r.location].join('\t'))];
    writeFileSync(path, lines.join('\n') + '\n');
    batches.push({ num, path, count: chunk.length });
  }
  return batches;
}

function readState() {
  const done = new Set();
  if (!existsSync(STATE_PATH)) return done;
  for (const line of readFileSync(STATE_PATH, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('batch')) continue;
    const [batch, status] = line.split('\t');
    if (status === 'done') done.add(parseInt(batch, 10));
  }
  return done;
}

function markBatchDone(num, summary) {
  const header = existsSync(STATE_PATH) ? '' : 'batch\tstatus\tsummary\n';
  const line = `${num}\tdone\t${summary.replace(/\s+/g, ' ').trim()}\n`;
  writeFileSync(STATE_PATH, (existsSync(STATE_PATH) ? readFileSync(STATE_PATH, 'utf-8') : header) + line);
}

function runCursorAgent(prompt, bin) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--trust', '--force'];
    const child = spawn(bin, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      out += s;
      process.stderr.write(s);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`cursor-agent exited ${code}\n${out.slice(-2000)}`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const batchSize = parseInt(args.find((a, i) => args[i - 1] === '--batch-size') ?? '50', 10);
  const startBatch = parseInt(args.find((a, i) => args[i - 1] === '--start') ?? '1', 10);
  const prepareOnly = args.includes('--prepare-only');
  const skipAgent = args.includes('--apply-only');

  const pipelinePath = join(DATA_ROOT, 'data', 'pipeline.md');
  const lines = readFileSync(pipelinePath, 'utf-8').split('\n');
  const rows = collectLinkedInPipelineRows(lines);
  console.log(`LinkedIn rows in pipeline: ${rows.length}`);

  const batches = writeBatchFiles(rows, batchSize);
  console.log(`Prepared ${batches.length} batch file(s) in batch/`);

  if (prepareOnly) return;

  const mode = readFileSync(MODE_PATH, 'utf-8');
  const bin = findCursorAgent();
  const done = readState();

  for (const batch of batches) {
    if (batch.num < startBatch) continue;
    if (done.has(batch.num)) {
      console.log(`⏭️  Batch ${batch.num} already done — skip`);
      continue;
    }

    if (skipAgent) {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync(process.execPath, ['linkedin-job-enrich-apply.mjs', '--from-fetch', '--tsv', batch.path], {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: 'inherit',
      });
      if (r.status !== 0) process.exit(r.status ?? 1);
      markBatchDone(batch.num, `apply-only ${batch.count} rows`);
      continue;
    }

    const prompt = `${mode}

## Your task now

Process **batch ${batch.num}** (${batch.count} rows).

Batch file: \`${batch.path}\`

1. Run: \`node linkedin-job-enrich-apply.mjs --from-fetch --tsv ${batch.path}\`
2. If any rows failed fetch, retry those URLs with curl/browser and patch pipeline lines manually.
3. Print exactly: \`DONE batch ${batch.num} updated=X skipped=Y\`

Work only in career-ops root: ${ROOT}`;

    console.log(`\n▶ cursor-agent batch ${batch.num}/${batches.length} (${batch.count} jobs)…`);
    try {
      const out = await runCursorAgent(prompt, bin);
      const m = out.match(new RegExp(`DONE batch ${batch.num} updated=(\\d+) skipped=(\\d+)`));
      markBatchDone(batch.num, m ? `updated=${m[1]} skipped=${m[2]}` : 'completed');
    } catch (err) {
      console.error(`Batch ${batch.num} failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\n✅ All LinkedIn title-fix batches complete.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
