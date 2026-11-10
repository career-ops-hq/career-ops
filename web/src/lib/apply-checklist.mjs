/**
 * Pure helpers for /pipeline/[id]/apply.
 * Server and node tests only. The client component receives the results.
 */
import fs from "node:fs";
import path from "node:path";
import { pdfIndexEntryForReport, reportNumberFromCell } from "./apply/cv-selection.mjs";

const EXPERIENCE_RE = /^(?:(?:work|professional)\s+)?experience$|^(?:employment|work)\s+history$/i;
const EDUCATION_RE = /^education\b/i;

export const PORTAL_TIPS = [
  {
    portal: "Workday",
    tip: "Create an account on that company's Workday site first. The session expires, so keep the tab open while you paste.",
  },
  {
    portal: "iCIMS",
    tip: "Create an account first. The form does not keep a draft without one.",
  },
  {
    portal: "UKG",
    tip: "Create an account first. The session expires, so keep the tab open while you paste.",
  },
  {
    portal: "Greenhouse",
    tip: "No account. Upload the PDF, then paste the fields below.",
  },
  {
    portal: "Lever",
    tip: "No account. The form is one page.",
  },
  {
    portal: "Ashby",
    tip: "No account. The form is short.",
  },
];

function heading(line) {
  const match = /^(#{1,6})\s+(.*)$/.exec(String(line ?? "").trim());
  if (!match) return null;
  return { level: match[1].length, text: plain(match[2]) };
}

function plain(text) {
  return String(text ?? "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plainBlock(lines) {
  const out = [];
  for (const line of lines) {
    const h = heading(line);
    const text = h ? h.text : plain(String(line).replace(/^\s*[-*]\s+/, ""));
    if (!text) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    out.push(text);
  }
  return out.join("\n").trim();
}

function jobBlocks(lines) {
  const jobs = [];
  let label = "";
  let buf = [];
  let started = false;
  const flush = () => {
    if (!started) return;
    const body = plainBlock(buf);
    const text = [label, body].filter(Boolean).join("\n");
    if (text) jobs.push({ label: label || "Role", text });
    buf = [];
  };
  for (const line of lines) {
    const h = heading(line);
    if (h && h.level === 3) {
      flush();
      label = h.text;
      started = true;
      continue;
    }
    if (h && h.level <= 2) break;
    buf.push(line);
    if (line.trim()) started = true;
  }
  flush();
  return jobs;
}

function sectionBody(cvText, test) {
  const lines = String(cvText ?? "").replace(/\r\n/g, "\n").split("\n");
  let capture = false;
  const body = [];
  for (const line of lines) {
    const h = heading(line);
    if (h && h.level === 2) {
      if (capture) break;
      capture = test(h.text);
      continue;
    }
    if (h && h.level === 1 && capture) break;
    if (capture) body.push(line);
  }
  return body;
}

/** Work history as one plain block per role, and education as one block. */
export function cvCopyFields(cvText) {
  const workLines = sectionBody(cvText, (title) => EXPERIENCE_RE.test(title));
  const educationLines = sectionBody(cvText, (title) => EDUCATION_RE.test(title));
  return {
    work: jobBlocks(workLines),
    education: plainBlock(educationLines),
  };
}

function emptyCopy(kind, from) {
  if (from === "none") return "cv.md is not in this workspace.";
  if (from === "cv") return kind === "work" ? "No work history in cv.md." : "No education section in cv.md.";
  return kind === "work" ? "No work history in this resume." : "No education section in this resume.";
}

function titleKind(title) {
  const text = String(title ?? "").replace(/\s+/g, " ").trim();
  if (EXPERIENCE_RE.test(text)) return "work";
  if (EDUCATION_RE.test(text)) return "education";
  return null;
}

function tagAt(html, index) {
  if (html[index] !== "<") return null;
  if (html.startsWith("<!--", index)) {
    const end = html.indexOf("-->", index + 4);
    return { kind: "skip", end: end === -1 ? html.length : end + 3 };
  }
  if (html.startsWith("<!", index) || html.startsWith("<?", index)) {
    const end = html.indexOf(">", index + 2);
    return { kind: "skip", end: end === -1 ? html.length : end + 1 };
  }
  const end = html.indexOf(">", index + 1);
  if (end === -1) return { kind: "skip", end: html.length };
  const raw = html.slice(index + 1, end);
  const closing = raw.startsWith("/");
  const nameMatch = /^\/?\s*([a-zA-Z][\w:-]*)/.exec(raw);
  const name = nameMatch ? nameMatch[1].toLowerCase() : "";
  const voidTag = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/.test(name);
  const self = !closing && (voidTag || /\/\s*$/.test(raw));
  return {
    kind: closing ? "close" : "open",
    name,
    attr: raw.replace(/^\/?\s*[a-zA-Z][\w:-]*/, ""),
    end: end + 1,
    self,
  };
}

function classList(attr) {
  const match = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attr);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").split(/\s+/).filter(Boolean);
}

function walkElements(html, openMatch) {
  const out = [];
  let capture = null;
  for (let i = 0; i < html.length; i++) {
    if (html[i] !== "<") continue;
    const tag = tagAt(html, i);
    if (!tag) break;
    if (tag.kind === "open" && !tag.self) {
      if (!capture && openMatch(tag)) capture = { name: tag.name, start: i, depth: 1 };
      else if (capture && tag.name === capture.name) capture.depth += 1;
    } else if (tag.kind === "close" && capture && tag.name === capture.name) {
      capture.depth -= 1;
      if (capture.depth === 0) {
        out.push({ start: capture.start, end: tag.end, html: html.slice(capture.start, tag.end) });
        capture = null;
      }
    }
    i = tag.end - 1;
  }
  return out;
}

function elementsWithClass(html, token) {
  return walkElements(html, (tag) => classList(tag.attr).includes(token));
}

function elementsNamed(html, names) {
  return walkElements(html, (tag) => names.has(tag.name));
}

function decodePoint(raw, radix) {
  const n = radix === 16 ? Number.parseInt(raw, 16) : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "";
  if (n === 160) return " ";
  return String.fromCodePoint(n);
}

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  middot: "\u00b7",
  bull: "\u2022",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  hellip: "\u2026",
};

