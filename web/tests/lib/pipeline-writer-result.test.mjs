// The "Add to pipeline" writer child (src/lib/core/pipeline.ts) answers with
// one JSON line. A child that crashes before answering, e.g. because scan.mjs
// fails to import, printed nothing on stdout, and that empty answer parsed as
// `{}`: "added 0, no error", the same answer as "nothing new to add".
//
// Run (from web/, as `npm test` does):  node --test tests/lib/pipeline-writer-result.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pipelineWriterResult } from "../../src/lib/core/pipeline-writer-result.mjs";

const PIPELINE_TS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "lib", "core", "pipeline.ts");

test("the writer's own answer passes through", () => {
  assert.deepEqual(pipelineWriterResult('{"added":3}', "", { code: 0, signal: null }), { added: 3 });
  assert.deepEqual(
    pipelineWriterResult('{"added":0,"error":"lock timeout"}', "", { code: 0, signal: null }),
    { added: 0, error: "lock timeout" },
  );
});

test("a stray line before the answer does not hide it", () => {
  assert.deepEqual(pipelineWriterResult('[dotenv] loaded\n{"added":2}', "", { code: 0, signal: null }), { added: 2 });
});

test("a child that crashed on import reports an error, not a silent added:0", () => {
  // The real shape of that crash: the same kind of `-e` module child, whose
  // import cannot resolve.
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", 'import "./does-not-exist-scan.mjs";'], {
    encoding: "utf8",
  });
  assert.equal(child.stdout, "");
  const result = pipelineWriterResult(child.stdout, child.stderr, { code: child.status, signal: child.signal });
  assert.equal(result.added, 0);
  assert.match(result.error ?? "", /pipeline writer failed \(exit code 1\): .*ERR_MODULE_NOT_FOUND|Cannot find module/);
});

test("a killed child with no output still reports an error", () => {
  const result = pipelineWriterResult("", "", { code: null, signal: "SIGKILL" });
  assert.deepEqual(result, { added: 0, error: "pipeline writer failed (killed by SIGKILL)" });
});

test("output that is not the writer's answer is a failure", () => {
  assert.equal(pipelineWriterResult("{}", "", { code: 0, signal: null }).error, "pipeline writer failed (no result)");
  assert.match(pipelineWriterResult("not json", "boom", { code: 2, signal: null }).error ?? "", /exit code 2\): boom/);
});

test("pipeline.ts reads the child's answer through this helper", () => {
  const src = readFileSync(PIPELINE_TS, "utf8");
  assert.match(src, /child\.on\("close", \(code, signal\) => resolve\(pipelineWriterResult\(out, err, \{ code, signal \}\)\)\)/);
  assert.doesNotMatch(src, /out\.trim\(\) \|\| "\{\}"/);
});
