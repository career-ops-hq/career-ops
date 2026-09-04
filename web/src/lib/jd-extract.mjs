/**
 * jd-extract.mjs — plain text out of an uploaded job description file.
 *
 * "Add job" lets the user hand over the posting as a file, because that is the
 * form a lot of postings actually arrive in: a recruiter's PDF attachment, a
 * DOCX from an internal referral, a .md a scraper already produced. Everything
 * downstream of the upload (jd-source.mjs, the evaluate prompt, the report) works
 * on text, so this module is the whole of the file-format problem.
 *
 * Two extractors, chosen for the same reason intake.mjs chose its one: zero new
 * package.json dependencies.
 *
 *   .pdf   `pdftotext -layout` (Poppler), the same rung intake.mjs's ladder uses.
 *          Born-digital PDFs — which is every posting a recruiter exports — carry
 *          a text layer it reads directly. No binary on PATH is NOT a crash: the
 *          caller gets a message telling the user to paste the text instead,
 *          which always works and costs them one keystroke.
 *   .docx  A ~50-line reader over the format's own structure. A .docx is a ZIP
 *          holding word/document.xml, and Node ships the two pieces needed to
 *          open one (zlib.inflateRawSync for the entries, Buffer for the record
 *          offsets). Shelling out to `unzip` would add a PATH dependency for a
 *          format that needs none, and a library would add a dependency to a
 *          package.json whose whole discipline is not having them.
 *
 * .doc / .rtf / .odt / .pages are refused with a message, not silently mangled:
 * the legacy binary .doc format in particular yields readable-looking garbage
 * from a naive strings-style read, and a JD that is 30% garbage still scores.
 *
 * Plain dependency-free .mjs so the ZIP reader is unit-testable under bare
 * `node --test` against a .docx synthesized in the test itself.
 */

import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Largest upload accepted. A text-layer JD is kilobytes; 10MB is generous. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Extensions handled without any extraction step. */
const DIRECT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);

/** Extensions we recognize well enough to refuse with a specific reason. */
const REFUSED = {
  ".doc": "Old Word .doc files can't be read reliably. Save it as .docx or PDF, or paste the text.",
  ".rtf": "RTF isn't supported. Save it as .docx or PDF, or paste the text.",
  ".odt": "OpenDocument .odt isn't supported. Save it as .docx or PDF, or paste the text.",
  ".pages": "Apple Pages files aren't supported. Export to PDF or Word, or paste the text.",
};

/**
 * Lowercase extension including the dot, or "" when the name has none.
 * @param {string} filename
 * @returns {string}
 */
export function extensionOf(filename) {
  const dot = String(filename ?? "").lastIndexOf(".");
  return dot > 0 ? String(filename).slice(dot).toLowerCase() : "";
}

/* ── DOCX ─────────────────────────────────────────────────────────────────── */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/**
 * Read one named entry out of a ZIP archive.
 *
 * Goes through the central directory rather than scanning for local headers,
 * because the central directory is the archive's authoritative index: a local
 * header may carry zeroed sizes with the real ones in a trailing data descriptor
 * (streamed ZIPs, which Word does produce), and only the central directory is
 * guaranteed to have them.
 *
 * @param {Buffer} buf
 * @param {string} wanted  Entry name, e.g. "word/document.xml".
 * @returns {Buffer|null} The entry's uncompressed bytes, or null when the archive
 *   has no such entry (or is not a readable ZIP at all).
 */
