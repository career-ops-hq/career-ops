import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const webSrc = fileURLToPath(new URL("../../src/", import.meta.url));
const loader = `
  import { existsSync } from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of [".ts", ".tsx", ".mjs", ".js", ""]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, pathToFileURL(webSrc));

const { POST: postCvUpload } = await import("../../src/app/api/cv/upload/route.ts");

test("cv upload POST rejects PDF and DOCX files with 400", async () => {
  // Test PDF rejection
  const pdfFormData = new FormData();
  pdfFormData.append("file", new File(["%PDF-1.5 fake pdf content"], "my-resume.pdf", { type: "application/pdf" }));
  const pdfReq = new Request("http://fixture.invalid/api/cv/upload", {
    method: "POST",
    body: pdfFormData,
  });
  const pdfRes = await postCvUpload(pdfReq);
  assert.equal(pdfRes.status, 400);
  const pdfData = await pdfRes.json();
  assert.match(pdfData.error, /Direct PDF parsing/);

  // Test DOCX rejection
  const docxFormData = new FormData();
  docxFormData.append("file", new File(["PK fake docx"], "my-resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  const docxReq = new Request("http://fixture.invalid/api/cv/upload", {
    method: "POST",
    body: docxFormData,
  });
  const docxRes = await postCvUpload(docxReq);
  assert.equal(docxRes.status, 400);
  const docxData = await docxRes.json();
  assert.match(docxData.error, /Word documents/);
});

test("cv upload POST accepts plain text and markdown files", async () => {
  const textContent = `# CV -- Jane Doe\n**Email:** jane@example.com\n## Professional Summary\nExperienced Software Engineer.`;
  const textFormData = new FormData();
  textFormData.append("file", new File([textContent], "cv.md", { type: "text/markdown" }));
  const textReq = new Request("http://fixture.invalid/api/cv/upload", {
    method: "POST",
    body: textFormData,
  });
  const textRes = await postCvUpload(textReq);
  assert.equal(textRes.status, 200);
  const textData = await textRes.json();
  assert.equal(textData.ok, true);
  assert.match(textData.markdown, /Jane Doe/);
});
