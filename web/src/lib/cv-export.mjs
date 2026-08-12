/**
 * FAS 4 — CV Designer + Export + Quality Gate.
 *
 * Dependency-free export: PDF- och DOCX-skrivare skrivs här direkt i stället
 * för att dra in npm-paket. Motivering (dokumenterad enligt FAS 4-regeln om
 * nya beroenden): ingen extern kod = ingen supply chain-risk, deterministisk
 * utdata, och quality gate kan verifiera textlagret med redan testad
 * pdf-text.mjs. PDF:en är A4 med Helvetica (standardtypsnitt → markerbar
 * text i alla visare). DOCX:en är en store-zip med word/document.xml.
 */
import { buildExportFileName, validateExportFileName, analyzeCvForAts } from "./ats-analyzer.mjs";
import { parseCvSections } from "./cv-tailoring.mjs";

export const CV_TEMPLATES = Object.freeze([
  {
    id: "ats-standard",
    name: "ATS Standard",
    description: "En kolumn, maximal maskinläsbarhet, tydliga rubriker, inga kritiska uppgifter i sidhuvud/sidfot, minimala grafiska element.",
  },
  {
    id: "professional",
    name: "Professional",
    description: "Modern, ren och professionell med diskret visuell hierarki — fortsatt ATS-vänlig.",
  },
  {
    id: "executive",
    name: "Executive",
    description: "För seniora specialist- och ledarroller: stark sammanfattning, erfarenhets- och resultatfokus, premiumdesign.",
  },
]);

export const EXPORT_FORMATS = Object.freeze(["pdf", "docx", "txt", "md"]);

/* ── Markdown → strukturerad form ─────────────────────────────────────── */

