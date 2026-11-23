import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { realInside } from "@/lib/safe-path.mjs";

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

// Two folders hold what the app generates for a role: output/ (CVs, evaluations,
// per-company folders) and interview-prep/ (the prep guides the interview-prep
// mode writes). Listed paths are prefixed with the folder they live in.
const roots = () => ({
  output: path.resolve(careerOpsRoot(), "output"),
  "interview-prep": path.resolve(careerOpsRoot(), "interview-prep"),
});

function walk(prefix: string, base: string, dir: string, out: Entry[], recursive: boolean, skipped: { n: number }) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") skipped.n++;
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive) walk(prefix, base, full, out, recursive, skipped);
    } else if (e.isFile() && TYPES[path.extname(e.name).toLowerCase()]) {
      // isFile() is false for a symlink, so one pointing outside the folder is never listed.
      try {
        const st = fs.statSync(full);
        out.push({ path: `${prefix}/${path.relative(base, full).split(path.sep).join("/")}`, size: st.size, mtime: st.mtimeMs });
      } catch {
        skipped.n++; // removed or unreadable between the listing and the stat
      }
    }
  }
}

// GET /api/output                   -> every viewable file, plus how many entries could not be read
// GET /api/output?file=output/a/b.md -> that file (confined to its folder)
export async function GET(req: NextRequest) {
  const r = roots();
  const file = req.nextUrl.searchParams.get("file");
  if (!file) {
    const out: Entry[] = [];
    const skipped = { n: 0 };
    walk("output", r.output, r.output, out, true, skipped);
    walk("interview-prep", r["interview-prep"], r["interview-prep"], out, false, skipped);
    return Response.json({ files: out, unreadable: skipped.n });
  }
  const slash = file.indexOf("/");
  const prefix = (slash < 0 ? "" : file.slice(0, slash)) as keyof ReturnType<typeof roots>;
  const base = r[prefix];
  if (!base) return new Response("forbidden", { status: 403 });
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return new Response("unsupported", { status: 415 });
  // Follows symlinks: only a file that really lives inside its folder is served.
  const real = realInside(base, file.slice(slash + 1));
  if (!real) return new Response("not found", { status: 404 });
  try {
    const headers: Record<string, string> = { "content-type": type, "x-content-type-options": "nosniff" };
    // Generated HTML is untrusted: serve it sandboxed so scripts cannot reach the app's origin.
    if (type.startsWith("text/html")) headers["content-security-policy"] = "sandbox";
    return new Response(new Uint8Array(fs.readFileSync(real)), { headers });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
