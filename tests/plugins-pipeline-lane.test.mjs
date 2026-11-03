// tests/plugins-pipeline-lane.test.mjs — #6353: plugins.mjs honors the
// CAREER_OPS_PIPELINE lane override everywhere it touches the pipeline.
//
// The write went through scan.mjs's appendToPipeline(), which honors the lane,
// but plugins.mjs hardcoded data/pipeline.md for the de-duplication read
// (existingPipelineUrls) and for the export snapshot (buildSnapshot). With a
// second lane set, an ingest re-appended leads already in that lane and
// skipped leads that only the main pipeline held.
//
// Each case runs in a child process so the module-level path constants are
// evaluated against that case's environment, not whichever environment first
// imported plugins.mjs or scan.mjs in a shared test process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, rmSync } from './helpers.mjs';

const PROBE = `
const m = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'plugins.mjs')).href)});
const snap = m._testBuildSnapshot();
// The same de-dup path cmdRun's ingest/search branch takes: the lane's URLs
// feed admitPluginJobs(), which keeps only leads the lane does not hold yet.
const found = ['https://example.com/lane/1', 'https://example.com/main/1', 'https://example.com/new/1']
  .map((url) => ({ title: 'Engineer', company: 'Example', url }));
const { jobs } = m.admitPluginJobs(found, { id: 'probe', pipelineUrls: m._testExistingPipelineUrls() });
process.stdout.write(JSON.stringify({
  pipelinePath: m._testPaths.PIPELINE_PATH,
  snapshotUrls: snap.pipeline.map((e) => e.url),
  admittedUrls: jobs.map((j) => j.url),
}));
`;

function probe(env) {
  const childEnv = { ...process.env, ...env };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', PROBE], {
    cwd: ROOT, env: childEnv, encoding: 'utf8',
  });
  return JSON.parse(out);
}

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-plugins-lane-')));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), '# Applications Tracker\n');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n- [ ] https://example.com/main/1\n');
  const lane = join(dir, 'data', 'pipeline-other.md');
  writeFileSync(lane, '# Pipeline\n- [ ] https://example.com/lane/1\n- [x] https://example.com/lane/2\n');
  return { dir, lane };
}

const BASE_ENV = { CAREER_OPS_DATA_DIR: undefined, CAREER_OPS_TRACKER: undefined, CAREER_OPS_SCAN_HISTORY: undefined };

test('with CAREER_OPS_PIPELINE set, de-dup and export read the lane file', (t) => {
  const { dir, lane } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const got = probe({ ...BASE_ENV, CAREER_OPS_ROOT: dir, CAREER_OPS_PIPELINE: lane });
  assert.equal(got.pipelinePath, lane);
  assert.deepEqual(got.snapshotUrls, ['https://example.com/lane/1', 'https://example.com/lane/2']);
  // A lead already in the lane is skipped; one only the main pipeline holds is admitted to the lane.
  assert.deepEqual(got.admittedUrls, ['https://example.com/main/1', 'https://example.com/new/1']);
});

test('without CAREER_OPS_PIPELINE, the data-root pipeline is used', (t) => {
  const { dir } = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const got = probe({ ...BASE_ENV, CAREER_OPS_ROOT: dir, CAREER_OPS_PIPELINE: undefined });
  assert.equal(got.pipelinePath, join(dir, 'data', 'pipeline.md'));
  assert.deepEqual(got.snapshotUrls, ['https://example.com/main/1']);
  assert.deepEqual(got.admittedUrls, ['https://example.com/lane/1', 'https://example.com/new/1']);
});
