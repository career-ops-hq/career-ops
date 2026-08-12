import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  CV_TEMPLATES,
  EXPORT_FORMATS,
  structuredCv,
  renderHtml,
  renderPdf,
  renderDocx,
  renderTxt,
  renderMarkdown,
} from "../../src/lib/cv-export.mjs";
import { renderCvExport, extractDocxText, runExportQualityGate } from "../../src/lib/cv-export-server.mjs";
import { extractPdfText } from "../../src/lib/pdf-text.mjs";
import {
  exportRecordId,
  saveExportRecord,
  readExportRecord,
  recordExportGateResult,
  listExportRecords,
} from "../../src/lib/export-store.mjs";

const CV = `Anna Andersson
Stockholm | anna@exempel.se | 070-123 45 67

## Profil
Erfaren webbutvecklare med fokus på React och TypeScript.

## Arbetslivserfarenhet
### Acme Digital AB — Senior Frontend Developer (2021–nu)
- Utvecklade React-applikationer och API-integrationer.
- Ansvarig för prestandaoptimering av webbplatsen.

### Globex Corp — Webbutvecklare (2018–2021)
- Arbetsuppgifter: underhåll av interna verktyg med JavaScript.

## Kompetenser
- React, TypeScript, JavaScript, Node.js, CSS

## Utbildning
- Kandidat i datavetenskap, KTH (2014–2018)

## Certifieringar
- AWS Certified Developer

## Språk
Svenska (modersmål), Engelska (flytande)
`;

/* ── Mallar och struktur ────────────────────────────────────────────── */

test("MALLAR: 3 templates + 4 formats definierade", () => {
  assert.equal(CV_TEMPLATES.length, 3);
  const ids = CV_TEMPLATES.map((t) => t.id);
  assert.ok(ids.includes("ats-standard"));
  assert.ok(ids.includes("professional"));
  assert.ok(ids.includes("executive"));
  for (const t of CV_TEMPLATES) {
    assert.ok(t.name);
    assert.ok(t.description);
  }
  assert.equal(EXPORT_FORMATS.length, 4);
  assert.deepEqual(EXPORT_FORMATS, ["pdf", "docx", "txt", "md"]);
});

test("STRUCTURED: parseCv extraherar namn + sektioner", () => {
  const s = structuredCv(CV);
  assert.ok(s.name.includes("Anna"));
  assert.ok(s.sections.length >= 6);
  assert.ok(s.headerLines.length > 0);
  const types = s.sections.map((sec) => sec.type);
  assert.ok(types.includes("profile") || types.some((t) => t === "profile"));
});

/* ── PDF export ─────────────────────────────────────────────────────── */

test("PDF: ger giltig buffer och innehåller textlager", () => {
  const { buffer, text, fileName } = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "pdf", role: "Frontend Developer", company: "Acme" });
  assert.ok(buffer.length > 500, `PDF:en för liten (${buffer.length} B)`);
  assert.ok(fileName.endsWith(".pdf"));
  assert.ok(buffer.includes("PDF"));
  assert.ok(text.length > 100, "PDF-textextrahering returnerade text");
  assert.ok(text.includes("Anna Andersson"), "PDF-texten saknar namn");
  assert.ok(text.includes("React"), "PDF-texten saknar kompetenser");
  assert.ok(text.includes("Sida 1"), "PDF-texten saknar sidfot");
});

test("PDF: em-dash normaliseras till bindestreck", () => {
  const cv = `Test\n\n## Profil\nEn test.\n\n## Kompetenser\n- Utvecklare — senior nivå.\n`;
  const { text } = renderCvExport({ cvText: cv, templateId: "ats-standard", format: "pdf" });
  assert.ok(!text.includes("\u2014"), "em-dash ska vara ersatt");
});

test("PDF: alla 3 mallar fungerar utan krasch", () => {
  for (const t of CV_TEMPLATES) {
    const r = renderCvExport({ cvText: CV, templateId: t.id, format: "pdf", role: "Dev", company: "Co" });
    assert.ok(r.buffer.length > 0, `${t.id}: tom buffer`);
    assert.ok(r.text.length > 0, `${t.id}: ingen text`);
  }
});

