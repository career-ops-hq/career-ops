/**
 * Regression: Explore's ISO publication date must survive Add to Pipeline.
 *
 * This executes the real web writer (pipeline.ts) and canonical scan.mjs
 * writers against a disposable data root. The only source substitution is
 * Next's @/lib/career-ops alias, which Node's test runner cannot resolve.
 * Any referenced sibling writer-result helper is staged unchanged beside the
 * temporary .mts module to preserve relative ESM imports.
 * No dashboard, ATS network request, LLM, or real user data is involved.
 *
 * Run from web/: node --experimental-strip-types --test tests/lib/explore-posted-at.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sourcePath = path.join(repo, 'web', 'src', 'lib', 'core', 'pipeline.ts');
const scanPath = path.join(repo, 'scan.mjs');
const todayPath = path.join(repo, 'lib', 'local-today.mjs');
const pipelineReaderPath = path.join(repo, 'web', 'src', 'lib', 'pipeline-table.mjs');
const historyReaderPath = path.join(repo, 'lib', 'scan-history-columns.mjs');

function historyRows(tsv, parseRow) {
  return tsv.split(/\r?\n/).filter(Boolean).slice(1).map(parseRow);
}

test('Explore add preserves a valid posting date in pipeline and scan history', async (t) => {
  for (const file of [sourcePath, scanPath, todayPath, pipelineReaderPath, historyReaderPath]) {
    assert.ok(fs.statSync(file).isFile(), `Missing required file: ${file}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-explore-date-test-'));
  const pipelinePath = path.join(tmp, 'data', 'pipeline.md');
  const historyPath = path.join(tmp, 'data', 'scan-history.tsv');
  assert.notEqual(tmp, repo);
  assert.ok(tmp.startsWith(path.join(os.tmpdir(), 'career-ops-explore-date-test-')));

  const envKeys = [
    'CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PIPELINE',
    'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_PROFILE',
    'CAREER_OPS_TRACKER', 'CAREER_OPS_PORTALS',
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of envKeys) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  process.env.CAREER_OPS_ROOT = tmp;
  process.env.CAREER_OPS_DATA_DIR = tmp;
  process.env.CAREER_OPS_PIPELINE = pipelinePath;
  process.env.CAREER_OPS_SCAN_HISTORY = historyPath;
  process.env.CAREER_OPS_PROFILE = path.join(tmp, 'config', 'profile.yml');
  process.env.CAREER_OPS_TRACKER = path.join(tmp, 'data', 'applications.md');
  process.env.CAREER_OPS_PORTALS = path.join(tmp, 'portals.yml');

  // pipeline.ts currently imports localToday from careerOpsRoot()/lib. Stage
  // that system module inside the throwaway root (independent of PR #4430).
  fs.mkdirSync(path.join(tmp, 'lib'), { recursive: true });
  fs.copyFileSync(todayPath, path.join(tmp, 'lib', 'local-today.mjs'));

  const original = fs.readFileSync(sourcePath, 'utf8');
  const alias = 'import { careerOpsRoot, rootScript } from "@/lib/career-ops";';
  assert.equal(original.split(alias).length - 1, 1,
    'The web writer import changed; update this test rather than testing a mock');
  assert.match(original, /export function addOffersToPipeline\(/);
  const shim = `const careerOpsRoot = () => ${JSON.stringify(tmp)};\n`
    + `const rootScript = (name) => {\n`
    + `  if (name !== "scan") throw new Error("Unexpected script name: " + name);\n`
    + `  return ${JSON.stringify(scanPath)};\n};`;
  // Node >=22.6.0 supports --experimental-strip-types for .mts files,
  // but node:module.stripTypeScriptTypes() was only added in 22.13.0.
  // A newer pipeline.ts may import a sibling writer-result helper. Keep its
  // relative import resolvable when the source is loaded from this temp root.
  if (/from\s+["']\.\/pipeline-writer-result\.mjs["']/.test(original)) {
    const helperName = 'pipeline-writer-result.mjs';
    fs.copyFileSync(
      path.join(path.dirname(sourcePath), helperName),
      path.join(tmp, helperName),
    );
  }
  const runtimePath = path.join(tmp, 'pipeline-for-test.mts');
  fs.writeFileSync(runtimePath, original.replace(alias, shim), 'utf8');
  const webWriter = await import(pathToFileURL(runtimePath).href);
  const { parseInbox } = await import(pathToFileURL(pipelineReaderPath).href);
  const { parseScanHistoryLine } = await import(pathToFileURL(historyReaderPath).href);
  const core = await import(pathToFileURL(scanPath).href);

  // Fail BEFORE spawning/writing if either canonical writer targets real data.
  assert.equal(resolvePath(core.PIPELINE_PATH), resolvePath(pipelinePath));
  assert.equal(resolvePath(core.SCAN_HISTORY_PATH), resolvePath(historyPath));

  const base = {
    company: 'Example Co', title: 'Software Engineer', location: 'Remote',
    source: 'fixture', ats: 'fixture', note: '', postedAt: '2026-09-01',
  };
  const cases = [
    { id: '1001', postedAt: '2026-09-01', expected: '2026-09-01' },
    { id: '1002', postedAt: '', expected: '' },
    { id: '1003', postedAt: 'not-a-date', expected: '' },
    { id: '1004', postedAt: '2026-02-30', expected: '' },
    { id: '1005', postedAt: '2024-02-29', expected: '2024-02-29' },
    { id: '1006', postedAt: '2026-12-31', expected: '2026-12-31' },
  ];

  for (const { id, postedAt, expected } of cases) {
    const url = `https://example.invalid/jobs/${id}`;
    const result = await webWriter.addOffersToPipeline([{ ...base, url, postedAt }]);
    assert.equal(result.added, 1, `Writer added count for ${JSON.stringify(postedAt)}`);
    assert.equal(result.error, undefined, `Writer failed for ${JSON.stringify(postedAt)}`);
    const inbox = parseInbox(fs.readFileSync(pipelinePath, 'utf8'));
    const history = historyRows(fs.readFileSync(historyPath, 'utf8'), parseScanHistoryLine);
    const pipelineRow = inbox.find((row) => row.url === url);
    const historyRow = history.find((row) => row.url === url);
    assert.ok(pipelineRow, `Pipeline row missing: ${id}`);
    assert.ok(historyRow, `History row missing: ${id}`);
    assert.equal(pipelineRow.postedAt ?? '', expected, `Pipeline date for ${JSON.stringify(postedAt)}`);
    assert.equal(historyRow.posted_at, expected, `History date for ${JSON.stringify(postedAt)}`);
    assert.match(historyRow.first_seen, /^\d{4}-\d{2}-\d{2}$/);
    if (expected) {
      // This is the same precedence as the evaluate route: known posting date
      // wins over the first-seen fallback, without launching a paid evaluation.
      assert.equal(pipelineRow.postedAt ?? historyRow.first_seen, expected);
    }
  }
});
