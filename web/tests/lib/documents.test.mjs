import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { discoverDocuments } from "../../src/lib/documents.ts";

function setupTestEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-docs-test-"));
  const outputDir = path.join(root, "output");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const manifestPath = path.join(dataDir, "pdf-index.tsv");
  
  const isRegularContainedFile = (absPath, dir) => {
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) return false;
      const real = fs.realpathSync(absPath);
      const realDir = fs.realpathSync(dir);
      return real.startsWith(realDir + path.sep) || real === realDir;
    } catch {
      return false;
    }
  };

  const cleanup = () => {
    fs.rmSync(root, { recursive: true, force: true });
  };

  return { root, outputDir, manifestPath, isRegularContainedFile, cleanup };
}

function touch(filepath, timeMs) {
  const d = new Date(timeMs);
  fs.utimesSync(filepath, d, d);
}

test("Missing output directory", () => {
  const { root, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    const fakeOutputDir = path.join(root, "non-existent-output");
    const results = discoverDocuments({
      outputDir: fakeOutputDir,
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
    assert.deepEqual(results, []);
  } finally {
    cleanup();
  }
});

test("Missing manifest still discovers PDFs with fallback classification", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-123.pdf"), "fake pdf");
    fs.writeFileSync(path.join(outputDir, "random-doc.pdf"), "fake pdf");
    
    const results = discoverDocuments({
      outputDir,
      manifestPath, // Path exists but file doesn't
      workspaceRoot: root,
      isRegularContainedFile
    });
    
    assert.equal(results.length, 2);
    const cv = results.find(r => r.filename === "cv-123.pdf");
    assert.equal(cv.kind, "cv");
    assert.equal(cv.reportId, null);
    
    const rand = results.find(r => r.filename === "random-doc.pdf");
    assert.equal(rand.kind, "unknown");
    assert.equal(rand.reportId, null);
  } finally {
    cleanup();
  }
});

test("Discovers and enriches documents using manifest, ignores missing files", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-acme.pdf"), "fake pdf");
    touch(path.join(outputDir, "cv-acme.pdf"), 1000);
    
    fs.writeFileSync(path.join(outputDir, "cover-acme.pdf"), "fake pdf");
    touch(path.join(outputDir, "cover-acme.pdf"), 2000);
    
    // Manifest row points to missing HTML and missing PDF (cv-missing.pdf)
    const manifestContent = [
      "# report\tpdf\thtml\tformat\tdate\tkind",
      "42\toutput/cv-acme.pdf\toutput/scratch/missing.html\tletter\t2026-10-10\tcv",
      "\toutput/cover-acme.pdf\t\ta4\t2026-10-11\tcover",
      "99\toutput/cv-missing.pdf\t\t\t\tcv"
    ].join("\n");
    fs.writeFileSync(manifestPath, manifestContent);
    
    const results = discoverDocuments({
      outputDir,
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
    
    assert.equal(results.length, 2); // missing pdf ignored
    
    assert.equal(results[0].filename, "cover-acme.pdf");
    assert.equal(results[0].kind, "cover");
    assert.equal(results[0].reportId, null);
    assert.equal(results[0].format, "a4");
    assert.equal(results[0].date, "2026-10-11");
    
    assert.equal(results[1].filename, "cv-acme.pdf");
    assert.equal(results[1].kind, "cv");
    assert.equal(results[1].reportId, "42");
    assert.equal(results[1].format, "letter");
  } finally {
    cleanup();
  }
});

test("Similar filenames that must not be merged", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-apple.pdf"), "fake pdf");
    touch(path.join(outputDir, "cv-apple.pdf"), 1000);
    
    fs.writeFileSync(path.join(outputDir, "cv-apple-senior.pdf"), "fake pdf");
    touch(path.join(outputDir, "cv-apple-senior.pdf"), 2000);
    
    const manifestContent = [
      "# report\tpdf\thtml\tformat\tdate\tkind",
      "1\toutput/cv-apple.pdf\t\t\t\tcv",
      "2\toutput/cv-apple-senior.pdf\t\t\t\tcv"
    ].join("\n");
    fs.writeFileSync(manifestPath, manifestContent);
    
    const results = discoverDocuments({
      outputDir,
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
    
    assert.equal(results.length, 2);
    assert.equal(results[0].filename, "cv-apple-senior.pdf");
    assert.equal(results[0].reportId, "2");
    
    assert.equal(results[1].filename, "cv-apple.pdf");
    assert.equal(results[1].reportId, "1");
  } finally {
    cleanup();
  }
});

test("Relative outputDir resolves and matches absolute manifest entries", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-relative.pdf"), "fake pdf");
    const manifestContent = [
      "# report\tpdf\thtml\tformat\tdate\tkind",
      "99\toutput/cv-relative.pdf\t\t\t\tcv"
    ].join("\n");
    fs.writeFileSync(manifestPath, manifestContent);
    
    // Convert absolute outputDir to a relative path from current working directory
    const relativeOutputDir = path.relative(process.cwd(), outputDir);
    
    const results = discoverDocuments({
      outputDir: relativeOutputDir, // Pass relative path
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].filename, "cv-relative.pdf");
    assert.equal(results[0].reportId, "99"); // Enrichment succeeds despite relative outputDir
  } finally {
    cleanup();
  }
});

