// CAREER_OPS_PIPELINE (#2271) moves a search lane's inbox to its own file, and
// scan.mjs writes new postings there. The pipeline mode and the scan's closing
// hint have to point at the same file, or the lane's postings stay `- [ ]`
// while `/career-ops pipeline` processes the main inbox (#6379).
//
// Run:  node --test tests/pipeline-lane-inbox.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.equal(pipelineRunHint(undefined), '→ Run /career-ops pipeline to evaluate new offers.');
  assert.equal(pipelineRunHint('   '), '→ Run /career-ops pipeline to evaluate new offers.');
});

test('the pipeline mode resolves the inbox from CAREER_OPS_PIPELINE before the default', () => {
  const which = section(mode, '## Which inbox', '## Liveness sweep');
  const named = which.indexOf('names in the request');
  const lane = which.indexOf('CAREER_OPS_PIPELINE');
  const fallback = which.indexOf('Otherwise the inbox is `data/pipeline.md`');
  assert.ok(named !== -1 && lane !== -1 && fallback !== -1, 'all three sources are listed');
  assert.ok(named < lane && lane < fallback, 'named file, then the lane variable, then the default');
  assert.match(which, /Do not fall back to `data\/pipeline\.md`/);
});

test('the pipeline mode searches the resolved inbox, not a hardcoded file', () => {
  const workflow = section(mode, '## Workflow', '## Format of pipeline.md');
  assert.match(workflow, /searching `\{INBOX\}`/);
});
