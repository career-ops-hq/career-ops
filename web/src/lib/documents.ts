import fs from "node:fs";
import path from "node:path";

export type DocumentKind = "cv" | "cover" | "unknown";

export interface DiscoveredDocument {
  filename: string;
  kind: DocumentKind;
  date: string | null;
  reportId: string | null;
  format: string | null;
  mtimeMs: number;
}

export interface DiscoverOptions {
  outputDir: string;
  manifestPath: string | null;
  workspaceRoot: string;
  isRegularContainedFile: (absPath: string, root: string) => boolean;
}

export function discoverDocuments(opts: DiscoverOptions): DiscoveredDocument[] {
  const { outputDir, manifestPath, workspaceRoot, isRegularContainedFile } = opts;
  
  if (!fs.existsSync(outputDir)) return [];

  const manifestRows: {
    pdfAbs: string;
    reportId: string;
    date: string;
    format: string;
    kind: DocumentKind;
  }[] = [];

  if (manifestPath) {
    try {
      const text = fs.readFileSync(manifestPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || line.startsWith("#")) continue;
        const cols = line.split("\t");
        const reportId = cols[0]?.trim() || "";
        const pdfRel = cols[1]?.trim() || "";
        const format = cols[3]?.trim() || "";
        const date = cols[4]?.trim() || "";
        const rawKind = (cols[5] ?? "").trim().toLowerCase();

        let kind: DocumentKind = "unknown";
        if (rawKind === "cv") kind = "cv";
        else if (rawKind === "cover") kind = "cover";

        if (pdfRel) {
          const pdfAbs = path.normalize(path.resolve(workspaceRoot, pdfRel));
          const normOutput = path.resolve(outputDir);
          
          // Reject manifest entries that resolve outside the intended output scope
          // We only discover immediate children of outputDir, so exact dirname match is appropriate.
          if (path.dirname(pdfAbs) === normOutput) {
            manifestRows.push({ pdfAbs, reportId, date, format, kind });
          }
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw new Error("Failed to read manifest");
      }
    }
  }

  const results: DiscoveredDocument[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(outputDir);
  } catch {
    return [];
  }

  const normOutput = path.resolve(outputDir);

  for (const filename of entries) {
    if (!filename.toLowerCase().endsWith(".pdf")) continue;
    
    const absPath = path.resolve(outputDir, filename);
    
    // 2. Clarify symlink policy: Reject symlinks outright (internal and external)
    // Rationale: Generated PDFs are canonical outputs written directly by the CLI. 
    // Allowing symlinks here is unnecessary and introduces path resolution / spoofing risks.
    try {
      if (!fs.lstatSync(absPath).isFile()) continue;
    } catch {
      continue;
    }

    // Avoid escapes and double-check containment using injected guard
    if (!isRegularContainedFile(absPath, normOutput)) continue;

    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(absPath).mtimeMs;
    } catch {
      continue;
    }

    // Strict absolute path matching to avoid merging unrelated files
    const matchingRows = manifestRows.filter((r) => r.pdfAbs === absPath);
    // Use the latest entry if multiple exist (e.g. file regenerated)
    const manifestEntry = matchingRows[matchingRows.length - 1];

    let kind: DocumentKind = "unknown";
    let reportId: string | null = null;
    let date: string | null = null;
    let format: string | null = null;

    if (manifestEntry) {
      kind = manifestEntry.kind;
      reportId = manifestEntry.reportId || null;
      date = manifestEntry.date || null;
      format = manifestEntry.format || null;
    }

    // Fallback classification if manifest is missing or didn't have a kind
    if (kind === "unknown") {
      const name = filename.toLowerCase().replace(/\.pdf$/, "");
      if (name.startsWith("cv-")) {
        kind = "cv";
      } else if (/^cover([-_]|$)/.test(name) || /[-_]cover$/.test(name)) {
        kind = "cover";
      }
    }

    results.push({
      filename,
      kind,
      date,
      reportId,
      format,
      mtimeMs,
    });
  }

  // Deterministic sort: newest first, tie-break alphabetically by filename
  results.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return a.filename.localeCompare(b.filename);
  });

  return results;
}

export function encodeId(filename: string): string {
  return Buffer.from(filename).toString("base64url");
}

export function decodeId(id: string): string {
  try {
    return Buffer.from(id, "base64url").toString("utf-8");
  } catch {
    return "";
  }
}

export async function handleDocumentsRequest(
  req: Request,
  root: string,
  manifestPath: string | null,
  isRegularContainedFile: (absPath: string, root: string) => boolean
) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  const outputDir = path.join(root, "output");

  let documents: DiscoveredDocument[];
  try {
    documents = discoverDocuments({
      outputDir,
      manifestPath,
      workspaceRoot: root,
      isRegularContainedFile
    });
  } catch (err) {
    return new Response("failed to discover documents", { status: 500 });
  }

  if (id) {
    const filename = decodeId(id);
    if (!filename) return new Response("invalid identifier", { status: 400 });

    const doc = documents.find(d => d.filename === filename);
    if (!doc) return new Response("document not found", { status: 404 });

    const absPath = path.resolve(outputDir, filename);

    if (!isRegularContainedFile(absPath, path.resolve(outputDir))) {
      return new Response("document unavailable", { status: 404 });
    }

    let fd: number;
    try {
      // O_NOFOLLOW prevents opening a symlink as a file (supported on POSIX, may be ignored on Windows).
      fd = fs.openSync(absPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    } catch {
      return new Response("document unavailable", { status: 404 });
    }

    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) {
        return new Response("document unavailable", { status: 404 });
      }

      const buf = fs.readFileSync(fd);
      const asciiFilename = doc.filename.replace(/[^\x20-\x7E]/g, "?").replace(/(["\\])/g, "\\$1");
      const encodedFilename = encodeURIComponent(doc.filename);
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
          "Cache-Control": "no-store"
        }
      });
    } catch {
      return new Response("could not read the PDF", { status: 500 });
    } finally {
      fs.closeSync(fd);
    }
  }

  const payload = documents.map(doc => ({
    id: encodeId(doc.filename),
    filename: doc.filename,
    kind: doc.kind,
    date: doc.date,
    reportId: doc.reportId,
    format: doc.format,
    mtimeMs: doc.mtimeMs
  }));

  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" }
  });
}
