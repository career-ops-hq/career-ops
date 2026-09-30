#!/usr/bin/env node
/**
 * Jev Score Calibration (#2913)
 *
 * Derives the `jev_gate` band thresholds in config/profile.yml from MEASURED
 * scores instead of asserted ones.
 *
 * `band_low: 1.85` in the profile reads like a measured 15th percentile and is
 * not one: it was picked by eye from a 69-posting run and then frozen in a
 * comment that says "n=69" while `jds/` has since grown. Nothing detects the
 * drift, because the number is a literal and the corpus keeps moving.
 *
 * So this script measures, and the numbers come from the corpus:
 *
 *   1. run scripts/jev_gatekeeper.py <resume> <job> triage over every capture
 *   2. append each score to data/jev-calibration.tsv (append-only, so the
 *      dataset accumulates and a later run compares against a growing history)
 *   3. print the real quantiles for the caller to reconcile against the config
 *
 * It does NOT write config/profile.yml. Band selection is a judgement about
 * which applications to protect, not a mechanical function of a percentile —
 * the script's job is to make the judgement falsifiable, and an agent that can
 * quietly rewrite the thresholds on every run would be a worse failure than the
 * frozen literal it replaces. `--json` prints a machine-readable block; the
 * human summary is the default because this output is read before it is trusted.
 *
 * Postings already present in the TSV are skipped by default: a re-run costs
 * ~$0.008 and a minute for 73 postings, so the cheap path is "measure only what
 * is new". `--force` re-measures everything.
 *
 * PDFs are skipped, not counted. scripts/jev_gatekeeper.py opens both inputs as
 * UTF-8 text, so a PDF capture is a UnicodeDecodeError on the Python side and an
 * `{"error": ...}` on stdout. Counting it as a 0 or skipping it silently would
 * both put a fabricated value in the dataset; it is reported as skipped so `n`
 * is always the number of postings that actually produced a score.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { isMainModule } from '../lib/is-main-module.mjs';

const execFileAsync = promisify(execFile);

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const GATEKEEPER = join(ROOT, 'scripts', 'jev_gatekeeper.py');
const TSV = join(ROOT, 'data', 'jev-calibration.tsv');
const TSV_HEADER = 'posting\tscore\thas_core_skills\tdate';

/** Below this many bytes a capture cannot hold a job description. */
const MIN_JOB_BYTES = 200;

const QUANTILES = [
  ['p10', 0.1],
  ['p15', 0.15],
  ['p25', 0.25],
  ['p50', 0.5],
  ['p75', 0.75],
  ['p90', 0.9],
];

/**
 * Linear-interpolated quantile over an ascending-sorted array.
 *
 * Matches numpy's default 'linear' method, which is what any earlier ad-hoc
 * calibration used, so the numbers here are comparable with the figure the
 * config comment claims rather than being computed by a different convention.
 *
 * @param {number[]} sorted Ascending-sorted values.
 * @param {number} p Quantile in [0, 1].
 * @returns {number} The interpolated quantile, NaN for an empty input.
 */
export function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Parse the gatekeeper's stdout into a score, or explain why there is none.
 *
 * The `{"error": ...}`-on-stdout quirk is the reason this is not a bare
 * JSON.parse: scripts/jev_gatekeeper.py's fail() prints its error object to
 * STDOUT and exits non-zero, so a provider failure arrives as valid JSON on the
 * same channel as a verdict. Trusting a successful parse here would read a
 * failed audit as a scored one.
 *
 * @param {string} stdout Raw stdout from the gatekeeper.
 * @returns {{ok: true, score: number, hasCoreSkills: boolean}|{ok: false, reason: string}}
 */
export function parseTriage(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: 'non-JSON stdout' };
  }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'stdout was not a JSON object' };
  if (payload.error) return { ok: false, reason: `provider error: ${String(payload.error).slice(0, 160)}` };

  const score = payload.ats_pass_probability;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return { ok: false, reason: `missing/non-numeric ats_pass_probability (got ${JSON.stringify(score)})` };
  }
  return { ok: true, score, hasCoreSkills: payload.has_core_skills === true };
}