/* ── DOCX export ────────────────────────────────────────────────────── */

test("DOCX: giltig store-zip, kan öppnas, innehåller text", () => {
  const { buffer, text, fileName } = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "docx", role: "Frontend Developer", company: "Acme" });
  assert.ok(buffer.length > 500);
  assert.ok(fileName.endsWith(".docx"));
  assert.ok(text.includes("Anna Andersson"), "DOCX-texten saknar namn");
  assert.ok(text.includes("React"), "DOCX-texten saknar kompetenser");
  assert.ok(text.includes("PROFIL") || text.includes("Profil"), "DOCX-texten saknar sektionstitel");
});

test("DOCX: extractDocxText hittar rätt via local-header-sökning", () => {
  const { buffer } = renderCvExport({ cvText: CV, templateId: "professional", format: "docx" });
  const text = extractDocxText(buffer);
  assert.ok(text.length > 100, `DOCX-extraktion för kort: ${text.length}`);
  assert.ok(text.includes("Acme"), "DOCX-extraktion saknar sektionsinnehåll");
});

test("DOCX: alla 3 mallar fungerar", () => {
  for (const t of CV_TEMPLATES) {
    const r = renderCvExport({ cvText: CV, templateId: t.id, format: "docx" });
    assert.ok(r.buffer.length > 0, `${t.id}: tom DOCX`);
  }
});

/* ── TXT export ─────────────────────────────────────────────────────── */

test("TXT: rubriker versaler, innehåll bevarat", () => {
  const { text, fileName } = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "txt" });
  assert.ok(fileName.endsWith(".txt"));
  assert.ok(text.includes("KOMPETENSER"), "sektionstitel ska vara versal");
  assert.ok(text.includes("Anna Andersson"));
  assert.ok(text.includes("React"));
  assert.ok(text.includes("KTH"));
  assert.ok(text.includes("AWS Certified Developer"));
});

test("TXT: innehåll inte kapas", () => {
  const { text } = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "txt" });
  assert.ok(text.includes("Svenska (modersmål)"), "sista raden saknas — innehåll kapat");
});

/* ── Markdown export ────────────────────────────────────────────────── */

test("MD: bevarar original-struktur", () => {
  const { text, fileName } = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "md" });
  assert.ok(fileName.endsWith(".md"));
  assert.ok(text.includes("## Profil"));
  assert.ok(text.includes("### Acme Digital AB"));
  assert.ok(text.includes("Anna Andersson"));
});

/* ── Filnamn i export ───────────────────────────────────────────────── */

test("FILNAMN: First_Last_Role_Company_CV.ext", () => {
  const r = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "pdf", role: "Senior Frontend Developer", company: "Acme Digital AB" });
  assert.equal(r.fileName, "Anna_Andersson_Senior_Frontend_Developer_Acme_Digital_AB_CV.pdf");
});

test("FILNAMN: fallback utan role/company", () => {
  const r = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "pdf" });
  assert.equal(r.fileName, "Anna_Andersson_Roll_Foretag_CV.pdf");
});

test("FILNAMN: ogiltigt custom filnamn → fallback", () => {
  const r = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "pdf", fileName: "min cv!.pdf" });
  assert.ok(!r.fileName.includes("!"), "ogiltigt tecken ska saneras");
  assert.ok(r.fileName.endsWith("_CV.pdf"));
});

/* ── Quality Gate ───────────────────────────────────────────────────── */

