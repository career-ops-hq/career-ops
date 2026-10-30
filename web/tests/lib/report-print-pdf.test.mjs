// The print browser test uses these helpers to read a PDF page, not only its
// file size. Run: node --test web/tests/lib/report-print-pdf.test.mjs
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { test } from "node:test";
import { findPhrase, readPdfPages } from "../helpers/report-print-pdf.mjs";

function hex(text) {
  return `<${[...text].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, "0")).join("")}>`;
}

function stream(dict, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${bytes.length} >>\nstream\n`),
    bytes,
    Buffer.from("\nendstream"),
  ]);
}

function buildPdf(objects) {
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  for (let n = 0; n < objects.length; n++) {
    offsets.push(Buffer.concat(chunks).length);
    const body = Buffer.isBuffer(objects[n]) ? objects[n] : Buffer.from(objects[n]);
    chunks.push(Buffer.from(`${n + 1} 0 obj\n`), body, Buffer.from("\nendobj\n"));
  }
  const xrefAt = Buffer.concat(chunks).length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= objects.length; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

const cmap = `begincmap
1 beginbfrange
<0020> <007e> <0020>
endbfrange
endcmap
`;

const page1 = `BT
/F1 12 Tf
1 0 0 1 72 700 Tm
${hex("Paragraph 8 of notes")} Tj
1 0 0 1 400 700 Tm
${hex("https://fixture-print.example/evidence/3")} Tj
1 0 0 1 72 640 Tm
/Span << /ActualText (fi) >> BDC
<00C0> Tj
EMC
${hex("ctional")} Tj
1 0 0 1 72 500 Tm
${hex("https://wrap.example/")} Tj
1 0 0 1 72 480 Tm
${hex("evidence/3")} Tj
1 0 0 1 72 400 Tm
${hex("Reflection")} Tj
1 0 0 1 72 380 Tm
${hex("text that")} Tj
1 0 0 1 72 360 Tm
${hex("keeps")} Tj
1 0 0 1 72 340 Tm
${hex("going")} Tj
1 0 0 1 590 640 Tm
${hex("CLIPPED")} Tj
ET
`;

const page2 = `BT /F1 12 Tf 1 0 0 1 72 700 Tm ${hex("CV Match")} Tj ET`;

function fixturePdf() {
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 8 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 9 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /F /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /F /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 /W [32 126 400] >>",
    stream("", cmap),
    stream("/Filter /FlateDecode", zlib.deflateSync(Buffer.from(page1))),
    stream("", page2),
  ]);
}

test("a phrase on the page is found and stays inside", () => {
  const pages = readPdfPages(fixturePdf());
  const found = findPhrase(pages, "Paragraph 8 of notes");
  assert.ok(found);
  assert.deepEqual(found.outside, []);
  assert.ok(Math.abs(found.words[0].xMin - 72) < 0.2);
  assert.ok(found.words[0].yMax < 792);
  assert.equal(findPhrase(pages, "noteshttps"), null);
});

test("a word past the page edge is reported", () => {
  const found = findPhrase(readPdfPages(fixturePdf()), "CLIPPED");
  assert.ok(found);
  assert.ok(found.outside.length > 0);
});

test("a phrase that is not in the PDF is missing", () => {
  assert.equal(findPhrase(readPdfPages(fixturePdf()), "Story 3"), null);
});

test("a later page and a wrapped line can hold a phrase", () => {
  const pages = readPdfPages(fixturePdf());
  const match = findPhrase(pages, "CV Match");
  assert.ok(match);
  assert.deepEqual(match.outside, []);
  const wrapped = findPhrase(pages, "https://wrap.example/evidence/3");
  assert.ok(wrapped);
  assert.deepEqual(wrapped.outside, []);
  const url = findPhrase(pages, "https://fixture-print.example/evidence/3");
  assert.ok(url);
  assert.deepEqual(url.outside, []);
});

test("an ActualText ligature stays part of the word", () => {
  const found = findPhrase(readPdfPages(fixturePdf()), "fictional");
  assert.ok(found);
  assert.deepEqual(found.outside, []);
});

test("a wrapped sentence keeps its spaces when the line break drops them", () => {
  const found = findPhrase(readPdfPages(fixturePdf()), "Reflection text that keeps going");
  assert.ok(found);
  assert.deepEqual(found.outside, []);
});

function pageAt(fontObject, extra = []) {
  const content = "BT /F1 12 Tf 1 0 0 1 72 700 Tm (HI) Tj ET";
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    stream("", content),
    fontObject,
    ...extra,
  ]);
}

function widthsOf(fontObject, extra) {
  const words = readPdfPages(pageAt(fontObject, extra)).flatMap((page) => page.words);
  return words.map((word) => ({ text: word.text, xMin: word.xMin, xMax: word.xMax }));
}

test("a simple font and a Type3 font use their own width arrays", () => {
  const expected = [
    { text: "H", xMin: 72, xMax: 74.4 },
    { text: "I", xMin: 74.4, xMax: 84 },
  ];
  const simple = widthsOf("<< /Type /Font /Subtype /TrueType /BaseFont /F /FirstChar 72 /LastChar 73 /Widths [200 800] >>");
  const indirect = widthsOf("<< /Type /Font /Subtype /TrueType /BaseFont /F /FirstChar 72 /LastChar 73 /Widths 6 0 R >>", ["[200 800]"]);
  const type3 = widthsOf("<< /Type /Font /Subtype /Type3 /BaseFont /F /FontMatrix [0.002 0 0 0.002 0 0] /FontBBox [0 0 1 1] /FirstChar 72 /LastChar 73 /Widths [100 400] >>");
  for (const words of [simple, indirect, type3]) {
    assert.equal(words.length, 2);
    words.forEach((word, index) => {
      assert.equal(word.text, expected[index].text);
      assert.ok(Math.abs(word.xMin - expected[index].xMin) < 0.05, `${word.text} xMin ${word.xMin}`);
      assert.ok(Math.abs(word.xMax - expected[index].xMax) < 0.05, `${word.text} xMax ${word.xMax}`);
    });
  }
});
