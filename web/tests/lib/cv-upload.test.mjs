import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { pdfText } from "../../src/lib/cv/pdf-text.mjs";
import { CV_UPLOAD_ACCEPT, cvUploadError, MAX_CV_UPLOAD_BYTES } from "../../src/lib/cv/upload.mjs";

// Core CI runs these suites with only root dependencies installed. The web CI
// installs web dependencies and must run the real PDF extraction checks. Only
// skip when that install is absent; a broken web install must still fail.
let skipPdf = false;
try {
  import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND" || existsSync(new URL("../../node_modules", import.meta.url))) throw error;
  skipPdf = "web dependencies are not installed (PDF extraction runs in web CI)";
}

// A real, minimal PDF with deterministic fictional text and a valid xref table.
export function cvPdf(lines = ["Alex Example", "Engineer 2021-2026", "Improved delivery by 25%"] ) {
  const stream = "BT /F1 12 Tf 50 750 Td " + lines.map((line, i) => `${i ? "0 -18 Td " : ""}(${line}) Tj`).join("\n") + " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

test("PDF text extraction preserves CV names, dates and metrics", { skip: skipPdf }, async () => {
  const text = await pdfText(cvPdf().buffer);
  for (const fact of ["Alex Example", "2021-2026", "25%"]) assert.ok(text.includes(fact), text);
});

test("empty and malformed PDFs fail instead of proposing an empty CV", { skip: skipPdf }, async () => {
  await assert.rejects(pdfText(cvPdf([]).buffer), /no readable text/);
  await assert.rejects(pdfText(new TextEncoder().encode("This is not a PDF").buffer), /could not be read/);
});

test("upload validation accepts PDF and TeX and rejects empty, oversized and unsupported files", () => {
  for (const name of ["resume.PDF", "resume.tex", "resume.md", "resume.txt", "resume.docx"]) {
    assert.equal(cvUploadError({ name, size: 100 }), null);
    assert.ok(CV_UPLOAD_ACCEPT.includes(name.slice(name.lastIndexOf(".")).toLowerCase()));
  }
  assert.match(cvUploadError({ name: "resume.pdf", size: 0 }), /empty/);
  assert.match(cvUploadError({ name: "resume.tex", size: MAX_CV_UPLOAD_BYTES + 1 }), /too large/);
  assert.match(cvUploadError({ name: "resume.exe", size: 100 }), /Choose/);
});
