#!/usr/bin/env node
/**
 * eval-golden.mjs — golden-set eval harness for cheap-model routing (#1354)
 *
 * The *mechanism* in this file is design-invariant: load labeled golden cases,
 * obtain each candidate model's `---SCORE_SUMMARY---` block (replayed from a
 * recorded fixture for $0 deterministic CI, or live via openai-eval.mjs),
 * compare it to the reference label, and exit 0/1 on an aggregate threshold.
 *
 * Labels are frozen reference (Claude-tier) verdicts — the metric is
 * agreement-with-reference, not absolute correctness (see evals/README.md).
 * ARCHETYPE agreement is the gate; SCORE is a secondary tolerance-banded signal.
 *
 * The remaining knobs are surfaced as named constants so they stay trivial to
 * tune, with safe v1 defaults:
 *   - SCORE agreement     → SCORE_TOLERANCE (±band; distance-to-reference)
 *   - CI gate threshold   → MIN_ARCHETYPE_AGREEMENT
 *   - per-model $/run      → COST_PER_RUN_USD (empty until routing rates agreed)
 *
 * Usage:
 *   node eval-golden.mjs --replay --model cheap-stub     # offline, deterministic ($0)
 *   node eval-golden.mjs --live   --model gpt-4o-mini    # calls openai-eval.mjs (needs key + cv.md)
 *   npm run eval:golden -- --replay --model cheap-stub
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(ROOT, 'evals', 'golden');

// ---------------------------------------------------------------------------
// Tunable knobs (#1354), with safe v1 defaults — see evals/README.md.
// ---------------------------------------------------------------------------

/** Max |candidate.score - label.score| still counted as agreement.
 *  v1: a ±band, per the distance-to-reference metric (not exact match). */
const SCORE_TOLERANCE = 0.5;

/** Fraction of cases whose ARCHETYPE must match the label for the gate to pass.
 *  ARCHETYPE exact-match is the clean 0/1 signal hinted at in the issue.
 *  v1 default: 0.8 — tunable when this is wired into the CI job. */
const MIN_ARCHETYPE_AGREEMENT = 0.8;

/** Rough $/run per model id, for the cost column. Empty until the routing
 *  provider rates are agreed (#1354). */
const COST_PER_RUN_USD = {};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`eval-golden.mjs — golden-set eval harness (#1354)

  --replay         Replay recorded fixtures (default; offline, $0, deterministic)
  --live           Call the model live via openai-eval.mjs (needs key + cv.md)
  --model <id>     Candidate model id to evaluate (default: cheap-stub)
  --golden <dir>   Golden-set directory (default: evals/golden)
  --fixtures <dir> Replay fixtures directory (default: sibling of --golden)
  --help           Show this help
`);
  process.exit(0);
}

const mode  = args.includes('--live') ? 'live' : 'replay';
const model = argValue('--model') || 'cheap-stub';
const goldenDir = argValue('--golden') || GOLDEN_DIR;
// Keep fixtures next to the golden set so a custom --golden dir resolves its
// own fixtures (the default lands on evals/fixtures); override with --fixtures.
const fixtureDir = argValue('--fixtures') || join(dirname(goldenDir), 'fixtures');

/**
 * Read the value following a `--flag` token in argv.
 *
 * @param {string} flag - The flag whose following value to return.
 * @returns {string|undefined} The value, or undefined if the flag is absent/last.
 */
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/**
 * Flatten a model id into a filesystem-safe fixture token.
 *
 * Provider ids like "deepseek/deepseek-chat" contain slashes that would be read
 * as path separators; collapse any non-[A-Za-z0-9._-] run to a single "-" so the
 * fixture stays a single flat file.
 *
 * @param {string} m - The candidate model id.
 * @returns {string} A path-safe token for the fixture filename.
 */
function fixtureModelId(m) {
  return m.replace(/[^A-Za-z0-9._-]+/g, '-');
}

// ---------------------------------------------------------------------------
// Shared SCORE_SUMMARY parser — same contract every *-eval.mjs already emits.
// ---------------------------------------------------------------------------

/**
 * Parse the machine-readable summary block produced by the eval scripts.
 *
 * @param {string} text - Raw model output containing a SCORE_SUMMARY block.
 * @returns {{score: number, archetype: string}} Parsed score/archetype; score
 *   is NaN and archetype is "unknown" when the block is missing or malformed.
 */
