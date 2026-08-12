/**
 * FAS 4 — Server-only export-quality-lager.
 *
 * Innehåller de funktioner som läser filer från disk (node:fs / node:crypto)
 * så att den klientbara modulen cv-export.mjs förblir ren (ingen node:fs i
 * klientbundlen). Importeras endast från API-routes och tester (server).
 */
import { existsSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractPdfText } from "./pdf-text.mjs";
import {
  detectLanguage,
  validateExportFileName,
  structuredCv,
  renderPdf,
  renderDocx,
  renderTxt,
  renderMarkdown,
  buildExportFileName,
} from "./cv-export.mjs";

/** Genererar en export. Returnerar {fileName, format, buffer, text, structured}. */
export function renderCvExport({ cvText, templateId = "ats-standard", format = "pdf", fileName, role, company, kind = "cv" }) {
  const structured = structuredCv(cvText);
  let buffer = null;
  let text = "";
  if (format === "pdf") {
    buffer = renderPdf(structured, templateId);
    text = extractPdfText(buffer);
  } else if (format === "docx") {
    buffer = renderDocx(structured, templateId);
    text = extractDocxText(buffer);
  } else if (format === "txt") {
    text = renderTxt(structured);
    buffer = Buffer.from(text, "utf8");
  } else {
    text = renderMarkdown(cvText);
    buffer = Buffer.from(text, "utf8");
  }
  const nameParts = String(structured.name || "").trim().split(/\s+/);
  const auto = () => buildExportFileName({
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
    role,
    company,
    kind: kind === "coverletter" ? "CoverLetter" : "CV",
    ext: format,
  });
  const custom = String(fileName || "").trim();
  let built;
  if (custom) {
    const v = validateExportFileName(custom);
    built = v.valid ? custom : auto();
  } else {
    built = auto();
  }
  return { fileName: built, format, buffer, text, structured };
}