test("Symlink rejection and non-regular files", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-real.pdf"), "fake pdf");
    
    // Directory ending in .pdf
    fs.mkdirSync(path.join(outputDir, "cv-dir.pdf"));
    
    // Symlinks (if platform supports it)
    let symlinkCreated = false;
    try {
      const outsideFile = path.join(root, "outside.pdf");
      fs.writeFileSync(outsideFile, "fake pdf");
      fs.symlinkSync(outsideFile, path.join(outputDir, "cv-external-symlink.pdf"));
      
      const insideFile = path.join(outputDir, "cv-real.pdf");
      fs.symlinkSync(insideFile, path.join(outputDir, "cv-internal-symlink.pdf"));
      symlinkCreated = true;
    } catch {
      // e.g. EPERM on Windows without admin, skip symlink test
    }
    
    const results = discoverDocuments({
      outputDir,
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
    
    const files = results.map(r => r.filename);
    assert.ok(files.includes("cv-real.pdf"));
    assert.ok(!files.includes("cv-dir.pdf")); // Directories skipped
    if (symlinkCreated) {
      assert.ok(!files.includes("cv-external-symlink.pdf")); // External symlink skipped
      assert.ok(!files.includes("cv-internal-symlink.pdf")); // Internal symlink skipped outright
    }
  } finally {
    cleanup();
  }
});

test("Manifest entries outside permitted directory are ignored", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-sneaky.pdf"), "fake pdf");
    // Manifest row uses path traversal to point outside outputDir, or points to somewhere else
    const manifestContent = [
      "# report\tpdf\thtml\tformat\tdate\tkind",
      "10\tdata/cv-sneaky.pdf\t\t\t\tcv", // entirely outside output/
      "11\toutput/../output/cv-sneaky.pdf\t\t\t\tcv" // valid after normalization
    ].join("\n");
    fs.writeFileSync(manifestPath, manifestContent);
    
    const results = discoverDocuments({
      outputDir,
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].filename, "cv-sneaky.pdf");
    assert.equal(results[0].reportId, "11"); // Matches the valid row, ignores the row pointing outside
  } finally {
    cleanup();
  }
});

test("Duplicate manifest entries prioritize the latest row", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-dup.pdf"), "fake pdf");
    const manifestContent = [
      "# report\tpdf\thtml\tformat\tdate\tkind",
      "1\toutput/cv-dup.pdf\t\tletter\t2026-01-01\tcv",
      "2\toutput/cv-dup.pdf\t\ta4\t2026-01-02\tcv" // Duplicate row later in file
    ].join("\n");
    fs.writeFileSync(manifestPath, manifestContent);
    
    const results = discoverDocuments({
      outputDir,
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].reportId, "2"); // Chooses the latest entry
    assert.equal(results[0].format, "a4");
  } finally {
    cleanup();
  }
});

test("Equal modification times sort alphabetically", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-zebra.pdf"), "fake pdf");
    fs.writeFileSync(path.join(outputDir, "cv-apple.pdf"), "fake pdf");
    fs.writeFileSync(path.join(outputDir, "cv-mango.pdf"), "fake pdf");
    
    touch(path.join(outputDir, "cv-zebra.pdf"), 1000);
    touch(path.join(outputDir, "cv-apple.pdf"), 1000);
    touch(path.join(outputDir, "cv-mango.pdf"), 1000);
    
    const results = discoverDocuments({
      outputDir,
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
    
    assert.equal(results.length, 3);
    assert.equal(results[0].filename, "cv-apple.pdf");
    assert.equal(results[1].filename, "cv-mango.pdf");
    assert.equal(results[2].filename, "cv-zebra.pdf");
  } finally {
    cleanup();
  }
});

test("Normalized path matching handles trailing slashes", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-slash.pdf"), "fake pdf");
    const manifestContent = [
      "# report\tpdf\thtml\tformat\tdate\tkind",
      "5\toutput/cv-slash.pdf\t\tletter\t2026-01-01\tcv"
    ].join("\n");
    fs.writeFileSync(manifestPath, manifestContent);
    
    // Pass outputDir with trailing slash, and workspaceRoot with trailing slash
    const results = discoverDocuments({
      outputDir: outputDir + path.sep,
      manifestPath,
      workspaceRoot: root + path.sep,
      isRegularContainedFile
    });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].reportId, "5");
  } finally {
    cleanup();
  }
});

test("Malformed or partially populated manifest rows", () => {
  const { root, outputDir, manifestPath, isRegularContainedFile, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-malformed.pdf"), "fake pdf");
    const manifestContent = [
      "# report\tpdf\thtml\tformat\tdate\tkind",
      "  \toutput/cv-malformed.pdf\t\t\t\t  ", // blank report ID and kind
      "invalid-no-tabs", // malformed row
      "\t\t\t\t\t" // empty row
    ].join("\n");
    fs.writeFileSync(manifestPath, manifestContent);
    
    const results = discoverDocuments({
      outputDir,
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].filename, "cv-malformed.pdf");
    assert.equal(results[0].reportId, null);
    assert.equal(results[0].kind, "cv"); // fallback classification because kind is blank
  } finally {
    cleanup();
  }
});
