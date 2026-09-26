// tests/batch-evaluate-data-root.test.mjs — batch-evaluate-gemini's PATHS table
// puts every user-layer entry under the data root.
//
// Two of its entries pointed at the CODE root while its two siblings pointed at
// the data root for the same files:
//
//                        batch-evaluate-gemini   gemini-eval / ollama-eval
//   modes/_profile.md    ROOT                    DATA_ROOT
//   batch/tracker-additions ROOT                 DATA_ROOT
//   cv.md                DATA_ROOT               DATA_ROOT
//   config/profile.yml   DATA_ROOT               DATA_ROOT
//   reports/             DATA_ROOT               DATA_ROOT
//
// _profile.md carries the archetypes and North Star every A-F evaluation scores
// against. Read from the code root it is the shipped template, which is exactly
// what AGENTS.md's `unpersonalized` warning exists to prevent — and that warning
// cannot fire here, because this never looked at the data root at all.
//
// tracker-additions is the batch's OUTPUT, and merge-tracker.mjs:65 reads it
// from DATA_ROOT. Written to the code root the rows are never merged, including
// by the merge batch-evaluate spawns itself at the end of a run.
//
// Asserted against the module's own exported PATHS under a configured root,
// rather than by grepping source, so the table is checked as it resolves.
//
// Run:  node --test tests/batch-evaluate-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Resolved in a child so CAREER_OPS_ROOT is read at module load, which is when
// getCareerOpsRoot() runs.
function resolvedPaths(dataRoot, cwd, { via = 'CAREER_OPS_ROOT' } = {}) {
  // Fenced with a sentinel rather than sliced at the first '{'. batch-evaluate
  // imports dotenv, which prints a banner to stdout that itself contains '{',
  // so indexOf('{') parses the banner and reports confident nonsense.
  const script = `
    const { PATHS } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'batch-evaluate-gemini.mjs')).href)});
    process.stdout.write('<<<PATHS>>>' + JSON.stringify(PATHS) + '<<<END>>>');
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd, encoding: 'utf-8', timeout: 60_000,
    // CAREER_OPS_TRACKER cleared because path-resolver ranks it above the
    // resolved root; left inherited, a developer who exports it would have
    // these spawns ignore the fixture entirely (#3988).
    env: {
      ...process.env,
      CAREER_OPS_ROOT: via === 'CAREER_OPS_ROOT' ? dataRoot : '',
      CAREER_OPS_DATA_DIR: via === 'CAREER_OPS_DATA_DIR' ? dataRoot : '',
      CAREER_OPS_TRACKER: '',
    },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  assert.equal(r.status, 0, `child exited ${r.status}: ${r.stderr}`);
  const m = r.stdout.match(/<<<PATHS>>>([\s\S]*?)<<<END>>>/);
  assert.ok(m, `no PATHS payload in child stdout: ${r.stdout.slice(0, 300)}`);
  return JSON.parse(m[1]);
}

function roots() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-batcheval-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'career-ops-batchdecoy-'));
  mkdirSync(join(dataRoot, 'modes'), { recursive: true });
  mkdirSync(join(dataRoot, 'batch'), { recursive: true });
  return { dataRoot, decoyCwd };
}
const cleanup = (f) => { for (const d of [f.dataRoot, f.decoyCwd]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); };

test('modes/_profile.md resolves under the data root', () => {
  const f = roots();
  try {
    const p = resolvedPaths(f.dataRoot, f.decoyCwd);
    assert.ok(
      p.profile.startsWith(f.dataRoot),
      `_profile.md resolved to ${p.profile} — outside the data root, so every A-F score uses the shipped template's targeting`,
    );
  } finally { cleanup(f); }
});