/** Plockar ut namn/header + sektioner (rad-baserat) ur en CV-markdown. */
export function structuredCv(cvText) {
  const text = String(cvText || "");
  const parsed = parseCvSections(text);
  const header = parsed.find((s) => s.type === "header");
  const headerLines = (header ? header.original : text.split("\n").slice(0, 6)).split("\n").filter((l) => l.trim() !== "");
  const name = headerLines.find((l) => !/^#/.test(l))?.trim() || "";
  const sections = parsed
    .filter((s) => s.type !== "header")
    .map((s) => ({
      type: s.type,
      title: s.title.replace(/^#{1,6}\s*/, "").trim(),
      lines: s.original.split("\n").slice(1),
    }));
  return { name, headerLines, sections };
}

/* ── Språkdetektion (dominans, ej exakt) ──────────────────────────────── */

const SWE = /(och|att|det|som|för|med|har|inte|men|var|vid|från|den|till|av|är|jag|vi|de|sig|kan|ska|år|efter|under|över|utan|även|eller|hade|varit|blir|blev|när|där|detta|dessa)/gi;
const ENG = /\b(the|and|with|for|from|that|this|have|has|was|were|are|will|can|not|but|also|into|over|under|about|experience|skills|education|work|developer|years)\b/gi;

export function detectLanguage(text) {
  const swe = (text.match(SWE) || []).length;
  const eng = (text.match(ENG) || []).length;
  if (swe === 0 && eng === 0) return "okänd";
  if (swe > eng * 2) return "sv";
  if (eng > swe * 2) return "en";
  return "blandat";
}

/* ── HTML-mallar (preview + docx-semantik) ────────────────────────────── */

const TEMPLATE_CSS = {
  "ats-standard": `
    body { font-family: Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 48px; font-size: 12px; line-height: 1.45; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .contact { color: #333; margin-bottom: 18px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #999; padding-bottom: 3px; margin: 20px 0 8px; }
    h3 { font-size: 12.5px; margin: 12px 0 3px; }
    ul { margin: 4px 0 8px; padding-left: 18px; }
    li { margin-bottom: 3px; }
    p { margin: 4px 0; }
    .page { width: 210mm; min-height: 297mm; }`,
  professional: `
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #222; margin: 0; padding: 48px 52px; font-size: 12px; line-height: 1.5; }
    h1 { font-size: 24px; margin: 0 0 2px; color: #1a1a1a; }
    .contact { color: #555; margin-bottom: 20px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #2c5f8a; border-bottom: 1px solid #d8d8d8; padding-bottom: 4px; margin: 22px 0 8px; }
    h3 { font-size: 12.5px; margin: 12px 0 3px; color: #111; }
    ul { margin: 4px 0 8px; padding-left: 18px; }
    li { margin-bottom: 3px; }
    p { margin: 4px 0; }`,
  executive: `
    body { font-family: Georgia, 'Times New Roman', serif; color: #1c1c1c; margin: 0; padding: 54px 56px; font-size: 12px; line-height: 1.55; }
    h1 { font-size: 28px; margin: 0 0 2px; color: #10243e; letter-spacing: 0.3px; }
    .contact { color: #4a4a4a; margin-bottom: 22px; font-size: 11.5px; }
    h2 { font-size: 13.5px; text-transform: uppercase; letter-spacing: 1.2px; color: #10243e; border-bottom: 2px solid #10243e; padding-bottom: 4px; margin: 24px 0 9px; }
    h3 { font-size: 13px; margin: 13px 0 3px; color: #10243e; }
    ul { margin: 5px 0 9px; padding-left: 18px; }
    li { margin-bottom: 4px; }
    p { margin: 5px 0; }`,
};

/** Renderar CV:t som fristående HTML (preview). */
export function renderHtml(structured, templateId = "ats-standard") {
  const css = TEMPLATE_CSS[templateId] || TEMPLATE_CSS["ats-standard"];
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = structured.headerLines.map((l) => esc(l.replace(/^#{1,6}\s*/, "")));
  const contact = lines.join(" · ");
  const body = structured.sections
    .map((sec) => {
      const title = esc(sec.title);
      const items = sec.lines
        .map((raw) => {
          const l = raw.trim();
          if (!l) return "";
          const isBullet = /^[-*•]\s+/.test(l);
          const text = esc(l.replace(/^[-*•]\s+/, ""));
          if (isBullet) return `  <li>${text}</li>`;
          const isSub = /^#{3,6}\s*/.test(l);
          if (isSub) return `<h3>${esc(l.replace(/^#{3,6}\s*/, ""))}</h3>`;
          return `<p>${text}</p>`;
        })
        .filter(Boolean)
        .join("\n");
      const hasList = items.includes("<li>");
      return `<section><h2>${title}</h2>${hasList ? `<ul>\n${items}\n</ul>` : items}</section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="sv"><head><meta charset="utf-8" /><title>${esc(structured.name || "CV")}</title>
<style>${css}</style></head>
<body><div class="page">
<h1>${esc(structured.name)}</h1>
<div class="contact">${contact}</div>
${body}
</div></body></html>`;
}

/* ── PDF-skrivare (A4, Helvetica, markerbart textlager) ────────────────── */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;

/** Unicode → WinAnsi (CP1252); omappbara tecken → "?". */
function encodeWinAnsi(str) {
  const special = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
    0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
    0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
    0x017e: 0x9e, 0x0178: 0x9f,
  };
  const out = [];
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
    else if (special[cp] !== undefined) out.push(special[cp]);
    else out.push(0x3f); // "?"
  }
  return Buffer.from(out);
}

/** Ungefärlig bredd för Helvetica (avg ~0.5 × storlek). */
function textWidth(text, size) {
  return [...String(text)].length * size * 0.52;
}

function wrapLine(text, size, maxWidth) {
  if (textWidth(text, size) <= maxWidth) return [text];
  const words = String(text).split(" ");
  const out = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (textWidth(cand, size) <= maxWidth || !cur) cur = cand;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Bygger en PDF (A4) med markerbart textlager. Returnerar Buffer.
 * `templateId` styr färg/typografi. Inga kritiska uppgifter i sidhuvudet;
 * sidfoten innehåller endast sidnummer (ATS Standard) eller namn + sidnummer.
 */
export function renderPdf(structured, templateId = "ats-standard") {
  const name = structured.name || "CV";
  const pages = []; // { stream: [], color: current }
  const FONT_REG = 0;
  const FONT_BOLD = 1;
  const CONTENT_W = A4.width - MARGIN * 2;
  const BOTTOM = 56;

  const palette = {
    "ats-standard": { heading: "0 0 0", line: "0.55 0.55 0.55", footer: "0.45 0.45 0.45" },
    professional: { heading: "0.17 0.37 0.54", line: "0.78 0.78 0.78", footer: "0.5 0.5 0.5" },
    executive: { heading: "0.06 0.14 0.24", line: "0.06 0.14 0.24", footer: "0.4 0.4 0.4" },
  }[templateId] || { heading: "0 0 0", line: "0.55 0.55 0.55", footer: "0.45 0.45 0.45" };

  let y = A4.height - MARGIN;
  let pageIdx = 0;
  const newPage = () => {
    pages.push({ ops: [], contentRects: 0 });
    pageIdx = pages.length - 1;
    y = A4.height - MARGIN;
  };
  newPage();

  const op = (s) => pages[pageIdx].ops.push(s);
  const color = (c) => op(`${c} rg`);
  const font = (f, size) => op(`BT /F${f + 1} ${size} Tf ET`);
  const text = (str, size, bold = false) => {
    const lines = wrapLine(str, size, CONTENT_W);
    for (const ln of lines) {
      if (y - size < BOTTOM) newPage();
      font(bold ? FONT_BOLD : FONT_REG, size);
      op(`BT 1 0 0 1 ${MARGIN} ${y - size} Tm (${escapePdfText(ln)}) Tj ET`);
      pages[pageIdx].contentRects += 1;
      y -= size * 1.42;
    }
  };
  const rule = () => {
    if (y - 8 < BOTTOM) newPage();
    color(palette.line);
    op(`${MARGIN} ${y} ${CONTENT_W} 0.8 re f`);
    y -= 10;
  };
  const gap = (n = 8) => { y -= n; };

  // ── Header ──
  color(palette.heading);
  text(name, templateId === "executive" ? 22 : templateId === "professional" ? 20 : 18, true);
  color("0 0 0");
  for (const line of structured.headerLines.slice(1)) {
    if (/^#/.test(line)) continue;
    text(line.replace(/^[-*•]\s+/, ""), 10);
  }
  gap(templateId === "executive" ? 14 : 10);

  // ── Sektioner ──
  for (const sec of structured.sections) {
    const title = sec.title.replace(/^#{1,6}\s*/, "");
    if (y - 30 < BOTTOM) newPage();
    color(palette.heading);
    text(title, 13, true);
    rule();
    color("0 0 0");
    for (const raw of sec.lines) {
      const l = raw.trim();
      if (!l) { gap(3); continue; }
      const isBullet = /^[-*•]\s+/.test(l);
      const isSub = /^#{3,6}\s*/.test(l);
      if (isSub) {
        if (y - 24 < BOTTOM) newPage();
        color(palette.heading);
        text(l.replace(/^#{3,6}\s*/, ""), 11.5, true);
        color("0 0 0");
      } else if (isBullet) {
        text(`• ${l.replace(/^[-*•]\s+/, "")}`, 10.5);
      } else {
        text(l, 10.5);
      }
    }
    gap(4);
  }

  // ── Sidfot (endast sidnummer / namn+sidnummer) ──
  for (let i = 0; i < pages.length; i++) {
    const footerText = templateId === "ats-standard" ? `Sida ${i + 1}` : `${name} — Sida ${i + 1}`;
    pages[i].ops.push(`BT /F1 8.5 Tf 1 0 0 1 ${MARGIN} 34 Tm (${escapePdfText(footerText)}) Tj ET`);
  }

  return buildPdf(pages.map((p) => p.ops.join("\n")));
}

function escapePdfText(s) {
  // ATS-säkert: em-dash/en-dash normaliseras till bindestreck i PDF-utskrift
  // (vissa ATS/textextraktorer tappar CP1252 0x91–0x97-tecken).
  return encodeWinAnsi(String(s).replace(/[\u2013\u2014]/g, "-"))
    .toString("latin1")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Bygger PDF-filen (objekt, xref, trailer) från sidornas content streams. */
export function buildPdf(pageStreams) {
  const objects = [];
  const push = (obj) => { objects.push(obj); return objects.length; };

  const catalog = push("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesRef = push(null); // 2: Pages — fylls efter sidorna
  const pageRefs = [];
  for (let i = 0; i < pageStreams.length; i++) {
    pageRefs.push(push(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 ${objects.length + 1} 0 R /F2 ${objects.length + 2} 0 R >> >> /Contents ${objects.length + 3} 0 R >>`));
  }
  const fontRef = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBoldRef = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const contentRefs = pageStreams.map((s) => push(`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`));
  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageStreams.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/* ── DOCX-skrivare (store-zip + word/document.xml) ────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Skapar en okomprimerad (store) zip-fil. files = [{name, data: Buffer|string}]. */
export function storeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6); // method 0 = store
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const cenOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(Buffer.concat(central).length, 12);
  eocd.writeUInt32LE(cenOffset, 16);
  return Buffer.concat([...chunks, ...central, eocd]);
}

const xmlEsc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Bygger en DOCX (Word) med rubrikstilar och punktlistor. */
export function renderDocx(structured, templateId = "ats-standard") {
  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`);
  parts.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${xmlEsc(structured.name)}</w:t></w:r></w:p>`);
  for (const line of structured.headerLines.slice(1)) {
    if (/^#/.test(line)) continue;
    parts.push(`<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:t>${xmlEsc(line.replace(/^[-*•]\s+/, ""))}</w:t></w:r></w:p>`);
  }
  for (const sec of structured.sections) {
    parts.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${xmlEsc(sec.title.replace(/^#{1,6}\s*/, ""))}</w:t></w:r></w:p>`);
    for (const raw of sec.lines) {
      const l = raw.trim();
      if (!l) continue;
      const isBullet = /^[-*•]\s+/.test(l);
      const isSub = /^#{3,6}\s*/.test(l);
      if (isSub) {
        parts.push(`<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${xmlEsc(l.replace(/^#{3,6}\s*/, ""))}</w:t></w:r></w:p>`);
      } else if (isBullet) {
        parts.push(`<w:p><w:pPr><w:ind w:left="360"/></w:pPr><w:r><w:t>• ${xmlEsc(l.replace(/^[-*•]\s+/, ""))}</w:t></w:r></w:p>`);
      } else {
        parts.push(`<w:p><w:r><w:t>${xmlEsc(l)}</w:t></w:r></w:p>`);
      }
    }
  }
  parts.push(`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);

  const documentXml = parts.join("");
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="1A1A1A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="2C5F8A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/><w:color w:val="111111"/></w:rPr></w:style>
</w:styles>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  return storeZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: documentXml },
    { name: "word/styles.xml", data: stylesXml },
  ]);
}

/* ── TXT / Markdown ───────────────────────────────────────────────────── */

export function renderTxt(structured) {
  const lines = [];
  for (const line of structured.headerLines) lines.push(line.replace(/^#{1,6}\s*/, "").trim());
  lines.push("");
  for (const sec of structured.sections) {
    lines.push(sec.title.replace(/^#{1,6}\s*/, "").toUpperCase());
    lines.push("");
    for (const raw of sec.lines) {
      const l = raw.trim();
      if (!l) { lines.push(""); continue; }
      const isBullet = /^[-*•]\s+/.test(l);
      const isSub = /^#{3,6}\s*/.test(l);
      if (isSub) lines.push(`  ${l.replace(/^#{3,6}\s*/, "")}`);
      else if (isBullet) lines.push(`- ${l.replace(/^[-*•]\s+/, "")}`);
      else lines.push(l);
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function renderMarkdown(cvText) {
  // Mall-oberoende: normaliserad markdown av CV-versionen.
  const text = String(cvText || "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return `${text}\n`;
}

/* ── Exportera (renderera + skapa filnamn) ────────────────────────────── */

export { buildExportFileName, validateExportFileName, analyzeCvForAts };
