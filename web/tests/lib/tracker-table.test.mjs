import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseApplications } from "../../src/lib/tracker-table.mjs";

const ALIASES = {
  "#": "num",
  date: "date",
  company: "company",
  via: "via",
  role: "role",
  score: "score",
  status: "status",
  pdf: "pdf",
  report: "report",
  notes: "notes",
};

const TRACKER = `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-09-23 | Example | Agency | Frontend Engineer | 4.0/5 | Applied | ✅ | [001](../reports/001-example.md) | fixture |
`;

test("parses header columns when the data root does not contain system files", (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-data-"));
  const systemRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-system-"));
  t.after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    fs.rmSync(systemRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(systemRoot, "tracker-aliases.json"), JSON.stringify(ALIASES));

  assert.deepEqual(parseApplications(TRACKER, dataRoot, systemRoot), [
    {
      n: "1",
      date: "2026-09-23",
      company: "Example",
      via: "Agency",
      role: "Frontend Engineer",
      score: "4.0/5",
      status: "Applied",
      pdf: "✅",
      report: "[001](../reports/001-example.md)",
      notes: "fixture",
    },
  ]);
});