/**
 * Read the calibration TSV into {byPosting, scores}.
 *
 * A malformed line is skipped rather than thrown: the file is append-only and
 * user-owned, so a half-written line from an interrupted run must not make every
 * later run unreadable.
 *
 * @returns {{byPosting: Map<string, number>, scores: number[], rows: number, bad: number}}
 */
export function readCalibration() {
  const byPosting = new Map();
  const scores = [];
  if (!existsSync(TSV)) return { byPosting, scores, rows: 0, bad: 0 };

  const lines = readFileSync(TSV, 'utf8').split('\n');
  let bad = 0;
  for (const line of lines) {
    if (!line.trim() || line.startsWith('posting\t') || line.startsWith('#')) continue;
    const [posting, rawScore] = line.split('\t');
    const score = Number(rawScore);
    if (!posting || !Number.isFinite(score)) {
      bad += 1;
      continue;
    }
    if (!byPosting.has(posting)) {
      byPosting.set(posting, score);
      scores.push(score);
    }
  }
  return { byPosting, scores, rows: byPosting.size, bad };
}

/**
 * Summarize a score distribution.
 *
 * @param {number[]} values Scores in any order.
 * @returns {{n: number, min: number, max: number, mean: number, quantiles: Record<string, number>}}
 */
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantiles = {};
  for (const [label, p] of QUANTILES) quantiles[label] = quantile(sorted, p);
  return {
    n: sorted.length,
    min: sorted[0] ?? NaN,
    max: sorted[sorted.length - 1] ?? NaN,
    mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : NaN,
    quantiles,
  };
}

