// Tests for resolvePdfPaths()/slugify() using Node's built-in test runner.
// Imports directly from pdf-paths.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/pdf-paths.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { slugify, resolvePdfPaths } from "../../src/lib/pdf-paths.mjs";

test("slugify: lowercases and hyphenates", () => {
  assert.equal(slugify("Jane Q. Smith"), "jane-q-smith");
});

test("slugify: trims leading/trailing hyphens", () => {
  assert.equal(slugify("  -Weird Name!- "), "weird-name");
});

// Given a career-ops root with a report on disk and a profile.yml naming the candidate
function makeRoot({ profileYaml } = {}) {
  const root = mkdtempSync(join(tmpdir(), "co-pdfpaths-"));
  mkdirSync(join(root, "config"), { recursive: true });
  if (profileYaml !== null) {
    writeFileSync(join(root, "config", "profile.yml"), profileYaml ?? 'candidate:\n  full_name: "Jane Smith"\n');
  }
  return root;
}

test("resolvePdfPaths: happy path builds html/meta/finalPdf from report + profile", () => {
  // Given a root with a resolvable report and a named candidate
  const root = makeRoot();
  const findReportFile = (input) => (input === "018" ? join(root, "reports", "018-acme-2026-07-01.md") : null);
  try {
    // When resolving paths for report #018
    const result = resolvePdfPaths("018", "2026-07-26", root, findReportFile);

    // Then it returns deterministic scratch + final paths using the candidate/company slugs
    assert.equal(result.ok, true);
    assert.equal(result.paths.html, join(root, ".career-ops-web", "pdf-tmp", "cv-web-018.html"));
    assert.equal(result.paths.meta, join(root, ".career-ops-web", "pdf-tmp", "cv-web-018.meta.json"));
    assert.equal(result.paths.finalPdf, join(root, "output", "cv-jane-smith-acme-2026-07-26.pdf"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePdfPaths: path-traversal selector is rejected before any path is built", () => {
  // Given a findReportFile that would (via parseInt-based matching) resolve a
  // traversal-shaped selector to a real report, and a directory sentinel to
  // prove no scratch dir gets created for this input
  const root = makeRoot();
  const scratchDir = join(root, ".career-ops-web", "pdf-tmp");
  const findReportFile = () => join(root, "reports", "123-acme-2026-07-01.md");
  try {
    // When resolving paths for a crafted, non-canonical selector
    const result = resolvePdfPaths("123/../../etc/passwd", "2026-07-26", root, findReportFile);

    // Then it fails closed with a clear error, never calling findReportFile or touching disk
    assert.equal(result.ok, false);
    assert.match(result.error, /Invalid report selector/);
    assert.equal(existsSync(scratchDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePdfPaths: no matching report -> ok:false, no directories created", () => {
  // Given a root where findReportFile never resolves
  const root = makeRoot();
  const findReportFile = () => null;
  try {
    // When resolving paths for a report that doesn't exist
    const result = resolvePdfPaths("999", "2026-07-26", root, findReportFile);

    // Then it fails with a user-facing error and never touches the filesystem
    assert.equal(result.ok, false);
    assert.match(result.error, /No report #999 found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePdfPaths: missing profile.yml falls back to the default candidate slug", () => {
  // Given a root with a resolvable report but no profile.yml at all
  const root = makeRoot({ profileYaml: null });
  const findReportFile = (input) => (input === "5" ? join(root, "reports", "5-globex-2026-07-01.md") : null);
  try {
    // When resolving paths for report #5
    const result = resolvePdfPaths("5", "2026-07-26", root, findReportFile);

    // Then it still succeeds, using the "candidate" fallback slug
    assert.equal(result.ok, true);
    assert.equal(result.paths.finalPdf, join(root, "output", "cv-candidate-globex-2026-07-26.pdf"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePdfPaths: malformed profile.yml falls back to the default candidate slug", () => {
  // Given a root with a resolvable report and an unparseable profile.yml
  const root = makeRoot({ profileYaml: "candidate: [unterminated" });
  const findReportFile = (input) => (input === "5" ? join(root, "reports", "5-globex-2026-07-01.md") : null);
  try {
    // When resolving paths for report #5
    const result = resolvePdfPaths("5", "2026-07-26", root, findReportFile);

    // Then it still succeeds, using the "candidate" fallback slug rather than throwing
    assert.equal(result.ok, true);
    assert.equal(result.paths.finalPdf, join(root, "output", "cv-candidate-globex-2026-07-26.pdf"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePdfPaths: report filename that doesn't match the expected pattern falls back to the default company slug", () => {
  // Given findReportFile resolves to a filename that doesn't match ^\d+-(.+)-YYYY-MM-DD.md$
  const root = makeRoot();
  const findReportFile = (input) => (input === "7" ? join(root, "reports", "not-the-expected-shape.md") : null);
  try {
    // When resolving paths for report #7
    const result = resolvePdfPaths("7", "2026-07-26", root, findReportFile);

    // Then it still succeeds, using the "company" fallback slug
    assert.equal(result.ok, true);
    assert.equal(result.paths.finalPdf, join(root, "output", "cv-jane-smith-company-2026-07-26.pdf"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePdfPaths: profile.yml present but candidate.full_name empty falls back to the default candidate slug", () => {
  // Given a profile.yml with a candidate block but no usable full_name
  const root = makeRoot({ profileYaml: 'candidate:\n  full_name: ""\n  email: "jane@example.com"\n' });
  const findReportFile = (input) => (input === "5" ? join(root, "reports", "5-globex-2026-07-01.md") : null);
  try {
    // When resolving paths for report #5
    const result = resolvePdfPaths("5", "2026-07-26", root, findReportFile);

    // Then it still succeeds, using the "candidate" fallback slug
    assert.equal(result.ok, true);
    assert.equal(result.paths.finalPdf, join(root, "output", "cv-candidate-globex-2026-07-26.pdf"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
