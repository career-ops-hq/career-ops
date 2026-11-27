import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reopenApplyOptions } from "../../src/lib/apply/reopen-options.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("rereading the same form keeps the tracker row", () => {
  assert.deepEqual(
    reopenApplyOptions("https://jobs.example.com/role", {
      url: "https://jobs.example.com/role",
      n: "12",
      from: "/pipeline",
      company: "Example",
    }),
    { n: "12", from: "/pipeline", company: "Example" },
  );
});

test("a different form does not keep the previous tracker row", () => {
  assert.equal(
    reopenApplyOptions("https://jobs.example.com/other", {
      url: "https://jobs.example.com/role",
      n: "12",
    }),
    undefined,
  );
});

test("a failed read offers the checklist for that tracker row", () => {
  const src = readFileSync(join(here, "../../src/components/apply-view.tsx"), "utf8");
  const start = src.indexOf("Open the form directly");
  const end = src.indexOf("a.status === \"error\" && <ApplyExitBar />");
  assert.ok(start !== -1 && end > start);
  const block = src.slice(start, end);
  assert.match(block, /checklistHrefFor\(a\.n\)/);
  assert.match(src, /reopenApplyOptions\(input\.trim\(\), a\)/);
  assert.match(src, /checklist-href\.mjs/);
  assert.doesNotMatch(src, /unsupported-ats/);
});

test("a marked tracker with no report number still shows the missing-file note", () => {
  const src = readFileSync(join(here, "../../src/app/pipeline/[id]/apply/page.tsx"), "utf8");
  assert.match(src, /pdfNote=\{reportNum != null && trackerMarked && resume === null \? null : disk\.note\}/);
});
