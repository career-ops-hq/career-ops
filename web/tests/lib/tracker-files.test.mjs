import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveTrackerPath as coreResolve } from "../../../path-resolver.mjs";
import { resolveTrackerPath, readTrackerFile } from "../../src/lib/core/tracker-files.mjs";

test("web tracker and ledger follow the core resolver across supported layouts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-files-"));
  const prior = process.env.CAREER_OPS_TRACKER;
  try {
    delete process.env.CAREER_OPS_TRACKER;
    for (const directory of [root, path.join(root, "data"), path.join(root, "custom")]) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "applications.md"), directory);
      fs.writeFileSync(path.join(directory, "status-log.tsv"), "ledger:" + directory);
    }
    const check = (directory) => {
      assert.equal(resolveTrackerPath(root), coreResolve(root));
      assert.equal(readTrackerFile(root), directory);
      assert.equal(readTrackerFile(root, "status-log.tsv"), "ledger:" + directory);
    };
    check(path.join(root, "data"));
    fs.unlinkSync(path.join(root, "data/applications.md"));
    check(root);
    process.env.CAREER_OPS_TRACKER = path.join(root, "custom/applications.md");
    check(path.join(root, "custom"));
    process.env.CAREER_OPS_TRACKER = path.relative(process.cwd(), path.join(root, "custom/applications.md"));
    check(path.join(root, "custom"));
    fs.symlinkSync(path.join(root, "custom/applications.md"), path.join(root, "linked.md"));
    process.env.CAREER_OPS_TRACKER = path.join(root, "linked.md");
    check(path.join(root, "custom"));
    fs.unlinkSync(path.join(root, "custom/status-log.tsv"));
    assert.equal(readTrackerFile(root, "status-log.tsv"), null);
    fs.mkdirSync(path.join(root, "custom/status-log.tsv"));
    assert.throws(() => readTrackerFile(root, "status-log.tsv"), { code: "EISDIR" });
  } finally {
    if (prior === undefined) delete process.env.CAREER_OPS_TRACKER;
    else process.env.CAREER_OPS_TRACKER = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