export function readZipEntry(buf, wanted) {
  // The EOCD is last, but a trailing archive comment can push it up to 64KB back,
  // so scan backwards from the end for its signature.
  const minEocd = 22;
  if (!Buffer.isBuffer(buf) || buf.length < minEocd) return null;
  const scanFloor = Math.max(0, buf.length - minEocd - 0xffff);
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= scanFloor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  // 0xFFFFFFFF here means the real value lives in a ZIP64 record. A .docx that
  // large is not a job description, so refuse rather than grow a ZIP64 parser.
  if (p === 0xffffffff || p >= buf.length) return null;

  for (let i = 0; i < entries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    if (name === wanted) {
      if (compSize === 0xffffffff || localOff === 0xffffffff) return null; // ZIP64
      if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== LOC_SIG) return null;
      // The local header's own name/extra lengths are the authoritative ones for
      // locating the data: the extra field routinely differs between the local
      // and central copies of the same entry.
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const end = start + compSize;
      if (end > buf.length) return null;
      const raw = buf.subarray(start, end);
      if (method === 0) return Buffer.from(raw); // stored
      if (method !== 8) return null; // anything but deflate is not a .docx we wrote
      try {
        return inflateRawSync(raw);
      } catch {
        return null;
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** The five XML entities that can appear in WordprocessingML text runs. */
function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // Last, so an escaped "&amp;lt;" survives as the literal "&lt;".
    .replace(/&amp;/g, "&");
}

/**
 * Every construct in a .docx this reader cares about, as one alternation:
 * the text of a run (`<w:t>`), the two inline break elements, and the three
 * closing tags that carry structure.
 */
const DOCX_TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\b[^>]*?\/?>|<\/w:(p|tc|tr)>/g;

/** What each structural token contributes to the plain text. */
const DOCX_SEPARATOR = { tab: "\t", br: "\n", p: "\n", tc: "\t", tr: "\n" };

/**
 * WordprocessingML -> plain text.
 *
 * Reads the text OUT of `<w:t>` runs rather than stripping tags off the whole
 * document, which is both the correct reading of the format and the only one
 * that is safe. A single-pass `replace(/<[^>]*>/g, "")` over attacker-supplied
 * markup is incomplete sanitization by construction (CodeQL
 * js/incomplete-multi-character-sanitization): nested angle brackets survive one
 * pass, and this text goes on to be written to a file, rendered in the report
 * view, and read into an agent's context. Only what the format says is text
 * becomes text, so nothing else can ride along.
 *
 * Structure is preserved because it is the only thing separating one
 * requirement from the next: strip it and a list of five requirements reads as
 * one sentence, which is exactly the shape that makes an evaluation misjudge
 * the role. Paragraph and row ends become newlines, tabs and cell ends become
 * tabs.
 *
 * @param {string} xml
 * @returns {string}
 */
export function docxXmlToText(xml) {
  /** @type {Array<{kind: "text"|"tab"|"br"|"p"|"tc"|"tr", value?: string}>} */
  const tokens = [];
  for (const m of String(xml ?? "").matchAll(DOCX_TOKEN)) {
    if (m[1] !== undefined) tokens.push({ kind: "text", value: decodeXmlEntities(m[1]) });
    else tokens.push({ kind: m[2] ?? m[3] });
  }

  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "text") {
      out += t.value;
      continue;
    }
    // Every table cell wraps its text in a <w:p> of its own, so the plain
    // paragraph rule would end each cell with a newline and turn a two-column
    // comp table into "Level\n\tSenior". Inside a table the cell and row
    // boundaries are the real separators, so a paragraph that ends one is not
    // also its own line.
    if (t.kind === "p") {
      const next = tokens[i + 1]?.kind;
      if (next === "tc" || next === "tr") continue;
    }
    out += DOCX_SEPARATOR[t.kind];
  }

  return out.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * @param {Buffer} buf
 * @returns {{ok: true, text: string} | {ok: false, error: string}}
 */
export function extractDocx(buf) {
  const xml = readZipEntry(buf, "word/document.xml");
  if (!xml) {
    return { ok: false, error: "That .docx could not be opened. Re-save it from Word, or paste the text instead." };
  }
  const text = docxXmlToText(xml.toString("utf8"));
  if (!text) return { ok: false, error: "That .docx has no readable text in it. Paste the posting instead." };
  return { ok: true, text };
}

/* ── PDF ──────────────────────────────────────────────────────────────────── */

const PDF_MISSING =
  "No PDF text reader is installed, so this PDF can't be read. Install poppler (brew install poppler, or apt install poppler-utils), or paste the posting text instead.";

/**
 * Is Poppler's pdftotext runnable here?
 *
 * Presence, not exit status: Poppler's pdftotext exits 0 on `-v` but Xpdf's build
 * exits 99, and treating a nonzero exit as absence is the bug intake.mjs already
 * documents (it silently skipped every PDF on a machine where extraction worked).
 * A process that RAN answers the question, whatever it returned.
 *
 * @param {(cmd: string, args: string[], opts: object) => unknown} [run]
 * @returns {boolean}
 */
export function hasPdfExtractor(run = execFileSync) {
  try {
    run("pdftotext", ["-v"], { stdio: ["ignore", "ignore", "ignore"], timeout: 10_000 });
    return true;
  } catch (e) {
    // ENOENT (not installed) / EACCES (not runnable) mean absent. A nonzero exit
    // sets `status` instead and means the binary is right there.
    return typeof e === "object" && e !== null && "status" in e && e.status !== null;
  }
}

/**
 * @param {Buffer} buf
 * @returns {{ok: true, text: string} | {ok: false, error: string}}
 */
export function extractPdf(buf) {
  if (!hasPdfExtractor()) return { ok: false, error: PDF_MISSING };
  // Via a temp file rather than stdin: pdftotext needs to seek (a PDF's xref
  // table is at the end), and its stdin path is a Poppler-version-dependent
  // convenience we would be relying on with no way to detect its absence.
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), "career-ops-jd-"));
    const pdf = join(dir, "posting.pdf");
    writeFileSync(pdf, buf);
    const out = execFileSync("pdftotext", ["-layout", pdf, "-"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    }).toString("utf8");
    const text = out.replace(/\r\n?/g, "\n").replace(/\f/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) {
      return {
        ok: false,
        error: "That PDF has no text layer, so it is probably a scan or an image. Paste the posting text instead.",
      };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: "That PDF could not be read. Paste the posting text instead." };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/* ── entry point ──────────────────────────────────────────────────────────── */

/**
 * Plain text out of an uploaded file, dispatched on its extension.
 *
 * Extension, not sniffed content: the user picked the file, the browser reported
 * its name, and a mismatch is far more likely to be a mis-named file the user
 * should hear about than an attack we should quietly handle. Every failure path
 * returns a message that names the workaround, because pasting the text is always
 * available and always works.
 *
 * @param {Buffer} buf
 * @param {string} filename
 * @returns {{ok: true, text: string} | {ok: false, error: string}}
 */
export function extractJdFile(buf, filename) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, error: "That file is empty." };
  if (buf.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is larger than 10MB. Upload the posting itself, not a whole brochure." };
  }
  const ext = extensionOf(filename);
  if (DIRECT_EXTENSIONS.has(ext)) {
    const text = buf.toString("utf8").replace(/\r\n?/g, "\n").trim();
    if (!text) return { ok: false, error: "That file is empty." };
    return { ok: true, text };
  }
  if (ext === ".docx") return extractDocx(buf);
  if (ext === ".pdf") return extractPdf(buf);
  if (ext in REFUSED) return { ok: false, error: REFUSED[ext] };
  return { ok: false, error: `${ext || "That file type"} isn't supported. Use PDF, DOCX, MD or TXT, or paste the text.` };
}
