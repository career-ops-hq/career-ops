import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";
import { parseInbox } from "../../src/lib/pipeline-table.mjs";

test("adding a freelance offer preserves its type through the canonical pipeline writer and reader", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-freelance-pipeline-"));
  const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const saved = {
    CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT,
    CAREER_OPS_CODE_ROOT: process.env.CAREER_OPS_CODE_ROOT,
  };
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  const { addOffersToPipeline } = await import("@/lib/core/pipeline");
  const result = await addOffersToPipeline([{
    url: "https://example.test/freelance-designer",
    company: "Acme",
    title: "Freelance Designer",
    location: "Lisboa, Portugal",
    postedAt: "",
    ats: "wttj",
    source: "wttj-api",
    opportunityType: "freelance",
  }]);

  assert.equal(result.added, 1);
  assert.equal(result.error, undefined);
  const markdown = fs.readFileSync(path.join(dataRoot, "data", "pipeline.md"), "utf8");
  assert.match(markdown, /\| type: freelance(?:\n|\|)/);
  assert.equal(parseInbox(markdown)[0].opportunityType, "freelance");
});
