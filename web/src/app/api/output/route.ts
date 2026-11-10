import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveInside } from "@/lib/prep.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

type Entry = { path: string; size: number; mtime: number };

function walk(base: string, dir: string, out: Entry[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(base, full, out);
    else if (TYPES[path.extname(e.name).toLowerCase()]) {
      const st = fs.statSync(full);
      out.push({ path: path.relative(base, full).split(path.sep).join("/"), size: st.size, mtime: st.mtimeMs });
    }
  }
}

// GET /api/output            -> list of every viewable file under output/
// GET /api/output?file=a/b.md -> that file (path-confined to output/)
export async function GET(req: NextRequest) {
  const base = path.resolve(careerOpsRoot(), "output");
  const file = req.nextUrl.searchParams.get("file");
  if (!file) {
    const out: Entry[] = [];
    try {
      walk(base, base, out);
    } catch {
      /* no output dir yet */
    }
    return Response.json({ files: out });
  }
  const full = resolveInside(base, file);
  if (!full) return new Response("forbidden", { status: 403 });
  const type = TYPES[path.extname(full).toLowerCase()];
  if (!type) return new Response("unsupported", { status: 415 });
  try {
    return new Response(new Uint8Array(fs.readFileSync(full)), { headers: { "content-type": type } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
