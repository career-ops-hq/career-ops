import { pass, fail } from "./helpers.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const script = fileURLToPath(new URL("../company-history.mjs", import.meta.url));
const header = "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n";

function check(label, run) {
  try {
    run();
    pass(label);
  } catch (err) {
    fail(`${label}: ${err.message}`);
  }
}

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "company-evidence-truth-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CAREER_OPS_")));
  Object.assign(env, { CAREER_OPS_ROOT: root, CAREER_OPS_PORTALS: path.join(root, "portals.yml"), CAREER_OPS_PROFILE: path.join(root, "config/profile.yml") });
  fs.mkdirSync(path.join(root, "data"));
  fs.writeFileSync(env.CAREER_OPS_PORTALS, "companies: []\n");
  const card = () => JSON.parse(execFileSync(process.execPath, [script, "--company", "Globex", "--include-stale"], { cwd: root, env, encoding: "utf8" }));
  const tracker = (status, notes = "—") => fs.writeFileSync(path.join(root, "data/applications.md"), header + `| 1 | 2026-08-01 | Globex | Platform Engineer | 4/5 | ${status} | — | — | ${notes} |\n`);
  try { run({ root, env, card, tracker }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

check("the real single-company CLI distinguishes missing, empty and responded trackers", () => {
  fixture(({ root, env, card, tracker }) => {
    const missing = card();
    assert.equal(missing.metadata.sources.tracker, false);
    fs.writeFileSync(path.join(root, "data/applications.md"), header);
    const empty = card();
    assert.equal(empty.metadata.sources.tracker, true);
    assert.equal(empty.responsiveness.label, "no-history");
    tracker("Interview");
    assert.equal(card().responsiveness.facts[0].outcome, "Interview");
    env.CAREER_OPS_TRACKER = path.join(root, "missing-selected-tracker.md");
    assert.equal(card().metadata.sources.tracker, false);
  });
});

check("the real churn card retains the source cluster role, distinct from the tracker role", () => {
  fixture(({ root, card, tracker }) => {
    tracker("Evaluated");
    fs.writeFileSync(path.join(root, "data/scan-history.tsv"), "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\nhttps://jobs.example.com/sales-1\t2026-08-01\tgreenhouse\tSales Manager\tGlobex\tadded\tRemote\nhttps://jobs.example.com/sales-2\t2026-08-15\tgreenhouse\tSales Manager\tGlobex\tadded\tRemote\n");
    const result = card();
    assert.equal(result.postingChurn.clusters[0].role, "Sales Manager");
    assert.equal(result.postingChurn.label, "reposts-detected");
    assert.equal(result.company, "Globex");
  });
});

check("evaluation fallback dates remain distinct from confirmed application dates", () => {
  fixture(({ card, tracker }) => {
    tracker("Applied");
    const fallback = card().responsiveness.facts[0];
    assert.equal(fallback.dateBasis, "evaluation-date");
    assert.equal(fallback.appliedDate, "2026-08-01");
    tracker("Applied", "Applied 2026-08-20");
    const confirmed = card().responsiveness.facts[0];
    assert.equal(confirmed.dateBasis, "notes");
    assert.equal(confirmed.appliedDate, "2026-08-20");
  });
});