function parseSummary(text) {
  const block = text.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
  const field = (key) => {
    const m = block && block[1].match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : '';
  };
  return {
    score:     parseFloat(field('SCORE')),
    archetype: (field('ARCHETYPE') || 'unknown').toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// Obtain one candidate completion (replay fixture or live openai-eval call).
// ---------------------------------------------------------------------------

/**
 * Return the candidate model's raw evaluation text for one golden case.
 *
 * In replay mode this reads a recorded fixture so the gate is offline and
 * deterministic; in live mode it shells out to openai-eval.mjs, reusing the
 * real prompt-assembly path rather than duplicating it here.
 *
 * @param {{id: string, jd: string}} testCase - The golden case being run.
 * @returns {string} Raw model output (expected to contain a SCORE_SUMMARY block).
 */
function getCompletion(testCase) {
  if (mode === 'replay') {
    // Slash-form provider ids (e.g. "deepseek/deepseek-chat") must not become
    // path separators, or the fixture lands in a phantom subdirectory. Sanitize
    // to a flat filename — record fixtures under the same sanitized name.
    const fixture = join(fixtureDir, `${testCase.id}__${fixtureModelId(model)}.txt`);
    if (!existsSync(fixture)) {
      throw new Error(`missing replay fixture: ${fixture} — record it or run --live`);
    }
    return readFileSync(fixture, 'utf8');
  }

  // live: write the JD to a temp file and run the existing evaluator.
  const dir = mkdtempSync(join(tmpdir(), 'eval-golden-'));
  try {
    const jdFile = join(dir, 'jd.txt');
    writeFileSync(jdFile, testCase.jd);
    const res = spawnSync(process.execPath,
      [join(ROOT, 'openai-eval.mjs'), '--file', jdFile, '--model', model, '--no-save'],
      { encoding: 'utf8', env: process.env, timeout: 360000 });
    if (res.status !== 0) {
      throw new Error(`openai-eval.mjs exited ${res.status}: ${(res.stderr || '').slice(0, 200)}`);
    }
    return res.stdout || '';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Median of a numeric array (0 for an empty array).
 *
 * @param {number[]} xs - Values to summarize.
 * @returns {number} The median value.
 */
function median(xs) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
if (!existsSync(goldenDir)) {
  console.error(`❌  golden-set directory not found: ${goldenDir}`);
  process.exit(1);
}

let cases;
try {
  cases = readdirSync(goldenDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const parsed = JSON.parse(readFileSync(join(goldenDir, f), 'utf8'));
      if (typeof parsed?.id !== 'string' ||
          typeof parsed?.jd !== 'string' ||
          typeof parsed?.label?.archetype !== 'string' ||
          typeof parsed?.label?.score !== 'number') {
        throw new Error(`invalid golden case ${f}: need string id/jd and label.{archetype:string, score:number}`);
      }
      return parsed;
    });
} catch (err) {
  console.error(`❌  ${err.message || err}`);
  process.exit(1);
}

if (cases.length === 0) {
  console.error(`❌  no golden cases (*.json) in ${goldenDir}`);
  process.exit(1);
}

console.log(`\ngolden-set eval — model "${model}" (${mode}), ${cases.length} case(s)`);
console.log(`(row ✅ needs both archetype + score; the gate counts archetype agreement only)\n`);

let archetypeHits = 0;
const deltas = [];
const latencies = [];

for (const tc of cases) {
  const t0 = Date.now();
  let parsed;
  try {
    parsed = parseSummary(getCompletion(tc));
  } catch (err) {
    console.log(`  ❌ ${tc.id}: ${err.message}`);
    deltas.push(NaN);
    continue;
  }
  const latencyMs = Date.now() - t0;
  latencies.push(latencyMs);

  const archetypeMatch = parsed.archetype === String(tc.label.archetype).toLowerCase();
  const delta = Math.abs(parsed.score - tc.label.score);
  const scoreOk = Number.isFinite(delta) && delta <= SCORE_TOLERANCE;
  if (archetypeMatch) archetypeHits++;
  deltas.push(delta);

  const ok = archetypeMatch && scoreOk;
  console.log(
    `  ${ok ? '✅' : '❌'} ${tc.id}: ` +
    `archetype ${parsed.archetype} vs ${String(tc.label.archetype).toLowerCase()} ` +
    `(${archetypeMatch ? 'match' : 'MISS'}); ` +
    `score ${parsed.score} vs ${tc.label.score} (Δ${Number.isFinite(delta) ? delta.toFixed(2) : 'n/a'}); ` +
    `${mode === 'live' ? `${latencyMs}ms` : 'replay'}`,
  );
}

const agreement = archetypeHits / cases.length;
const finiteDeltas = deltas.filter(Number.isFinite);
const meanDelta = finiteDeltas.length ? finiteDeltas.reduce((a, b) => a + b, 0) / finiteDeltas.length : NaN;
// Cases whose SCORE was missing/malformed produce a NaN delta and drop out of
// the mean — surface that count so a model can't hide failures behind a low mean.
const unscored = cases.length - finiteDeltas.length;
const cost = COST_PER_RUN_USD[model];

console.log('\n  ── summary ──');
console.log(`  archetype agreement : ${(agreement * 100).toFixed(0)}%  (gate ≥ ${(MIN_ARCHETYPE_AGREEMENT * 100).toFixed(0)}%)`);
console.log(`  mean |Δscore|       : ${Number.isFinite(meanDelta) ? meanDelta.toFixed(2) : 'n/a'}  over ${finiteDeltas.length}/${cases.length} scored${unscored ? ` (${unscored} unscored)` : ''}  (tolerance ±${SCORE_TOLERANCE})`);
if (mode === 'live') console.log(`  median latency      : ${median(latencies)}ms`);
console.log(`  est. $/run          : ${cost != null ? `$${cost}` : 'n/a — TODO(#1354)'}`);

const passed = agreement >= MIN_ARCHETYPE_AGREEMENT;
console.log(`\n  ${passed ? '✅ PASS' : '❌ FAIL'} — archetype agreement ${passed ? 'meets' : 'below'} gate\n`);
process.exit(passed ? 0 : 1);