const INLINE_TAG = "a|b|strong|i|em|u|mark|small|sub|sup|code|abbr|time";

function findNamedOpen(text, name, from) {
  const lower = text.toLowerCase();
  const open = `<${name}`;
  let at = from;
  while (at < text.length) {
    const start = lower.indexOf(open, at);
    if (start === -1) return -1;
    const next = text[start + open.length];
    if (next === undefined || next === ">" || next === "/" || next === " " || next === "\t" || next === "\n" || next === "\r" || next === "\f") return start;
    at = start + open.length;
  }
  return -1;
}

function cutOneBlock(text, name) {
  const start = findNamedOpen(text, name, 0);
  if (start === -1) return text;
  const openEnd = text.indexOf(">", start);
  if (openEnd === -1) return text.slice(0, start);
  const close = `</${name}`;
  const closeAt = text.toLowerCase().indexOf(close, openEnd + 1);
  if (closeAt === -1) return text.slice(0, start);
  const closeEnd = text.indexOf(">", closeAt + close.length);
  if (closeEnd === -1) return text.slice(0, start);
  return text.slice(0, start) + text.slice(closeEnd + 1);
}

function stripNamedBlocks(text, name) {
  let next = text;
  let prev;
  do {
    prev = next;
    next = cutOneBlock(next, name);
  } while (next !== prev);
  return next;
}

function stripComments(text) {
  let next = text;
  let prev;
  do {
    prev = next;
    const start = next.indexOf("<!--");
    if (start === -1) break;
    const end = next.indexOf("-->", start + 4);
    next = end === -1 ? next.slice(0, start) : next.slice(0, start) + next.slice(end + 3);
  } while (next !== prev);
  return next;
}

function stripHiddenHtml(html) {
  let text = String(html ?? "");
  let prev;
  do {
    prev = text;
    text = stripComments(stripNamedBlocks(stripNamedBlocks(text, "script"), "style"));
  } while (text !== prev);
  return text;
}

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      return decodePoint(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? entity : named;
  });
}

