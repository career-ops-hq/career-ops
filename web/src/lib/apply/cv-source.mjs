import fs from "node:fs";
import path from "node:path";

/**
 * A READABLE path to the tailored CV the apply flow uploads, so the planner
 * drafting the structured answers reads the document the reviewer is holding.
 *
 * Resolution goes through the `pdf` column of `data/pdf-index.tsv`, instead of a
 * second match over `output/`. generate-pdf.mjs writes one row per rendered
 * artifact and drops any existing row naming the same PDF, so a PDF path
 * identifies exactly one row and its `html` column is that PDF's own source.
 * Matching the company or the report number again would be a second, independent
 * lookup that can disagree with the first: by the company, because two roles at
 * one employer share it; by the report number, because a cover letter for the
 * same report is its own row.
 *
 * Falls back to the PDF itself when no rendering survives. A missing rendering
 * still leaves that PDF going into the form, so name it. Treating it as an
 * absent tailored CV puts back the contradiction this resolver prevents.
 *
 * @param {string} root - Career-ops workspace root (see careerOpsRoot()).
 * @param {string | undefined | null} pdfPath - The attached CV, absolute or root-relative.
 * @returns {string | null} Root-relative path to the CV to draft from, or null.
 */
export function applyCvSource(root, pdfPath) {
  const rel = toRootRelative(root, pdfPath);
  if (!rel) return null;

  const fromManifest = manifestHtml(root, rel);
  if (fromManifest) {
    const kept = keepInsideRoot(root, fromManifest);
    if (kept) return kept;
  }

  // No row, an empty html column, or a rendering since cleaned up. The PDF's own
  // `.html` sibling is the same document where `pdf` mode left it.
  if (rel.toLowerCase().endsWith(".pdf")) {
    const sibling = keepInsideRoot(root, rel.slice(0, -4) + ".html");
    if (sibling) return sibling;
  }
  return keepInsideRoot(root, rel);
}

/** Normalize a PDF path to the root-relative, forward-slash spelling the
 *  manifest stores. Null for a path outside the root. */
function toRootRelative(root, p) {
  const s = (p ?? "").trim();
  if (!s) return null;
  const abs = path.isAbsolute(s) ? s : path.join(root, s);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** The `html` column of the manifest row naming this PDF. Last match wins, so a
 *  regenerated CV supersedes an earlier row for the same file. */
function manifestHtml(root, relPdf) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, "data", "pdf-index.tsv"), "utf8");
  } catch {
    return null; // no PDF was ever generated here
  }
  let html = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields[1] !== relPdf) continue;
    html = (fields[2] || "").trim();
  }
  return html || null;
}

/** A manifest path is local data, and it is still handed to an agent with read
 *  access. Confirm it resolves to a real file inside the root, following
 *  symlinks, before naming it in a prompt. */
function keepInsideRoot(root, relCandidate) {
  let realAbs;
  let realRoot;
  try {
    realAbs = fs.realpathSync(path.resolve(root, relCandidate));
    realRoot = fs.realpathSync(root);
  } catch {
    return null; // missing file
  }
  const rel = path.relative(realRoot, realAbs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}
