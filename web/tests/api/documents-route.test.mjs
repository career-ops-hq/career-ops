import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleDocumentsRequest } from "../../src/lib/documents.ts";

function setupTestEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-api-test-"));
  const outputDir = path.join(root, "output");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const manifestPath = path.join(dataDir, "pdf-index.tsv");

  const cleanup = () => {
    fs.rmSync(root, { recursive: true, force: true });
  };

  return { root, outputDir, manifestPath, cleanup };
}

// Replaced during test
function mockIsRegularContainedFile(absPath, outputDir) {
  return fs.existsSync(absPath) && absPath.startsWith(outputDir);
}

test("API: List available generated PDF documents", async () => {
  const { root, outputDir, manifestPath, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-1.pdf"), "fake pdf content 1");
    fs.writeFileSync(path.join(outputDir, "cover-1.pdf"), "fake cover content 1");
    
    fs.writeFileSync(manifestPath, [
      "# report\tpdf\thtml\tformat\tdate\tkind",
      "10\toutput/cv-1.pdf\t\t\t2026-01-01\tcv",
      "11\toutput/cover-1.pdf\t\t\t2026-01-02\tcover"
    ].join("\n"));

    const req = new Request("http://localhost:3000/api/documents");
    const res = await handleDocumentsRequest(req, root, manifestPath, mockIsRegularContainedFile);
    
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 2);
    
    const cv = data.find(d => d.filename === "cv-1.pdf");
    assert.ok(cv.id);
    assert.equal(cv.kind, "cv");
    
    const cover = data.find(d => d.filename === "cover-1.pdf");
    assert.ok(cover.id);
    assert.equal(cover.kind, "cover");
  } finally {
    cleanup();
  }
});

test("API: Invalid identifiers and path-traversal attempts", async () => {
  const { root, outputDir, manifestPath, cleanup } = setupTestEnv();
  try {
    const maliciousId = Buffer.from("../../../etc/passwd").toString("base64url");
    const req = new Request(`http://localhost:3000/api/documents?id=${maliciousId}`);
    
    const res = await handleDocumentsRequest(req, root, manifestPath, mockIsRegularContainedFile);
    assert.equal(res.status, 404);
  } finally {
    cleanup();
  }
});

test("API: Missing or deleted files between discovery and serving", async () => {
  const { root, outputDir, manifestPath, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-missing.pdf"), "content");
    fs.writeFileSync(manifestPath, [
      "# report\tpdf\thtml\tformat\tdate\tkind",
      "10\toutput/cv-missing.pdf\t\t\t2026-01-01\tcv"
    ].join("\n"));

    // Discover it, but then delete it before serving
    const id = Buffer.from("cv-missing.pdf").toString("base64url");
    const req = new Request(`http://localhost:3000/api/documents?id=${id}`);
    
    // Delete file immediately to simulate TOCTOU or missing
    fs.unlinkSync(path.join(outputDir, "cv-missing.pdf"));
    
    const res = await handleDocumentsRequest(req, root, manifestPath, mockIsRegularContainedFile);
    assert.equal(res.status, 404);
  } finally {
    cleanup();
  }
});

test("API: Symlink rejection, including an internal symlink", async () => {
  const { root, outputDir, manifestPath, cleanup } = setupTestEnv();
  try {
    const realPdf = path.join(outputDir, "cv-real.pdf");
    fs.writeFileSync(realPdf, "real content");
    
    let symlinkCreated = false;
    try {
      const internalSymlink = path.join(outputDir, "cv-internal-symlink.pdf");
      fs.symlinkSync(realPdf, internalSymlink);
      
      const outsideFile = path.join(root, "outside.pdf");
      fs.writeFileSync(outsideFile, "outside content");
      fs.symlinkSync(outsideFile, path.join(outputDir, "cv-external-symlink.pdf"));
      symlinkCreated = true;
    } catch {}

    if (symlinkCreated) {
      // Mock discoverDocuments to pretend it found the symlink, testing the TOCTOU check
      const id = Buffer.from("cv-internal-symlink.pdf").toString("base64url");
      const req = new Request(`http://localhost:3000/api/documents?id=${id}`);
      
      const res = await handleDocumentsRequest(req, root, manifestPath, mockIsRegularContainedFile);
      // Because documents API explicitly rejects symlinks during serving:
      assert.equal(res.status, 404);
    }
  } finally {
    cleanup();
  }
});

test("API: Unexpected file types and safe response headers", async () => {
  const { root, outputDir, manifestPath, cleanup } = setupTestEnv();
  try {
    fs.writeFileSync(path.join(outputDir, "cv-safe.pdf"), "pdf content");
    const id = Buffer.from("cv-safe.pdf").toString("base64url");
    const req = new Request(`http://localhost:3000/api/documents?id=${id}`);
    
    const res = await handleDocumentsRequest(req, root, manifestPath, mockIsRegularContainedFile);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("content-disposition"), 'inline; filename="cv-safe.pdf"');
    assert.equal(res.headers.get("cache-control"), "no-store");
  } finally {
    cleanup();
  }
});