function visibleText(html) {
  const inline = new RegExp(`</?(?:${INLINE_TAG})\\b[^>]*>`, "gi");
  const decoded = decodeEntities(
    stripHiddenHtml(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(inline, "")
      .replace(/<[^>]+>/g, "\n"),
  );
  const out = [];
  for (const line of decoded.split("\n")) {
    const text = line.replace(/[ \t]+/g, " ").trim();
    if (!text) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    out.push(text);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function copyBlock(text) {
  if (!text) return null;
  const label = text.split("\n").find((line) => line.trim()) || "Role";
  return { label, text };
}

function sectionBoundaries(html) {
  const titled = elementsWithClass(html, "section-title");
  const headings = elementsNamed(html, new Set(["h1", "h2"])).filter(
    (heading) => !titled.some((title) => heading.start >= title.start && heading.start < title.end),
  );
  return [...titled, ...headings].sort((a, b) => a.start - b.start);
}

function workBlocks(body) {
  const jobs = elementsWithClass(body, "job");
  if (jobs.length) return jobs.map((job) => copyBlock(visibleText(job.html))).filter(Boolean);
  const block = copyBlock(visibleText(body));
  return block ? [block] : [];
}

function htmlPasteFields(html) {
  const bounds = sectionBoundaries(String(html ?? ""));
  let hasWork = false;
  let hasEducation = false;
  let work = [];
  let education = "";
  for (let i = 0; i < bounds.length; i++) {
    const kind = titleKind(visibleText(bounds[i].html));
    if (!kind) continue;
    const body = String(html).slice(bounds[i].end, i + 1 < bounds.length ? bounds[i + 1].start : String(html).length);
    if (kind === "work" && !hasWork) {
      hasWork = true;
      work = workBlocks(body);
    } else if (kind === "education" && !hasEducation) {
      hasEducation = true;
      education = visibleText(body);
    }
  }
  return { hasWork, hasEducation, work, education };
}

export function pasteCopyFields(tailoredHtml, masterText) {
  const master = masterText == null ? null : cvCopyFields(masterText);
  const tailored = tailoredHtml == null ? null : htmlPasteFields(tailoredHtml);
  const workFrom = tailored?.hasWork ? "tailored" : master ? "cv" : "none";
  const educationFrom = tailored?.hasEducation ? "tailored" : master ? "cv" : "none";
  const work = workFrom === "tailored" ? tailored.work : (master?.work ?? []);
  const education = educationFrom === "tailored" ? tailored.education : (master?.education ?? "");
  return {
    work,
    education,
    workEmpty: work.length ? "" : emptyCopy("work", workFrom),
    educationEmpty: education ? "" : emptyCopy("education", educationFrom),
  };
}

function containedHtmlFile(root, relCandidate) {
  const stored = String(relCandidate ?? "").trim();
  if (!stored || path.isAbsolute(stored) || !stored.toLowerCase().endsWith(".html")) return null;
  const abs = path.resolve(root, stored);
  let realAbs;
  let realOutput;
  try {
    if (!fs.statSync(abs).isFile()) return null;
    realAbs = fs.realpathSync(abs);
    realOutput = fs.realpathSync(path.join(root, "output"));
  } catch {
    return null;
  }
  const rel = path.relative(realOutput, realAbs);
  if (!rel || path.isAbsolute(rel) || rel.split(path.sep).includes("..")) return null;
  return realAbs;
}

/**
 * @param {string} indexText
 * @param {string | null | undefined} pdfRelative
 * @param {string} root
 * @param {(abs: string) => string} readFile
 * @returns {string | null}
 */
export function tailoredResumeText(indexText, pdfRelative, root, readFile) {
  const pdf = String(pdfRelative ?? "").trim();
  if (!pdf) return null;
  let htmlRel = "";
  for (const line of String(indexText ?? "").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if ((fields[1] ?? "").trim() !== pdf) continue;
    const html = (fields[2] ?? "").trim();
    if (html) htmlRel = html;
  }
  const candidates = [];
  if (htmlRel) candidates.push(htmlRel);
  if (pdf.toLowerCase().endsWith(".pdf")) candidates.push(`${pdf.slice(0, -4)}.html`);
  for (const candidate of candidates) {
    const abs = containedHtmlFile(root, candidate);
    if (!abs) continue;
    try {
      return readFile(abs);
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
  }
  return null;
}

function pushItem(items, label, text) {
  const value = String(text ?? "").trim();
  if (!value) return;
  items.push({ label: String(label || "Answer").trim() || "Answer", text: value });
}

/**
 * Copy targets from parseApplicationAnswersSection().
 * The text is the answer, selection, or file path. Empty values are skipped.
 * @param {object | null} snapshot
 */
export function answerCopyItems(snapshot) {
  if (!snapshot) return [];
  const items = [];
  for (const entry of snapshot.freeText ?? []) pushItem(items, entry.question, entry.answer);
  for (const entry of snapshot.selections ?? []) pushItem(items, entry.question, entry.selection);
  for (const entry of snapshot.fieldValues ?? []) pushItem(items, entry.question || entry.field, entry.answer ?? entry.value);
  for (const entry of snapshot.files ?? []) pushItem(items, entry.field || entry.question, entry.path);
  return items;
}

/**
 * Report number for pdf-index and mark-pdf-ready.
 * The page id is a tracker row number, which is a different counter.
 * @param {string} id
 * @param {{ report?: string } | null} app
 * @param {string | null} reportFile
 * @returns {number | null}
 */
export function reportNumberFor(id, app, reportFile) {
  const fromCell = app ? reportNumberFromCell(app.report) : null;
  if (fromCell != null) return fromCell;
  if (reportFile) {
    const n = parseInt(reportFile, 10);
    if (Number.isInteger(n)) return n;
  }
  if (!app && /^\d+$/.test(String(id ?? ""))) return Number(id);
  return null;
}

/**
 * A pdf-index row whose file is under output/ and exists.
 * relativePath is workspace-relative, never an absolute home path.
 * @param {string} indexText
 * @param {number} reportNumber
 * @param {"cv" | "cover"} kind
 * @param {string} root
 * @param {(abs: string) => boolean} fileExists
 * @returns {{ relativePath: string, absolutePath: string } | null}
 */
export function indexedPdf(indexText, reportNumber, kind, root, fileExists) {
  const entry = pdfIndexEntryForReport(indexText, reportNumber, kind);
  if (!entry.found || !entry.path) return null;
  const stored = String(entry.path).trim();
  if (!stored || path.isAbsolute(stored)) return null;
  const abs = path.resolve(root, stored);
  const outputDir = path.resolve(root, "output");
  if (abs !== outputDir && !abs.startsWith(outputDir + path.sep)) return null;
  if (typeof fileExists !== "function" || !fileExists(abs)) return null;
  const relativePath = path.relative(root, abs).split(path.sep).join("/");
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return { relativePath, absolutePath: abs };
}
