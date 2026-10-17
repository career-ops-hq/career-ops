import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { careerOpsRoot, findReportFile, isRegularContainedFile, pdfPathStatusForReport, rootScript } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";
import { matchesTailoredCv, sortNewestFirst } from "@/lib/apply/cv-match.mjs";
import { markTrackerReady, spawnGeneratePdf } from "@/lib/pdf-render.mjs";
import { htmlText, parseBlocks, renderBlocks, type BlockTree } from "./html-blocks.mjs";
import { parseBaseCv } from "./base-cv.mjs";
import { unsupportedClaims } from "./rewrite.mjs";
import { buildStudioDoc, emptyEdits, parseEdits, resolveStudio, type StudioDoc, type StudioEdits } from "./studio.mjs";

const EDITED_SUFFIX = "-edited";

export type StudioLoad =
  | { ok: true; reportNum: string; company: string; file: string; tree: BlockTree; doc: StudioDoc; edits: StudioEdits; stale: boolean; hasBase: boolean }
  | { ok: false; reason: "no-report" | "no-tailored-cv" | "unreadable-layout" };

type KeywordMatch = { extractKeywords: (report: string) => string[]; keywordCount: (keyword: string, text: string) => number };

async function coreModule<T>(name: string): Promise<T> {
  return import(/* webpackIgnore: true */ pathToFileURL(rootScript(name)).href) as Promise<T>;
}

function reportIdentity(n: string) {
  const file = findReportFile(n);
  if (!file) return null;
  const m = path.basename(file).match(/^(\d+)-(.+?)-\d{4}-\d{2}-\d{2}\.md$/);
  const reportNum = (m?.[1] ?? n).replace(/^0+(?=\d)/, "").padStart(3, "0");
  return { file, reportNum, slug: m?.[2] ?? "" };
}

function originalOf(htmlPath: string) {
  return htmlPath.replace(new RegExp(`${EDITED_SUFFIX}\\.html$`), ".html");
}

/**
 * The tailored HTML for a report: the sibling of the PDF recorded in
 * data/pdf-index.tsv when there is one, else the newest output/ HTML for the
 * report's company. An edited copy is never a source, because edits are always
 * made against the original the tailor wrote.
 */
async function findTailoredHtml(n: string, slug: string): Promise<string | null> {
  const dir = path.join(careerOpsRoot(), "output");
  const indexed = await pdfPathStatusForReport(n);
  if (indexed.status === "found") {
    const sibling = originalOf(indexed.path.replace(/\.pdf$/i, ".html"));
    if (isRegularContainedFile(sibling, dir)) return sibling;
  }
  if (!slug) return null;
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => {
        const name = f.toLowerCase();
        return name.endsWith(".html") && !name.endsWith(`${EDITED_SUFFIX}.html`) && !name.endsWith("-ats.html");
      })
      .filter((f) => matchesTailoredCv(f.toLowerCase(), slug))
      .filter((f) => isRegularContainedFile(path.join(dir, f), dir));
  } catch {
    return null;
  }
  const sorted = sortNewestFirst(dir, files);
  return sorted.length ? path.join(dir, sorted[0]) : null;
}

function editsPath(reportNum: string) {
  return path.join(careerOpsRoot(), ".career-ops-web", "cv-studio", `${reportNum}.json`);
}

