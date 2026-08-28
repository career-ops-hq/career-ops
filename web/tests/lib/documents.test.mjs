import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverApplications, discoverReadyToApply, generateReadyFilename, isAllowedDocumentPath, resolveExistingDocument } from "../../src/lib/documents.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "co-documents-"));
  const write = (relative, content = "%PDF") => { const file = join(root, ...relative.split("/")); mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, content); };
  write("output/001-acme-role/cv/tailored/v001/cv.pdf"); write("output/001-acme-role/cv/tailored/v002/cv.pdf");
  write("output/001-acme-role/cover-letter/v001/cover-letter.pdf");
  write("output/001-acme-role/cover-letter/draft.json", JSON.stringify({ status: "Review recommended - newer resume exists", resumeVersion: "v002", targetVersion: "v002" }));
  write("ready-to-apply/Acme - Jane Smith - Resume.pdf"); return root;
}

test("discovers applications, resume versions, cover letters, and workflow state", () => { const root = fixture(); try { const app = discoverApplications(root, [{ number: "1", company: "Acme", role: "Role" }])[0]; assert.deepEqual(app.documents[0].versions.map((v) => v.version), ["v002", "v001"]); assert.equal(app.documents[0].selectedVersion, "v002"); assert.equal(app.documents[0].status, "Latest"); assert.equal(app.documents[1].versions[0].version, "v001"); assert.equal(app.documents[1].workflow.status, "Review recommended - newer resume exists"); } finally { rmSync(root, { recursive: true, force: true }); } });
test("approved metadata selects a non-latest resume", () => { const root = fixture(); try { const approved = new Set(["output/001-acme-role/cv/tailored/v001/cv.pdf"]); const resume = discoverApplications(root, [], approved)[0].documents[0]; assert.equal(resume.selectedVersion, "v001"); assert.equal(resume.status, "Approved"); } finally { rmSync(root, { recursive: true, force: true }); } });
test("ready-to-apply discovery returns PDFs", () => { const root = fixture(); try { assert.equal(discoverReadyToApply(root)[0].name, "Acme - Jane Smith - Resume.pdf"); } finally { rmSync(root, { recursive: true, force: true }); } });
test("safe-path validation and traversal rejection", () => { const root = fixture(); try { const good = "output/001-acme-role/cv/tailored/v002/cv.pdf"; assert.equal(isAllowedDocumentPath(good), true); assert.ok(resolveExistingDocument(root, good)); for (const bad of ["../cv.md", "output/../cv.md", "/etc/passwd", "C:/Windows/win.ini", "output\\..\\cv.md", "%2e%2e/cv.md", decodeURIComponent("%2e%2e%2fcv.md")]) assert.equal(isAllowedDocumentPath(bad), false, bad); } finally { rmSync(root, { recursive: true, force: true }); } });
test("safe paths allow only the general-role PDF", () => { assert.equal(isAllowedDocumentPath("output/role-resumes/application-developer/v001/cv.pdf"), true); assert.equal(isAllowedDocumentPath("output/role-resumes/../cv.md"), false); assert.equal(isAllowedDocumentPath("output/role-resumes/application-developer/v001/metadata.json"), false); });
test("filename generation is human-readable and sanitized", () => { assert.equal(generateReadyFilename("Signifyd", "Lavasier Joyner", "resume"), "Signifyd - Lavasier Joyner - Resume.pdf"); assert.equal(generateReadyFilename("Acme/West", "Jane: Smith", "cover-letter"), "Acme West - Jane Smith - Cover Letter.pdf"); });
