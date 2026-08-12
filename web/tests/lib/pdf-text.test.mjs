import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { extractPdfText } from "../../src/lib/pdf-text.mjs";

function makePdf(contentStreams, { flate = false } = {}) {
  let objects = "";
  let objNum = 1;
  const refs = [];
  for (const content of contentStreams) {
    const data = flate ? zlib.deflateSync(Buffer.from(content, "latin1")) : Buffer.from(content, "latin1");
    const filter = flate ? "\n/Filter /FlateDecode" : "";
    objects += `${objNum} 0 obj\n<< /Length ${data.byteLength}${filter} >>\nstream\n${data.toString("latin1")}\nendstream\nendobj\n`;
    refs.push(`${objNum} 0 R`);
    objNum++;
  }
  return `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [${refs.join(" ")}] /Count ${refs.length} >>\nendobj\n${objects}trailer\n<< /Root 1 0 R >>\n%%EOF`;
}

test("extractPdfText: uncompressed Tj streams", () => {
  const content = "BT /F1 12 Tf 72 720 Td (Staff AI Engineer) Tj T* (Acme AB) Tj ET";
  const pdf = makePdf([content]);
  const text = extractPdfText(Buffer.from(pdf, "latin1"));
  assert.ok(text.includes("Staff AI Engineer"), text);
  assert.ok(text.includes("Acme AB"), text);
});

test("extractPdfText: FlateDecode compressed stream", () => {
  const content = "BT /F1 12 Tf 72 720 Td (Kubernetes och AWS) Tj ET";
  const pdf = makePdf([content], { flate: true });
  const text = extractPdfText(Buffer.from(pdf, "latin1"));
  assert.ok(text.includes("Kubernetes och AWS"), text);
});

test("extractPdfText: TJ array with kerning", () => {
  const content = "BT /F1 12 Tf 72 720 Td [(Remote) -120 ( hybrid)] TJ ET";
  const pdf = makePdf([content]);
  const text = extractPdfText(Buffer.from(pdf, "latin1"));
  assert.ok(text.includes("Remote"), text);
  assert.ok(text.includes("hybrid"), text);
});

test("extractPdfText: escaped parens and hex strings", () => {
  const content = "BT /F1 12 Tf 72 720 Td (\\(Backend\\)) Tj T* <4b726131> Tj ET"; // "(Backend)" + "Kra1"
  const pdf = makePdf([content]);
  const text = extractPdfText(Buffer.from(pdf, "latin1"));
  assert.ok(text.includes("(Backend)"), text);
  assert.ok(text.includes("Kra1"), text);
});

test("extractPdfText: multiple pages joined", () => {
  const pdf = makePdf(["BT (Sida ett) Tj ET", "BT (Sida tva) Tj ET"]);
  const text = extractPdfText(Buffer.from(pdf, "latin1"));
  assert.ok(text.includes("Sida ett") && text.includes("Sida tva"), text);
});

test("extractPdfText: rejects non-PDF input", () => {
  assert.throws(() => extractPdfText(Buffer.from("not a pdf at all")), /giltig PDF/i);
});

test("extractPdfText: rejects PDF without extractable text", () => {
  const pdf = makePdf([""]); // valid PDF, no text operators
  assert.throws(() => extractPdfText(Buffer.from(pdf, "latin1")), /Kunde inte extrahera/i);
});