async function measurePosting(resumePath, jobPath) {
  try {
    const { stdout } = await execFileAsync('python3', [GATEKEEPER, resumePath, jobPath, 'triage'], {
      maxBuffer: 1024 * 1024,
      timeout: 120000,
    });
    return parseTriage(stdout);
  } catch (err) {
    // execFile rejects on non-zero exit; stdout still carries the error object.
    if (err && typeof err.stdout === 'string' && err.stdout.trim()) {
      return parseTriage(err.stdout);
    }
    return { ok: false, reason: String((err && err.message) || err).slice(0, 160) };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      resume: { type: 'string', default: 'cv.md' },
      concurrency: { type: 'string', default: '4' },
      force: { type: 'boolean', default: false },
      dry_run: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`Usage: node scripts/jev-calibrate.mjs [options]

  --resume <path>      Resume to score against (default: cv.md)
  --concurrency <n>    Parallel gate calls (default: 4)
  --force              Re-measure postings already in the TSV
  --dry-run            Measure without appending to the TSV
  --json               Print the summary as JSON

Appends to data/jev-calibration.tsv and prints quantiles. Does not write
config/profile.yml — band selection stays a human/agent decision.`);
    return 0;
  }

  const resumePath = resolve(ROOT, values.resume);
  if (!existsSync(resumePath)) {
    console.error(`resume not found: ${values.resume}`);
    return 1;
  }
  if (!existsSync(GATEKEEPER)) {
    console.error(`gatekeeper not found: ${GATEKEEPER}`);
    return 1;
  }

  const jdsDir = join(ROOT, 'jds');
  if (!existsSync(jdsDir)) {
    console.error('jds/ not found — nothing to calibrate against');
    return 1;
  }

  const files = readdirSync(jdsDir)
    .filter((f) => statSync(join(jdsDir, f)).isFile())
    .sort();

  const { byPosting, scores } = readCalibration();
  const skippedPdf = [];
  const skippedEmpty = [];
  const candidates = [];
  for (const file of files) {
    // Dotfiles are placeholders, not postings. `.gitkeep` is 0 bytes, and the
    // gate returns a real score for it anyway — an empty resume+job prompt
    // still gets an answer. First run measured .gitkeep at 3.440, which is
    // inside the p75–p90 band and silently shifted the upper quantiles.
    // A file too small to contain a job description is skipped for the same
    // reason: it cannot produce a meaningful score, and a score it produces is
    // worse than no score at all.
    if (file.startsWith('.')) {
      skippedEmpty.push(file);
      continue;
    }
    if (/\.(pdf|docx?|png|jpe?g|webp)$/i.test(file)) {
      skippedPdf.push(file);
      continue;
    }
    if (statSync(join(jdsDir, file)).size < MIN_JOB_BYTES) {
      skippedEmpty.push(file);
      continue;
    }
    if (!values.force && byPosting.has(file)) continue;
    candidates.push(file);
  }

  const pendingLines = [];
  const failures = [];
  let done = 0;

  const workerCount = Math.max(1, Math.min(16, Number(values.concurrency) || 4));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < candidates.length) {
        const file = candidates[cursor++];
        const result = await measurePosting(resumePath, join(jdsDir, file));
        done += 1;
        if (result.ok) {
          pendingLines.push(
            [file, result.score.toFixed(3), String(result.hasCoreSkills), new Date().toISOString().slice(0, 10)].join('\t'),
          );
          byPosting.set(file, result.score);
          scores.push(result.score);
        } else {
          failures.push({ file, reason: result.reason });
        }
        if (!values.json) {
          process.stderr.write(`\r  measured ${done}/${candidates.length} — ${file.slice(0, 58).padEnd(58)}`);
        }
      }
    }),
  );
  if (!values.json) process.stderr.write('\r'.padEnd(80) + '\r');

  if (pendingLines.length && !values.dry_run) {
    mkdirSync(join(ROOT, 'data'), { recursive: true });
    const needsHeader = !existsSync(TSV);
    appendFileSync(TSV, `${needsHeader ? `${TSV_HEADER}\n` : ''}${pendingLines.join('\n')}\n`);
  }

  const allScores = [...byPosting.values()];
  const summary = summarize(allScores);
  const fresh = pendingLines.length;
  const report = {
    resume: basename(resumePath),
    corpus: { total: files.length, measuredNow: fresh, skippedNonText: skippedPdf, skippedEmpty, failures },
    dataset: dataFileSummary(values.dry_run),
    summary,
  };

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return failures.length ? 2 : 0;
  }

  const { dataset } = report;
  console.log('\n=== Jev score calibration ===\n');
  console.log(`resume        ${report.resume}`);
  console.log(`corpus        ${report.corpus.total} captures in jds/`);
  console.log(`measured now  ${fresh}${values.dry_run ? '  (dry run, nothing written)' : ''}`);
  console.log(`newly failed  ${failures.length}`);
  if (skippedPdf.length) console.log(`skipped       ${skippedPdf.length} non-text (gatekeeper reads UTF-8 only): ${skippedPdf.join(', ')}`);
  if (skippedEmpty.length) console.log(`skipped       ${skippedEmpty.length} empty/placeholder (not a posting): ${skippedEmpty.join(', ')}`);
  console.log(`dataset       ${dataset.path} — ${dataset.rows} postings${dataset.bad ? `, ${dataset.bad} malformed line(s) skipped` : ''}\n`);

  console.log('quantiles (n=' + summary.n + '):');
  for (const [label] of QUANTILES) {
    console.log(`  ${label.padEnd(4)} ${summary.quantiles[label].toFixed(3)}`);
  }
  console.log(`  min  ${summary.min.toFixed(3)}`);
  console.log(`  max  ${summary.max.toFixed(3)}`);
  console.log(`  mean ${summary.mean.toFixed(3)}\n`);

  const sorted = [...allScores].sort((a, b) => a - b);
  const hist = new Map();
  for (const s of sorted) {
    const bucket = (Math.floor(s * 2) / 2).toFixed(1);
    hist.set(bucket, (hist.get(bucket) || 0) + 1);
  }
  console.log('distribution:');
  for (const [bucket, count] of [...hist.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
    console.log(`  ${bucket.padStart(4)} | ${'#'.repeat(count)} ${count}`);
  }
  console.log('');

  if (failures.length) {
    console.log('failures (excluded from the distribution):');
    for (const f of failures) console.log(`  ${f.file}: ${f.reason}`);
    console.log('');
  }

  console.log('config/profile.yml was NOT modified — reconcile the bands by hand.');
  return failures.length ? 2 : 0;
}

function dataFileSummary(dryRun) {
  const { rows, bad } = readCalibration();
  return { path: 'data/jev-calibration.tsv', rows, bad, dryRun };
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main();
}
