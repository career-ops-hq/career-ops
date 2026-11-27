// tests/verify-pipeline-posting-url-duplicates.test.mjs — Check 2 must not
// report two rows as "possible duplicates" when their posting URLs name two
// different postings.
//
// One title posted per country is two openings: merge-tracker.mjs keeps both
// rows and dedup-tracker.mjs keeps both, because the reports' **URL:** headers
// differ. The default nine-column tracker has no URL cell, so the report is the
// only place that URL lives. A missing URL proves nothing, so those rows still
// warn, as do two rows on one posting URL.
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pass, fail, ROOT, NODE, rmSync } from "./helpers.mjs";

console.log(
  "\nverify-pipeline — Check 2 keeps rows with different posting URLs apart",
);

const tmp = mkdtempSync(join(tmpdir(), "co-vp-url-dup-"));
try {
  const data = join(tmp, "data");
  const reports = join(tmp, "reports");
  mkdirSync(data, { recursive: true });
  mkdirSync(reports, { recursive: true });
  const tracker = join(data, "applications.md");

  const HEADER =
    "# Applications Tracker\n\n" +
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n" +
    "|---|------|---------|------|-------|--------|-----|--------|-------|\n";
  const URL_HEADER =
    "# Applications Tracker\n\n" +
    "| # | Date | Company | Role | URL | Score | Status | PDF | Report | Notes |\n" +
    "|---|------|---------|------|-----|-------|--------|-----|--------|-------|\n";
  const report = (num, url) => {
    const name = `${num}-acme-2026-11-01.md`;
    writeFileSync(
      join(reports, name),
      `# Evaluation: Acme — Senior Data Engineer\n\n**Date:** 2026-11-01\n**Score:** 4.0/5\n**URL:** ${url}\n**PDF:** ❌\n`,
      "utf-8",
    );
    return `[${num}](../reports/${name})`;
  };
  const row = (num, company, reportCell) =>
    `| ${num} | 2026-11-01 | ${company} | Senior Data Engineer | 4.0/5 | Evaluated | ❌ | ${reportCell} | — |\n`;
  const urlRow = (num, url) =>
    `| ${num} | 2026-11-01 | Acme | Senior Data Engineer | ${url} | 4.0/5 | Evaluated | ❌ | — | — |\n`;
  const greenhouse = (id) => `https://job-boards.greenhouse.io/acme/jobs/${id}`;

  // Exit status is asserted before any match, so a crashed run cannot be read
  // as "no warning".
  const dupLine = (label, table) => {
    writeFileSync(tracker, table, "utf-8");
    const env = {
      ...process.env,
      CAREER_OPS_ROOT: tmp,
      CAREER_OPS_TRACKER: tracker,
      CAREER_OPS_REPORTS: reports,
    };
    delete env.CAREER_OPS_DATA_DIR;
    delete env.CAREER_OPS_PROFILE;
    delete env.CAREER_OPS_JDS;
    delete env.CAREER_OPS_PORTALS;
    try {
      const out = execFileSync(NODE, [join(ROOT, "verify-pipeline.mjs")], {
        cwd: ROOT,
        env,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 60_000,
      });
      return out
        .split("\n")
        .filter((l) => /Possible duplicates/.test(l))
        .join("\n");
    } catch (err) {
      fail(
        `${label}: verify-pipeline exited ${err.status ?? 1}; its Check 2 output proves nothing`,
      );
      return null;
    }
  };
  const expect = (label, table, warns) => {
    const out = dupLine(label, table);
    if (out === null) return;
    if (warns ? /#1, #2/.test(out) : out === "") pass(label);
    else fail(`${label}: got ${JSON.stringify(out)}`);
  };

  expect(
    "different report URLs are not duplicates",
    HEADER +
      row(1, "Acme", report("001", greenhouse(1001))) +
      row(2, "Acme", report("002", greenhouse(2002))),
    false,
  );
  expect(
    "one report URL is still a duplicate",
    HEADER +
      row(1, "Acme", report("001", greenhouse(1001))) +
      row(2, "Acme", report("002", greenhouse(1001))),
    true,
  );
  expect(
    "a report without a URL is still a duplicate",
    HEADER +
      row(1, "Acme", report("001", greenhouse(1001))) +
      row(2, "Acme", report("002", "N/A")),
    true,
  );
  expect(
    "different URL cells are not duplicates",
    URL_HEADER + urlRow(1, greenhouse(1001)) + urlRow(2, greenhouse(2002)),
    false,
  );
  expect(
    "corporate-form twins with different report URLs are not duplicates",
    HEADER +
      row(1, "Acme", report("001", greenhouse(1001))) +
      row(2, "Acme Inc", report("002", greenhouse(2002))),
    false,
  );
  expect(
    "corporate-form twins on one report URL are still duplicates",
    HEADER +
      row(1, "Acme", report("001", greenhouse(1001))) +
      row(2, "Acme Inc", report("002", greenhouse(1001))),
    true,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