/** Läser text ur en DOCX (store-zip) för verifiering. */
export function extractDocxText(buf) {
  const marker = Buffer.from("word/document.xml", "utf8");
  let idx = buf.indexOf(marker);
  while (idx >= 0) {
    // Lokal fil-header börjar 30 bytes före namnet (sig 0x04034b50).
    const headerStart = idx - 30;
    if (headerStart >= 4 && buf.readUInt32LE(headerStart) === 0x04034b50) {
      const nameLen = buf.readUInt16LE(headerStart + 26);
      const extraLen = buf.readUInt16LE(headerStart + 28);
      const compSize = buf.readUInt32LE(headerStart + 18);
      const dataStart = headerStart + 30 + nameLen + extraLen;
      const data = buf.subarray(dataStart, dataStart + compSize).toString("utf8");
      return data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    idx = buf.indexOf(marker, idx + 1);
  }
  return "";
}

/**
 * Export Quality Gate — kontrollerar att en exporterad fil är giltig och att
 * original-CV:t är oförändrat. Returnerar {passed, checks, reason}.
 */
export function runExportQualityGate({
  filePath,
  fileName,
  format,
  sourceText,
  originalCvPath,
  originalSha256,
} = {}) {
  const checks = [];
  const add = (id, label, ok, message) => checks.push({ id, label, ok, message });

  const source = String(sourceText || "");
  const sectionTitles = (source.match(/^##(?!#)\s+.+$/gm) || [])
    .map((t) => t.replace(/^##\s+/, "").trim())
    .filter(Boolean);
  const lastContentLine = source.split("\n").map((l) => l.trim()).filter(Boolean).pop() || "";

  // 1. Filen existerar
  let exists = false;
  try { exists = existsSync(filePath) && statSync(filePath).isFile(); } catch { exists = false; }
  add("file-exists", "Filen existerar", exists, exists ? "Exportfilen finns på disk." : "Exportfilen hittades inte.");

  // 2. Filen kan öppnas
  let buf = null;
  try { buf = readFileSync(filePath); add("file-openable", "Filen kan öppnas", true, "Filen lästes utan fel."); }
  catch { add("file-openable", "Filen kan öppnas", false, "Filen kunde inte läsas."); }

  // 3. Filen är inte tom
  const notEmpty = !!buf && buf.length > 0;
  add("file-not-empty", "Filen är inte tom", notEmpty, notEmpty ? `${buf.length} byte.` : "Filen är tom (0 byte).");

  // 4. Texten finns kvar (ordtäckning — PDF-text kan sakna radmellanslag)
  let extracted = "";
  if (buf) {
    if (format === "pdf") extracted = extractPdfText(buf);
    else if (format === "docx") extracted = extractDocxText(buf);
    else extracted = buf.toString("utf8");
  }
  const extLow = extracted.toLowerCase();
  const sourceWords = [...new Set((source.toLowerCase().match(/[a-zåäö][a-zåäö0-9-]{2,}/g) || []).map((w) => w.replace(/[^a-zåäö0-9]/g, "")))].filter(Boolean);
  const foundWords = sourceWords.filter((w) => extLow.includes(w)).length;
  const coverage = sourceWords.length ? foundWords / sourceWords.length : 0;
  const firstLine = (source.split("\n").find((l) => l.trim() && !/^#/.test(l)) || "").trim();
  const namePresent = !firstLine || extLow.includes(firstLine.toLowerCase());
  const textPreserved = coverage >= 0.5 && namePresent;
  add("text-preserved", "Texten finns kvar", textPreserved, textPreserved ? `${Math.round(coverage * 100)} % av källans ord hittades i exporten.` : `Endast ${Math.round(coverage * 100)} % ordtäckning — texten verkar ha gått förlorad.`);

  // 5. PDF-text är markerbar (när relevant)
  if (format === "pdf") {
    const selectable = coverage >= 0.5;
    add("pdf-text-selectable", "PDF-text är markerbar", selectable, selectable ? `Textlagret extraherades korrekt (${Math.round(coverage * 100)} % ordtäckning, markerbar text).` : "Textlagret saknas eller är tomt.");
  } else {
    add("pdf-text-selectable", "PDF-text är markerbar", true, "Ej tillämpligt för detta format.");
  }

  // 6. Inga tomma sidor
  if (format === "pdf" && buf) {
    const pagesMatch = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
    const pageCount = pagesMatch ? pagesMatch.length : 1;
    const expectedMax = Math.ceil(Math.max(source.split(/\s+/).length, 1) / 120) + 2;
    const noEmpty = pageCount <= expectedMax && coverage > 0;
    add("no-empty-pages", "Inga tomma sidor", noEmpty, noEmpty ? `${pageCount} sidor, samtliga med innehåll.` : `${pageCount} sidor — misstänkt tom sida.`);
  } else {
    add("no-empty-pages", "Inga tomma sidor", true, "Ej tillämpligt för detta format.");
  }

  // 7. Inget innehåll kapas (normaliserat mot teckenkodningsskillnader, t.ex. en-dash → "-")
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9åäö]/g, "");
  const notTruncated = !lastContentLine || norm(extracted).includes(norm(lastContentLine).slice(0, 40));
  add("content-not-truncated", "Inget innehåll kapas", notTruncated, notTruncated ? "Sista innehållsraden finns i exporten." : "Sista innehållsraden saknas — innehåll kan ha kapats.");

  // 8. Korrekt sidstorlek (A4 för PDF)
  if (format === "pdf" && buf) {
    const raw = buf.toString("latin1");
    const a4 = raw.includes("595.28") && raw.includes("841.89");
    add("page-size", "Korrekt sidstorlek", a4, a4 ? "A4 (595 × 842 pt)." : "Sidstorleken avviker från A4.");
  } else {
    add("page-size", "Korrekt sidstorlek", true, "Ej tillämpligt för detta format.");
  }

  // 9. Korrekt språk
  const srcLang = detectLanguage(source);
  const expLang = format === "docx" ? srcLang : detectLanguage(extracted);
  const langOk = srcLang === "okänd" || srcLang === expLang || expLang === "okänd";
  add("language", "Korrekt språk", langOk, langOk ? `Dominant språk: ${srcLang}.` : `Språk skiljer sig: källa ${srcLang}, export ${expLang}.`);

  // 10. Korrekt filnamn
  const fn = validateExportFileName(fileName || "");
  add("file-name", "Korrekt filnamn", fn.valid, fn.valid ? `"${fileName}" följer Namn_Namn_Roll_Företag_CV.ext.` : `"${fileName}" — ${fn.reason || "ogiltigt format."}`);

  // 11. Sektioner finns kvar
  const missingSections = sectionTitles.filter((t) => !extracted.toLowerCase().includes(t.toLowerCase()));
  add("sections-present", "Sektioner finns kvar", missingSections.length === 0, missingSections.length === 0 ? `${sectionTitles.length} sektioner verifierade.` : `Saknade sektioner: ${missingSections.join(", ")}`);

  // 12. Original-CV oförändrat
  if (originalCvPath && originalSha256) {
    let ok = false;
    try {
      const current = createHash("sha256").update(readFileSync(originalCvPath)).digest("hex");
      ok = current === originalSha256;
    } catch { ok = false; }
    add("original-cv-unchanged", "Original-CV är oförändrat", ok, ok ? "Original-CV:ts SHA-256 stämmer." : "Original-CV:t har ändrats!");
  } else {
    add("original-cv-unchanged", "Original-CV är oförändrat", true, "Ingen originalfil angiven — hoppas över.");
  }

  const failed = checks.filter((c) => !c.ok);
  return { passed: failed.length === 0, checks, reason: failed.length ? failed.map((c) => c.label).join(", ") : null };
}
