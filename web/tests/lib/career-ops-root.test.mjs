// Tests for careerOpsRoot() using Node's built-in test runner.
// Imports directly from career-ops-root.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/career-ops-root.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { careerOpsRoot } from "../../src/lib/career-ops-root.mjs";

const ENV_NAMES = ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR"];

function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  try {
    for (const n of ENV_NAMES) {
      if (vars[n] === undefined) delete process.env[n];
      else process.env[n] = vars[n];
    }
    return fn();
  } finally {
    for (const n of ENV_NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}

test("no env: default is cwd/.., not path-resolver's repo-root default", () => {
  withEnv({}, () => {
    assert.equal(careerOpsRoot(), path.resolve(process.cwd(), ".."));
  });
});

test("CAREER_OPS_DATA_DIR alone is honored (absolute)", () => {
  const dataDir = path.join(os.tmpdir(), "career-ops-data-dir-fixture");
  withEnv({ CAREER_OPS_DATA_DIR: dataDir }, () => {
    assert.equal(careerOpsRoot(), path.resolve(dataDir));
  });
});

test("CAREER_OPS_DATA_DIR relative path is resolved against cwd", () => {
  withEnv({ CAREER_OPS_DATA_DIR: "some-data" }, () => {
    assert.equal(careerOpsRoot(), path.resolve("some-data"));
  });
});

test("CAREER_OPS_ROOT still wins when both env vars are set", () => {
  const root = path.join(os.tmpdir(), "career-ops-root-fixture");
  const dataDir = path.join(os.tmpdir(), "career-ops-data-dir-fixture");
  withEnv({ CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: dataDir }, () => {
    assert.equal(careerOpsRoot(), path.resolve(root));
  });
});

test("blank CAREER_OPS_ROOT falls through to CAREER_OPS_DATA_DIR", () => {
  const dataDir = path.join(os.tmpdir(), "career-ops-data-dir-fallback");
  withEnv({ CAREER_OPS_ROOT: "  ", CAREER_OPS_DATA_DIR: dataDir }, () => {
    assert.equal(careerOpsRoot(), path.resolve(dataDir));
  });
});
