// CAREER_OPS_PIPELINE (#2271) moves a search lane's inbox to its own file, and
// scan.mjs writes new postings there. The pipeline mode and the scan's closing
// hint have to point at the same file, or the lane's postings stay `- [ ]`
// while `/career-ops pipeline` processes the main inbox (#6379).
//
// Run:  node --test tests/pipeline-lane-inbox.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipelineRunHint } from '../scan.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = readFileSync(join(ROOT, 'modes', 'pipeline.md'), 'utf-8');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end} after ${start}`);
  return text.slice(from, to);
}

test('the scan hint names the lane inbox when CAREER_OPS_PIPELINE is set', () => {
  const hint = pipelineRunHint('data/pipeline.bridge.md');
  assert.match(hint, /\/career-ops pipeline data\/pipeline\.bridge\.md /);
});

test('the scan hint is unchanged without a lane', () => {
  // '' and not undefined: undefined takes the default, process.env.CAREER_OPS_PIPELINE,
  // so a developer with a lane set would see this fail.
  assert.equal(pipelineRunHint(''), '→ Run /career-ops pipeline to evaluate new offers.');
  assert.equal(pipelineRunHint('   '), '→ Run /career-ops pipeline to evaluate new offers.');
});

/**
 * Verifies that a named inbox takes precedence over the Data Root default.
 * @param {object} _testContext Node.js test context.
 * @returns {void}
 */
function pipelineModeKeepsTheDataRootDefault(_testContext) {
  const which = section(mode, '## Which inbox', '## Liveness sweep');
  const named = which.indexOf('names in the request');
  const scanner = which.indexOf('import { PIPELINE_PATH } from "./scan.mjs"');
  assert.ok(named !== -1 && scanner !== -1, 'both sources are listed');
  assert.ok(named < scanner, 'named file, then the scanner path');
  // `./scan.mjs` resolves against the working directory, which is not the
  // checkout when a plugin session starts elsewhere.
  assert.match(which, /Run it from `PROJECT_ROOT`/);
  assert.match(which, /Do not fall back to `\{DATA_ROOT\}\/data\/pipeline\.md`/);
}

test('the pipeline mode takes a named file first, then the path scan.mjs writes to', pipelineModeKeepsTheDataRootDefault);

// scan.mjs loads the data root's .env before it reads CAREER_OPS_PIPELINE, so a
// lane set only there must still reach the mode (a shell-only read misses it).
test('the command the mode runs resolves a lane set only in the data root .env', () => {
  const which = section(mode, '## Which inbox', '## Liveness sweep');
  const command = which.match(/^\s*(node --input-type=module -e .+)$/m)?.[1];
  assert.ok(command, 'the mode shows the resolve command');
  const script = command.match(/-e '(.+)'$/)?.[1];
  assert.ok(script, 'the command carries a single-quoted script');

  const dataRoot = mkdtempSync(join(tmpdir(), 'co-lane-env-'));
  try {
    writeFileSync(join(dataRoot, '.env'), 'CAREER_OPS_PIPELINE=data/pipeline.bridge.md\n');
    const env = { ...process.env, CAREER_OPS_DATA_DIR: dataRoot };
    delete env.CAREER_OPS_PIPELINE;
    delete env.CAREER_OPS_ROOT;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, env, encoding: 'utf-8' });
    assert.equal(out.trim(), 'data/pipeline.bridge.md');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

/**
 * Verifies that the pipeline search uses its resolved inbox variable.
 * @param {object} _testContext Node.js test context.
 * @returns {void}
 */
function pipelineModeSearchesTheResolvedInbox(_testContext) {
  const workflow = section(mode, '## Workflow', '## Format of pipeline.md');
  assert.match(workflow, /searching the resolved `\{INBOX\}`/);
}

test('the pipeline mode searches the resolved inbox, not a hardcoded file', pipelineModeSearchesTheResolvedInbox);