test('batch/tracker-additions resolves where merge-tracker reads it', () => {
  // Agreement, not a literal path: merge-tracker.mjs is the only consumer, and
  // the two have to name the same directory or the rows are never merged.
  const f = roots();
  try {
    const p = resolvedPaths(f.dataRoot, f.decoyCwd);
    // merge-tracker.mjs:65 resolves join(DATA_ROOT, 'batch/tracker-additions');
    // recomputed here rather than imported, because importing merge-tracker for
    // one constant pulls in its lock and tracker machinery.
    const expected = join(f.dataRoot, 'batch', 'tracker-additions');
    assert.equal(
      p.trackerAdditions, expected,
      `the batch writes additions to ${p.trackerAdditions} but merge-tracker reads ${expected}`,
    );
  } finally { cleanup(f); }
});

test('the system-layer entries still resolve from the CODE root', () => {
  // The other half of the split. modes/_shared.md and modes/oferta.md ship with
  // the code and are absent from a user's data root, so a blanket move to
  // DATA_ROOT would have broken every batch evaluation.
  const f = roots();
  try {
    const p = resolvedPaths(f.dataRoot, f.decoyCwd);
    assert.ok(p.shared.startsWith(ROOT), `modes/_shared.md resolved to ${p.shared}, outside the checkout`);
    assert.ok(p.oferta.startsWith(ROOT), `modes/oferta.md resolved to ${p.oferta}, outside the checkout`);
  } finally { cleanup(f); }
});

test('nothing in the table resolves against the cwd', () => {
  const f = roots();
  try {
    const p = resolvedPaths(f.dataRoot, f.decoyCwd);
    const strays = Object.entries(p).filter(([, v]) => typeof v === 'string' && v.startsWith(f.decoyCwd));
    assert.deepEqual(strays, [], `PATHS entries resolved against the working directory: ${JSON.stringify(strays)}`);
  } finally { cleanup(f); }
});

test('the three evaluators agree on which root each user-layer file uses', () => {
  // The structural half, and the reason this bug existed: two siblings read the
  // same files from the data root and this one did not. Checked as a comparison
  // between them so a future divergence reddens whichever file drifts.
  const files = ['batch-evaluate-gemini.mjs', 'gemini-eval.mjs', 'ollama-eval.mjs'];
  const offenders = [];
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    for (const line of src.split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      // a user-layer path joined onto a code-root constant
      if (/join\(\s*(ROOT|CODE_ROOT)\s*,\s*'modes'\s*,\s*'_(profile|custom|brief)/.test(line)) offenders.push(`${file}: ${line.trim()}`);
      if (/join\(\s*(ROOT|CODE_ROOT)\s*,\s*'(cv\.md|batch'|config')/.test(line)) offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `user-layer paths joined onto the code root:\n${offenders.join('\n')}`);
});

test('CAREER_OPS_DATA_DIR selects the same root as CAREER_OPS_ROOT', () => {
  // AGENTS.md documents both as ways to set the data root, and path-resolver
  // treats DATA_DIR as the fallback when ROOT is unset:
  //
  //   const env = process.env.CAREER_OPS_ROOT?.trim() || process.env.CAREER_OPS_DATA_DIR?.trim();
  //
  // Every suite in this repo that mentions DATA_DIR sets it to '' to clear it;
  // none passes a real value, so the documented fallback was exercised nowhere.
  // A user who configured the data root that way had no test standing behind
  // them.
  const f = roots();
  try {
    const viaRoot = resolvedPaths(f.dataRoot, f.decoyCwd, { via: 'CAREER_OPS_ROOT' });
    const viaDataDir = resolvedPaths(f.dataRoot, f.decoyCwd, { via: 'CAREER_OPS_DATA_DIR' });
    assert.deepEqual(
      viaDataDir, viaRoot,
      'CAREER_OPS_DATA_DIR resolved a different table than CAREER_OPS_ROOT for the same directory',
    );
    assert.ok(viaDataDir.profile.startsWith(f.dataRoot), `_profile.md resolved to ${viaDataDir.profile}`);
  } finally { cleanup(f); }
});
