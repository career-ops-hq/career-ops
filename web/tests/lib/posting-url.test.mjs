import assert from "node:assert/strict";
import test from "node:test";
import { firstMarkdownLinkTarget, postingHref, postingLabel, readTrackerUrl, resolvePostingUrl, soleMarkdownLinkTarget } from "../../src/lib/posting-url.mjs";
import { extractCellUrl, firstLinkTarget, soleMarkdownLink } from "../../../tracker-parse.mjs";

test("readTrackerUrl returns the href and leaves a non-link cell unchanged", () => {
  const workday = "https://jobs.example.com/Engineer_(Remote)";
  assert.equal(readTrackerUrl(`[workday](${workday})`), workday);
  assert.equal(readTrackerUrl("[board](<https://jobs.example.com/1>)"), "https://jobs.example.com/1");
  assert.equal(readTrackerUrl("https://jobs.example.com/1"), "https://jobs.example.com/1");
  assert.equal(readTrackerUrl("—"), "—");
  assert.equal(readTrackerUrl(""), "");
});

test("postingHref reads a markdown link and a raw URL", () => {
  assert.equal(postingHref("[greenhouse](https://boards.greenhouse.io/example/jobs/1)"), "https://boards.greenhouse.io/example/jobs/1");
  assert.equal(postingHref("https://jobs.example.com/1 extra"), "https://jobs.example.com/1");
  assert.equal(postingHref("—"), "");
  assert.equal(postingHref(""), "");
  assert.equal(postingHref("not a url"), "");
});

test("postingLabel uses the host without www", () => {
  assert.equal(postingLabel("https://www.example.com/jobs/1"), "example.com");
  assert.equal(postingLabel("not a url"), "posting");
});

test("resolvePostingUrl prefers the tracker cell", () => {
  assert.equal(
    resolvePostingUrl("https://jobs.example.com/tracker", "https://jobs.example.com/report"),
    "https://jobs.example.com/tracker",
  );
  assert.equal(resolvePostingUrl("—", "https://jobs.example.com/report"), "https://jobs.example.com/report");
  assert.equal(resolvePostingUrl("", ""), "");
});

test("readTrackerUrl keeps a value that is already a URL", () => {
  const nested = "https://jobs.example.com/[other](https://other.example.com)";
  assert.equal(readTrackerUrl(nested), nested);
  const once = readTrackerUrl(`[job](<${nested}>)`);
  assert.equal(once, nested);
  assert.equal(readTrackerUrl(once), nested);
});

test("postingHref does not reparse an extracted URL", () => {
  const nested = "https://jobs.example.com/[other](https://other.example.com)";
  assert.equal(postingHref(nested), nested);
});

test("postingHref keeps spaces inside a markdown destination", () => {
  assert.equal(
    postingHref("[job](https://jobs.example.com/Software\\ Engineer)"),
    "https://jobs.example.com/Software Engineer",
  );
  assert.equal(
    postingHref("[job](https://jobs.example.com/a_(Remote Role))"),
    "https://jobs.example.com/a_(Remote Role)",
  );
  assert.equal(postingHref("https://jobs.example.com/1 trailing note"), "https://jobs.example.com/1");
});

test("firstMarkdownLinkTarget keeps parentheses in a report path (#5482)", () => {
  assert.equal(
    firstMarkdownLinkTarget("[1](../reports/001-acme-(berlin)-2026-10-01.md)"),
    "../reports/001-acme-(berlin)-2026-10-01.md",
  );
  assert.equal(firstMarkdownLinkTarget("[1](<../reports/001 acme.md>)"), "../reports/001 acme.md");
  assert.equal(firstMarkdownLinkTarget("—"), null);
  assert.equal(firstMarkdownLinkTarget(undefined), null);
});

test("link targets match tracker-parse.mjs, escaped angle brackets included", () => {
  const cells = [
    "[1](../reports/001-acme-(berlin)-2026-10-01.md)",
    "[1](<../reports/001-a\\>>)",
    "[job](<https://jobs.example.test/file\\>>)",
    "[job](https://jobs.example.test/a_(remote))",
    "—",
  ];
  for (const cell of cells) {
    assert.equal(firstMarkdownLinkTarget(cell), firstLinkTarget(cell), cell);
    assert.equal(readTrackerUrl(cell), extractCellUrl(cell), cell);
  }
  assert.equal(firstMarkdownLinkTarget("[1](<../reports/001-a\\>>)"), "../reports/001-a>");
});

test("soleMarkdownLinkTarget reads a cell that is exactly one link, as tracker-parse.mjs does", () => {
  const cells = [
    "[1](../reports/001-acme-(berlin)-2026-10-01.md)",
    "  [1](<../reports/001 acme.md>)  ",
    "[1](../reports/001-a.md), [2](../reports/002-b.md)",
    "see [1](../reports/001-a.md)",
    "[1](../reports/001-a.md) (moved)",
    "—",
    "",
  ];
  for (const cell of cells) {
    assert.equal(soleMarkdownLinkTarget(cell), soleMarkdownLink(cell)?.target ?? null, cell);
  }
  assert.equal(soleMarkdownLinkTarget("[1](../reports/001-a.md), [2](../reports/002-b.md)"), null);
  assert.equal(soleMarkdownLinkTarget(" [1](../reports/001-a.md) "), "../reports/001-a.md");
  assert.equal(soleMarkdownLinkTarget(undefined), null);
});
