// tests/verify-cv-facts-data-root.test.mjs — the fabrication gate has to read
// the user's actual cv.md.
//
// verify-cv-facts.mjs enforces the Source-of-Truth Boundary rule AGENTS.md
// states as "Keywords get reformulated, never fabricated": every metric-like
// claim in a generated CV must appear in a primary source file. Its defaults
// resolved neither the sources nor its config from the user's data root:
//
//   const DEFAULT_SOURCES = ['cv.md', 'article-digest.md'];        // -> cwd
//   const DEFAULT_CONFIG  = join(ROOT, 'config', 'cv-facts.json'); // -> CODE root
//
// One invocation therefore failed in both directions at once. With no sources
// found the gate does not fail open quietly — it fails LOUD and WRONG, because
// "no source contains this number" is exactly what it reports for a claim
// copied verbatim out of the user's own CV:
//
//   CV fact check failed: gen.md
//   Metric-like claims absent from sources:
//     - 12 engineers
//
// while simultaneously announcing that the other half of the gate did not run:
//
//   ⚠️  fact-gate config not found: <CHECKOUT>/config/cv-facts.json
//       — forbidden/advisory phrase checks did not run.
//
// A gate that invents failures teaches the user to ignore it, which is worse
// for a fabrication check than being absent.
//
// Run:  node --test tests/verify-cv-facts-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The claim is present verbatim in cv.md, so a correct gate passes it. That is
// the whole measurement: a gate reading no sources reports it as fabricated.
const CV = '# CV\n\n- Led a team of 12 engineers.\n- Cut deploy time by 40 minutes.\n';
const GENERATED = '# Generated CV\n\n- Led a team of 12 engineers.\n';

function fixture({ withConfig = false } = {}) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-factgate-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'career-ops-factdecoy-'));
  writeFileSync(join(dataRoot, 'cv.md'), CV);
  writeFileSync(join(dataRoot, 'generated.md'), GENERATED);
  if (withConfig) {
    mkdirSync(join(dataRoot, 'config'), { recursive: true });
    // Key names lifted from config/cv-facts.example.json, the shipped schema —
    // an invented shape would be silently ignored and the assertion below would
    // then be testing nothing.
    writeFileSync(join(dataRoot, 'config', 'cv-facts.json'),
      JSON.stringify({ forbidden_phrases: ['ninja rockstar'], warn_phrases: [] }, null, 2));
  }
  return { dataRoot, decoyCwd };
}

const cleanup = (f) => {
  for (const d of [f.dataRoot, f.decoyCwd]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};

function run(f, args = []) {
  const r = spawnSync(process.execPath, [join(ROOT, 'verify-cv-facts.mjs'), join(f.dataRoot, 'generated.md'), ...args], {
    cwd: f.decoyCwd, encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: f.dataRoot, CAREER_OPS_DATA_DIR: '' },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('a claim copied verbatim from the user cv.md is not reported as fabricated', () => {
  const f = fixture();
  try {
    const r = run(f);
    assert.doesNotMatch(
      r.all,
      /absent from sources/i,
      `the gate read no sources and invented a fabrication finding:\n${r.all.slice(0, 500)}`,
    );
    assert.match(r.all, /passed/i, `the check did not pass:\n${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('the phrase config is found in the data root, so those checks actually run', () => {
  // The other half. A gate that announces "these checks did not run" and exits
  // 0 is indistinguishable from a gate that ran them and found nothing.
  const f = fixture({ withConfig: true });
  try {
    const r = run(f);
    assert.doesNotMatch(
      r.all,
      /fact-gate config not found/i,
      `the config was looked for outside the data root:\n${r.all.slice(0, 400)}`,
    );
  } finally { cleanup(f); }
});

test('and a forbidden phrase from that config is caught', () => {
  // Proves the config was not merely FOUND but applied — otherwise "no warning
  // about a missing config" would pass on a gate that silently ignored it.
  const f = fixture({ withConfig: true });
  try {
    writeFileSync(join(f.dataRoot, 'generated.md'), '# Generated CV\n\n- Led a team of 12 engineers.\n- A ninja rockstar developer.\n');
    const r = run(f);
    assert.match(r.all, /ninja rockstar/i, `the forbidden phrase was not caught:\n${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('a genuinely fabricated claim is still caught', () => {
  // The guard that matters most: this fix must not buy a pass by reading
  // nothing in the other direction. A number that is in NO source must fail.
  const f = fixture();
  try {
    writeFileSync(join(f.dataRoot, 'generated.md'), '# Generated CV\n\n- Led a team of 900 engineers.\n');
    const r = run(f);
    assert.match(r.all, /900 engineers/, `an invented figure passed the gate:\n${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('--source still overrides the default', () => {
  // Documented escape hatch; anchoring the default must not remove it.
  const f = fixture();
  const other = mkdtempSync(join(tmpdir(), 'career-ops-factalt-'));
  try {
    writeFileSync(join(other, 'alt.md'), '# Alt\n\n- Led a team of 12 engineers.\n');
    const r = run(f, ['--source', join(other, 'alt.md')]);
    assert.doesNotMatch(r.all, /absent from sources/i, `an explicit --source was ignored:\n${r.all.slice(0, 400)}`);
  } finally {
    cleanup(f);
    rmSync(other, { recursive: true, force: true, maxRetries: 10 });
  }
});
