// readAwaitingAges joins posting facts by the posting URL. A tracker with no
// URL column still has the report's URL, and that one has to find the facts.
//
// Run:  node --experimental-strip-types --test tests/lib/awaiting-ages-read.test.mjs

import "../helpers/web-ts-alias-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
process.env.CAREER_OPS_CODE_ROOT = repo;

const { readAwaitingAges } = await import("../../src/lib/career-ops.ts");

const TODAY = "2026-11-23";
const POSTING = "https://jobs.example.com/role/42";

function useRoot() {
  const root = mkdtempSync(join(tmpdir(), "co-ages-read-"));
  const saved = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data", "liveness-checks.tsv"), `url\tchecked_at\tresult\n${POSTING}\t2026-11-21\texpired\n`);
  return {
    restore() {
      if (saved === undefined) delete process.env.CAREER_OPS_ROOT;
      else process.env.CAREER_OPS_ROOT = saved;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("a tracker URL finds the stored verdict", async () => {
  const fixture = useRoot();
  try {
    const ages = await readAwaitingAges([{ n: "1", url: POSTING }], TODAY);
    assert.equal(ages["1"].open.state, "closed");
  } finally {
    fixture.restore();
  }
});

test("a row with no tracker URL uses the report-backed URL", async () => {
  const fixture = useRoot();
  try {
    const ages = await readAwaitingAges([{ n: "1", url: "" }], TODAY, () => POSTING);
    assert.equal(ages["1"].open.state, "closed");
    assert.equal(ages["1"].open.checkedDays, 2);
  } finally {
    fixture.restore();
  }
});

test("the tracker URL wins over the fallback", async () => {
  const fixture = useRoot();
  try {
    const ages = await readAwaitingAges([{ n: "1", url: POSTING }], TODAY, () => "https://jobs.example.com/other");
    assert.equal(ages["1"].open.state, "closed");
  } finally {
    fixture.restore();
  }
});