function companyOf(reportText: string, slug: string) {
  return reportText.match(/^#\s.*?:\s*(.+?)\s+(?:--|—|–)\s+/m)?.[1]?.trim() ?? slug;
}

export async function loadStudio(n: string): Promise<StudioLoad> {
  if (!/^\d+$/.test(n)) return { ok: false, reason: "no-report" };
  const id = reportIdentity(n);
  if (!id) return { ok: false, reason: "no-report" };
  const file = await findTailoredHtml(n, id.slug);
  if (!file) return { ok: false, reason: "no-tailored-cv" };

  const html = fs.readFileSync(file, "utf8");
  const tree = parseBlocks(html);
  if (!tree.sections.some((s) => s.items.some((i) => i.bullets.length))) return { ok: false, reason: "unreadable-layout" };

  const reportText = fs.readFileSync(id.file, "utf8");
  const km = await coreModule<KeywordMatch>("keyword-match");
  const keywords = km.extractKeywords(reportText);
  const keywordsIn = (text: string) => keywords.filter((k) => km.keywordCount(k, text) > 0);

  let cvMd = "";
  try {
    cvMd = fs.readFileSync(path.join(careerOpsRoot(), "cv.md"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const base = parseBaseCv(cvMd, await coreModule("lib/cv-markdown"));

  const bulletIds = tree.sections.flatMap((s) => s.items.flatMap((i) => i.bullets.map((b) => b.id)));
  const itemIds = tree.sections.flatMap((s) => s.items.map((i) => i.id));
  const items = new Map(tree.sections.flatMap((s) => s.items.map((i) => [i.id, i] as const)));
  const itemText = (itemId: string) => {
    const item = items.get(itemId)!;
    let out = html.slice(item.start, item.end);
    for (const b of [...item.bullets].reverse()) out = out.slice(0, b.start - item.start) + out.slice(b.end - item.start);
    return htmlText(out);
  };
  let withoutStyle = renderBlocks(tree, { hidden: new Set([...itemIds, ...bulletIds]), order: {}, text: {} });
  // Drop <style> blocks until stable so nested markers cannot leave a live tag.
  for (let prev = null; withoutStyle !== prev; ) {
    prev = withoutStyle;
    withoutStyle = withoutStyle.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  }
  const fixedText = htmlText(withoutStyle);

  const sourceHash = crypto.createHash("sha256").update(html).digest("hex").slice(0, 16);
  const doc = buildStudioDoc({ tree, base, keywords, sourceHash, keywordsIn, itemText, fixedText });

  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(editsPath(id.reportNum), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const { edits, stale } = parseEdits(raw, sourceHash) ?? { edits: emptyEdits(sourceHash), stale: false };
  return { ok: true, reportNum: id.reportNum, company: companyOf(reportText, id.slug), file: path.basename(file), tree, doc, edits, stale, hasBase: base.entries.length > 0 || base.summary !== null };
}

export function saveEdits(reportNum: string, edits: StudioEdits) {
  const file = editsPath(reportNum);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, JSON.stringify(edits, null, 2) + "\n");
}

export async function keywordsInText(n: string, text: string): Promise<string[] | null> {
  const id = reportIdentity(n);
  if (!id) return null;
  const km = await coreModule<KeywordMatch>("keyword-match");
  return km.extractKeywords(fs.readFileSync(id.file, "utf8")).filter((k) => km.keywordCount(k, text) > 0);
}

type VerifyCvFacts = {
  verifyFacts: (text: string, opts: { sourcePaths: string[]; configPath: string }) => Parameters<typeof unsupportedClaims>[0];
  auditClaims: (text: string, sourceText: string) => Parameters<typeof unsupportedClaims>[1];
};

/** The claims in a rewrite that cv.md and article-digest.md do not support, and the metrics its own bullet does not carry. */
export async function unsupportedRewriteClaims(text: string, bulletText: string): Promise<string[]> {
  const root = careerOpsRoot();
  const { verifyFacts, auditClaims } = await coreModule<VerifyCvFacts>("verify-cv-facts");
  const cv = verifyFacts(text, { sourcePaths: [path.join(root, "cv.md"), path.join(root, "article-digest.md")], configPath: path.join(root, "config", "cv-facts.json") });
  return unsupportedClaims(cv, auditClaims(text, bulletText));
}

export type RenderOutcome = { ok: true; pdf: string; indexed: boolean; warnings: string[] } | { ok: false; error: string };

/**
 * Write the edited CV beside the original and render it through the same
 * generate-pdf.mjs the pdf flow uses, so the fact gate runs on every edit and
 * data/pdf-index.tsv points Apply at the edited PDF. `indexed` is false when
 * the render succeeded but the index still names another PDF.
 */
export async function renderEditedPdf(load: Extract<StudioLoad, { ok: true }>, edits: StudioEdits): Promise<RenderOutcome> {
  const root = careerOpsRoot();
  const { view, added } = resolveStudio(load.doc, edits);
  const html = renderBlocks(load.tree, view, { added });
  const outDir = path.join(root, "output");
  const editedStem = path.join(outDir, load.file.replace(/\.html$/i, EDITED_SUFFIX));
  const editedHtml = `${editedStem}.html`;
  const editedPdf = `${editedStem}.pdf`;
  const previousHtml = fs.existsSync(editedHtml) ? fs.readFileSync(editedHtml, "utf8") : null;
  atomicWrite(editedHtml, html);
  const format = /size:\s*a4/i.test(html) ? "a4" : "letter";
  const render = await spawnGeneratePdf({ spawnFn: spawn, execPath: process.execPath, root, html: editedHtml, finalPdf: editedPdf, format, reportNum: load.reportNum });
  if (!render.ok) {
    if (previousHtml === null) fs.rmSync(editedHtml, { force: true });
    else atomicWrite(editedHtml, previousHtml);
    return { ok: false, error: render.stderr || "PDF rendering failed." };
  }
  const warnings = render.stderr.split("\n").map((l: string) => l.trim()).filter(Boolean);
  const mark = await markTrackerReady({ spawnFn: spawn, execPath: process.execPath, root, reportNum: load.reportNum });
  if (!mark.ok) warnings.push(`PDF rendered, but the tracker's PDF column was not updated${mark.data?.error ? `: ${mark.data.error}` : "."}`);
  const index = await pdfPathStatusForReport(load.reportNum);
  return { ok: true, pdf: path.basename(editedPdf), indexed: index.status === "found" && index.path === path.resolve(editedPdf), warnings };
}
