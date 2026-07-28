/**
 * batch/aggregate-tokens.mjs — Aggregate and display token usage for batch runs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { estimateCost } from '../utils/token-tracker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'batch', 'batch-state.tsv');
const LOGS_DIR = path.join(ROOT, 'batch', 'logs');
const REPORTS_DIR = path.join(ROOT, 'reports');

export function parseTokenVal(str) {
  if (!str) return 0;
  str = str.toLowerCase().replace(/,/g, '').trim();
  if (str.endsWith('k')) {
    return Math.round(parseFloat(str.slice(0, -1)) * 1000);
  }
  return parseInt(str, 10) || 0;
}

function formatK(tokens) {
  return (tokens / 1000).toFixed(1) + 'k';
}

function main() {
  if (!fs.existsSync(STATE_FILE)) {
    console.log('No state file found.');
    return;
  }

  const lines = fs.readFileSync(STATE_FILE, 'utf-8').split('\n');
  const workers = [];

  for (const line of lines.slice(1)) {
    const parts = line.split('\t');
    if (parts.length < 6) continue;
    const id = parts[0]?.trim();
    const status = parts[2]?.trim();
    const report_num = parts[5]?.trim();
    
    if (!id || !report_num || report_num === '-' || report_num === 'report_num') continue;

    // Sanitize to prevent path traversal
    const safeId = /^[\w-]+$/.test(id) ? id : null;
    const safeReportNum = /^[\w-]+$/.test(report_num) ? report_num : null;
    if (!safeId || !safeReportNum) continue;

    const logFile = path.join(LOGS_DIR, `${safeReportNum}-${safeId}.log`);
    const resolvedLogFile = path.resolve(logFile);
    if (!resolvedLogFile.startsWith(path.resolve(LOGS_DIR) + path.sep)) continue;

    if (fs.existsSync(resolvedLogFile)) {
      workers.push({ id: safeId, report_num: safeReportNum, status, logFile: resolvedLogFile });
    }
  }

  if (workers.length === 0) {
    console.log('No worker logs found.');
    return;
  }

  const reportFiles = fs.existsSync(REPORTS_DIR) ? fs.readdirSync(REPORTS_DIR) : [];
  
  const aggregated = {
    scan: { prompt: 0, completion: 0, cached: 0, isZero: true },
    evaluation: { prompt: 0, completion: 0, cached: 0, isZero: true },
    'pdf payload': { prompt: 0, completion: 0, cached: 0, isZero: true },
  };

  console.log('\n=== Per-Worker Token Breakdown ===');
  let grandCost = 0;

  for (const w of workers) {
    const logContent = fs.readFileSync(w.logFile, 'utf-8');
    const steps = {
      scan: { prompt: 0, completion: 0, cached: 0, isZero: true },
      evaluation: { prompt: 0, completion: 0, cached: 0, isZero: true },
      'pdf payload': { prompt: 0, completion: 0, cached: 0, isZero: true },
    };

    // Try parsing printed Token breakdown block first
    const breakdownMatch = logContent.match(/Token breakdown:([\s\S]*?)(?:\n\n|\n[^\s]|$)/);
    let parsedFromBlock = false;

    if (breakdownMatch) {
      const blockContent = breakdownMatch[1];
      const stepLines = blockContent.split('\n');
      for (const line of stepLines) {
        const m = line.match(/^\s*([\w\s]+):\s*(.*)/);
        if (m) {
          const stepName = m[1].trim();
          const val = m[2].trim();
          if (stepName === 'total') continue;

          if (!steps[stepName]) {
            steps[stepName] = { prompt: 0, completion: 0, cached: 0, isZero: true };
          }

          if (val.includes('(zero-token by design)')) {
            steps[stepName].isZero = true;
          } else {
            steps[stepName].isZero = false;
            const promptMatch = val.match(/([\d.,]+k?)\s*prompt/i);
            const compMatch = val.match(/([\d.,]+k?)\s*completion/i);
            const cachedMatch = val.match(/cached:\s*([\d.,]+k?)/i);

            if (promptMatch) steps[stepName].prompt = parseTokenVal(promptMatch[1]);
            if (compMatch) steps[stepName].completion = parseTokenVal(compMatch[1]);
            if (cachedMatch) steps[stepName].cached = parseTokenVal(cachedMatch[1]);
          }
        }
      }
      parsedFromBlock = true;
    }

    // Fallback: parse raw Claude CLI token output from log
    if (!parsedFromBlock) {
      const inputRegex = /(\d[\d,.]*k?)\s*(?:input|prompt)/i;
      const outputRegex = /(\d[\d,.]*k?)\s*(?:output|completion|candidate)/i;
      
      const lines = logContent.split('\n');
      let promptTokens = 0;
      let completionTokens = 0;
      
      for (const line of lines) {
        if (line.toLowerCase().includes('token') || line.toLowerCase().includes('usage:')) {
          const inM = line.match(inputRegex);
          const outM = line.match(outputRegex);
          if (inM) promptTokens = parseTokenVal(inM[1]);
          if (outM) completionTokens = parseTokenVal(outM[1]);
        }
      }

      if (promptTokens || completionTokens) {
        steps.evaluation = {
          prompt: promptTokens,
          completion: completionTokens,
          cached: 0,
          isZero: false
        };
      }
    }

    // Extract model and provider from metadata line if present
    const metaMatch = logContent.match(/\(metadata:\s*model=([^,\s)]+),\s*provider=([^)\s]+)\)/);
    let model = null;
    let provider = 'unknown';
    if (metaMatch) {
      model = metaMatch[1];
      provider = metaMatch[2];
    }

    // Print per-worker breakdown
    const reportFile = reportFiles.find(f => f.startsWith(`${w.report_num}-`));
    let label = `Worker #${w.id} (report ${w.report_num})`;
    if (reportFile) {
      const parts = reportFile.replace(/\.md$/, '').split('-');
      if (parts.length >= 2) {
        const companyName = parts[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        label = `Worker #${w.id} (${companyName}, report ${w.report_num})`;
      }
    }

    console.log(`\n${label}:`);
    let workerTotalTokens = 0;

    for (const [stepName, stepData] of Object.entries(steps)) {
      const padLabel = (stepName + ':').padEnd(15);
      if (stepData.isZero) {
        console.log(`  ${padLabel}(zero-token by design)`);
      } else {
        const pK = formatK(stepData.prompt);
        const cK = formatK(stepData.completion);
        let line = `  ${padLabel}${pK} prompt / ${cK} completion`;
        if (stepData.cached > 0) {
          line += ` (cached: ${formatK(stepData.cached)})`;
        }
        console.log(line);

        if (!aggregated[stepName]) {
          aggregated[stepName] = { prompt: 0, completion: 0, cached: 0, isZero: true };
        }
        aggregated[stepName].prompt += stepData.prompt;
        aggregated[stepName].completion += stepData.completion;
        aggregated[stepName].cached += stepData.cached;
        aggregated[stepName].isZero = false;

        workerTotalTokens += stepData.prompt + stepData.completion;
      }
    }

    const padTotal = 'total:'.padEnd(15);
    if (model !== null) {
      const workerUsage = Object.values(steps).reduce((acc, s) => {
        if (!s.isZero) {
          acc.prompt_tokens += s.prompt;
          acc.completion_tokens += s.completion;
          acc.cached_tokens += s.cached;
        }
        return acc;
      }, { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 });
      const workerCost = estimateCost(model, workerUsage, provider);
      if (workerCost !== null) {
        grandCost += workerCost;
        console.log(`  ${padTotal}${formatK(workerTotalTokens)} tokens ($${workerCost.toFixed(4)})`);
      } else {
        console.log(`  ${padTotal}${formatK(workerTotalTokens)} tokens (est. cost n/a)`);
      }
    } else {
      console.log(`  ${padTotal}${formatK(workerTotalTokens)} tokens (est. cost n/a — no model metadata found)`);
    }
  }

  // Print Aggregated Summary
  console.log('\n=== Aggregated Token Breakdown ===');
  let grandTotalTokens = 0;

  for (const [stepName, stepData] of Object.entries(aggregated)) {
    const padLabel = (stepName + ':').padEnd(15);
    if (stepData.isZero) {
      console.log(`  ${padLabel}(zero-token by design)`);
    } else {
      const pK = formatK(stepData.prompt);
      const cK = formatK(stepData.completion);
      let line = `  ${padLabel}${pK} prompt / ${cK} completion`;
      if (stepData.cached > 0) {
        line += ` (cached: ${formatK(stepData.cached)})`;
      }
      console.log(line);

      grandTotalTokens += stepData.prompt + stepData.completion;
    }
  }

  const padTotal = 'total:'.padEnd(15);
  console.log(`  ${padTotal}${formatK(grandTotalTokens)} tokens ($${grandCost.toFixed(4)})\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