test("GATE: korrekt fil passar alla checks", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fas4-gate-"));
  try {
    const r = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "pdf", role: "Dev", company: "Co" });
    const filePath = join(tmp, r.fileName);
    writeFileSync(filePath, r.buffer);
    const gate = runExportQualityGate({ filePath, fileName: r.fileName, format: "pdf", sourceText: CV });
    assert.equal(gate.passed, true, `gate misslyckades: ${gate.reason}`);
    assert.ok(gate.checks.length >= 11, `${gate.checks.length} checks — förväntade ≥11`);
    assert.ok(gate.checks.every((c) => c.ok), `icke-gröna: ${gate.checks.filter((c) => !c.ok).map((c) => c.label).join(", ")}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("GATE: saknad fil ger FAILED", () => {
  const gate = runExportQualityGate({ filePath: "/tmp/finns-inte-fas4-test.pdf", fileName: "x.pdf", format: "pdf", sourceText: CV });
  assert.equal(gate.passed, false);
  assert.ok(gate.reason);
  const fileCheck = gate.checks.find((c) => c.id === "file-exists");
  assert.ok(fileCheck);
  assert.equal(fileCheck.ok, false);
});

test("GATE: ändrat original detekteras", () => {
  const tmp = mkdtempSync(join(tmpdir(), "fas4-imm-"));
  try {
    const origPath = join(tmp, "cv.md");
    writeFileSync(origPath, CV);
    const sha = createHash("sha256").update(CV).digest("hex");
    const r = renderCvExport({ cvText: CV, templateId: "ats-standard", format: "txt" });
    const filePath = join(tmp, r.fileName);
    writeFileSync(filePath, r.buffer);
    const ok = runExportQualityGate({ filePath, fileName: r.fileName, format: "txt", sourceText: CV, originalCvPath: origPath, originalSha256: sha });
    assert.equal(ok.passed, true);
    // Ändra originalfilen
    writeFileSync(origPath, CV + "\nÄNDRAD");
    const fail = runExportQualityGate({ filePath, fileName: r.fileName, format: "txt", sourceText: CV, originalCvPath: origPath, originalSha256: sha });
    assert.equal(fail.passed, false);
    const immCheck = fail.checks.find((c) => c.id === "original-cv-unchanged");
    assert.equal(immCheck?.ok, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/* ── Export Store ───────────────────────────────────────────────────── */

test("STORE: saveExportRecord genererar id, filePath, storedFile, createdAt", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "fas4-store-"));
  try {
    const record = await saveExportRecord(tmp, {
      fileName: "Test_CV.pdf",
      format: "pdf",
      templateId: "ats-standard",
      ats: { scoreCard: { overall: { label: "Strong" } } },
    });
    assert.ok(record.id, "id saknas");
    assert.ok(record.filePath, "filePath saknas");
    assert.ok(record.storedFile, "storedFile saknas");
    assert.ok(record.createdAt, "createdAt saknas");
    assert.ok(record.filePath.includes("cv-exports"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("STORE: listExportRecords returnerar sparade poster", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "fas4-list-"));
  try {
    await saveExportRecord(tmp, { fileName: "A_CV.pdf", format: "pdf", templateId: "ats-standard" });
    await saveExportRecord(tmp, { fileName: "B_CV.pdf", format: "docx", templateId: "professional" });
    const list = await listExportRecords(tmp);
    assert.equal(list.length, 2);
    assert.ok(list[0].id);
    assert.ok(list[0].qualityGatePassed === false || list[0].qualityGatePassed === true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("STORE: recordExportGateResult uppdaterar metadata och index", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "fas4-gate-store-"));
  try {
    const rec = await saveExportRecord(tmp, { fileName: "X_CV.pdf", format: "pdf", templateId: "ats-standard" });
    assert.equal(rec.qualityGate, undefined, "initialt ingen gate");
    await recordExportGateResult(tmp, rec.id, { passed: true, checks: [{ id: "x", label: "Test", ok: true, message: "OK" }], reason: null });
    const reread = await readExportRecord(tmp, rec.id);
    assert.equal(reread.qualityGate?.passed, true);
    assert.equal(reread.qualityGate?.checks?.length, 1);
    const list = await listExportRecords(tmp);
    assert.equal(list.length, 1);
    assert.equal(list[0].qualityGatePassed, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("STORE: exportRecordId ger deterministiskt 16-teckens id", () => {
  const a = exportRecordId("job123");
  const b = exportRecordId("job456");
  assert.equal(a.length, 16);
  assert.equal(b.length, 16);
  assert.notEqual(a, b);
});
